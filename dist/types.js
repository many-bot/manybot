/**
 * src/types.ts
 *
 * Shared WhatsApp-facing types, imported everywhere as "#types" (see
 * tsconfig.json paths / package.json imports). Kept as a single module so
 * call sites don't need to know whether a type comes straight from
 * Baileys or from ManyBot's own store/adapter layer.
 *
 * Types that are only meaningful within the plugin-API builder itself
 * (the shape of `ctx`, `ctx.msg`, the chainable sender returned by
 * ctx.send/ctx.msg.reply, etc.) are NOT defined here — they're inferred
 * with `ReturnType<typeof ...>` right next to the functions that build
 * them, in drivers/whatsapp/api/index.ts, to avoid circular type
 * definitions.
 */
export {};
