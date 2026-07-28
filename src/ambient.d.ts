/*
* src/ambient.d.ts
* 
* This file basically describes types for untyped packages
*
* */

declare module "qrcode-terminal" {
  interface QRCode {
    generate(text: string, opts?: { small?: boolean }): void;
    setErrorLevel(level: "L" | "M" | "Q" | "H"): void;
    error: string;
  }
  const qrcode: QRCode;
  export = qrcode;
}

declare module "node-webpmux" {
  interface WebPFrame {
    delay: number; // milliseconds
    [key: string]: unknown;
  }
  class Image {
    hasAnim: boolean;
    hasAlpha: boolean;
    width: number;
    height: number;
    frames?: WebPFrame[];
    load(source: string | Buffer): Promise<void>;
    demux(opts: { buffers: true; path?: undefined; frame?: number; start?: number; end?: number }): Promise<Buffer[]>;
    demux(opts?: { path?: string; buffers?: false; frame?: number; start?: number; end?: number }): Promise<void>;
    save(path: string | null, options?: Record<string, unknown>): Promise<Buffer | void>;
  }
  const WebP: { Image: typeof Image };
  export default WebP;
  export { Image };
}

declare module "node-cron" {
  interface ScheduledTask {
    stop(): void;
    start(): void;
    destroy(): void;
  }
  function schedule(expression: string, fn: () => void, options?: Record<string, unknown>): ScheduledTask;
  function validate(expression: string): boolean;
  export = { schedule, validate };
}
