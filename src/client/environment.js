import os from "os";

/**
 * Detect if running inside Termux.
 */
export const isTermux =
  (os.platform() === "linux" || os.platform() === "android") &&
  process.env.PREFIX?.startsWith("/data/data/com.termux");

/**
 * Return Puppeteer config suitable for the environment.
 * @returns {import("puppeteer").LaunchOptions}
 */
export function resolvePuppeteerConfig() {
  if (!isTermux) return {};

  return {
    executablePath: "/data/data/com.termux/files/usr/bin/chromium-browser",
    args: [
      "--headless=new", "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", "--disable-gpu", "--single-process",
      "--no-zygote", "--disable-software-rasterizer",
    ],
  };
}