// Renders the weekly report as Markdown plus a small SVG chart.
// Everything written here is aggregate: no room codes, names, user IDs or notes.

import { change } from "./insights.js";

const ICON = { good: "✅", watch: "⚠️", info: "ℹ️" };
const dateFmt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const shortFmt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short" });

const n = (x) => (x == null ? "–" : String(x));
const p = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
const s = (x) => (x == null ? "–" : x < 90 ? `${x}s` : `${Math.round(x / 6) / 10} min`);
const r1 = (x) => (x == null ? "–" : x.toFixed(1));

function delta(cur, prev, kind = "count") {
  if (kind === "rate") {
    if (cur == null || prev == null) return "";
    const d = Math.round((cur - prev) * 100);
    return d === 0 ? "same" : `${d > 0 ? "+" : ""}${d} pts`;
  }
  if (kind === "none") return "";
  const c = change(cur, prev);
  if (c == null) return prev === 0 && cur > 0 ? "new" : "";
  if (c === 0) return "same";
  return `${c > 0 ? "▲" : "▼"} ${Math.round(Math.abs(c) * 100)}%`;
}

export function renderMarkdown(m, ins, { chartPath = "chart.svg" } = {}) {
  const c = m.current, pv = m.previous;
  const L = [];
  L.push(`# Roomkey weekly report`);
  L.push("");
  L.push(`**Last 7 days, ${shortFmt.format(c.from)} to ${dateFmt.format(c.to)}** · compared with the 7 days before`);
  L.push("");
  L.push(`> ${ins.headline}`);
  L.push("");
  L.push(`![Laptops joined per day, last ${m.trend.length} days](${chartPath})`);
  L.push("");
  L.push(`## This week vs last week`);
  L.push("");
  L.push(`| Metric | This week | Last week | Change |`);
  L.push(`|---|---:|---:|---:|`);
  const row = (label, a, b, fmt, kind) => L.push(`| ${label} | ${fmt(a)} | ${fmt(b)} | ${delta(a, b, kind)} |`);
  row("Laptops joined", c.attendees, pv.attendees, n);
  row("Real sessions (3+ laptops)", c.realSessions, pv.realSessions, n);
  row("Rooms opened", c.roomsCreated, pv.roomsCreated, n);
  row("Presenters", c.presenters, pv.presenters, n);
  row("Lines and sections copied", c.copies, pv.copies, n);
  row("Copies per attendee", c.copiesPerAttendee, pv.copiesPerAttendee, r1, "none");
  row("Time to fill a room (80%)", c.medianFillSeconds, pv.medianFillSeconds, s, "none");
  row("Wrong PIN rate", c.pinFailRate, pv.pinFailRate, p, "rate");
  row("Joined on a phone", c.mobileShare, pv.mobileShare, p, "rate");
  row("Pressed \"I'm stuck\"", c.stuckRate, pv.stuckRate, p, "rate");
  row("Rooms closed after use", c.closeRate, pv.closeRate, p, "rate");
  L.push("");
  L.push(`## What stands out`);
  L.push("");
  for (const i of ins.insights) L.push(`- ${ICON[i.level]} **${i.title}.** ${i.detail}`);
  L.push("");
  L.push(`## Next steps`);
  L.push("");
  ins.actions.forEach((a, k) => L.push(`${k + 1}. ${a}`));
  L.push("");

  if (c.sessionList.length) {
    L.push(`## Sessions this week`);
    L.push("");
    L.push(`| Session | Started | Laptops | Fill time | Copies | Stuck | On phones | Closed |`);
    L.push(`|---|---|---:|---:|---:|---:|---:|:---:|`);
    c.sessionList.forEach((x, k) =>
      L.push(`| ${k + 1} | ${shortFmt.format(x.startedAt)} | ${x.laptops} | ${s(x.fillSeconds)} | ${x.copies} | ${x.stuckPeople} | ${p(x.mobileShare)} | ${x.closed ? "yes" : "no"} |`));
    L.push("");
  }

  const a = m.allTime;
  L.push(`## All time`);
  L.push("");
  L.push(`${n(a.attendees)} laptops in ${n(a.realSessions)} real sessions, ${n(a.copies)} copies, ${n(a.presenters)} presenters (${n(a.repeatPresenters)} came back on another day). Biggest room: ${n(a.largestRoom)} laptops.`);
  L.push("");
  L.push(`---`);
  L.push(`<sub>Made by the Roomkey insights agent in GitHub Actions. Counts only: Roomkey never records note contents, PINs or keys, and this report leaves out room codes, names and user IDs.</sub>`);
  L.push("");
  return L.join("\n");
}

export function renderChart(trend, { width = 720, height = 220 } = {}) {
  const pad = { l: 36, r: 12, t: 30, b: 34 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const max = Math.max(4, ...trend.map((d) => d.attendees));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const bw = w / trend.length;
  const y = (v) => pad.t + h - (v / top) * h;
  const esc = (t) => String(t).replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch]);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">`);
  out.push(`<rect width="100%" height="100%" rx="8" fill="#ffffff" stroke="#e6e4df"/>`);
  out.push(`<text x="${pad.l}" y="18" font-size="12" font-weight="600" fill="#37352f">Laptops joined per day</text>`);
  for (let i = 0; i <= 4; i++) {
    const v = step * i, yy = y(v);
    out.push(`<line x1="${pad.l}" x2="${width - pad.r}" y1="${yy}" y2="${yy}" stroke="${i ? "#efeee9" : "#c9c7c0"}"/>`);
    out.push(`<text x="${pad.l - 6}" y="${yy + 4}" font-size="10" text-anchor="end" fill="#8a877f">${v}</text>`);
  }
  trend.forEach((d, i) => {
    const x = pad.l + i * bw;
    if (d.attendees > 0) {
      const yy = y(d.attendees);
      out.push(`<rect x="${(x + bw * 0.18).toFixed(1)}" y="${yy.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${(pad.t + h - yy).toFixed(1)}" rx="2" fill="${i >= trend.length - 7 ? "#2f6fdb" : "#a9c3ef"}"><title>${esc(d.day)}: ${d.attendees}</title></rect>`);
    }
    if (i % 7 === 0 || i === trend.length - 1) {
      const [, mo, da] = d.day.split("-");
      out.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${height - 14}" font-size="10" text-anchor="middle" fill="#8a877f">${Number(da)}/${Number(mo)}</text>`);
    }
  });
  out.push(`<text x="${width - pad.r}" y="18" font-size="10" text-anchor="end" fill="#8a877f">dark bars = this week</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}
