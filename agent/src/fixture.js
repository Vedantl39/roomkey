// Realistic fake events for tests, CI and demos. Seeded, so it's the same every run.

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeEvents({ now = Date.parse("2026-10-12T06:45:00Z"), seed = 7, weeks = 5 } = {}) {
  const rand = rng(seed);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const code = () => Array.from({ length: 6 }, () => pick(ALPHA)).join("");
  const id = (p) => p + Math.floor(rand() * 1e9).toString(36);
  const presenters = ["p1", "p2", "p3", "p4"].map(id);
  const ev = [];
  const DAY = 86_400_000;

  for (let w = weeks - 1; w >= 0; w--) {
    // Usage grows over time: more sessions in recent weeks.
    const sessions = 1 + (weeks - w) + Math.floor(rand() * 2);
    for (let s = 0; s < sessions; s++) {
      const start = now - w * 7 * DAY - Math.floor(rand() * 6.5 * DAY) - 2 * 3600_000;
      const r = code();
      const owner = presenters[Math.min(presenters.length - 1, Math.floor(rand() * (weeks - w + 1)))];
      ev.push({ t: "room_created", r, u: owner, d: "d", at: start });
      const isTest = rand() < 0.2;
      const people = isTest ? 1 : 6 + Math.floor(rand() * (15 + (weeks - w) * 10));
      ev.push({ t: "projector_opened", r, u: owner, d: "d", at: start + 60_000 });
      const showAt = start + 5 * 60_000;
      for (let k = 0; k < people; k++) {
        const u = id("a");
        const d = rand() < 0.22 ? "m" : "d";
        const joinAt = showAt + Math.floor(Math.pow(rand(), 2) * 150_000);
        if (rand() < 0.12) ev.push({ t: "pin_failed", r, u, d, at: joinAt - 4000 });
        ev.push({ t: "joined", r, u, d, at: joinAt });
        if (rand() < 0.1) ev.push({ t: "joined", r, u, d, at: joinAt + 600_000 }); // reload, same person
        const copies = Math.floor(rand() * 6);
        for (let c = 0; c < copies; c++) ev.push({ t: pick(["copy_line", "copy_line", "copy_section", "copy_all"]), r, u, d, at: joinAt + (c + 1) * 90_000 });
        if (rand() < 0.15) {
          ev.push({ t: "stuck_on", r, u, d, at: joinAt + 20 * 60_000 });
          ev.push({ t: "stuck_off", r, u, d, at: joinAt + 24 * 60_000 });
        }
      }
      if (rand() < 0.55) ev.push({ t: "room_closed", r, u: owner, d: "d", at: start + 95 * 60_000 });
    }
  }
  return ev.filter((e) => e.at < now).sort((a, b) => a.at - b.at);
}
