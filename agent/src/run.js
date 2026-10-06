#!/usr/bin/env node
// Roomkey insights agent.
//   node src/run.js --source firebase             live data (needs env vars, see README)
//   node src/run.js --source demo --out ../demo   fake data, for trying it out
//   node src/run.js --source file --file events.json
// Writes <out>/README.md (latest report), <out>/chart.svg, <out>/latest.json
// and an archived copy in <out>/weekly/YYYY-MM-DD.md.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { computeMetrics, dayKey } from "./metrics.js";
import { generateInsights } from "./insights.js";
import { renderMarkdown, renderChart } from "./render.js";
import { loadEvents } from "./source.js";

const { values: args } = parseArgs({
  options: {
    source: { type: "string", default: "firebase" },
    file: { type: "string" },
    out: { type: "string", default: "../reports" },
    now: { type: "string" },
    print: { type: "boolean", default: false },
  },
});

const now = args.now ? Date.parse(args.now) : Date.now();
if (!Number.isFinite(now)) throw new Error(`--now "${args.now}" is not a date`);

const events = await loadEvents({ source: args.source, file: args.file, now });
const metrics = computeMetrics(events, { now });
const insights = generateInsights(metrics);
const out = resolve(args.out);
const day = dayKey(now);

await mkdir(join(out, "weekly"), { recursive: true });
const latest = renderMarkdown(metrics, insights, { chartPath: "chart.svg" });
const archived = renderMarkdown(metrics, insights, { chartPath: `${day}.svg` });
const chart = renderChart(metrics.trend);
const summary = {
  generatedAt: new Date(now).toISOString(),
  headline: insights.headline,
  insights: insights.insights,
  actions: insights.actions,
  current: { ...metrics.current, sessionList: undefined },
  previous: { ...metrics.previous, sessionList: undefined },
  allTime: metrics.allTime,
  trend: metrics.trend,
};

await Promise.all([
  writeFile(join(out, "README.md"), latest),
  writeFile(join(out, "chart.svg"), chart),
  writeFile(join(out, "latest.json"), JSON.stringify(summary, null, 2) + "\n"),
  writeFile(join(out, "weekly", `${day}.md`), archived),
  writeFile(join(out, "weekly", `${day}.svg`), chart),
]);

console.log(`Read ${events.length} events. ${insights.headline}`);
console.log(`Report written to ${out}`);
if (args.print) console.log("\n" + latest);
