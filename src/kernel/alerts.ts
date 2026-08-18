/**
 * alerts.ts
 *
 * Local-first critical alerting. The whole point is to still reach the
 * dev when the thing most likely to fail — the bot's own WhatsApp
 * connection — is exactly what's down. So WhatsApp is one sink among
 * several, never the only one:
 *
 *   1. Log file (~/.manybot/alerts.log) — always written, no dependency
 *      on anything external. The one sink guaranteed to work.
 *   2. OS notification (notify-send / osascript) — best-effort, only
 *      if the process is still alive to fire it.
 *   3. WhatsApp (ADMIN_JID)              — best-effort, only if a
 *      socket has been registered and the bot is actually connected.
 *   4. Email (SMTP)                      — best-effort, only if
 *      SMTP_HOST is configured.
 *
 * Sinks never block each other — a failure in one (e.g. SMTP down)
 * must not stop the log write or the other sinks.
 *
 * Kernel code must stay driver-agnostic: this module never imports the
 * WhatsApp driver directly. Instead the driver calls
 * registerAlertSockProvider() once at startup so this module can reach
 * it indirectly, keeping the dependency pointing driver → kernel.
 */

import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import nodemailer from "nodemailer";
import {
  CONFIG_DIR, ADMIN_JID,
  SMTP_HOST, SMTP_PORT, SMTP_SEC, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_TO, SMTP_INSECURE,
} from "#config";
import { logger } from "#logger";
import { t } from "#i18n";

export type AlertLevel = "info" | "warning" | "critical";

export interface AlertEvent {
  level:   AlertLevel;
  title:   string;
  message: string;
}

const ALERTS_LOG_FILE = path.join(CONFIG_DIR, "alerts.log");

// ── Driver registration (see module docblock) ───────────────────────────────

type SockLike = { sendMessage: (jid: string, content: { text: string }) => Promise<unknown> };
let sockProvider: (() => SockLike | null) | null = null;

/**
 * Called once by a driver (e.g. the WhatsApp driver) at startup so alerts
 * can reach ADMIN_JID when the bot is connected. Safe to call multiple
 * times — the latest provider wins.
 * @param {() => SockLike | null} provider
 */
export function registerAlertSockProvider(provider: () => SockLike | null): void {
  sockProvider = provider;
}

// ── Sinks ─────────────────────────────────────────────────────────────────

async function logToFile(event: AlertEvent): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const line = `[${new Date().toISOString()}] [${event.level.toUpperCase()}] ${event.title} — ${event.message}\n`;
    await fs.appendFile(ALERTS_LOG_FILE, line, "utf8");
  } catch (e) {
    // Last-resort fallback — if even the log write fails, at least surface
    // it on stderr so it's visible in whatever is supervising the process.
    logger.error(`[alerts] failed to write ${ALERTS_LOG_FILE}: ${(e as Error).message}`);
  }
}

function notifyOS(event: AlertEvent): Promise<void> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === "linux") {
      cmd  = "notify-send";
      args = [event.title, event.message];
    } else if (platform === "darwin") {
      cmd  = "osascript";
      args = ["-e", `display notification ${JSON.stringify(event.message)} with title ${JSON.stringify(event.title)}`];
    } else {
      // Windows toast notifications need extra tooling (BurntToast) that
      // isn't available out of the box — skip rather than half-implement.
      logger.debug(`[alerts] OS notification not supported on ${platform}, skipping`);
      resolve();
      return;
    }

    const proc = spawn(cmd, args, { stdio: "ignore" });
    proc.on("error", (e) => {
      logger.debug(`[alerts] OS notification failed (non-fatal): ${(e as Error).message}`);
      resolve();
    });
    proc.on("exit", () => resolve());
  });
}

/**
 * Accepts either a full JID ("5511999999999@s.whatsapp.net") or a bare
 * phone number ("+55 11 99999-9999", "5511999999999") in ADMIN_JID —
 * strips formatting and appends the WhatsApp suffix when missing.
 * @param {string} raw
 */
function normalizeAdminJid(raw: string): string {
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

async function notifyWhatsApp(event: AlertEvent): Promise<void> {
  if (!ADMIN_JID) return;
  const sock = sockProvider?.();
  if (!sock) return; // bot not connected — expected during the exact outages this exists for

  try {
    await sock.sendMessage(normalizeAdminJid(ADMIN_JID), { text: `*[${event.level.toUpperCase()}] ${event.title}*\n\n${event.message}` });
  } catch (e) {
    logger.debug(`[alerts] WhatsApp sink failed (non-fatal): ${(e as Error).message}`);
  }
}

let mailer: ReturnType<typeof nodemailer.createTransport> | null = null;

function getMailer(): ReturnType<typeof nodemailer.createTransport> | null {
  if (!SMTP_HOST || !SMTP_TO) return null;
  if (mailer) return mailer;

  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SEC === "ssl",
    requireTLS: SMTP_SEC === "starttls",
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    // Local SMTP proxies (Proton Mail Bridge, Mailhog, Mailpit...) present
    // a self-signed cert — only skip validation when explicitly opted in.
    tls: SMTP_INSECURE ? { rejectUnauthorized: false } : undefined,
  });
  return mailer;
}

async function notifyEmail(event: AlertEvent): Promise<void> {
  const transport = getMailer();
  if (!transport) return;

  try {
    await transport.sendMail({
      from:    SMTP_FROM || SMTP_USER,
      to:      SMTP_TO,
      subject: `[manybot] [${event.level.toUpperCase()}] ${event.title}`,
      text:    event.message,
    });
  } catch (e) {
    logger.debug(`[alerts] email sink failed (non-fatal): ${(e as Error).message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Fires an alert through every configured sink. The log write always
 * happens; OS notification, WhatsApp, and email are best-effort and run
 * independently — one failing never blocks the others.
 * @param {AlertEvent} event
 */
export async function sendAlert(event: AlertEvent): Promise<void> {
  await logToFile(event);
  await Promise.allSettled([
    notifyOS(event),
    notifyWhatsApp(event),
    notifyEmail(event),
  ]);
}

/**
 * Fire-and-forget alert by semantic kind. Thin wrapper over sendAlert
 * for callers that just want to say "this kind of bad thing happened"
 * without building a full AlertEvent each time. Unknown kinds fall
 * through as a warning with the kind name as the title and the details
 * object stringified into the message — so a future kind added in one
 * place but not yet mapped here still surfaces in the log instead of
 * silently disappearing.
 *
 * Mapped kinds:
 *   send_failed_no_fallback   — primary failed, no secondary available
 *   send_failed_both_drivers  — both primary and secondary failed
 */
export type AlertKind =
  | "send_failed_no_fallback"
  | "send_failed_both_drivers"
  | (string & {}); // open for future kinds without breaking the union

export function fireAlert(kind: AlertKind, details: Record<string, unknown> = {}): void {
  let event: AlertEvent;
  if (kind === "send_failed_no_fallback") {
    event = {
      level:   "critical",
      title:   t("alerts.noFallbackTitle"),
      message: `jid=${details.jid} primary=${details.primary}`,
    };
  } else if (kind === "send_failed_both_drivers") {
    event = {
      level:   "critical",
      title:   t("alerts.bothDriversFailedTitle"),
      message: `jid=${details.jid} ${details.primary}->${details.secondary}` +
               (details.error ? ` error=${String(details.error)}` : ""),
    };
  } else {
    event = {
      level:   "warning",
      title:   kind,
      message: JSON.stringify(details),
    };
  }
  void sendAlert(event);
}
