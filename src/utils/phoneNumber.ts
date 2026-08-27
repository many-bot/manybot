/**
 * src/utils/phoneNumber.ts
 *
 * Phone-number normalization built on `libphonenumber-js`. Centralized so
 * the Baileys adapter, the `whatsmeow` driver, and any future call site
 * produce a single, consistent shape for the `IContact` returned to
 * plugins:
 *
 *   {
 *     number:            "+12025550100",     // E.164 with leading "+"
 *     numberRaw:         "12025550100",      // digits only, no "+"
 *     numberPretty:      "+1 202 555-0100",  // formatInternational()
 *     country:           "US",               // ISO 3166-1 alpha-2
 *     countryCallingCode: "1",               // ITU calling code
 *   }
 *
 * When the input is not a parseable phone number (bot JIDs, group JIDs,
 * random strings, malformed numbers) every field is `null`. The helper
 * never throws and never calls the network — it's a pure synchronous
 * transform over the digits.
 *
 * `libphonenumber-js` has many format variants; we pick `formatInternational()`
 * for `numberPretty` because it's the form most users expect to see in
 * a chat reply ("+63 938 346-4136") and it preserves the country-code
 * prefix unambiguously.
 */

import parsePhoneNumber, {
  type CountryCode,
  type PhoneNumber,
} from "libphonenumber-js";

export interface ParsedPhoneNumber {
  /** E.164 with leading "+", e.g. `"+12025550100"`. `null` when the
   *  input isn't a parseable phone number. */
  number:            string | null;
  /** Digits only, no "+", e.g. `"12025550100"`. `null` when no digits
   *  could be extracted from the input. */
  numberRaw:         string | null;
  /** `formatInternational()`, e.g. `"+1 202 555-0100"`. `null` when
   *  the number couldn't be parsed. */
  numberPretty:      string | null;
  /** ISO 3166-1 alpha-2 country code (e.g. `"US"`), or `null` when
   *  libphonenumber-js can't pin a country to the input. */
  country:           string | null;
  /** ITU calling code (e.g. `"1"`), or `null` when unknown. */
  countryCallingCode: string | null;
}

/** All-null {@link ParsedPhoneNumber} — the obvious return value when
 *  the input isn't a phone number at all. Exported so test code (and
 *  any consumer that wants to deep-compare) has a stable reference. */
export const NULL_PHONE: ParsedPhoneNumber = Object.freeze({
  number:            null,
  numberRaw:         null,
  numberPretty:      null,
  country:           null,
  countryCallingCode: null,
});

function isParseable(p: PhoneNumber | undefined): p is PhoneNumber {
  // libphonenumber-js's `parsePhoneNumberFromString` returns a PhoneNumber
  // even for garbage input — but `country` is only set when the parser
  // could pin a country. Use that as the "this is a real phone" signal:
  // a country-less parse has nothing useful to say about country/CC.
  return Boolean(p && p.country);
}

/**
 * Parse a phone number into the canonical ManyBot shape. Accepts either
 * a phone-based JID (`"5511999999999@s.whatsapp.net"`), a `@c.us` legacy
 * form (`"5511999999999@c.us"`), or a plain digit string. Returns the
 * all-null `NULL_PHONE` when the input is empty, a non-phone JID (group
 * `@g.us`, bot meta-AI, status broadcast), or simply not parseable.
 */
export function parsePhone(value: string | null | undefined): ParsedPhoneNumber {
  if (!value) return NULL_PHONE;
  // Strip JID wrapper if present. Anything ending in a non-`@s.whatsapp.net` /
  // non-`@c.us` server (groups, status, newsletters, bot meta) isn't a phone
  // number at all — short-circuit to NULL_PHONE before calling the parser.
  const isJid = value.includes("@");
  if (isJid) {
    const server = value.slice(value.indexOf("@") + 1);
    if (server !== "s.whatsapp.net" && server !== "c.us") return NULL_PHONE;
  }
  const digits = value.replace(/\D/g, "");
  if (!digits) return NULL_PHONE;
  // Try the raw digit form first (covers the "5511999999999@s.whatsapp.net"
  // case where the parser knows no default country); the "+"-prefixed form
  // second (covers "5511999999999" when a default country is supplied by the
  // caller). Without a country hint libphonenumber-js can't tell a Brazilian
  // 55-prefix from a Portuguese 55-prefix and returns no country — that's
  // why the wrapper JID case is the common path.
  const parsed: PhoneNumber | undefined =
    parsePhoneNumber(value) ?? parsePhoneNumber("+" + digits);
  if (!isParseable(parsed)) return NULL_PHONE;
  return {
    number:            parsed.number,
    numberRaw:         digits,
    numberPretty:      parsed.formatInternational(),
    country:           parsed.country ?? null,
    countryCallingCode: parsed.countryCallingCode ?? null,
  };
}

/** Re-export the country-code type so callers don't have to import
 *  `libphonenumber-js` directly just to type a default-country hint. */
export type { CountryCode };
