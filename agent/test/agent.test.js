import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEvents, computeMetrics, fillSeconds, buildRooms, median, DAY } from "../src/metrics.js";
import { generateInsights, change } from "../src/insights.js";
import { renderMarkdown, renderChart } from "../src/render.js";
import { makeEvents } from "../src/fixture.js";

const NOW = Date.parse("2026-10-12T06:45:00Z");
const ev = (t, r, u, at, d = "d") => ({ t, r, u, d, at });

// A small, hand-built week: one real session of 5 laptops, one test room.
function week() {
  const t0 = NOW - 2 * DAY;
  return [
    ev("room_created", "ABCDEF", "pres", t0),
    ev("joined", "ABCDEF", "a1", t0 + 10_000),
    ev("joined", "ABCDEF", "a2", t0 + 20_000, "m"),
    ev("joined", "ABCDEF", "a3", t0 + 30_000),
    ev("joined", "ABCDEF", "a4", t0 + 40_000),
    ev("joined", "ABCDEF", "a5", t0 + 100_000),
    ev("joined", "ABCDEF", "a1", t0 + 500_000), // reload, same person
    ev("pin_failed", "ABCDEF", "a3", t0 + 25_000),
    ev("copy_line", "ABCDEF", "a1", t0 + 60_000),
    ev("copy_all", "ABCDEF", "a2", t0 + 61_000),
    ev("stuck_on", "ABCDEF", "a4", t0 + 70_000),
    ev("stuck_on", "ABCDEF", "a4", t0 + 90_000),
    ev("room_closed", "ABCDEF", "pres", t0 + 3_600_000),
    ev("room_created", "ZZZZZ2", "pres", t0 - DAY),
    ev("joined", "ZZZZZ2", "phone", t0 - DAY + 5_000, "m"),
  ];
}

test("drops malformed events and never keeps unexpected fields", () => {
  const out = cleanEvents([
    ev("joined", "ABCDEF", "u", 1),
    { t: "joined", r: "bad", u: "u", at: 2 },
    { t: "joined", r: "ABCDEF", u: "u", at: "x" },
    { ...ev("joined", "ABCDEF", "u", 3), notes: "API_KEY=secret" },
    null,
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.every((e) => !("notes" in e)));
});

test("counts each laptop once per room, even after reloads", () => {
  const m = computeMetrics(week(), { now: NOW });
  assert.equal(m.current.attendees, 6); // 5 in the real room + 1 phone test
  assert.equal(m.current.realSessions, 1);
  assert.equal(m.current.testRooms, 1);
  assert.equal(m.current.largestRoom, 5);
});

test("rates are computed from the right denominators", () => {
  const c = computeMetrics(week(), { now: NOW }).current;
  assert.equal(c.copies, 2);
  assert.equal(c.stuckPeople, 1); // pressed twice, one person
  assert.equal(c.pinFailRate, 1 / 7);
  assert.equal(c.mobileShare, 2 / 6);
  assert.equal(c.closeRate, 0.5);
});

test("fill time is first laptop to 80% of laptops", () => {
  const rooms = buildRooms(cleanEvents(week()));
  assert.equal(fillSeconds(rooms.get("ABCDEF")), 30); // 4th of 5 joined 30s after the 1st
  assert.equal(fillSeconds(rooms.get("ZZZZZ2")), null);
});

test("this week and last week don't overlap", () => {
  const evs = [ev("joined", "ABCDEF", "a", NOW - 1000), ev("joined", "BCDEFG", "b", NOW - 8 * DAY), ev("joined", "CDEFGH", "c", NOW + 1000)];
  const m = computeMetrics(evs, { now: NOW });
  assert.equal(m.current.attendees, 1);
  assert.equal(m.previous.attendees, 1);
});

test("trend has one entry per day and sums to joins in range", () => {
  const m = computeMetrics(week(), { now: NOW });
  assert.equal(m.trend.length, 28);
  assert.equal(m.trend.reduce((n, d) => n + d.attendees, 0), 6);
});

test("median and change helpers", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(change(15, 10), 0.5);
  assert.equal(change(5, 0), null);
  assert.equal(change(0, 0), 0);
});

test("an empty week produces a quiet-week report with an action", () => {
  const ins = generateInsights(computeMetrics([], { now: NOW }));
  assert.match(ins.headline, /No activity/);
  assert.equal(ins.actions.length, 1);
});

test("flags phone-heavy, PIN-heavy and slow rooms", () => {
  const t0 = NOW - DAY, evs = [ev("room_created", "ABCDEF", "p", t0)];
  for (let i = 0; i < 10; i++) {
    evs.push(ev("pin_failed", "ABCDEF", "u" + i, t0 + i * 60_000, "m"));
    evs.push(ev("joined", "ABCDEF", "u" + i, t0 + i * 60_000 + 1, "m"));
  }
  const titles = generateInsights(computeMetrics(evs, { now: NOW })).insights.map((i) => i.title);
  assert.ok(titles.includes("Lots of people joined on phones"));
  assert.ok(titles.includes("People are mistyping the PIN"));
  assert.ok(titles.includes("Rooms are slow to fill"));
});

test("warns before the Firebase free-plan connection limit", () => {
  const t0 = NOW - DAY, evs = [ev("room_created", "ABCDEF", "p", t0)];
  for (let i = 0; i < 85; i++) evs.push(ev("joined", "ABCDEF", "u" + i, t0 + i * 100));
  const titles = generateInsights(computeMetrics(evs, { now: NOW })).insights.map((i) => i.title);
  assert.ok(titles.includes("Close to the free-plan limit"));
});

test("report never contains room codes or user IDs", () => {
  const evs = makeEvents({ now: NOW });
  const m = computeMetrics(evs, { now: NOW });
  const md = renderMarkdown(m, generateInsights(m));
  const codes = new Set(evs.map((e) => e.r)), users = new Set(evs.map((e) => e.u));
  for (const c of codes) assert.ok(!md.includes(c), `room code ${c} leaked`);
  for (const u of users) assert.ok(!md.includes(u), `user id ${u} leaked`);
  assert.match(md, /# Roomkey weekly report/);
  assert.match(md, /## Next steps/);
});

test("chart is a valid standalone SVG", () => {
  const svg = renderChart(computeMetrics(week(), { now: NOW }).trend);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>$/);
  assert.equal((svg.match(/<rect /g) || []).length, 1 + 2); // background + 2 days with joins
});

test("demo data is deterministic", () => {
  assert.deepEqual(makeEvents({ now: NOW }), makeEvents({ now: NOW }));
});
