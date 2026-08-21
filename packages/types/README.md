# @manybot/types

Type definitions for building [ManyBot](https://github.com/many-bot/manybot) plugins — get full
autocomplete on the `ctx` object without depending on the whole `@manybot/manybot` package.

## Install

```bash
npm install --save-dev @manybot/types
```

`@whiskeysockets/baileys` is a peer dependency, but only needed for the (optional)
`ctx.wa.sock` escape hatch — if you don't have it installed, TypeScript will still
type everything else fine.

## Usage

Plain JS plugins, no build step required:

```js
/**
 * @param {import('@manybot/types').PluginContext} ctx
 */
export default async function (ctx) {
  if (ctx.msg.is("teste")) {
    const msg = await ctx.send.text("teste");
    await msg.reply.text("respondendo");
  }
}
```

`setup(ctx)` plugins use `SetupContext` the same way:

```js
/**
 * @param {import('@manybot/types').SetupContext} ctx
 */
export async function setup(ctx) {
  ctx.log.info("plugin loaded");
}
```

### Skipping the per-file import

If every plugin file is covered by one `tsconfig.json`/`jsconfig.json` with
`"checkJs": true`, add a small ambient file to your project:

```ts
// manybot-globals.d.ts
declare global {
  type PluginContext = import("@manybot/types").PluginContext;
  type SetupContext  = import("@manybot/types").SetupContext;
}
export {};
```

and make sure it's covered by `"include"`. Then every plugin can just write:

```js
/**
 * @param {PluginContext} ctx
 */
export default async function (ctx) { ... }
```

## What's typed

`PluginContext`, `SetupContext`, and everything under them: `ctx.send`, `ctx.msg`,
`ctx.chat`, `ctx.admin`, `ctx.me`, `ctx.poll`, `ctx.contacts`, `ctx.storage`,
`ctx.config`, `ctx.i18n`, `ctx.events`, `ctx.settings`, and `ctx.wa`.

## Versioning

This package tracks the plugin API surface of `@manybot/manybot`, not the bot's own
version. Breaking changes to `ctx` bump the major version here.
