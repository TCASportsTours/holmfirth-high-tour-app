import { getStore } from "@netlify/blobs";

// TCA Tours — Holmfirth NYC tour app backend (v2: push notifications + live subway status)
//
// One endpoint, separate slots, each stored under its own key:
//
//   PUBLIC (anyone with the link can read)
//   GET  /tour                     -> published itinerary (public half of the App Database)
//   GET  /tour?type=alerts[&sid=]  -> alerts for everyone, plus any sent just to this student (staff get all)
//   GET  /tour?type=subway         -> live MTA service alerts for the lines on our itinerary (cached ~2 min)
//   GET  /tour?type=pushkey        -> public VAPID key for push notifications
//   POST /tour?type=pushsub        -> save this phone's push subscription { sub, role }
//
//   STAFF ONLY (header  x-staff-key: <STAFF_PASSWORD (teachers) or TCA_PASSWORD (TCA Tours staff)>)
//   GET  /tour?type=auth           -> 200 if the password is right (used by the staff sign-in)
//   GET  /tour?type=private        -> students, medical, dietary, contacts, transfers, meal orders
//                                     + live room numbers + register, merged in
//   POST /tour?type=alerts         -> replace alerts list; any NEW alert is also sent as a push notification
//   POST /tour?type=roomnums       -> merge room numbers   { "<studentId>": "1203", ... }
//   POST /tour?type=register       -> merge register marks { "<rollId>|<studentId>": {...}, ... }
//
//   ADMIN (header  x-staff-key: <ADMIN_PASSWORD, or STAFF_PASSWORD if no admin one is set>)
//   POST /tour                     -> publish public itinerary
//   POST /tour?type=private        -> publish staff-only data
//   DELETE /tour?type=register|roomnums|alerts -> clear test data
//
// Passwords live in Netlify environment variables, never in the repo:
//   STAFF_PASSWORD (teachers, required), TCA_PASSWORD (TCA Tours staff, optional), ADMIN_PASSWORD (optional).
// Push notifications need VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a URL or mailto:).

const SUBWAY_FEED = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts";
const SUBWAY_LINES = ["1", "2", "3", "A", "C", "E", "7", "R", "W"]; // the lines on our itinerary
const SUBWAY_CACHE_MS = 120000;

const MERGE = new Set(["roomnums", "register"]);
const STAFF_READ = new Set(["private", "auth", "roomnums", "register"]);

function env(name) {
  try { if (typeof Netlify !== "undefined" && Netlify.env) return Netlify.env.get(name) || ""; } catch {}
  return process.env[name] || "";
}

// Constant-time-ish comparison so the password can't be guessed a character at a time.
function same(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0 && a.length > 0;
}

export default async (req) => {
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS, DELETE",
    "access-control-allow-headers": "content-type, x-staff-key",
  };
  if (req.method === "OPTIONS") return new Response("", { headers });

  const store = globalThis.__TOUR_TEST_STORE__ || getStore({ name: "holmfirth-nyc-2026", consistency: "strong" });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "";
  const key = type || "current";

  const staffPass = env("STAFF_PASSWORD");
  const adminPass = env("ADMIN_PASSWORD") || staffPass;
  const given = req.headers.get("x-staff-key") || "";
  const tcaPass = env("TCA_PASSWORD");
  const isStaff = same(given, staffPass) || same(given, adminPass) || (!!tcaPass && same(given, tcaPass));
  const isAdmin = same(given, adminPass);
  const isTca = isAdmin || (!!tcaPass && same(given, tcaPass));
  const notConfigured = () => reply(headers, 503, { ok: false, error: "STAFF_PASSWORD is not set in Netlify environment variables" });
  const denied = () => reply(headers, 401, { ok: false, error: "staff password required" });

  // ---------------- DELETE (admin): clear a live/test slot
  if (req.method === "DELETE") {
    if (!staffPass) return notConfigured();
    if (!isAdmin) return denied();
    const CLEARABLE = { register: "{}", roomnums: "{}", alerts: "[]" };
    if (!(type in CLEARABLE)) return reply(headers, 400, { ok: false, error: "refused: that slot can't be cleared" });
    await store.set(key, CLEARABLE[type]);
    return reply(headers, 200, { ok: true, cleared: type });
  }

  // ---------------- POST
  if (req.method === "POST") {
    let parsed;
    try { parsed = JSON.parse(await req.text()); } catch { return reply(headers, 400, { ok: false, error: "invalid JSON" }); }

    // Anyone using the app can register their phone for push alerts (no personal data: just the browser's push endpoint).
    if (type === "pushsub") {
      const sub = parsed && parsed.sub;
      if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth)
        return reply(headers, 400, { ok: false, error: "refused: not a push subscription" });
      let subs = {};
      try { subs = JSON.parse((await store.get("pushsubs")) || "{}"); } catch { subs = {}; }
      if (parsed.remove) delete subs[sub.endpoint];
      else subs[sub.endpoint] = { sub: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } }, role: String(parsed.role || "").slice(0, 20), sid: String(parsed.sid || "").slice(0, 20), at: Date.now() };
      const keys = Object.keys(subs);
      if (keys.length > 1000) keys.sort((a, b) => subs[a].at - subs[b].at).slice(0, keys.length - 1000).forEach((k) => delete subs[k]);
      await store.set("pushsubs", JSON.stringify(subs));
      return reply(headers, 200, { ok: true });
    }

    if (!staffPass) return notConfigured();

    if (!type || type === "private") {
      if (!isAdmin) return denied();
      if (!type && !(parsed && Array.isArray(parsed.events) && Array.isArray(parsed.days)))
        return reply(headers, 400, { ok: false, error: "refused: not a tour object" });
      if (type === "private" && !(parsed && Array.isArray(parsed.students)))
        return reply(headers, 400, { ok: false, error: "refused: not a staff data object" });
      await store.set(key, JSON.stringify(parsed));
      return reply(headers, 200, { ok: true });
    }

    if (!isStaff) return denied();

    if (type === "alerts") {
      if (!Array.isArray(parsed)) return reply(headers, 400, { ok: false, error: "refused: alerts must be a list" });
      let before = [];
      try { before = JSON.parse((await store.get("alerts")) || "[]"); } catch { before = []; }
      const known = new Set((Array.isArray(before) ? before : []).map((a) => a && a.id));
      const fresh = parsed.filter((a) => a && a.id && !known.has(a.id));
      await store.set(key, JSON.stringify(parsed.slice(0, 30)));
      let pushed = null;
      if (fresh.length) pushed = await sendPush(store, fresh[0]);
      return reply(headers, 200, { ok: true, data: pushed || undefined });
    }

    if (MERGE.has(type)) {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(headers, 400, { ok: false, error: "refused: expected an object" });
      let cur = {};
      try { cur = JSON.parse((await store.get(key)) || "{}"); } catch { cur = {}; }
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) cur = {};
      for (const k of Object.keys(parsed)) cur[k] = parsed[k];
      await store.set(key, JSON.stringify(cur));
      return reply(headers, 200, { ok: true, data: cur });
    }
    return reply(headers, 400, { ok: false, error: "unknown slot" });
  }

  // ---------------- GET
  if (STAFF_READ.has(type)) {
    if (!staffPass) return notConfigured();
    if (!isStaff) return denied();
    if (type === "auth") return reply(headers, 200, { ok: true, admin: isAdmin, tca: isTca });
    if (type === "private") {
      const [priv, rooms, reg] = await Promise.all([store.get("private"), store.get("roomnums"), store.get("register")]);
      const out = priv ? JSON.parse(priv) : null;
      // TCA-only itinerary rows never leave the server for a teacher's phone
      if (out && !isTca) delete out.tcaEvents;
      return reply(headers, 200, { ok: true, data: out, roomnums: safeObj(rooms), register: safeObj(reg) });
    }
    return new Response((await store.get(key)) || "{}", { headers });
  }
  if (type === "pushkey") return reply(headers, 200, { ok: true, key: env("VAPID_PUBLIC_KEY") || null });
  if (type === "subway") return reply(headers, 200, await subwayStatus(store));
  if (type && type !== "alerts") return reply(headers, 400, { ok: false, error: "unknown slot" });
  const data = await store.get(key);
  // Alerts sent to particular students only go to those students' phones (and to staff)
  if (type === "alerts" && data != null && !isStaff) {
    const sid = url.searchParams.get("sid") || "";
    let list = []; try { list = JSON.parse(data); } catch {}
    return new Response(JSON.stringify((Array.isArray(list) ? list : []).filter((a) => !a || !Array.isArray(a.to) || !a.to.length || (sid && a.to.includes(sid)))), { headers });
  }
  if (data != null) return new Response(data, { headers });
  return new Response(type === "alerts" ? "[]" : "null", { headers });
};

// ---------------- push notifications (Web Push, VAPID)
async function sendPush(store, alert) {
  const pub = env("VAPID_PUBLIC_KEY"), priv = env("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return { sent: 0, note: "push keys not configured" };
  let webpush;
  try { webpush = globalThis.__WEBPUSH__ || (await import("web-push")).default; } catch { return { sent: 0, note: "web-push not installed" }; }
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "https://holmfirthnyc.tcatours.co.uk", pub, priv);
  let subs = {};
  try { subs = JSON.parse((await store.get("pushsubs")) || "{}"); } catch { subs = {}; }
  const payload = JSON.stringify({ id: alert.id, title: alert.title || "Message from staff", body: String(alert.msg || "").slice(0, 300) });
  const to = Array.isArray(alert.to) && alert.to.length ? new Set(alert.to) : null;
  let sent = 0, gone = 0;
  await Promise.allSettled(Object.keys(subs).filter((k) => !to || to.has(subs[k].sid)).map(async (k) => {
    try { await webpush.sendNotification(subs[k].sub, payload, { TTL: 6 * 3600, urgency: "high" }); sent++; }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { delete subs[k]; gone++; } }
  }));
  if (gone) await store.set("pushsubs", JSON.stringify(subs));
  return { sent, removed: gone, total: Object.keys(subs).length };
}

// ---------------- live subway status (MTA GTFS-realtime service alerts, no key needed)
async function subwayStatus(store) {
  let cached = null;
  try { cached = JSON.parse((await store.get("subway")) || "null"); } catch {}
  if (cached && Date.now() - cached.at < SUBWAY_CACHE_MS) return cached;
  try {
    const res = await (globalThis.__SUBWAY_FETCH__ || fetch)(SUBWAY_FEED);
    if (!res.ok) throw new Error("MTA feed " + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    const bindings = globalThis.__GTFS__ || (await import("gtfs-realtime-bindings")).default;
    const feed = bindings.transit_realtime.FeedMessage.decode(buf);
    const now = Math.floor(Date.now() / 1000);
    const text = (t) => {
      const tr = (t && t.translation) || [];
      const en = tr.find((x) => x.language === "en") || tr.find((x) => !x.language) || tr.find((x) => !/html/.test(x.language || "")) || tr[0];
      return en ? String(en.text || "").replace(/\s+/g, " ").trim() : "";
    };
    const lines = {}; SUBWAY_LINES.forEach((l) => (lines[l] = []));
    for (const ent of feed.entity || []) {
      const a = ent.alert; if (!a) continue;
      const periods = a.activePeriod || [];
      const active = !periods.length || periods.some((p) => Number(p.start || 0) <= now && (!Number(p.end || 0) || now <= Number(p.end)));
      if (!active) continue;
      const routes = new Set((a.informedEntity || []).map((e) => String(e.routeId || "")).filter((r) => lines[r]));
      if (!routes.size) continue;
      const header = text(a.headerText);
      const kind = /delay|slower|longer wait|running with/i.test(header) ? "Delays"
        : /suspend|no .*trains|not running|skip|bypass|instead|rerout|via the|end at|run local|run express/i.test(header) ? "Service change" : "Notice";
      const item = { id: String(ent.id), kind, header: header.slice(0, 400), detail: text(a.descriptionText).slice(0, 800) };
      routes.forEach((r) => lines[r].push(item));
    }
    const out = { ok: true, at: Date.now(), source: "MTA", lines };
    await store.set("subway", JSON.stringify(out));
    return out;
  } catch (e) {
    if (cached) return Object.assign({}, cached, { stale: true });
    return { ok: false, at: Date.now(), error: "Live subway status is unavailable right now" };
  }
}

function safeObj(s) { try { const o = JSON.parse(s || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; } }
function reply(headers, status, obj) { return new Response(JSON.stringify(obj), { status, headers }); }
