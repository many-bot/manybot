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
import { t } from "#i18n";

export type LoginMethod = "phone" | "qr";

function cancelAndExit(): never {
  clack.cancel(t("onboarding.cancelled"));
  process.exit(1);
}

/**
 * Asks which login method to use and saves the choice to manybot.toml
 * (LOGIN_METHOD), so it won't be asked again next time.
 */
async function promptLoginMethod(): Promise<LoginMethod> {
  const choice = await clack.select({
    message: t("onboarding.methodPrompt"),
    options: [
      { value: "phone", label: t("onboarding.methodPhone"), hint: t("onboarding.methodPhoneHint") },
      { value: "qr",    label: t("onboarding.methodQr"),     hint: t("onboarding.methodQrHint") },
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
    message:     t("onboarding.phonePrompt"),
    placeholder: "5511999999999",
    validate(value) {
      if (!/^\d{8,15}$/.test(value.trim())) {
        return t("onboarding.phoneValidation");
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
  let method = CONFIG.LOGIN_METHOD as LoginMethod | null;
  let phone  = CONFIG.PHONE_NUMBER as string | null;

  const needsMethod = method !== "phone" && method !== "qr";
  const needsPhone  = !needsMethod && method === "phone" && !phone;

  if (!needsMethod && !needsPhone) {
    return { method: method as LoginMethod, phone: method === "phone" ? phone : null };
  }

  clack.intro(t("onboarding.intro"));

  if (needsMethod) {
    method = await promptLoginMethod();
  }

  if (method === "phone" && !phone) {
    phone = await promptPhoneNumber();
  }

  clack.outro(
    method === "qr" ? t("onboarding.outroQr") : t("onboarding.outroPhone")
  );

  return { method: method as LoginMethod, phone: method === "phone" ? phone : null };
}
