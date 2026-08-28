/**
 * coreCommands.ts
 *
 * Built-in command handlers live in the kernel namespace, independently of
 * the external plugin registry and manyplug configuration.
 */

import type { CommandHandler } from "./commandRegistry.js";
import type { PluginContext } from "./pluginApi.js";

// Mirrors src/locales/*.json — the only languages with a translation file.
const AVAILABLE_LOCALES = ["pt", "en", "es"];

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
    const locale = pctx.settings.get<string | null>("chat_locale", null);
    await pctx.send.text(
      "⚙️ Configuração deste chat:\n" +
      `• Prefixo: ${prefix ?? "(padrão)"}\n` +
      `• Idioma: ${locale ?? "(padrão)"}\n\n` +
      "Use !config prefixo <novo> ou !config idioma <pt|en|es> para alterar."
    );
  },

  // `!config prefixo <novo>`
  setChatPrefix: async (ctx, input) => {
    const pctx = ctx as PluginContext;
    const value = (input as ChatConfigInput | undefined)?.args?.[0];
    if (!value || value.length > 5) {
      await pctx.send.text("Uso: !config prefixo <novo prefixo> (até 5 caracteres)");
      return;
    }
    pctx.settings.set("chat_prefix", value);
    await pctx.send.text(
      `✅ Prefixo salvo como "${value}" para este chat.\n` +
      `A partir de agora, use "${value}" em vez do prefixo padrão neste chat.`
    );
  },

  // `!config idioma <pt|en|es>`
  setChatLocale: async (ctx, input) => {
    const pctx = ctx as PluginContext;
    const value = (input as ChatConfigInput | undefined)?.args?.[0]?.toLowerCase();
    if (!value || !AVAILABLE_LOCALES.includes(value)) {
      await pctx.send.text(`Uso: !config idioma <${AVAILABLE_LOCALES.join("|")}>`);
      return;
    }
    pctx.settings.set("chat_locale", value);
    await pctx.send.text(
      `✅ Idioma salvo como "${value}" para este chat.\n` +
      "As mensagens do sistema de comandos (menu, permissões, avisos de uso) passam a usar esse idioma neste chat."
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

