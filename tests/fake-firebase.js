// A tiny in-memory stand-in for the Firebase compat SDK, used only by the
// end-to-end test. Supports exactly what app.js uses. State can be exported
// from one page and seeded into another to simulate presenter + attendee.
(function () {
  const seed = window.__FAKE_SEED__ || {};
  const store = { data: JSON.parse(JSON.stringify(seed.data || {})), log: [] };
  const uid = window.__FAKE_UID__ || "uid-" + Math.random().toString(36).slice(2, 10);
  const TS = { ".sv": "timestamp" };
  const listeners = [];
  let pushN = 0;

  const parts = (p) => String(p).split("/").filter(Boolean);
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const resolveTs = (v) => {
    if (v && typeof v === "object") {
      if (v[".sv"] === "timestamp") return Date.now();
      const o = Array.isArray(v) ? [] : {};
      for (const k in v) o[k] = resolveTs(v[k]);
      return o;
    }
    return v;
  };
  function read(path) {
    let cur = store.data;
    for (const k of parts(path)) { if (cur == null || typeof cur !== "object") return null; cur = cur[k]; }
    return cur === undefined ? null : clone(cur);
  }
  function write(path, val) {
    const ks = parts(path);
    if (!ks.length) { store.data = val || {}; return; }
    let cur = store.data;
    for (const k of ks.slice(0, -1)) { if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {}; cur = cur[k]; }
    const last = ks[ks.length - 1];
    if (val == null) delete cur[last]; else cur[last] = val;
  }
  function notify(path) {
    const p = parts(path).join("/");
    for (const l of listeners) {
      const lp = parts(l.path).join("/");
      if (lp === ".info/connected") continue;
      if (p === lp || p.startsWith(lp + "/") || lp.startsWith(p + "/") || !lp || !p) l.cb(snap(l.path));
    }
  }
  const snap = (path) => ({ val: () => read(path) });

  function ref(path) {
    path = parts(path).join("/");
    return {
      on(_type, cb) {
        listeners.push({ path, cb });
        setTimeout(() => cb(path === ".info/connected" ? { val: () => true } : snap(path)), 0);
        return cb;
      },
      off(_type, cb) { const i = listeners.findIndex((l) => l.cb === cb); if (i >= 0) listeners.splice(i, 1); },
      async set(v) { const val = resolveTs(clone(v)); store.log.push({ op: "set", path, val }); write(path, val); notify(path); },
      async update(obj) { for (const k in obj) { const p = path + "/" + k; write(p, resolveTs(clone(obj[k]))); notify(p); } },
      async remove() { write(path, null); notify(path); },
      push(v) {
        const key = "k" + String(++pushN).padStart(6, "0");
        const child = ref(path + "/" + key);
        const pr = v === undefined ? Promise.resolve() : child.set(v);
        pr.key = key; return pr;
      },
      onDisconnect() { return { remove() {}, cancel() {} }; },
    };
  }

  const db = { ref };
  const database = () => db;
  database.ServerValue = { TIMESTAMP: TS };
  const authObj = {
    onAuthStateChanged(cb) { authObj._cb = cb; },
    signInAnonymously() { setTimeout(() => authObj._cb && authObj._cb({ uid }), 0); return Promise.resolve(); },
  };
  window.firebase = { initializeApp() {}, auth: () => authObj, database };
  window.__fake = { store, uid, read };
})();
