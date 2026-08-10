import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import * as clack from "@clack/prompts";
import { persistConfigValue } from "#config";
import { t } from "#i18n";

interface ArchTarget {
  name: string;
  os: string;
  arch: string;
}

const SUPPORTED: ArchTarget[] = [
  { os: "linux",   arch: "x64",   name: "whatsmeow-service-linux-x64" },
  { os: "linux",   arch: "arm64", name: "whatsmeow-service-linux-arm64" },
  { os: "win32",   arch: "x64",   name: "whatsmeow-service-windows-x64.exe" },
];

function detectTarget(): ArchTarget | null {
  return SUPPORTED.find(
    (t) => t.os === process.platform && t.arch === process.arch
  ) ?? null;
}

function str(val: string | Record<string, unknown>): string {
  return typeof val === "string" ? val : String(val);
}

async function fetchLatestTag(): Promise<string> {
  const res = await fetch(
    "https://codeberg.org/api/v1/repos/many-bot/manybot/releases/latest"
  );
  if (!res.ok) throw new Error(`Codeberg API: ${res.status}`);
  const data = await res.json() as { tag_name?: string };
  return data.tag_name ?? "v5.6.1";
}

function binaryDir(): string {
  return path.resolve(process.cwd(), "whatsmeow-service", "bin");
}

export async function promptWhatsmeowInstall(): Promise<void> {
  const target = detectTarget();
  if (!target) {
    clack.log.warn(str(t("whatsmeow.unsupportedArch", { os: process.platform, arch: process.arch })));
    return;
  }

  const choice = await clack.confirm({
    message: str(t("whatsmeow.installPrompt")),
    initialValue: false,
  });
  if (clack.isCancel(choice) || !choice) return;

  const spin = clack.spinner();
  spin.start(str(t("whatsmeow.fetchingTag")));

  let tag: string;
  try {
    tag = await fetchLatestTag();
  } catch {
    spin.stop(str(t("whatsmeow.fetchFailed")));
    return;
  }

  const url = `https://codeberg.org/many-bot/manybot/releases/download/${tag}/${target.name}`;
  spin.message(str(t("whatsmeow.downloading", { url })));

  let res: Response;
  try {
    res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
  } catch (e) {
    spin.stop(str(t("whatsmeow.downloadFailed", { reason: (e as Error).message })));
    return;
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  const dir = binaryDir();
  mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "whatsmeow-service");
  writeFileSync(outPath, buffer);
  chmodSync(outPath, 0o755);

  await persistConfigValue("driver_whatsmeow_enabled", "true");

  spin.stop(str(t("whatsmeow.installed", { path: outPath })));

  clack.note(
    str(t("whatsmeow.restartNotice")),
    str(t("whatsmeow.installTitle"))
  );
}