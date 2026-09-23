import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEntitlements,
  hasCapability,
  effectivePlan,
  CAPABILITY_NAMES,
  PLAN_PRICES,
} from "../js/membership.js";

const now = Date.parse("2026-09-21T12:00:00Z");
const payload = (plan, level) => ({
  schema_version: 1,
  plan,
  valid_until: "2026-10-21T12:00:00Z",
  capabilities: Object.fromEntries(
    CAPABILITY_NAMES.map((key) => [
      key,
      [
        "canMessage",
        "canSendText",
        "canReceiveText",
        "canAccessPremium",
      ].includes(key)
        ? level >= 1
        : level >= 2,
    ]),
  ),
});
test("invalid, missing and legacy responses fail closed", () => {
  for (const value of [
    null,
    {},
    { plan: "premium" },
    { schema_version: 2, plan: "diamond" },
    { schema_version: 1, plan: "essential" },
  ]) {
    const normalized = normalizeEntitlements(value);
    assert.equal(normalized.ready, false);
    for (const key of CAPABILITY_NAMES)
      assert.equal(hasCapability(normalized, key, now), false);
  }
});
test("official prices and plan names", () => {
  assert.deepEqual(PLAN_PRICES, { free: 0, premium: 19900, diamond: 39900 });
});
for (const [plan, level] of [
  ["free", 0],
  ["premium", 1],
  ["diamond", 2],
]) {
  test(`${plan} follows server capabilities`, () => {
    const e = normalizeEntitlements(payload(plan, level));
    assert.equal(effectivePlan(e, now), plan);
    assert.equal(hasCapability(e, "canSendText", now), level >= 1);
    assert.equal(hasCapability(e, "canSendMedia", now), level >= 2);
    assert.equal(hasCapability(e, "canRequestVideoCall", now), level >= 2);
    assert.equal(hasCapability(e, "unknown", now), false);
  });
}
test("expired and malformed dates never grant permission", () => {
  for (const date of [null, "invalid", "2026-09-21T12:00:00Z", "2020-01-01"]) {
    const e = normalizeEntitlements({
      ...payload("diamond", 2),
      valid_until: date,
    });
    assert.equal(effectivePlan(e, now), "free");
  }
});
test("truthy strings are not valid capabilities", () => {
  const e = normalizeEntitlements({
    ...payload("diamond", 2),
    capabilities: { canSendMedia: "true" },
  });
  assert.equal(hasCapability(e, "canSendMedia", now), false);
});
