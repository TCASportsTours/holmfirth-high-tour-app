import { getStore } from "@netlify/blobs";

// TCA Tours — Holmfirth NYC tour app backend (v3: hardened — lockout, size limits, safe merges, device-bound student alerts)
//
// One endpoint, separate slots, each stored under its own key:
//
//   PUBLIC (anyone with the link can read)
//   GET  /tour                     -> published itinerary (public half of the App Database)
//   GET  /tour?type=alerts[&sid=]  -> alerts for everyone, plus any sent just to this student (staff get all)
//   GET  /tour?type=subway         -> live MTA service alerts for the lines on our itinerary (cached ~2 min)
//   GET  /tour?type=pushkey        -> public VAPID key for push notifications
//   POST /tour?type=pushsub        -> save this phone's push subscription { sub, role }
//   GET  /tour?type=me&sid=        -> has this student been signed out by TCA? { kickedAt }
//   POST /tour?type=hello          -> "this phone is using the app" (student with token, or staff with key)
//   GET  /tour?type=sessions       -> TCA/admin: who has signed in, when last seen
//   POST /tour?type=kick {sid}     -> TCA/admin: sign a student's phones out
//   POST /tour?type=resetall       -> admin: sign EVERY phone out (students and staff) and clear sign-in records
//   POST /tour?type=quizscore      -> a signed-in student's phone saves a finished NYC Quiz score
//   GET  /tour?type=quiz           -> TCA/admin: quiz leaderboard
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

// ---- hardening limits
const LOCK_AFTER = 8, LOCK_WINDOW_MS = 15 * 60000;          // 8 wrong passwords in 15 min -> locked out for 15 min
const MAX_BODY = 256 * 1024, MAX_PUBLISH_BODY = 3 * 1024 * 1024;
const MAX_ALERTS = 30, MAX_TITLE = 120, MAX_MSG = 2000, MAX_TO = 100;
const MAX_SUBS = 1000, MAX_DEVICES_PER_STUDENT = 3;
// Only the real browser push services — never let a subscription point the server at an arbitrary URL
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com|push\.api\.chromium\.org)$/i;
const KEY_RULES = {
  register: (k, v) => /^(roll\|r[a-z0-9]{1,20}|r[a-z0-9]{1,20}\|s[a-z0-9]{1,20})$/.test(k) && v && typeof v === "object" && !Array.isArray(v) && JSON.stringify(v).length < 600,
  roomnums: (k, v) => /^s[a-z0-9]{1,20}$/.test(k) && typeof v === "string" && v.length <= 12,
};

async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Lockout is per connection AND device type: on hostel wifi every phone shares one address,
// so one student guessing passwords must not lock every teacher out.
function clientIp(req) {
  const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  return ip + "|" + String(req.headers.get("user-agent") || "").slice(0, 160);
}
function cleanAlert(a) {
  if (!a || typeof a !== "object" || !a.id) return null;
  const out = { id: String(a.id).slice(0, 40), title: String(a.title || "").slice(0, MAX_TITLE), msg: String(a.msg || "").slice(0, MAX_MSG),
    at: Number(a.at) || Date.now(), by: String(a.by || "Staff").slice(0, 60) };
  if (Array.isArray(a.to) && a.to.length) out.to = a.to.map((x) => String(x).slice(0, 24)).slice(0, MAX_TO);
  return out;
}
// A student's phone proves it is the phone that signed in as that student (token made on the phone at sign-in)
async function deviceOk(store, sid, token) {
  if (!sid || !token) return false;
  let claims = {}; try { claims = JSON.parse((await store.get("claims")) || "{}"); } catch {}
  return Array.isArray(claims[sid]) && claims[sid].includes(await sha(token));
}

const MERGE = new Set(["roomnums", "register"]);
const STAFF_READ = new Set(["private", "auth", "roomnums", "register", "sessions", "quiz"]);
const SEEN_EVERY_MS = 5 * 60000;   // only write "last seen" every 5 minutes per person

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
    "access-control-allow-headers": "content-type, x-staff-key, x-device",
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

  // ---- lockout: too many wrong passwords from one connection
  const ip = clientIp(req);
  let fails = {};
  if (given) { try { fails = JSON.parse((await store.get("authfails")) || "{}"); } catch { fails = {}; } }
  const f = fails[ip];
  if (given && f && f.n >= LOCK_AFTER && Date.now() - f.first < LOCK_WINDOW_MS)
    return reply(headers, 429, { ok: false, error: "Too many wrong passwords. Try again in 15 minutes." });
  if (given && staffPass && !isStaff) {
    const cur = f && Date.now() - f.first < LOCK_WINDOW_MS ? f : { n: 0, first: Date.now() };
    cur.n++; fails[ip] = cur;
    for (const k of Object.keys(fails)) if (Date.now() - fails[k].first > LOCK_WINDOW_MS) delete fails[k];
    await store.set("authfails", JSON.stringify(fails));
  } else if (given && isStaff && f) { delete fails[ip]; await store.set("authfails", JSON.stringify(fails)); }

  // ---------------- DELETE (admin): clear a live/test slot
  if (req.method === "DELETE") {
    if (!staffPass) return notConfigured();
    if (!isAdmin) return denied();
    const CLEARABLE = { register: "{}", roomnums: "{}", alerts: "[]", claims: "{}", pushsubs: "{}", sessions: "{}", kicked: "{}", quiz: "{}" };
    if (!(type in CLEARABLE)) return reply(headers, 400, { ok: false, error: "refused: that slot can't be cleared" });
    await store.set(key, CLEARABLE[type]);
    return reply(headers, 200, { ok: true, cleared: type });
  }

  // ---------------- POST
  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > ((!type || type === "private") ? MAX_PUBLISH_BODY : MAX_BODY)) return reply(headers, 413, { ok: false, error: "too large" });
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return reply(headers, 400, { ok: false, error: "invalid JSON" }); }

    // A student's phone registers a secret token at sign-in, so only that phone can read alerts sent to that student.
    if (type === "claim") {
      const sid = String((parsed && parsed.sid) || ""), token = String((parsed && parsed.token) || "");
      if (!/^s[a-z0-9]{1,20}$/.test(sid) || token.length < 16 || token.length > 100) return reply(headers, 400, { ok: false, error: "bad claim" });
      let claims = {}; try { claims = JSON.parse((await store.get("claims")) || "{}"); } catch {}
      const h = await sha(token); const list = Array.isArray(claims[sid]) ? claims[sid] : [];
      if (!list.includes(h)) {
        if (list.length >= MAX_DEVICES_PER_STUDENT && !isStaff) return reply(headers, 409, { ok: false, error: "This name is already signed in on other phones. Ask a teacher." });
        list.push(h); claims[sid] = list.slice(-MAX_DEVICES_PER_STUDENT);
        await store.set("claims", JSON.stringify(claims));
      }
      return reply(headers, 200, { ok: true, at: Date.now() });
    }
    // A phone says it is in use: students prove it with their token, staff with their password
    if (type === "hello") {
      let who = null;
      const sid = String((parsed && parsed.sid) || "");
      if (sid && (await deviceOk(store, sid, parsed.token))) who = "student:" + sid;
      else if (isStaff) who = "staff:" + (isAdmin ? "admin" : isTca ? "tca" : "teacher") + ":" + String((parsed && parsed.name) || "").slice(0, 40);
      if (!who) return reply(headers, 200, { ok: false });
      let ses = {}; try { ses = JSON.parse((await store.get("sessions")) || "{}"); } catch {}
      const now = Date.now(), cur = ses[who] || { first: now, last: 0, opens: 0 };
      if (now - cur.last > SEEN_EVERY_MS) {
        cur.last = now; cur.opens = (cur.opens || 0) + 1;
        const ua = String(req.headers.get("user-agent") || "");
        cur.device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "Other";
        ses[who] = cur; await store.set("sessions", JSON.stringify(ses));
      }
      return reply(headers, 200, { ok: true });
    }
    // NYC Quiz: only a phone signed in as that student can save that student's score
    if (type === "quizscore") {
      const sid = String((parsed && parsed.sid) || "");
      if (!(await deviceOk(store, sid, parsed.token))) return reply(headers, 403, { ok: false, error: "sign in as a student first" });
      const n = (v, max) => { v = Math.round(Number(v)); return Number.isFinite(v) && v >= 0 && v <= max ? v : null; };
      const max = n(parsed.max, 1000), score = n(parsed.score, 1000), total = n(parsed.total, 100), correct = n(parsed.correct, 100), streak = n(parsed.streak, 100);
      if (max === null || score === null || score > max || total === null || correct === null || correct > total) return reply(headers, 400, { ok: false, error: "bad score" });
      const rounds = Array.isArray(parsed.rounds) ? parsed.rounds.slice(0, 10).map((x) => n(x, 1000) || 0) : [];
      const quiz = safeObj(await store.get("quiz"));
      const rec = quiz[sid] || { attempts: [] };
      rec.attempts.push({ score, max, correct, total, streak: streak || 0, rounds, at: Date.now() });
      rec.attempts = rec.attempts.slice(-20);
      quiz[sid] = rec; await store.set("quiz", JSON.stringify(quiz));
      return reply(headers, 200, { ok: true, attempts: rec.attempts.length });
    }
    if (type === "kick") {              // TCA Tours / admin signs a student's phones out
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can do this" });
      const sid = String((parsed && parsed.sid) || "");
      if (!/^s[a-z0-9]{1,20}$/.test(sid)) return reply(headers, 400, { ok: false, error: "bad student" });
      const [c, k, se, ps] = await Promise.all(["claims", "kicked", "sessions", "pushsubs"].map((x) => store.get(x)));
      const claims = safeObj(c), kicked = safeObj(k), ses = safeObj(se), subs = safeObj(ps);
      delete claims[sid]; kicked[sid] = Date.now(); delete ses["student:" + sid];
      for (const e of Object.keys(subs)) if (subs[e].sid === sid) delete subs[e];
      await Promise.all([store.set("claims", JSON.stringify(claims)), store.set("kicked", JSON.stringify(kicked)), store.set("sessions", JSON.stringify(ses)), store.set("pushsubs", JSON.stringify(subs))]);
      return reply(headers, 200, { ok: true, kickedAt: kicked[sid] });
    }
    if (type === "resetall") {          // admin: every phone goes back to the launch page
      if (!isAdmin) return reply(headers, 403, { ok: false, error: "admin password required" });
      const at = Date.now();
      await Promise.all([store.set("resetAt", String(at)), store.set("claims", "{}"), store.set("sessions", "{}"), store.set("pushsubs", "{}"), store.set("kicked", "{}")]);
      return reply(headers, 200, { ok: true, resetAt: at });
    }
    if (type === "unclaim") {           // teacher resets a student's phones
      if (!isStaff) return denied();
      const sid = String((parsed && parsed.sid) || "");
      let claims = {}; try { claims = JSON.parse((await store.get("claims")) || "{}"); } catch {}
      delete claims[sid]; await store.set("claims", JSON.stringify(claims));
      return reply(headers, 200, { ok: true });
    }

    // Anyone using the app can register their phone for push alerts (no personal data: just the browser's push endpoint).
    if (type === "pushsub") {
      const sub = parsed && parsed.sub;
      let host = ""; try { host = new URL(sub && sub.endpoint).hostname; } catch {}
      if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 || !PUSH_HOSTS.test(host) ||
          !sub.keys || typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string" || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100)
        return reply(headers, 400, { ok: false, error: "refused: not a push subscription" });
      const sidClaim = String(parsed.sid || "");
      if (sidClaim && !(await deviceOk(store, sidClaim, parsed.token))) return reply(headers, 403, { ok: false, error: "this phone isn't signed in as that student" });
      let subs = {};
      try { subs = JSON.parse((await store.get("pushsubs")) || "{}"); } catch { subs = {}; }
      if (parsed.remove) delete subs[sub.endpoint];
      else subs[sub.endpoint] = { sub: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } }, role: String(parsed.role || "").slice(0, 20), sid: sidClaim.slice(0, 24), at: Date.now() };
      if (!subs[sub.endpoint] && Object.keys(subs).length >= MAX_SUBS && !parsed.remove) return reply(headers, 507, { ok: false, error: "too many phones registered" });
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
      let before = [];
      try { before = JSON.parse((await store.get("alerts")) || "[]"); } catch { before = []; }
      if (!Array.isArray(before)) before = [];
      let next;
      if (parsed && !Array.isArray(parsed) && (parsed.add || parsed.remove)) {     // preferred: one change at a time
        next = before.filter((a) => a && a.id !== parsed.remove);
        const add = cleanAlert(parsed.add);
        if (add) next = [add].concat(next.filter((a) => a.id !== add.id));
      } else if (Array.isArray(parsed)) next = parsed.map(cleanAlert).filter(Boolean);
      else return reply(headers, 400, { ok: false, error: "refused: alerts must be a list or {add|remove}" });
      next = next.slice(0, MAX_ALERTS);
      const known = new Set(before.map((a) => a && a.id));
      const fresh = next.filter((a) => !known.has(a.id));
      await store.set(key, JSON.stringify(next));
      let pushed = null;
      if (fresh.length) pushed = await sendPush(store, fresh[0]);
      return reply(headers, 200, { ok: true, data: pushed || undefined });
    }

    if (MERGE.has(type)) {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(headers, 400, { ok: false, error: "refused: expected an object" });
      const ks = Object.keys(parsed);
      if (ks.length > 500 || ks.some((k) => !KEY_RULES[type](k, parsed[k]))) return reply(headers, 400, { ok: false, error: "refused: unexpected entries" });
      let cur = {};
      try { cur = JSON.parse((await store.get(key)) || "{}"); } catch { cur = {}; }
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) cur = {};
      for (const k of ks) {
        // newest wins: a tick saved offline earlier can't overwrite a newer one from another phone
        if (type === "register" && cur[k] && Number(cur[k].at) > Number(parsed[k].at || 0) && !k.startsWith("roll|")) continue;
        cur[k] = parsed[k];
      }
      if (Object.keys(cur).length > 20000) return reply(headers, 507, { ok: false, error: "register is full — clear test data in admin" });
      await store.set(key, JSON.stringify(cur));
      return reply(headers, 200, { ok: true, data: cur });
    }
    return reply(headers, 400, { ok: false, error: "unknown slot" });
  }

  // ---------------- GET
  if (STAFF_READ.has(type)) {
    if (!staffPass) return notConfigured();
    if (!isStaff) return denied();
    if (type === "auth") return reply(headers, 200, { ok: true, admin: isAdmin, tca: isTca, at: Date.now() });
    if (type === "quiz") {
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can see this" });
      const [pub, priv, qz] = await Promise.all(["current", "private", "quiz"].map((x) => store.get(x)));
      let P = null, U = null; try { P = JSON.parse(priv || "null"); } catch {} try { U = JSON.parse(pub || "null"); } catch {}
      const quiz = safeObj(qz), labels = {}; ((U && U.students) || []).forEach((x) => (labels[x.id] = x.label));
      const rows = ((P && P.students) || []).map((x) => {
        const a = (quiz[x.id] && quiz[x.id].attempts) || [];
        const best = a.reduce((m, t) => (!m || t.score > m.score ? t : m), null);
        return { id: x.id, name: x.name, label: labels[x.id] || x.name, group: x.group, attempts: a.length, first: a[0] || null, best, last: a[a.length - 1] || null };
      });
      return reply(headers, 200, { ok: true, at: Date.now(), rows });
    }
    if (type === "sessions") {
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can see this" });
      const [pub, priv, se, c, k, ps] = await Promise.all(["current", "private", "sessions", "claims", "kicked", "pushsubs"].map((x) => store.get(x)));
      let P = null, U = null; try { P = JSON.parse(priv || "null"); } catch {} try { U = JSON.parse(pub || "null"); } catch {}
      const ses = safeObj(se), claims = safeObj(c), kicked = safeObj(k), subs = safeObj(ps);
      const labels = {}; ((U && U.students) || []).forEach((x) => (labels[x.id] = x.label));
      const alertsOn = {}; Object.values(subs).forEach((x) => { if (x.sid) alertsOn[x.sid] = true; });
      const students = ((P && P.students) || []).map((x) => {
        const s1 = ses["student:" + x.id] || null;
        return { id: x.id, name: x.name, label: labels[x.id] || x.name, group: x.group, teacher: x.teacher,
          phones: Array.isArray(claims[x.id]) ? claims[x.id].length : 0, first: s1 && s1.first, last: s1 && s1.last, opens: s1 && s1.opens,
          device: s1 && s1.device, alerts: !!alertsOn[x.id], kickedAt: kicked[x.id] || null };
      });
      const staff = Object.keys(ses).filter((x) => x.startsWith("staff:")).map((x) => {
        const [, kind, name] = x.split(":"); return Object.assign({ kind, name: name || "" }, ses[x]); })
        .sort((a, b) => b.last - a.last);
      return reply(headers, 200, { ok: true, at: Date.now(), students, staff, pushPhones: Object.keys(subs).length });
    }
    if (type === "private") {
      const [priv, rooms, reg] = await Promise.all([store.get("private"), store.get("roomnums"), store.get("register")]);
      const out = priv ? JSON.parse(priv) : null;
      // TCA-only itinerary rows never leave the server for a teacher's phone
      if (out && !isTca) delete out.tcaEvents;
      return reply(headers, 200, { ok: true, data: out, roomnums: safeObj(rooms), register: safeObj(reg) });
    }
    return new Response((await store.get(key)) || "{}", { headers });
  }
  if (type === "me") {
    const sid = url.searchParams.get("sid") || "";
    const [k, r] = await Promise.all([store.get("kicked"), store.get("resetAt")]);
    const kicked = safeObj(k);
    return reply(headers, 200, { ok: true, kickedAt: (sid && kicked[sid]) || null, resetAt: Number(r) || null });
  }
  if (type === "pushkey") return reply(headers, 200, { ok: true, key: env("VAPID_PUBLIC_KEY") || null });
  if (type === "subway") return reply(headers, 200, await subwayStatus(store));
  if (type && type !== "alerts") return reply(headers, 400, { ok: false, error: "unknown slot" });
  const data = await store.get(key);
  // Alerts sent to particular students only go to those students' phones (and to staff)
  if (type === "alerts" && data != null && !isStaff) {
    const sid = url.searchParams.get("sid") || "";
    const okSid = sid && (await deviceOk(store, sid, req.headers.get("x-device") || url.searchParams.get("t") || "")) ? sid : "";
    let list = []; try { list = JSON.parse(data); } catch {}
    return new Response(JSON.stringify((Array.isArray(list) ? list : []).filter((a) => !a || !Array.isArray(a.to) || !a.to.length || (okSid && a.to.includes(okSid)))), { headers });
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
