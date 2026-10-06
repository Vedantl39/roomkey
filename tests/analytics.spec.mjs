// End-to-end: a presenter opens a room, an attendee joins on another browser,
// and we check the analytics events that get logged. Firebase is replaced by
// tests/fake-firebase.js so this runs anywhere, offline.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const FAKE = readFileSync(new URL("./fake-firebase.js", import.meta.url), "utf8");
const CONFIG = `window.ROOMKEY_FIREBASE={apiKey:"test-key",authDomain:"x",databaseURL:"https://roomkey-test.example",projectId:"x",appId:"x"};`;
const QR_STUB = `window.QRCode=function(el,o){el.textContent="QR:"+o.text};window.QRCode.CorrectLevel={M:0};`;
const NOTES = "# Keys\nOPENAI_API_KEY=sk-test-123456\nnpm install roomkey-demo";

async function openApp(browser, { uid, seed }) {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(([u, s]) => { window.__FAKE_UID__ = u; window.__FAKE_SEED__ = s; }, [uid, seed || null]);
  await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: CONFIG }));
  await ctx.route("**/firebase-app-compat.js", (r) => r.fulfill({ contentType: "text/javascript", body: FAKE }));
  await ctx.route(/firebase-(auth|database)-compat\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await ctx.route("**/qrcode.min.js", (r) => r.fulfill({ contentType: "text/javascript", body: QR_STUB }));
  return ctx.newPage();
}
const events = (page) => page.evaluate(() => Object.values(window.__fake.read("events") || {}));

test("logs anonymous usage events, and nothing private", async ({ browser }) => {
  // Presenter opens a room and pastes notes.
  const pres = await openApp(browser, { uid: "presenter-1" });
  await pres.goto("/#new");
  await pres.fill("#newTitle", "Secret Workshop Name");
  const pin = await pres.inputValue("#newPin");
  await pres.click("text=Open the room");
  await expect(pres.locator("#pad")).toBeVisible();
  const code = (await pres.evaluate(() => location.hash)).slice(1);
  await pres.fill("#pad", NOTES);
  await expect(pres.locator("#syncState")).toHaveText(/On every laptop/);
  await pres.click("text=Copy link");
  await pres.click("text=Show on projector");
  await pres.click("#projector >> text=Close");

  // Attendee joins from a different browser with the same database state.
  const data = await pres.evaluate(() => window.__fake.store.data);
  const att = await openApp(browser, { uid: "attendee-1", seed: { data } });
  await att.goto("/#" + code);
  const wrong = pin === "111111" ? "222222" : "111111";
  await att.fill("#pinIn", wrong);
  await att.click("text=Join room");
  await expect(att.locator(".err")).toHaveText(/doesn't match/);
  await att.fill("#pinIn", pin);
  await att.click("text=Join room");
  await expect(att.locator(".sec")).toContainText("OPENAI_API_KEY");
  await att.locator(".line .cp").first().click();
  await att.click("text=Copy section");
  await att.click("text=Copy everything");
  await att.click("text=I'm stuck");
  await att.click("text=Got it working, thanks");

  // Presenter closes the room.
  await pres.click("text=Close room and wipe notes");
  await pres.click("text=Click again to close");

  const all = [...(await events(pres)), ...(await events(att))];
  const types = all.map((e) => e.t);
  for (const t of ["room_created", "link_copied", "projector_opened", "room_closed", "pin_failed", "joined", "copy_line", "copy_section", "copy_all", "stuck_on", "stuck_off"]) {
    expect(types, `missing ${t}`).toContain(t);
  }

  for (const e of all) {
    expect(Object.keys(e).sort()).toEqual(["at", "d", "r", "t", "u"]);
    expect(e.r).toBe(code);
    expect(["m", "d"]).toContain(e.d);
    expect(typeof e.at).toBe("number");
  }
  expect(all.filter((e) => e.t === "joined").every((e) => e.u === "attendee-1")).toBe(true);
  expect(all.filter((e) => e.t === "room_created").every((e) => e.u === "presenter-1")).toBe(true);

  // Nothing secret ever goes into analytics.
  const blob = JSON.stringify(all);
  for (const secret of [pin, "sk-test-123456", "OPENAI_API_KEY", "Secret Workshop Name", "npm install"]) {
    expect(blob).not.toContain(secret);
  }
});
