import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { describeError, isTransientNetworkError } from "#utils/errorDetail.js";

describe("utils/errorDetail", () => {
  test("returns just name+message when there is no cause", () => {
    const err = new Error("boom");
    assert.equal(describeError(err), "Error: boom");
  });

  test("walks a single-level cause chain", () => {
    const cause = new Error("connect ETIMEDOUT");
    (cause as any).code = "ETIMEDOUT";
    (cause as any).syscall = "connect";
    (cause as any).address = "157.240.12.1";
    (cause as any).port = 443;

    const err = new TypeError("fetch failed", { cause });
    assert.equal(
      describeError(err),
      "TypeError: fetch failed -> Error: connect ETIMEDOUT code=ETIMEDOUT syscall=connect address=157.240.12.1:443"
    );
  });

  test("walks a multi-level cause chain", () => {
    const root = new Error("EAI_AGAIN");
    (root as any).code = "EAI_AGAIN";
    const mid = new Error("network error", { cause: root });
    const top = new TypeError("fetch failed", { cause: mid });

    const desc = describeError(top);
    assert.match(desc, /^TypeError: fetch failed -> Error: network error -> Error: EAI_AGAIN code=EAI_AGAIN$/);
  });

  test("expands AggregateError into every attempted cause", () => {
    const e1 = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED", address: "1.1.1.1", port: 443 });
    const e2 = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED", address: "2.2.2.2", port: 443 });
    const agg = new AggregateError([e1, e2], "all attempts failed");
    const top = new TypeError("fetch failed", { cause: agg });

    const desc = describeError(top);
    assert.match(desc, /^TypeError: fetch failed -> AggregateError: all attempts failed -> aggregated\[2\]: /);
    assert.match(desc, /1\.1\.1\.1:443/);
    assert.match(desc, /2\.2\.2\.2:443/);
  });

  test("stops at maxDepth to avoid runaway cyclic causes", () => {
    const a: any = new Error("a");
    const b: any = new Error("b", { cause: a });
    a.cause = b; // cyclic on purpose
    assert.doesNotThrow(() => describeError(b, 4));
  });

  test("handles a non-Error thrown value", () => {
    assert.equal(describeError("plain string"), "plain string");
  });
});

describe("utils/errorDetail — isTransientNetworkError", () => {
  test("true for a direct known transient code", () => {
    const err = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    assert.equal(isTransientNetworkError(err), true);
  });

  test("true when the code is nested in .cause", () => {
    const root = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    const top = new TypeError("fetch failed", { cause: root });
    assert.equal(isTransientNetworkError(top), true);
  });

  test("true when ANY entry of an AggregateError is transient", () => {
    const e1 = Object.assign(new Error("ENETUNREACH"), { code: "ENETUNREACH" });
    const e2 = new Error("something else entirely");
    const agg = new AggregateError([e1, e2], "all attempts failed");
    const top = new TypeError("fetch failed", { cause: agg });
    assert.equal(isTransientNetworkError(top), true);
  });

  test("true for a bare 'fetch failed' with no cause at all", () => {
    assert.equal(isTransientNetworkError(new TypeError("fetch failed")), true);
  });

  test("false for a non-network error", () => {
    assert.equal(isTransientNetworkError(new Error("Bad MAC")), false);
  });

  test("false for a non-Error thrown value", () => {
    assert.equal(isTransientNetworkError("plain string"), false);
  });
});
