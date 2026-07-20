/**
 * clipboard.ts
 *
 * Writes text to the system clipboard using whatever OS-native tool is
 * available. No npm dependency — just spawns pbcopy/clip/xclip/xsel/wl-copy.
 */

import { spawn } from "child_process";

function tryCommand(cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve(false);
      return;
    }

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));

    child.stdin.on("error", () => {});
    child.stdin.write(text);
    child.stdin.end();
  });
}

/**
 * Copies `text` to the system clipboard.
 * Returns false (never throws) if no supported clipboard tool is found.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const candidates: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
      ? [["clip", []]]
      : [
          ["xclip", ["-selection", "clipboard"]],
          ["xsel", ["--clipboard", "--input"]],
          ["wl-copy", []],
        ];

  for (const [cmd, args] of candidates) {
    if (await tryCommand(cmd, args, text)) return true;
  }

  return false;
}
