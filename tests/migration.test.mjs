// npm install --no-save --ignore-scripts @electric-sql/pglite@0.3.14
// node tests/migration.test.mjs
// Or set PGLITE_MODULE to an absolute path to its dist/index.js.
// Runs exclusively in an ephemeral local PostgreSQL/WASM database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : "@electric-sql/pglite"
);
const db = new PGlite();
let checks = 0;
const check = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [user, other, creator, admin] = [1, 2, 3, 4].map(uid);
const creatorId = uid(10),
  conv = uid(11),
  exp = uid(12);
async function as(who, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    who || "",
  ]);
  await db.exec(`set role ${role}`);
}
async function rpc(sql, params = []) {
  return (await db.query(sql, params)).rows[0]?.value;
}
async function denied(sql, params = []) {
  await assert.rejects(() => db.query(sql, params));
  checks++;
}
const ent = () => rpc("select public.get_my_entitlements() as value");
try {
  await db.exec(
    readFileSync(new URL("./sql-fixture.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20260921161704_membership_entitlements_review.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  checks++;
  for (const [id, role] of [
    [user, "user"],
    [other, "user"],
    [creator, "creator"],
    [admin, "admin"],
  ])
    await db.query(
      "insert into public.profiles values($1,$2,'active','diamond','Synthetic test')",
      [id, role],
    );
  await db.query(
    "insert into public.creators values($1,$2,'Synthetic creator',true)",
    [creatorId, creator],
  );
  await db.query("insert into public.conversations values($1,$2,$3)", [
    conv,
    user,
    creatorId,
  ]);
  await db.query("insert into public.experiences values($1,$2,true)", [
    exp,
    creatorId,
  ]);
  await as(null, "anon");
  await denied("select public.get_my_entitlements()");
  await as(user);
  check((await ent()).plan, "free"); // profiles.plan=diamond grants nothing.
  await denied("select carlea_private.membership_tier($1)", [other]);
  await denied(
    "insert into public.client_subscriptions(user_id,plan,status,verified_at) values($1,'diamond','active',now())",
    [user],
  );
  await denied("select carlea_private.request_experience($1)", [exp]);
  const sub = await rpc(
    "select public.request_client_membership('premium') as value",
  );
  check(
    await rpc("select public.request_client_membership('premium') as value"),
    sub,
  );
  check((await ent()).plan, "free");
  await denied("select public.request_client_membership('diamond')");
  await denied("select public.admin_verify_client_membership($1,$2)", [
    sub,
    "verified-test-reference",
  ]);
  await as(other);
  check(
    (await db.query("select * from public.client_subscriptions")).rows.length,
    0,
  );
  await denied("select public.cancel_client_membership($1)", [sub]);
  await as(admin);
  check(
    await rpc("select public.admin_verify_client_membership($1,$2) as value", [
      sub,
      "verified-test-reference",
    ]),
    sub,
  );
  const before = (
    await db.query(
      "select ends_at from public.client_subscriptions where id=$1",
      [sub],
    )
  ).rows[0].ends_at;
  await rpc("select public.admin_verify_client_membership($1,$2)", [
    sub,
    "verified-test-reference",
  ]);
  check(
    (
      await db.query(
        "select ends_at from public.client_subscriptions where id=$1",
        [sub],
      )
    ).rows[0].ends_at,
    before,
  );
  await denied("select public.admin_verify_client_membership($1,$2)", [
    sub,
    "different-reference",
  ]);
  await as(user);
  const premium = await ent();
  check(premium.plan, "premium");
  check(premium.capabilities.canSendText, true);
  check(premium.capabilities.canSendMedia, false);
  check(premium.capabilities.canRequestVideoCall, false);
  check(await rpc("select carlea_private.can_chat($1) as value", [conv]), true);
  check(
    await rpc("select carlea_private.media_allowed($1) as value", [conv]),
    false,
  );
  check(
    await rpc("select carlea_private.current_app_plan()::text as value"),
    "premium",
  );
  check(
    typeof (await rpc("select carlea_private.request_experience($1) as value", [
      exp,
    ])),
    "string",
  );
  await rpc("select public.cancel_client_membership($1)", [sub]);
  check((await ent()).plan, "premium");
  await as(creator);
  check(
    (
      await rpc(
        "select carlea_private.conversation_capabilities($1) as value",
        [conv],
      )
    ).canSendMedia,
    false,
  );
  check(await rpc("select carlea_private.tier($1) as value", [creatorId]), 2);
  check(await rpc("select carlea_private.tier($1) as value", [uid(100)]), 0);
  await db.exec("reset role");
  await db.query(
    "update public.client_subscriptions set plan='diamond' where id=$1",
    [sub],
  );
  await as(user);
  check((await ent()).plan, "diamond");
  check((await ent()).capabilities.canSendAudio, true);
  check(
    await rpc("select carlea_private.media_allowed($1) as value", [conv]),
    true,
  );
  await db.exec("reset role");
  await db.query("update public.profiles set status='suspended' where id=$1", [
    user,
  ]);
  await as(user);
  check((await ent()).plan, "free");
  await as(creator);
  check(
    await rpc("select carlea_private.can_chat($1) as value", [conv]),
    false,
  );
  await db.exec("reset role");
  await db.query("update public.profiles set status='active' where id=$1", [
    user,
  ]);
  await db.query(
    "update public.client_subscriptions set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where id=$1",
    [sub],
  );
  await as(user);
  check((await ent()).plan, "free");
  await db.exec("reset role");
  await db.query(
    "insert into public.client_subscriptions(user_id,plan,status,starts_at,ends_at) values($1,'diamond','active',now(),now()+interval '1 month')",
    [other],
  );
  await as(other);
  check((await ent()).plan, "free"); // Created after the 3.2 cutoff; verification is mandatory.
  await db.exec("reset role");
  await db.query(
    "update public.client_subscriptions set created_at=timestamptz '2026-09-20 00:00:00+00' where user_id=$1 and verified_at is null",
    [other],
  );
  await as(other);
  check((await ent()).plan, "diamond"); // Pre-cutoff active access survives only its original period.
  await db.exec("reset role");
  check(
    Number(
      (
        await db.query(
          "select count(*) as n from public.admin_audit where action='membership.manual_payment_verified'",
        )
      ).rows[0].n,
    ),
    1,
  );
  console.log(
    `PASS: ${checks} local PostgreSQL assertions. Reduced fixture only; no live Supabase writes.`,
  );
} finally {
  await db.close();
}
