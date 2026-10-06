// Checks database.rules.json against the Firebase emulator.
// Run with: npm run test:rules
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { ref, set, push, get, serverTimestamp } from "firebase/database";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-roomkey",
    database: { host: "127.0.0.1", port: 9000, rules: readFileSync("database.rules.json", "utf8") },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearDatabase());

const asUser = (uid) => env.authenticatedContext(uid).database();
const good = (uid, extra = {}) => ({ t: "joined", r: "ABCDEF", u: uid, d: "d", at: serverTimestamp(), ...extra });

test("a signed-in browser can log a well-formed event", async () => {
  await assertSucceeds(push(ref(asUser("alice"), "events"), good("alice")));
});

test("signed-out visitors can't log events", async () => {
  await assertFails(push(ref(env.unauthenticatedContext().database(), "events"), good("alice")));
});

test("you can't log an event as someone else", async () => {
  await assertFails(push(ref(asUser("alice"), "events"), good("bob")));
});

test("unknown event types, bad codes and bad devices are rejected", async () => {
  const db = asUser("alice");
  await assertFails(push(ref(db, "events"), good("alice", { t: "drop_tables" })));
  await assertFails(push(ref(db, "events"), good("alice", { r: "abc" })));
  await assertFails(push(ref(db, "events"), good("alice", { d: "tablet" })));
});

test("events can't smuggle in extra data like note contents", async () => {
  await assertFails(push(ref(asUser("alice"), "events"), good("alice", { notes: "API_KEY=sk-123" })));
});

test("timestamps must come from the server", async () => {
  await assertFails(push(ref(asUser("alice"), "events"), good("alice", { at: 1 })));
});

test("events can't be read, edited or deleted from the browser", async () => {
  const db = asUser("alice");
  const r = push(ref(db, "events"));
  await assertSucceeds(set(r, good("alice")));
  await assertFails(get(ref(db, "events")));
  await assertFails(get(r));
  await assertFails(set(r, good("alice", { t: "room_closed" })));
  await assertFails(set(r, null));
});

test("existing room rules still hold: only the owner writes the pad", async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), "rooms/ABCDEF/meta"), { owner: "pres", title: "T", salt: "s", check: "c", createdAt: 1 }));
  const pad = { iv: "i", ct: "c", at: 1 };
  await assertSucceeds(set(ref(asUser("pres"), "rooms/ABCDEF/pad"), pad));
  await assertFails(set(ref(asUser("alice"), "rooms/ABCDEF/pad"), pad));
});
