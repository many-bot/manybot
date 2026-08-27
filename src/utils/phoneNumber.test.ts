import assert from "node:assert/strict";
import test from "node:test";

import { parsePhone, NULL_PHONE } from "#utils/phoneNumber.js";

test("parsePhone — US number (NANPA +1)", () => {
  // Use the 555-0100 reserved-for-fiction range so the example never
  // collides with a real subscriber anywhere on Earth.
  const r = parsePhone("+12025550100");
  assert.equal(r.number,    "+12025550100");
  assert.equal(r.numberRaw, "12025550100");
  assert.equal(r.country,   "US");
  assert.equal(r.countryCallingCode, "1");
  assert.match(r.numberPretty!, /^\+1 /);
});

test("parsePhone — BR number from @s.whatsapp.net JID", () => {
  const r = parsePhone("5516999999999@s.whatsapp.net");
  assert.equal(r.number,    "+5516999999999");
  assert.equal(r.numberRaw, "5516999999999");
  assert.equal(r.country,   "BR");
  assert.equal(r.countryCallingCode, "55");
  assert.match(r.numberPretty!, /^\+55 /);
});

test("parsePhone — US number with leading +", () => {
  const r = parsePhone("+14155552671");
  assert.equal(r.country,   "US");
  assert.equal(r.countryCallingCode, "1");
  assert.equal(r.numberRaw, "14155552671");
});

test("parsePhone — group JID is not a phone number", () => {
  // @g.us must NOT be parsed as a phone number, even though its user-part
  // is digit-only. The wrapper short-circuits to NULL_PHONE.
  assert.deepEqual(parsePhone("120363402117932687@g.us"), NULL_PHONE);
});

test("parsePhone — status/broadcast/newsletter JIDs are not phones", () => {
  assert.deepEqual(parsePhone("status@broadcast"), NULL_PHONE);
  assert.deepEqual(parsePhone("0@c.us"),           NULL_PHONE);
});

test("parsePhone — empty / null / undefined all return NULL_PHONE", () => {
  assert.deepEqual(parsePhone(""),       NULL_PHONE);
  assert.deepEqual(parsePhone(null),     NULL_PHONE);
  assert.deepEqual(parsePhone(undefined), NULL_PHONE);
});

test("parsePhone — unparseable digit string returns NULL_PHONE", () => {
  // 7 digits with no country hint → libphonenumber-js returns no country
  // for the raw form and no useful result for the +N form either.
  assert.deepEqual(parsePhone("1234567"), NULL_PHONE);
});

test("parsePhone — accepts the legacy @c.us form (framework internal JID)", () => {
  // Some code paths still hand us the framework's normalized "@c.us" form
  // instead of the raw "@s.whatsapp.net" one. Both should parse identically.
  const wire = parsePhone("5516999999999@s.whatsapp.net");
  const internal = parsePhone("5516999999999@c.us");
  assert.deepEqual(internal, wire);
});
