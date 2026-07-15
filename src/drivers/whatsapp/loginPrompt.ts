/**
 * loginPrompt.ts
 *
 * Interactive first-login flow. Only called when there is no valid
 * session yet in .manybot/sessions — if one already exists, the driver
 * skips this entirely and connects directly.
 *
 * Uses @clack/prompts: pure ANSI, no GUI/display, so it works the same
 * over SSH, tmux, containers, etc — it just needs a normal TTY.
 */

import * as clack from "@clack/prompts";
import { CONFIG, persistConfigValue } from "#config";
import { logger } from "#logger";

export type LoginMethod = "phone" | "qr";

function cancelAndExit(): never {
  clack.cancel("Login cancelled.");
  process.exit(1);
}

/**
 * Asks which login method to use and saves the choice to manybot.toml
 * (LOGIN_METHOD), so it won't be asked again next time.
 */
async function promptLoginMethod(): Promise<LoginMethod> {
  const choice = await clack.select({
    message: "How do you want to connect your WhatsApp account?",
    options: [
      { value: "phone", label: "Enter phone number", hint: "pairing code" },
      { value: "qr",    label: "Show QR code",        hint: "scan with your phone" },
    ],
  });

  if (clack.isCancel(choice)) cancelAndExit();

  await persistConfigValue("LOGIN_METHOD", choice as LoginMethod);
  return choice as LoginMethod;
}

/**
 * Asks for the phone number (with country code) and saves it to
 * manybot.toml (PHONE_NUMBER).
 */
async function promptPhoneNumber(): Promise<string> {
  const phone = await clack.text({
    message:     "Phone number (with country code, digits only)",
    placeholder: "5511999999999",
    validate(value) {
      if (!/^\d{8,15}$/.test(value.trim())) {
        return "Digits only, with country code. E.g.: 5511999999999";
      }
    },
  });

  if (clack.isCancel(phone)) cancelAndExit();

  const clean = (phone as string).trim();
  await persistConfigValue("PHONE_NUMBER", clean);
  return clean;
}

export interface ResolvedLogin {
  method: LoginMethod;
  phone:  string | null;
}

/**
 * Resolves the login method for this run:
 * - LOGIN_METHOD already configured → use it directly, no prompts.
 * - Not configured → show the menu, save the choice.
 * - Method is "phone" but no PHONE_NUMBER saved → ask for it and save it.
 *
 * Should only be called when there is NO valid session yet — a valid
 * session skips this module entirely (see baileysSock.ts).
 */
export async function resolveLoginMethod(): Promise<ResolvedLogin> {
  clack.intro("ManyBot — first login");

  let method = CONFIG.LOGIN_METHOD as LoginMethod | null;

  if (method !== "phone" && method !== "qr") {
    method = await promptLoginMethod();
  } else {
    logger.info(`[login] Configured method: ${method}`);
  }

  let phone = CONFIG.PHONE_NUMBER as string | null;

  if (method === "phone" && !phone) {
    phone = await promptPhoneNumber();
  }

  clack.outro(
    method === "qr"
      ? "Scan the QR code that will appear next."
      : "Wait for the pairing code that will appear next."
  );

  return { method, phone: method === "phone" ? phone : null };
}
