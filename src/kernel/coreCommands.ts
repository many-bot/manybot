/**
 * coreCommands.ts
 *
 * Built-in command handlers live in the kernel namespace, independently of
 * the external plugin registry and manyplug configuration.
 */

import type { CommandHandler } from "./commandRegistry.js";
import type { PluginContext } from "./pluginApi.js";
import { getAvailableLocales } from "#i18n";

interface ChatConfigInput {
  args?: string[];
}

const handlers: Record<string, CommandHandler> = {
  ping: async (ctx) => {
    await (ctx as PluginContext).send.text("pong");
  },
  status: async (ctx) => {
    await (ctx as PluginContext).send.text("ManyBot está online.");
  },

  // `!configurar` / `!config` / `!cfg` (no subcommand) — shows the
  // current per-chat overrides. Persisted via ctx.settings, which
  // (per pluginApi.ts) is already scoped to plugin "core" + the
  // current chat — same storage pattern already used for
  // last_welcome_seen in commandMenu.ts.
  setChatConfig: async (ctx) => {
    const pctx = ctx as PluginContext;
    const prefix = pctx.settings.get<string | null>("chat_prefix", null);
    const locale = pctx.i18n.getChatLocale() ?? null;
    const defaultLabel = pctx.t("config.defaultValue");
    await pctx.send.text(
      pctx.t("config.current", {
        prefix: prefix ?? defaultLabel,
        locale: locale ?? defaultLabel,
        available: getAvailableLocales().join("|"),
      })
    );
  },

  // `!config prefixo <novo>`
  setChatPrefix: async (ctx, input) => {
    const pctx = ctx as PluginContext;
    const value = (input as ChatConfigInput | undefined)?.args?.[0];
    if (!value || value.length > 5) {
      await pctx.send.text(pctx.t("config.prefixUsage"));
      return;
    }
    pctx.settings.set("chat_prefix", value);
    await pctx.send.text(pctx.t("config.prefixSaved", { value }));
  },

  // `!config idioma <código>` (or `padrao` to follow the bot default again)
  setChatLocale: async (ctx, input) => {
    const pctx = ctx as PluginContext;
    const value = (input as ChatConfigInput | undefined)?.args?.[0]?.toLowerCase();
    const available = pctx.i18n.available();
    if (value === "padrao" || value === "padrão" || value === "default") {
      pctx.i18n.clearChatLocale();
      await pctx.send.text(pctx.t("config.localeCleared", { lang: pctx.i18n.getCurrentLang() }));
      return;
    }
    const usage = () => pctx.send.text(pctx.t("config.localeUsage", { available: available.join("|") }));
    if (!value) {
      await usage();
      return;
    }
    let locale: string;
    try {
      locale = pctx.i18n.setChatLocale(value);
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
      await usage();
      return;
    }
    await pctx.send.text(
      pctx.t("config.localeSaved", { lang: locale })
    );
  },
};

export function resolveCoreCommandHandler(name: string): CommandHandler {
  return handlers[name] ?? (async () => {
    throw new Error(`Core handler "${name}" is not registered`);
  });
}

export function registerCoreCommand(name: string, handler: CommandHandler): void {
  handlers[name] = handler;
}

