// Where the events come from: the live Firebase database, a JSON file, or demo data.

import { readFile } from "node:fs/promises";
import { makeEvents } from "./fixture.js";

export async function loadEvents({ source, file, now }) {
  if (source === "demo") return makeEvents({ now });
  if (source === "file") {
    if (!file) throw new Error("--file is required with --source file");
    const data = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(data) ? data : Object.values(data.events || data);
  }
  if (source === "firebase") return loadFromFirebase();
  throw new Error(`Unknown source "${source}". Use firebase, file or demo.`);
}

async function loadFromFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!raw || !databaseURL) {
    throw new Error("Set FIREBASE_SERVICE_ACCOUNT (the service account JSON) and FIREBASE_DATABASE_URL.");
  }
  let credentials;
  try { credentials = JSON.parse(raw); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON."); }

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getDatabase } = await import("firebase-admin/database");
  const app = initializeApp({ credential: cert(credentials), databaseURL }, "roomkey-agent");
  try {
    // Admin access bypasses the database rules, which keep /events unreadable to everyone else.
    const snap = await getDatabase(app).ref("events").get();
    return Object.values(snap.val() || {});
  } finally {
    const { deleteApp } = await import("firebase-admin/app");
    await deleteApp(app);
  }
}
