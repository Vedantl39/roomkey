// Turns raw Roomkey events into the numbers the weekly report is built on.
// Pure functions only: no I/O, so everything here is easy to test.

export const DAY = 86_400_000;
export const COPY_TYPES = new Set(["copy_line", "copy_section", "copy_all"]);
export const REAL_SESSION_MIN = 3; // a room with 3+ laptops is a real session, not someone testing on their phone

const TZ = "Europe/Dublin";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const dayKey = (ms) => dayFmt.format(new Date(ms)); // YYYY-MM-DD in Dublin time

const EVENT_RE = /^[a-z_]+$/;
const CODE_RE = /^[A-Z2-9]{6}$/;

export function cleanEvents(raw) {
  const list = Array.isArray(raw) ? raw : Object.values(raw || {});
  return list
    .filter((e) => e && EVENT_RE.test(e.t) && CODE_RE.test(e.r) && typeof e.u === "string" && Number.isFinite(e.at))
    .map((e) => ({ t: e.t, r: e.r, u: e.u, d: e.d === "m" ? "m" : "d", at: e.at }))
    .sort((a, b) => a.at - b.at);
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = (n, d) => (d ? n / d : null);

// Every room ever seen, with everything we know about it.
export function buildRooms(events) {
  const rooms = new Map();
  for (const e of events) {
    let r = rooms.get(e.r);
    if (!r) {
      r = { code: e.r, createdAt: null, owner: null, joins: new Map(), pinFails: 0, stuckPeople: new Set(), stuckPresses: 0, copies: 0, closedAt: null, projector: 0, firstAt: e.at, lastAt: e.at };
      rooms.set(e.r, r);
    }
    r.lastAt = Math.max(r.lastAt, e.at);
    switch (e.t) {
      case "room_created": r.createdAt = e.at; r.owner = e.u; break;
      case "joined": if (!r.joins.has(e.u)) r.joins.set(e.u, { at: e.at, d: e.d }); break; // a reload is not a new person
      case "pin_failed": r.pinFails++; break;
      case "stuck_on": r.stuckPresses++; r.stuckPeople.add(e.u); break;
      case "room_closed": r.closedAt = e.at; break;
      case "room_reopened": r.closedAt = null; break;
      case "projector_opened": r.projector++; break;
      default: if (COPY_TYPES.has(e.t)) r.copies++;
    }
  }
  return rooms;
}

// How long it took the room to fill: first laptop in to 80% of laptops in.
export function fillSeconds(room) {
  const ts = [...room.joins.values()].map((j) => j.at).sort((a, b) => a - b);
  if (ts.length < REAL_SESSION_MIN) return null;
  const idx = Math.max(0, Math.ceil(ts.length * 0.8) - 1);
  return Math.round((ts[idx] - ts[0]) / 1000);
}

function windowStats(events, rooms, from, to) {
  const inWin = events.filter((e) => e.at >= from && e.at < to);
  const count = (t) => inWin.filter((e) => e.t === t).length;

  const joinKeys = new Set();
  let mobileJoins = 0;
  for (const e of inWin) {
    if (e.t !== "joined") continue;
    const k = e.r + "|" + e.u;
    if (joinKeys.has(k)) continue;
    joinKeys.add(k);
    if (e.d === "m") mobileJoins++;
  }
  const attendees = joinKeys.size;
  const pinFails = count("pin_failed");
  const copies = inWin.filter((e) => COPY_TYPES.has(e.t)).length;
  const stuckPeople = new Set(inWin.filter((e) => e.t === "stuck_on").map((e) => e.r + "|" + e.u)).size;
  const created = inWin.filter((e) => e.t === "room_created");
  const presenters = new Set(created.map((e) => e.u)).size;

  // Sessions = rooms that had someone join during this window.
  const sessionCodes = new Set(inWin.filter((e) => e.t === "joined").map((e) => e.r));
  const sessions = [...sessionCodes].map((c) => rooms.get(c)).map((r) => ({
    startedAt: r.createdAt ?? r.firstAt,
    laptops: r.joins.size,
    fillSeconds: fillSeconds(r),
    copies: r.copies,
    stuckPeople: r.stuckPeople.size,
    pinFails: r.pinFails,
    mobileShare: pct([...r.joins.values()].filter((j) => j.d === "m").length, r.joins.size),
    closed: r.closedAt != null,
    minutes: Math.round((r.lastAt - r.firstAt) / 60000),
  })).sort((a, b) => a.startedAt - b.startedAt);

  const real = sessions.filter((s) => s.laptops >= REAL_SESSION_MIN);
  const createdRooms = created.map((e) => rooms.get(e.r));
  const closedCreated = createdRooms.filter((r) => r.closedAt != null).length;
  const testRooms = createdRooms.filter((r) => r.joins.size < REAL_SESSION_MIN).length;

  return {
    from, to,
    events: inWin.length,
    roomsCreated: created.length,
    presenters,
    sessions: sessions.length,
    realSessions: real.length,
    testRooms,
    attendees,
    copies,
    copiesPerAttendee: pct(copies, attendees),
    stuckPeople,
    stuckRate: pct(stuckPeople, attendees),
    pinFails,
    pinFailRate: pct(pinFails, pinFails + attendees),
    mobileShare: pct(mobileJoins, attendees),
    closeRate: pct(closedCreated, created.length),
    medianLaptops: median(real.map((s) => s.laptops)),
    largestRoom: sessions.reduce((m, s) => Math.max(m, s.laptops), 0),
    medianFillSeconds: median(real.map((s) => s.fillSeconds).filter((x) => x != null)),
    sessionList: sessions,
  };
}

export function computeMetrics(rawEvents, { now = Date.now(), windowDays = 7, trendDays = 28 } = {}) {
  const events = cleanEvents(rawEvents);
  const rooms = buildRooms(events);
  const span = windowDays * DAY;
  const current = windowStats(events, rooms, now - span, now);
  const previous = windowStats(events, rooms, now - 2 * span, now - span);

  // Daily trend, Dublin days, oldest first.
  const days = [];
  for (let i = trendDays - 1; i >= 0; i--) days.push(dayKey(now - i * DAY));
  const byDay = Object.fromEntries(days.map((d) => [d, { day: d, attendees: 0, rooms: 0 }]));
  const seen = new Set();
  for (const e of events) {
    const k = dayKey(e.at);
    if (!byDay[k] || e.at >= now) continue;
    if (e.t === "room_created") byDay[k].rooms++;
    if (e.t === "joined" && !seen.has(e.r + "|" + e.u)) { seen.add(e.r + "|" + e.u); byDay[k].attendees++; }
  }

  // All time.
  const presenterDays = new Map();
  for (const e of events) if (e.t === "room_created") {
    if (!presenterDays.has(e.u)) presenterDays.set(e.u, new Set());
    presenterDays.get(e.u).add(dayKey(e.at));
  }
  const allRooms = [...rooms.values()];
  const allTime = {
    firstEventAt: events.length ? events[0].at : null,
    rooms: allRooms.filter((r) => r.createdAt != null).length,
    realSessions: allRooms.filter((r) => r.joins.size >= REAL_SESSION_MIN).length,
    attendees: allRooms.reduce((n, r) => n + r.joins.size, 0),
    copies: allRooms.reduce((n, r) => n + r.copies, 0),
    presenters: presenterDays.size,
    repeatPresenters: [...presenterDays.values()].filter((d) => d.size >= 2).length,
    largestRoom: allRooms.reduce((m, r) => Math.max(m, r.joins.size), 0),
  };

  return { generatedAt: now, windowDays, current, previous, trend: days.map((d) => byDay[d]), allTime };
}
