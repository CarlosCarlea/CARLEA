// Display-only adapter. The database is the authority for membership permissions.
export const PLAN_LABELS = Object.freeze({
  free: "Gratis",
  premium: "Premium",
  diamond: "Diamante",
});
export const PLAN_PRICES = Object.freeze({
  free: 0,
  premium: 19900,
  diamond: 39900,
});
export const CAPABILITY_NAMES = Object.freeze([
  "canMessage",
  "canSendText",
  "canReceiveText",
  "canSendMedia",
  "canReceiveMedia",
  "canSendAudio",
  "canReceiveAudio",
  "canAccessPremium",
  "canAccessDiamond",
  "canRequestVideoCall",
]);
export function normalizeEntitlements(payload) {
  const valid =
    payload?.schema_version === 1 &&
    ["free", "premium", "diamond"].includes(payload.plan);
  return {
    ready: Boolean(valid),
    plan: valid ? payload.plan : "free",
    validUntil: valid ? payload.valid_until : null,
    capabilities: Object.fromEntries(
      CAPABILITY_NAMES.map((key) => [
        key,
        valid && payload.capabilities?.[key] === true,
      ]),
    ),
  };
}
export function hasCapability(entitlements, key, now = Date.now()) {
  if (!entitlements?.ready || !CAPABILITY_NAMES.includes(key)) return false;
  const until = Date.parse(entitlements.validUntil);
  return (
    Number.isFinite(until) &&
    until > now &&
    entitlements.capabilities[key] === true
  );
}
export function effectivePlan(entitlements, now = Date.now()) {
  if (hasCapability(entitlements, "canAccessDiamond", now)) return "diamond";
  if (hasCapability(entitlements, "canAccessPremium", now)) return "premium";
  return "free";
}
