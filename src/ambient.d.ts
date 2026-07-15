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
