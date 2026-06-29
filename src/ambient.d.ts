// ── Untyped packages ──────────────────────────────────────────────────────────

declare module "qrcode-terminal" {
  interface QRCode {
    generate(text: string, opts?: { small?: boolean }): void;
    setErrorLevel(level: "L" | "M" | "Q" | "H"): void;
    error(err: string): void;
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
