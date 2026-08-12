import { logger } from "#logger";
import { CONFIG } from "#config";
import { t } from "#i18n";
import type { WaContract, SentMessageRef, BotMessage, BotQuotedRef, WaEventName, WaEventPayload } from "#kernel/waContract.js";
import type { BotPollOptions, BotMe, BotGroupMetadata } from "#kernel/waContract.js";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";

/**
 * Whatsmeow gRPC client implementing the WaContract interface.
 *
 * Phase 1 scope: only the send path (sendText) and the
 * verification primitives (getHistory) are fully wired. Every other
 * WaContract method throws "not implemented" — the kernel loads plugins
 * only after `connection.update === "open"`, and a plugin that calls e.g.
 * `groupMetadata` on a whatsmeow-primary bot will surface a clear error
 * to the caller, not a silent no-op.
 *
 * Connects to the address defined in config (default localhost:50051).
 */
class WhatsmeowClient implements Partial<WaContract> {
  readonly name = "whatsmeow" as const;
  private client: any; // grpc client stub
  private ready = false;
  private handlers = new Map<WaEventName, Set<(payload: unknown) => void>>();

  /**
   * Resolve the .proto path relative to this compiled module so it works
   * in ESM (where __dirname doesn't exist), under `node dist/main.js`
   * (proto is copied to dist/drivers/whatsmeow/whatsmeow.proto by the
   * build), and under a global npm install (the proto ships alongside
   * the JS in the package's `dist/` per `files` in package.json). In
   * dev (`tsx src/main.ts`) the proto already lives next to this source
   * file, so the same relative path resolves correctly there too.
   */
  private resolveProtoPath(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, "whatsmeow.proto");
  }

  private loadProto() {
    const protoPath = this.resolveProtoPath();
    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const grpcObj = grpc.loadPackageDefinition(packageDef) as any;
    return grpcObj.whatsmeow.WhatsmeowService as any;
  }

  async connect(): Promise<void> {
    const address = CONFIG.drivers.whatsmeow.grpcAddress ?? "localhost:50051";
    const Service = this.loadProto();
    this.client = new Service(address, grpc.credentials.createInsecure());

    // 1. Health check — confirm the gRPC server is up
    await new Promise<void>((resolve, reject) => {
      this.client.HealthCheck({} as any, (err: grpc.ServiceError, resp: any) => {
        if (err) return reject(err);
        this.ready = !!resp?.ready;
        if (this.ready) resolve();
        else reject(new Error("Whatsmeow service not ready"));
      });
    });
    logger.info("[whatsmeow] gRPC service ready");

    // 2. Call Connect RPC — initiates WhatsApp auth (QR or reuse existing session)
    const connectResp: { ok: boolean; qrCode: string } = await new Promise((resolve, reject) => {
      this.client.Connect({} as any, (err: grpc.ServiceError, resp: any) => {
        if (err) return reject(err);
        resolve(resp);
      });
    });

    const needsAuth = !connectResp.ok;

    if (needsAuth && connectResp.qrCode) {
      logger.info(t("system.qrScan"));
      qrcode.generate(connectResp.qrCode, { small: true });
    }

    // 3. Set up auth deferred BEFORE SubscribeEvents to avoid race
    let authDeferred: { resolve: () => void; reject: (e: Error) => void } | null = null;
    let authDone = false;
    const authPromise = needsAuth
      ? new Promise<void>((resolve, reject) => {
          authDeferred = { resolve, reject };
          setTimeout(() => {
            if (!authDone) {
              authDone = true;
              reject(new Error("Whatsmeow auth timeout (2 min)"));
            }
          }, 120_000);
        })
      : Promise.resolve();

    // 4. Open the server-streaming event subscription
    const stream: grpc.ClientReadableStream<any> = this.client.SubscribeEvents({} as any);

    stream.on("data", (raw: { payload?: string; message?: unknown; connState?: { state?: string } }) => {
      // Resolve auth promise when connection opens (QR scanned / session reused)
      if (!authDone && authDeferred && raw.connState?.state === "open") {
        authDone = true;
        authDeferred.resolve();
        authDeferred = null;
      }
      try {
        if (raw.connState) {
          const state = raw.connState.state ?? "connecting";
          this.dispatch("connection.update", {
            connection: state === "open" ? "open" : state === "close" ? "close" : "connecting",
          });
        } else if (raw.message) {
          this.dispatch("messages.upsert", {
            messages: [raw.message as BotMessage],
            type: "notify",
          });
        }
      } catch (e) {
        logger.debug(`[whatsmeow] event dispatch failed: ${(e as Error).message}`);
      }
    });
    stream.on("error", (err: Error) => {
      if (!authDone) {
        authDone = true;
        authDeferred?.reject(err);
        authDeferred = null;
      }
      logger.warn(`[whatsmeow] event stream error: ${err.message}`);
      this.ready = false;
    });
    stream.on("end", () => {
      if (!authDone) {
        authDone = true;
        authDeferred?.reject(new Error("Event stream ended before auth completed"));
        authDeferred = null;
      }
      logger.warn(`[whatsmeow] event stream ended`);
      this.ready = false;
    });

    // 5. If not authenticated, wait for connState === "open" from the event stream
    await authPromise;

    if (needsAuth) {
      logger.info("[whatsmeow] authenticated");
    }

    this.ready = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await new Promise<void>((resolve) => {
          this.client.Disconnect({} as any, () => resolve());
        });
      } catch {}
      this.client.close();
    }
    this.ready = false;
  }

  isReady(): boolean {
    return this.ready;
  }

  // ── Event fan-out ─────────────────────────────────────────────────────────
  on<E extends WaEventName>(event: E, handler: (payload: WaEventPayload<E>) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) { set = new Set(); this.handlers.set(event, set); }
    set.add(handler as (p: unknown) => void);
    return () => set!.delete(handler as (p: unknown) => void);
  }

  private dispatch(event: WaEventName, payload: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try { (h as (p: unknown) => void)(payload); }
      catch (e) { logger.debug(`[whatsmeow] handler for "${event}" threw: ${(e as Error).message}`); }
    }
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  // Only sendText is in phase-1 scope. Media fallback is
  // documented in the interface but explicitly deferred.

  async sendText(jid: string, text: string, opts?: { quoted?: BotQuotedRef; mentions?: string[] }): Promise<SentMessageRef> {
    const req = {
      jid,
      text,
      quotedId: opts?.quoted?.id ?? "",
      mentions: opts?.mentions ?? [],
    };
    return new Promise<SentMessageRef>((resolve, reject) => {
      this.client.SendText(req, (err: grpc.ServiceError, resp: any) => {
        if (err) return reject(err);
        resolve({ id: resp.id, chatId: resp.chatId, timestamp: Number(resp.timestamp) });
      });
    });
  }

  // ── Verification primitive ─────────────────────────────────────────────────

  async getHistory(jid: string, opts?: { limit?: number }): Promise<BotMessage[]> {
    const req = { jid, limit: opts?.limit ?? 5 };
    return new Promise<BotMessage[]>((resolve, reject) => {
      this.client.GetHistory(req, (err: grpc.ServiceError, resp: any) => {
        if (err) return reject(err);
        resolve(resp.messages ?? []);
      });
    });
  }

  // ── All other WaContract methods: stubbed for now ─────────────────────────
  // These throw a clear error so a plugin calling them on a whatsmeow-
  // primary bot fails loudly instead of silently no-op'ing. Coverage will
  // grow in later phases as the whatsmeow .proto grows.

  private unimplemented(method: string): never {
    throw new Error(`[whatsmeow] ${method} not implemented in whatsmeow driver yet`);
  }

  async resolveLid(_lid: string): Promise<string | null> { return null; }

  async sendImage(_jid: string, _buffer: Buffer, _opts?: { caption?: string; quoted?: BotQuotedRef; mentions?: string[]; viewOnce?: boolean }): Promise<SentMessageRef> { this.unimplemented("sendImage"); }
  async sendVideo(_jid: string, _buffer: Buffer, _opts?: { caption?: string; quoted?: BotQuotedRef; mentions?: string[]; viewOnce?: boolean; gifPlayback?: boolean }): Promise<SentMessageRef> { this.unimplemented("sendVideo"); }
  async sendAudio(_jid: string, _buffer: Buffer, _opts?: { quoted?: BotQuotedRef; viewOnce?: boolean; ptt?: boolean; mimetype?: string }): Promise<SentMessageRef> { this.unimplemented("sendAudio"); }
  async sendSticker(_jid: string, _buffer: Buffer, _opts?: { quoted?: BotQuotedRef }): Promise<SentMessageRef> { this.unimplemented("sendSticker"); }
  async sendDocument(_jid: string, _buffer: Buffer, _filename: string, _mimetype: string, _opts?: { quoted?: BotQuotedRef }): Promise<SentMessageRef> { this.unimplemented("sendDocument"); }
  async sendPoll(_jid: string, _opts: BotPollOptions & { quoted?: BotQuotedRef }): Promise<SentMessageRef> { this.unimplemented("sendPoll"); }

  async react(_jid: string, _target: BotQuotedRef, _emoji: string): Promise<void> { this.unimplemented("react"); }
  async deleteMessage(_jid: string, _target: BotQuotedRef, _forEveryone: boolean): Promise<void> { this.unimplemented("deleteMessage"); }
  async editMessage(_jid: string, _target: BotQuotedRef, _text: string): Promise<void> { this.unimplemented("editMessage"); }

  async sendPresenceUpdate(_state: "composing" | "recording" | "paused", _jid: string): Promise<void> { this.unimplemented("sendPresenceUpdate"); }
  async readMessages(_keys: BotQuotedRef[]): Promise<void> { this.unimplemented("readMessages"); }

  async onWhatsApp(_jid: string): Promise<{ exists: boolean }[] | null> { this.unimplemented("onWhatsApp"); }
  async getBusinessProfile(_jid: string): Promise<unknown | null> { this.unimplemented("getBusinessProfile"); }
  async profilePictureUrl(_jid: string): Promise<string | null> { this.unimplemented("profilePictureUrl"); }
  async fetchStatus(_jid: string): Promise<string | null> { this.unimplemented("fetchStatus"); }
  async updateBlockStatus(_jid: string, _action: "block" | "unblock"): Promise<void> { this.unimplemented("updateBlockStatus"); }
  async addOrEditContact(_jid: string, _info: { fullName: string; firstName?: string; saveOnPrimaryAddressbook?: boolean }): Promise<void> { this.unimplemented("addOrEditContact"); }
  async removeContact(_jid: string): Promise<void> { this.unimplemented("removeContact"); }

  async groupMetadata(_jid: string): Promise<BotGroupMetadata> { this.unimplemented("groupMetadata"); }
  async groupParticipantsUpdate(_jid: string, _users: string[], _action: "add" | "remove" | "promote" | "demote"): Promise<Array<{ status: string; jid?: string }>> { this.unimplemented("groupParticipantsUpdate"); }
  async groupUpdateSubject(_jid: string, _subject: string): Promise<void> { this.unimplemented("groupUpdateSubject"); }
  async groupUpdateDescription(_jid: string, _description: string): Promise<void> { this.unimplemented("groupUpdateDescription"); }
  async groupInviteCode(_jid: string): Promise<string> { this.unimplemented("groupInviteCode"); }
  async groupRevokeInvite(_jid: string): Promise<string> { this.unimplemented("groupRevokeInvite"); }

  async updateProfilePicture(_jid: string, _buffer: Buffer): Promise<void> { this.unimplemented("updateProfilePicture"); }
  async updateProfileName(_name: string): Promise<void> { this.unimplemented("updateProfileName"); }
  async updateProfileStatus(_status: string): Promise<void> { this.unimplemented("updateProfileStatus"); }

  me(): BotMe { this.unimplemented("me"); }

  async downloadMedia(_msg: BotMessage, _opts: { asMp4?: boolean }): Promise<{ mimetype: string; data: Buffer } | null> { this.unimplemented("downloadMedia"); }
}

export const whatsmeowContract: WaContract = new WhatsmeowClient() as WaContract;