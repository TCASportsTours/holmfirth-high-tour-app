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
//   POST /tour?type=quizscore      -> a signed-in student (phone token) or teacher (teacher password + name) saves
//                                     their finished NYC Quiz score. ONE go each: a second score is refused (409).
//   POST /tour?type=quizstart      -> same player says "I've started" (counted, so restarts show on the leaderboard)
//   POST /tour?type=tq             -> teacher questionnaire: teacher password + their name (TCA/admin = test); replaces their earlier answers
//   GET  /tour?type=tq             -> TCA/admin: every questionnaire response + the teacher list
//   POST /tour?type=tqdel {key}    -> TCA/admin: delete one response
//   FEEDBACK (separate links: /feedback/teachers and /feedback/students; no sign-in needed to send)
//   POST /tour?type=fbphoto        -> one photo (shrunk on the phone) for a questionnaire; returns its id
//   POST /tour?type=feedback       -> a teacher or student questionnaire; saved here, then sent to the master Google Sheet
//   GET  /tour?type=fb             -> TCA/admin: every response (+ the older in-app teacher answers), and the hub status
//   GET  /tour?type=fbrows         -> TCA/admin: every response laid out as the spreadsheet's tabs (for Export to Excel)
//   GET  /tour?type=fbphoto&id=    -> TCA/admin: one photo
//   POST /tour?type=fbsync {id}    -> TCA/admin: send one response to the spreadsheet (one step per call: a photo, then the rows)
//   POST /tour?type=fbping         -> TCA/admin: check the spreadsheet link; creates its tabs
//   POST /tour?type=fbdel {id}     -> TCA/admin: delete a response here (not from the spreadsheet)
//   The master Google Sheet is set by FEEDBACK_HUB_URL + FEEDBACK_HUB_TOKEN (see hub/TCA_Feedback_Hub_v2.gs).
//   RESULTS PAGE (/sheet): header x-sheet-key = FEEDBACK_VIEW_PASSWORD (no Google account needed)
//   GET  /tour?type=sheetdata      -> every tab of the master spreadsheet (every tour); this tour's own copy if it isn't connected
//   GET  /tour?type=sheetphoto&id= -> one questionnaire photo (from the app, else from the Drive folder)
//   GET  /tour?type=quizme         -> has this player already done it? (?sid= + x-device, or teacher key + ?teacher=)
//   GET  /tour?type=quiz           -> TCA/admin: quiz leaderboard
//   GET  /tour?type=quizstate      -> is the quiz open? { open, mode, opensAt }
//   POST /tour?type=quizlock       -> TCA/admin: { mode: "auto" | "open" | "closed" }
//   GET  /tour?type=fxrate&cur=USD -> TCA/admin: live rate, 1 <cur> = x GBP (open.er-api.com, fallback Frankfurter/ECB)
//   POST /tour?type=expense        -> TCA/admin: submit an expense + receipt files; the server stamps the date and time
//   EXPENSES (admin password in x-staff-key AND the expenses password in x-expenses-key; staff on tour can't read them)
//   GET  /tour?type=expenses       -> every expense (no file data)
//   GET  /tour?type=receipt&id=&n= -> one receipt file { name, type, data (data: URL) }
//   POST /tour?type=expensedel {id}-> delete an expense and its receipts
//   DELETE /tour?type=expenses     -> clear every expense and receipt
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
//   STAFF_PASSWORD (teachers, required), TCA_PASSWORD (TCA Tours staff, optional), ADMIN_PASSWORD (optional),
//   EXPENSES_PASSWORD (second password for the expenses list in admin.html).
// Push notifications need VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a URL or mailto:).

const SUBWAY_FEED = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts";
const SUBWAY_LINES = ["1", "2", "3", "A", "C", "E", "7", "R", "W"]; // the lines on our itinerary
const SUBWAY_CACHE_MS = 120000;

// ---- NYC Quiz: locked until Wed 28 Oct 2026, 5.30pm New York time (EDT, UTC-4) = 21:30 UTC
const QUIZ_OPENS_AT = Date.UTC(2026, 9, 28, 21, 30);
// Changing this id wipes the leaderboard once, on the next request after a deploy
const QUIZ_RESET_ID = "2026-10-16-launch";
async function quizReset(store) {
  if ((await store.get("quizResetId")) !== QUIZ_RESET_ID) { await store.set("quiz", "{}"); await store.set("quizResetId", QUIZ_RESET_ID); }
}
async function quizState(store) {
  let mode = "auto"; try { mode = (JSON.parse((await store.get("quizlock")) || "{}").mode) || "auto"; } catch {}
  const open = mode === "open" || (mode === "auto" && Date.now() >= QUIZ_OPENS_AT);
  return { ok: true, open, mode, opensAt: QUIZ_OPENS_AT, now: Date.now() };
}

// ---- hardening limits
const LOCK_AFTER = 8, LOCK_WINDOW_MS = 15 * 60000;          // 8 wrong passwords in 15 min -> locked out for 15 min
const MAX_BODY = 256 * 1024, MAX_PUBLISH_BODY = 3 * 1024 * 1024;
const MAX_ALERTS = 30, MAX_TITLE = 120, MAX_MSG = 2000, MAX_TO = 100;
const MAX_SUBS = 1000, MAX_DEVICES_PER_STUDENT = 3;
// Expenses: one request carries the receipts (photos are shrunk on the phone first). Netlify's request limit is 6 MB.
const MAX_EXPENSE_BODY = 5.5 * 1024 * 1024, MAX_RECEIPTS = 6;
const CUR_RE = /^[A-Z]{3}$/;
const FX_CACHE_MS = 10 * 60000;
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
const STAFF_READ = new Set(["private", "auth", "roomnums", "register", "sessions", "quiz", "fxrate", "expenses", "receipt", "tq", "fb", "fbrows"]);
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
    "access-control-allow-headers": "content-type, x-staff-key, x-device, x-expenses-key, x-sheet-key",
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
  // Expenses list: the admin password AND the separate expenses password
  const expPass = env("EXPENSES_PASSWORD"), expGiven = req.headers.get("x-expenses-key") || "";
  const isExp = isAdmin && !!expPass && same(expGiven, expPass);
  const expDenied = () => reply(headers, expPass ? 401 : 503, { ok: false, error: expPass ? "expenses password required" : "EXPENSES_PASSWORD is not set in Netlify environment variables" });
  // Results page for the master feedback spreadsheet: its own password, no Google account
  const sheetPass = env("FEEDBACK_VIEW_PASSWORD"), sheetGiven = req.headers.get("x-sheet-key") || "";
  const isSheet = !!sheetPass && same(sheetGiven, sheetPass);
  const notConfigured = () => reply(headers, 503, { ok: false, error: "STAFF_PASSWORD is not set in Netlify environment variables" });
  const denied = () => reply(headers, 401, { ok: false, error: "staff password required" });

  // ---- lockout: too many wrong passwords from one connection
  const ip = clientIp(req);
  let fails = {};
  const tried = given || expGiven || sheetGiven;
  if (tried) { try { fails = JSON.parse((await store.get("authfails")) || "{}"); } catch { fails = {}; } }
  const f = fails[ip];
  if (tried && f && f.n >= LOCK_AFTER && Date.now() - f.first < LOCK_WINDOW_MS)
    return reply(headers, 429, { ok: false, error: "Too many wrong passwords. Try again in 15 minutes." });
  if ((given && staffPass && !isStaff) || (expGiven && expPass && !same(expGiven, expPass)) || (sheetGiven && sheetPass && !isSheet)) {
    const cur = f && Date.now() - f.first < LOCK_WINDOW_MS ? f : { n: 0, first: Date.now() };
    cur.n++; fails[ip] = cur;
    for (const k of Object.keys(fails)) if (Date.now() - fails[k].first > LOCK_WINDOW_MS) delete fails[k];
    await store.set("authfails", JSON.stringify(fails));
  } else if (f && ((given && isStaff && !(expGiven && !isExp)) || (isSheet && !given && !expGiven))) { delete fails[ip]; await store.set("authfails", JSON.stringify(fails)); }

  // ---------------- DELETE (admin): clear a live/test slot
  if (req.method === "DELETE") {
    if (!staffPass) return notConfigured();
    if (!isAdmin) return denied();
    if (type === "fb") {                // test questionnaire answers and their photos (not the spreadsheet)
      const ids = await fbIds(store);
      for (const id of ids) {
        let e = null; try { e = JSON.parse((await store.get("fb/" + id)) || "null"); } catch {}
        for (const ph of (e && e.photos) || []) await delKey(store, "fbp/" + ph.id);
        await delKey(store, "fb/" + id);
      }
      await store.set("fbidx", "[]"); await store.set("fbsynced", "{}");
      return reply(headers, 200, { ok: true, cleared: type, removed: ids.length });
    }
    if (type === "expenses") {          // every expense and its receipt files (needs the expenses password too)
      if (!isExp) return expDenied();
      let idx = []; try { idx = JSON.parse((await store.get("expidx")) || "[]"); } catch {}
      if (typeof store.list === "function") { try { const l = await store.list({ prefix: "exp/" }); (l.blobs || []).forEach((b) => { const id = b.key.slice(4); if (!idx.includes(id)) idx.push(id); }); } catch {} }
      for (const id of idx) {
        let e = null; try { e = JSON.parse((await store.get("exp/" + id)) || "null"); } catch {}
        for (const r of (e && e.receipts) || []) await delKey(store, "rcpt/" + id + "/" + r.n);
        await delKey(store, "exp/" + id);
      }
      await store.set("expidx", "[]"); await store.set("expseq", "0");
      return reply(headers, 200, { ok: true, cleared: type, removed: idx.length });
    }
    const CLEARABLE = { register: "{}", roomnums: "{}", alerts: "[]", claims: "{}", pushsubs: "{}", sessions: "{}", kicked: "{}", quiz: "{}", tq: "{}" };
    if (!(type in CLEARABLE)) return reply(headers, 400, { ok: false, error: "refused: that slot can't be cleared" });
    await store.set(key, CLEARABLE[type]);
    return reply(headers, 200, { ok: true, cleared: type });
  }

  // ---------------- POST
  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > ((!type || type === "private") ? MAX_PUBLISH_BODY : type === "expense" ? MAX_EXPENSE_BODY : type === "fbphoto" ? FB_MAX_PHOTO : MAX_BODY)) return reply(headers, 413, { ok: false, error: "too large" });
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
    if (type === "quizlock") {
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can do this" });
      const mode = String((parsed && parsed.mode) || "");
      if (!["auto", "open", "closed"].includes(mode)) return reply(headers, 400, { ok: false, error: "bad mode" });
      await store.set("quizlock", JSON.stringify({ mode, at: Date.now() }));
      return reply(headers, 200, await quizState(store));
    }
    if (type === "quizstart") {
      await quizReset(store);
      if (!(await quizState(store)).open) return reply(headers, 423, { ok: false, error: "the quiz is locked" });
      const who = await quizPlayer(store, parsed || {}, given, staffPass);
      if (!who) return reply(headers, 403, { ok: false, error: "sign in as a student or teacher first" });
      const quiz = safeObj(await store.get("quiz"));
      const rec = quiz[who] || { attempts: [] };
      if (rec.attempts.length) return reply(headers, 409, { ok: false, done: true, attempt: rec.attempts[0] });
      rec.starts = (rec.starts || 0) + 1; rec.startedAt = rec.startedAt || Date.now();
      quiz[who] = rec; await store.set("quiz", JSON.stringify(quiz));
      return reply(headers, 200, { ok: true, starts: rec.starts });
    }
    if (type === "quizscore") {
      await quizReset(store);
      if (!(await quizState(store)).open) return reply(headers, 423, { ok: false, error: "the quiz is locked" });
      const sid = await quizPlayer(store, parsed || {}, given, staffPass);
      if (!sid) return reply(headers, 403, { ok: false, error: "sign in as a student or teacher first" });
      const n = (v, max) => { v = Math.round(Number(v)); return Number.isFinite(v) && v >= 0 && v <= max ? v : null; };
      const max = n(parsed.max, 1000), score = n(parsed.score, 1000), total = n(parsed.total, 100), correct = n(parsed.correct, 100), streak = n(parsed.streak, 100);
      if (max === null || score === null || score > max || total === null || correct === null || correct > total) return reply(headers, 400, { ok: false, error: "bad score" });
      const rounds = Array.isArray(parsed.rounds) ? parsed.rounds.slice(0, 10).map((x) => n(x, 1000) || 0) : [];
      const quiz = safeObj(await store.get("quiz"));
      const rec = quiz[sid] || { attempts: [] };
      // One go each: only the first finished score counts
      if (rec.attempts.length) return reply(headers, 409, { ok: false, done: true, error: "already done", attempt: rec.attempts[0] });
      rec.attempts.push({ score, max, correct, total, streak: streak || 0, rounds, at: Date.now() });
      quiz[sid] = rec; await store.set("quiz", JSON.stringify(quiz));
      return reply(headers, 200, { ok: true, attempt: rec.attempts[0] });
    }
    // Expenses (TCA Tours staff): the date and time submitted is stamped here, by the server, not by the phone
    if (type === "expense") {
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can do this" });
      const e = cleanExpense(parsed);
      if (e.error) return reply(headers, 400, { ok: false, error: e.error });
      const files = Array.isArray(parsed.receipts) ? parsed.receipts.slice(0, MAX_RECEIPTS) : [];
      const okFiles = files.filter((f) => f && /^data:(image\/(jpeg|png|webp|heic|heif)|application\/pdf);base64,/.test(String(f.data || "")));
      if (okFiles.length !== files.length) return reply(headers, 400, { ok: false, error: "receipts must be photos or PDFs" });
      let seq = Number(await store.get("expseq")) || 0; seq++; await store.set("expseq", String(seq));
      e.id = "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      e.ref = "EXP-" + String(seq).padStart(3, "0");
      e.submittedAt = Date.now();
      e.receipts = okFiles.map((f, i) => ({ n: i, name: String(f.name || "receipt").replace(/[^\w .()-]/g, "_").slice(0, 80), type: String(f.data).slice(5, String(f.data).indexOf(";")), size: Math.round(String(f.data).length * 0.75) }));
      for (let i = 0; i < okFiles.length; i++) await store.set("rcpt/" + e.id + "/" + i, JSON.stringify({ name: e.receipts[i].name, type: e.receipts[i].type, data: String(okFiles[i].data) }));
      await store.set("exp/" + e.id, JSON.stringify(e));
      let idx = []; try { idx = JSON.parse((await store.get("expidx")) || "[]"); } catch {}
      if (!idx.includes(e.id)) { idx.push(e.id); await store.set("expidx", JSON.stringify(idx)); }
      return reply(headers, 200, { ok: true, expense: e });
    }
    if (type === "expensedel") {
      if (!isExp) return expDenied();
      const id = String((parsed && parsed.id) || "");
      if (!/^x[a-z0-9]{4,20}$/.test(id)) return reply(headers, 400, { ok: false, error: "bad id" });
      const old = await store.get("exp/" + id); let e = null; try { e = JSON.parse(old || "null"); } catch {}
      if (e) { for (const r of e.receipts || []) await delKey(store, "rcpt/" + id + "/" + r.n); await delKey(store, "exp/" + id); }
      let idx = []; try { idx = JSON.parse((await store.get("expidx")) || "[]"); } catch {}
      await store.set("expidx", JSON.stringify(idx.filter((x) => x !== id)));
      return reply(headers, 200, { ok: true, deleted: id });
    }
    // ---- Questionnaires on their own links (teachers and students). Anyone with the link can send one.
    if (type === "fbphoto" || type === "feedback") {
      if (!(await fbRateOk(store, ip))) return reply(headers, 429, { ok: false, error: "Too many sends from this connection. Try again in an hour." });
    }
    if (type === "fbphoto") {
      const data = String((parsed && parsed.data) || "");
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(data)) return reply(headers, 400, { ok: false, error: "photos only" });
      const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const rec = { id, at: Date.now(), kind: parsed.kind === "teacher" ? "teacher" : "student", name: String(parsed.name || "photo.jpg").replace(/[^\w .()-]/g, "_").slice(0, 80),
        mime: data.slice(5, data.indexOf(";")), data, url: "" };
      await store.set("fbp/" + id, JSON.stringify(rec));
      // Straight to the Drive folder when the spreadsheet is connected (otherwise it's sent with the response later)
      const tour = await fbTour(store);
      const h = await hubPost({ action: "photo", id, name: rec.name, mime: rec.mime, data: data.slice(data.indexOf(",") + 1), tour: tour.name });
      if (h && h.ok && h.url) { rec.url = h.url; await store.set("fbp/" + id, JSON.stringify(rec)); }
      return reply(headers, 200, { ok: true, id });
    }
    if (type === "feedback") {
      const kind = parsed && parsed.kind === "teacher" ? "teacher" : parsed && parsed.kind === "student" ? "student" : null;
      const a = parsed && parsed.a;
      if (!kind || !a || typeof a !== "object" || JSON.stringify(a).length > 30000) return reply(headers, 400, { ok: false, error: "bad answers" });
      if (typeof a.r_overall !== "number" || a.r_overall < 1 || a.r_overall > 5) return reply(headers, 400, { ok: false, error: "Please give the trip an overall rating" });
      if (!String(a.name || "").trim()) return reply(headers, 400, { ok: false, error: "Please put your name" });
      const photos = (Array.isArray(parsed.photos) ? parsed.photos : []).slice(0, FB_MAX_PHOTOS)
        .filter((x) => x && /^p[a-z0-9]{4,20}$/.test(String(x.id))).map((x) => ({ id: String(x.id), cap: String(x.cap || "").slice(0, 300) }));
      for (const ph of photos) if (!(await store.get("fbp/" + ph.id))) return reply(headers, 400, { ok: false, error: "a photo didn't upload: remove it and add it again" });
      if (photos.length && !["Yes", "No"].includes(a.photoOk)) return reply(headers, 400, { ok: false, error: "Please say whether we can post your photos" });
      if (photos.length && a.photoOk === "Yes" && a.othersOk !== true) return reply(headers, 400, { ok: false, error: "Please tick the box about other people in your photos, or choose No" });
      if (await fbCount(store) >= FB_MAX_RESPONSES) return reply(headers, 507, { ok: false, error: "too many responses" });
      const tour = await fbTour(store);
      const e = { id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), kind, ts: Date.now(), tour, a, photos,
        source: String(parsed.source || "Link").slice(0, 40), test: !!parsed.test };
      await store.set("fb/" + e.id, JSON.stringify(e));
      let idx = []; try { idx = JSON.parse((await store.get("fbidx")) || "[]"); } catch {}
      idx.push(e.id); await store.set("fbidx", JSON.stringify(idx));
      // Send to the spreadsheet now if it's connected and every photo is already in Drive; otherwise TCA can send it later
      let synced = false;
      try { const r = await fbSyncStep(store, e); synced = !!r.done; } catch {}
      return reply(headers, 200, { ok: true, id: e.id, synced });
    }
    if (type === "fbsync" || type === "fbdel" || type === "fbping") {
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can do this" });
      if (type === "fbping") {
        const h = await hubPost({ action: "ping" });
        if (h && h.ok && h.sheet) await store.set("fbsheet", String(h.sheet));
        return reply(headers, 200, h || { ok: false, error: "no answer" });
      }
      const id = String((parsed && parsed.id) || "");
      const e = await fbGet(store, id);
      if (!e) return reply(headers, 404, { ok: false, error: "not found" });
      if (type === "fbdel") {
        if (id.startsWith("tq-")) { const all = safeObj(await store.get("tq")); delete all[e.tqKey]; await store.set("tq", JSON.stringify(all)); }
        else { for (const ph of e.photos || []) await delKey(store, "fbp/" + ph.id); await delKey(store, "fb/" + id);
          let idx = []; try { idx = JSON.parse((await store.get("fbidx")) || "[]"); } catch {}
          await store.set("fbidx", JSON.stringify(idx.filter((x) => x !== id))); }
        return reply(headers, 200, { ok: true });
      }
      const r = await fbSyncStep(store, e, true);
      return reply(headers, r.ok === false ? 502 : 200, r);
    }
    // Post-tour teacher questionnaire: one entry per teacher; the server stamps the time
    if (type === "tq") {
      const raw2 = JSON.stringify((parsed && parsed.a) || {});
      if (!parsed || typeof parsed.a !== "object" || raw2.length > 20000) return reply(headers, 400, { ok: false, error: "bad answers" });
      if (typeof parsed.a.r_overall !== "number") return reply(headers, 400, { ok: false, error: "Please give the tour an overall rating" });
      let key = null, teacher = "", test = false;
      if (isTca) { key = "test:tca"; teacher = "TCA Tours (test)"; test = true; }
      else {
        const t = await quizPlayer(store, { teacher: String(parsed.teacher || "") }, given, staffPass);
        if (!t) return reply(headers, 403, { ok: false, error: "sign in as a teacher first" });
        key = t; teacher = t.slice(2);
      }
      const all = safeObj(await store.get("tq"));
      all[key] = { key, teacher, test, ts: Date.now(), v: Number(parsed.v) || 1, a: parsed.a };
      await store.set("tq", JSON.stringify(all));
      return reply(headers, 200, { ok: true });
    }
    if (type === "tqdel") {
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can do this" });
      const all = safeObj(await store.get("tq")); delete all[String((parsed && parsed.key) || "")];
      await store.set("tq", JSON.stringify(all));
      return reply(headers, 200, { ok: true });
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
      await quizReset(store);
      const [pub, priv, qz] = await Promise.all(["current", "private", "quiz"].map((x) => store.get(x)));
      let P = null, U = null; try { P = JSON.parse(priv || "null"); } catch {} try { U = JSON.parse(pub || "null"); } catch {}
      const quiz = safeObj(qz), labels = {}; ((U && U.students) || []).forEach((x) => (labels[x.id] = x.label));
      const row = (key, base) => { const r = quiz[key] || {}, a = r.attempts || [];
        return Object.assign(base, { attempts: a.length, first: a[0] || null, starts: r.starts || 0, startedAt: r.startedAt || null }); };
      const rows = ((P && P.students) || []).map((x) => row(x.id, { id: x.id, name: x.name, label: labels[x.id] || x.name, group: x.group }));
      const teachers = teacherNames(U).map((t) => row("t:" + t.name, { id: "t:" + t.name, name: t.name, group: t.group }));
      return reply(headers, 200, { ok: true, at: Date.now(), rows, teachers, state: await quizState(store) });
    }
    if (type === "fb" || type === "fbrows") {
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can see this" });
      const all = await fbAll(store), synced = safeObj(await store.get("fbsynced"));
      if (type === "fbrows") {
        const tabs = {};
        for (const e of all) { const t = await fbRows(store, e); Object.keys(t).forEach((k) => { (tabs[k] = tabs[k] || []).push(...t[k]); }); }
        return reply(headers, 200, { ok: true, tabs });
      }
      let U = null; try { U = JSON.parse((await store.get("current")) || "null"); } catch {}
      return reply(headers, 200, { ok: true, rows: all.map((e) => Object.assign({}, e, { synced: synced[e.id] || null })),
        teachers: teacherNames(U).map((t) => t.name), hub: !!(env("FEEDBACK_HUB_URL") && env("FEEDBACK_HUB_TOKEN")),
        sheet: env("FEEDBACK_SHEET_URL") || (await store.get("fbsheet")) || "" });
    }
    if (type === "tq") {
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can see this" });
      let U = null; try { U = JSON.parse((await store.get("current")) || "null"); } catch {}
      const rows = Object.values(safeObj(await store.get("tq"))).sort((a, b) => a.ts - b.ts);
      return reply(headers, 200, { ok: true, rows, teachers: teacherNames(U).map((t) => t.name) });
    }
    if (type === "fxrate") {
      if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can see this" });
      return reply(headers, 200, await fxRate(store, String(url.searchParams.get("cur") || "").toUpperCase()));
    }
    if (type === "expenses" || type === "receipt") {
      if (!isExp) return expDenied();
      if (type === "receipt") {
        const id = url.searchParams.get("id") || "", n = url.searchParams.get("n") || "0";
        if (!/^x[a-z0-9]{4,20}$/.test(id) || !/^\d$/.test(n)) return reply(headers, 400, { ok: false, error: "bad id" });
        const r = await store.get("rcpt/" + id + "/" + n);
        return r ? new Response(r, { headers }) : reply(headers, 404, { ok: false, error: "not found" });
      }
      let idx = []; try { idx = JSON.parse((await store.get("expidx")) || "[]"); } catch {}
      // Also pick up any expense the index missed (two staff submitting at the same moment)
      if (typeof store.list === "function") {
        try { const l = await store.list({ prefix: "exp/" }); (l.blobs || []).forEach((b) => { const id = b.key.slice(4); if (!idx.includes(id)) idx.push(id); }); } catch {}
      }
      const rows = (await Promise.all(idx.map((id) => store.get("exp/" + id)))).map((x) => { try { return JSON.parse(x || "null"); } catch { return null; } }).filter(Boolean)
        .sort((a, b) => a.submittedAt - b.submittedAt);
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
  if (type === "quizstate") return reply(headers, 200, await quizState(store));
  // ---- Results page (/sheet): the master feedback spreadsheet behind its own password
  if (type === "sheetdata" || type === "sheetphoto") {
    if (!sheetPass) return reply(headers, 503, { ok: false, error: "The results page password isn't set (FEEDBACK_VIEW_PASSWORD)." });
    if (!isSheet) return reply(headers, 401, { ok: false, error: "That password isn't right." });
    if (type === "sheetphoto") {
      const id = url.searchParams.get("id") || "";
      if (!/^p[a-z0-9]{4,20}$/.test(id)) return reply(headers, 400, { ok: false, error: "bad id" });
      const local = await store.get("fbp/" + id);
      if (local) { try { const r = JSON.parse(local); return reply(headers, 200, { ok: true, data: r.data }); } catch {} }
      const h = await hubPost({ action: "photoget", id });
      return h && h.ok ? reply(headers, 200, { ok: true, data: "data:" + (h.mime || "image/jpeg") + ";base64," + h.data }) : reply(headers, 404, { ok: false, error: (h && h.error) || "not found" });
    }
    const h = await hubPost({ action: "read" });
    if (h && h.ok && h.tabs) return reply(headers, 200, { ok: true, source: "sheet", tabs: h.tabs, sheet: h.sheet || env("FEEDBACK_SHEET_URL") || "" });
    // Not connected yet: this tour's own answers, laid out the same way
    const tabs = {};
    for (const e of await fbAll(store)) { const t = await fbRows(store, e); Object.keys(t).forEach((k) => { (tabs[k] = tabs[k] || []).push(...t[k]); }); }
    return reply(headers, 200, { ok: true, source: "app", note: (h && h.error) || "", tabs, sheet: env("FEEDBACK_SHEET_URL") || "" });
  }
  if (type === "fbphoto") {   // a questionnaire photo: TCA/admin only
    if (!isTca) return reply(headers, 403, { ok: false, error: "only TCA Tours staff can see this" });
    const id = url.searchParams.get("id") || "";
    if (!/^p[a-z0-9]{4,20}$/.test(id)) return reply(headers, 400, { ok: false, error: "bad id" });
    const r = await store.get("fbp/" + id);
    return r ? new Response(r, { headers }) : reply(headers, 404, { ok: false, error: "not found" });
  }
  if (type === "quizme") {
    const who = await quizPlayer(store, { sid: url.searchParams.get("sid") || "", token: req.headers.get("x-device") || "", teacher: url.searchParams.get("teacher") || "" }, given, staffPass);
    if (!who) return reply(headers, 403, { ok: false, error: "sign in as a student or teacher first" });
    const r = safeObj(await store.get("quiz"))[who] || {};
    return reply(headers, 200, { ok: true, done: !!(r.attempts && r.attempts.length), attempt: (r.attempts && r.attempts[0]) || null, starts: r.starts || 0 });
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

// ---------------- NYC Quiz players: a student (device token) or a teacher (teacher password + their name)
function teacherNames(U) { return ((U && U.staff) || []).filter((x) => /teacher/i.test(x.role || "") && x.name); }
async function quizPlayer(store, p, given, staffPass) {
  const sid = String(p.sid || "");
  if (sid) return (await deviceOk(store, sid, p.token)) ? sid : null;
  const name = String(p.teacher || "");
  if (!name || !staffPass || !same(given, staffPass)) return null;   // the teacher password only (not TCA/admin)
  let U = null; try { U = JSON.parse((await store.get("current")) || "null"); } catch {}
  return teacherNames(U).some((t) => t.name === name) ? "t:" + name : null;
}

// ---------------- questionnaires -> the master Google Sheet ("feedback hub")
const FB_MAX_PHOTOS = 6, FB_MAX_PHOTO = 3 * 1024 * 1024, FB_MAX_RESPONSES = 3000, FB_RATE = 400;
async function fbRateOk(store, ip) {
  let r = {}; try { r = JSON.parse((await store.get("fbrate")) || "{}"); } catch {}
  const now = Date.now(); for (const k of Object.keys(r)) if (now - r[k].first > 3600000) delete r[k];
  const cur = r[ip] || { n: 0, first: now }; cur.n++; r[ip] = cur; await store.set("fbrate", JSON.stringify(r));
  return cur.n <= FB_RATE;
}
async function fbTour(store) {
  let U = null; try { U = JSON.parse((await store.get("current")) || "null"); } catch {}
  const t = (U && U.tour) || {};
  return { name: t["Tour Name"] || "Holmfirth High · New York 2026", school: t["School"] || "Holmfirth High School",
    destination: t["Destination"] || "New York City, USA", dates: t["Dates"] || "Sun 25 – Fri 30 October 2026" };
}
async function fbIds(store) {
  let idx = []; try { idx = JSON.parse((await store.get("fbidx")) || "[]"); } catch {}
  if (typeof store.list === "function") { try { const l = await store.list({ prefix: "fb/" }); (l.blobs || []).forEach((b) => { const id = b.key.slice(3); if (!idx.includes(id)) idx.push(id); }); } catch {} }
  return idx;
}
async function fbCount(store) { return (await fbIds(store)).length; }
/* Teacher answers sent from inside the app before the separate links existed (v22/v23) look like link answers */
function fbFromTq(t, tour) {
  return { id: "tq-" + String(t.key).replace(/[^A-Za-z0-9]/g, ""), tqKey: t.key, kind: "teacher", ts: t.ts, tour,
    a: Object.assign({ name: t.teacher }, t.a || {}), photos: [], source: "App", test: !!t.test };
}
async function fbAll(store) {
  const ids = await fbIds(store), tour = await fbTour(store);
  const out = (await Promise.all(ids.map((id) => store.get("fb/" + id)))).map((x) => { try { return JSON.parse(x || "null"); } catch { return null; } }).filter(Boolean);
  Object.values(safeObj(await store.get("tq"))).forEach((t) => out.push(fbFromTq(t, tour)));
  return out.sort((a, b) => a.ts - b.ts);
}
async function fbGet(store, id) {
  if (id.startsWith("tq-")) { const tour = await fbTour(store); const t = Object.values(safeObj(await store.get("tq"))).find((x) => "tq-" + String(x.key).replace(/[^A-Za-z0-9]/g, "") === id); return t ? fbFromTq(t, tour) : null; }
  if (!/^f[a-z0-9]{4,20}$/.test(id)) return null;
  try { return JSON.parse((await store.get("fb/" + id)) || "null"); } catch { return null; }
}
async function hubPost(body) {
  const url = env("FEEDBACK_HUB_URL"), tok = env("FEEDBACK_HUB_TOKEN");
  if (!url || !tok) return { ok: false, notConfigured: true, error: "The master spreadsheet isn't connected yet (FEEDBACK_HUB_URL / FEEDBACK_HUB_TOKEN)." };
  try {
    const r = await (globalThis.__HUB_FETCH__ || fetch)(url, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ token: tok }, body)), redirect: "follow", signal: AbortSignal.timeout(9000) });
    return await r.json();
  } catch (err) { return { ok: false, error: "The spreadsheet didn't answer: " + String((err && err.message) || err).slice(0, 120) }; }
}
function fbCredit(e) {
  const a = e.a || {}, q = String(a.quoteOk || ""), school = a.school || e.tour.school, dest = String(e.tour.destination || "").split(",")[0];
  if (!/^Yes/.test(q)) return "";
  if (e.kind === "student") return /first name/.test(q) ? String(a.name || "").trim().split(/\s+/)[0] + ", " + school : "A student on the " + dest + " trip";
  if (/name and school/.test(q)) return [a.name, school].filter(Boolean).join(", ");
  if (/school name only/.test(q)) return "A teacher at " + school;
  return "A teacher on the " + dest + " trip";
}
const RATE = (v) => (v === "na" ? "n/a" : v == null ? "" : v);
const LIST = (v) => (Array.isArray(v) ? v.join(", ") : v || "");
/* One response laid out as the spreadsheet's tabs. Column names are the sheet's headers. */
async function fbRows(store, e) {
  const a = e.a || {}, t = e.tour, when = new Date(e.ts).toLocaleString("en-GB", { timeZone: "Europe/London" });
  const base = { "Response ID": e.id, "Received": when, "Tour": t.name };
  const who = e.kind === "teacher" ? "Teacher" : "Student";
  const photos = [];
  for (const ph of e.photos || []) { let rec = null; try { rec = JSON.parse((await store.get("fbp/" + ph.id)) || "null"); } catch {}
    photos.push(Object.assign({}, base, { "Who": who, "Name": a.name || "", "Caption": ph.cap || "", "OK to post?": a.photoOk || "",
      "Others in photo have consent?": a.photoOk === "Yes" ? (a.othersOk ? "Yes: confirmed by sender" : "") : "", "Photo": (rec && rec.url) || "In the tour app only", "Photo ID": ph.id })); }
  const head = Object.assign({}, base, { "Destination": t.destination, "Tour dates": t.dates, "School / Organisation": a.school || t.school, "Name": a.name || "", "Source": e.source || "", "Test?": e.test ? "Yes" : "" });
  const rows = {};
  if (e.kind === "teacher") {
    rows["Teachers"] = [Object.assign(head, {
      "Overall, how satisfied were you with your TCA tour experience? (1 = Very Dissatisfied - 5 = Extremely satisfied)": RATE(a.r_overall),
      "How satisfied are you that the tour achieved its objectives? (1–5)": RATE(a.r_objectives),
      "How satisfied were you with our communication, organisation and on-tour support? (1–5)": RATE(a.r_support),
      "What stood out about this tour for you and your players / students?": a.stoodOut || "",
      "What was the biggest impact of this trip on your players / students?": a.impact || "",
      "Would you recommend TCA Sports Tours to another school or club?": a.recommend || "",
      "If yes, what would you say to another school / club considering this tour?": a.say || "",
      "Summary of the trip & working with TCA Tours": a.summary || "",
      "Are you happy for us to use your comments in our promotional material (website, social media, brochure, etc).?": a.quoteOk || "",
      "Credit line": fbCredit(e),
      "Do you have any additional comments or suggestions about the tour or your experience?": a.improve || "",
      "Itinerary & pace (1–5)": RATE(a.r_itin), "Accommodation (1–5)": RATE(a.r_hostel), "Flights (1–5)": RATE(a.r_flights), "Coach transfers (1–5)": RATE(a.r_coach),
      "Value for money (1–5)": RATE(a.r_value), "Tour app (1–5)": RATE(a.r_app), "Recommended spending money": a.spend || "",
      "Book another trip?": a.again || "", "Where next": LIST(a.dests), "Other places": a.destsOther || "", "When": a.when || "",
      "Photos sent": (e.photos || []).length || "", "Photos OK to post?": (e.photos || []).length ? a.photoOk || "" : "" })];
  } else {
    rows["Students"] = [Object.assign(head, {
      "Overall rating (1–5)": RATE(a.r_overall), "Best bit of the trip": a.best || "", "What would you change?": a.change || "",
      "Would you recommend this trip to a friend?": a.recommend || "", "How would you describe the trip to a friend?": a.summary || "",
      "Permission to use comment": a.quoteOk || "", "Credit line": fbCredit(e),
      "Photos sent": (e.photos || []).length || "", "Photos OK to post?": (e.photos || []).length ? a.photoOk || "" : "",
      "Others in photos have consent?": a.photoOk === "Yes" ? (a.othersOk ? "Yes: confirmed by sender" : "") : "" })];
  }
  rows["Trip ratings"] = Object.keys(a.trips || {}).map((trip) => Object.assign({}, base, { "Who": who, "Name": a.name || "", "Trip": trip, "Rating (1–5)": a.trips[trip] === "na" ? "Didn't go" : a.trips[trip] }));
  const quote = e.kind === "teacher" ? a.summary || a.say || a.stoodOut : a.summary || a.best;
  if (quote && fbCredit(e) && !e.test) rows["Website reviews"] = [Object.assign({}, base, { "Who": who, "Review": quote, "Credit line": fbCredit(e), "Permission": a.quoteOk })];
  if (photos.length) rows["Photos"] = photos;
  return rows;
}
/* One step towards the spreadsheet: a photo still to go to Drive, else the rows. Called again until done. */
async function fbSyncStep(store, e, manual) {
  const synced = safeObj(await store.get("fbsynced"));
  if (synced[e.id] && !manual) return { ok: true, done: true };
  for (const ph of e.photos || []) {
    let rec = null; try { rec = JSON.parse((await store.get("fbp/" + ph.id)) || "null"); } catch {}
    if (rec && !rec.url) {
      if (!manual) return { ok: true, done: false };       // leave photos for a TCA "Send" (keeps the student's wait short)
      const h = await hubPost({ action: "photo", id: rec.id, name: rec.name, mime: rec.mime, data: rec.data.slice(rec.data.indexOf(",") + 1), tour: e.tour.name, caption: ph.cap });
      if (!(h && h.ok && h.url)) return { ok: false, error: (h && h.error) || "photo not saved" };
      rec.url = h.url; await store.set("fbp/" + rec.id, JSON.stringify(rec));
      return { ok: true, done: false, step: "photo" };
    }
  }
  const h = await hubPost({ action: "rows", id: e.id, rows: await fbRows(store, e) });
  if (!(h && h.ok)) return { ok: false, error: (h && h.error) || "not saved" };
  synced[e.id] = Date.now(); await store.set("fbsynced", JSON.stringify(synced));
  if (h.sheet) await store.set("fbsheet", String(h.sheet));
  return { ok: true, done: true, sheet: h.sheet || "" };
}

// ---------------- expenses
function cleanExpense(p) {
  if (!p || typeof p !== "object") return { error: "missing details" };
  const name = String(p.name || "").trim().slice(0, 60);
  const desc = String(p.desc || "").trim().slice(0, 300);
  const currency = String(p.currency || "").toUpperCase();
  const amount = Math.round(Number(p.amount) * 100) / 100;
  const rate = Number(p.rate);
  if (!name) return { error: "Put the staff member's name" };
  if (!desc) return { error: "Say what the expense was for" };
  if (!CUR_RE.test(currency)) return { error: "Choose a currency" };
  if (!(amount > 0 && amount < 1e10)) return { error: "Enter the amount" };
  if (!(rate > 0 && rate < 100)) return { error: "Enter the conversion rate to pounds" };
  const out = {
    name, desc, currency, country: String(p.country || "").slice(0, 60), amount, rate: Number(rate.toPrecision(8)),
    gbp: Math.round(amount * Number(rate.toPrecision(8)) * 100) / 100,
    category: String(p.category || "Other").slice(0, 40),
    paidBy: String(p.paidBy || "").slice(0, 40),
    spentOn: /^\d{4}-\d{2}-\d{2}$/.test(String(p.spentOn || "")) ? String(p.spentOn) : "",
    notes: String(p.notes || "").trim().slice(0, 500),
    rateSource: String(p.rateSource || "").slice(0, 120),
    rateAsOf: Number(p.rateAsOf) || null,
    rateFetchedAt: Number(p.rateFetchedAt) || null,
    rateEdited: !!p.rateEdited,
  };
  if (currency === "GBP") { out.rate = 1; out.gbp = amount; out.rateSource = "Paid in pounds"; out.rateEdited = false; }
  return out;
}
async function delKey(store, k) { if (typeof store.delete === "function") await store.delete(k); else await store.set(k, ""); }
// Live rate, 1 <cur> = x GBP. Cached 10 minutes so every staff phone sees the same rate.
async function fxRate(store, cur) {
  if (!CUR_RE.test(cur)) return { ok: false, error: "unknown currency" };
  if (cur === "GBP") return { ok: true, cur, rate: 1, source: "Paid in pounds", asOf: Date.now(), fetchedAt: Date.now() };
  let cache = {}; try { cache = JSON.parse((await store.get("fxcache")) || "{}"); } catch {}
  if (cache[cur] && Date.now() - cache[cur].fetchedAt < FX_CACHE_MS) return Object.assign({ ok: true, cached: true }, cache[cur]);
  const get = globalThis.__FX_FETCH__ || fetch;
  let out = null;
  try {
    const r = await get("https://open.er-api.com/v6/latest/" + cur, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (j && j.result === "success" && j.rates && j.rates.GBP && j.base_code === cur) out = { cur, rate: j.rates.GBP, source: "ExchangeRate-API (open.er-api.com) mid-market rate", asOf: (j.time_last_update_unix || 0) * 1000 || Date.now() };
  } catch {}
  if (!out) try {
    const r = await get("https://api.frankfurter.app/latest?from=" + cur + "&to=GBP", { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (j && j.rates && j.rates.GBP) out = { cur, rate: j.rates.GBP, source: "European Central Bank reference rate (Frankfurter)", asOf: Date.parse(j.date + "T16:00:00Z") || Date.now() };
  } catch {}
  if (!out) return cache[cur] ? Object.assign({ ok: true, stale: true }, cache[cur]) : { ok: false, error: "No live rate available. Type the rate from your bank or card app." };
  out.fetchedAt = Date.now(); cache[cur] = out; await store.set("fxcache", JSON.stringify(cache));
  return Object.assign({ ok: true }, out);
}

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
