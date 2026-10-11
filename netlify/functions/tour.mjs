import { getStore } from "@netlify/blobs";

// TCA Tours — Holmfirth NYC tour app backend (v1)
//
// One endpoint, separate slots, each stored under its own key:
//
//   PUBLIC (anyone with the link can read)
//   GET  /tour                     -> published itinerary (public half of the App Database)
//   GET  /tour?type=alerts         -> alerts list
//
//   STAFF ONLY (header  x-staff-key: <STAFF_PASSWORD>)
//   GET  /tour?type=auth           -> 200 if the password is right (used by the staff sign-in)
//   GET  /tour?type=private        -> students, medical, dietary, contacts, transfers, meal orders
//                                     + live room numbers + register, merged in
//   POST /tour?type=alerts         -> replace alerts list
//   POST /tour?type=roomnums       -> merge room numbers   { "<studentId>": "1203", ... }
//   POST /tour?type=register       -> merge register marks { "<rollId>|<studentId>": {...}, ... }
//
//   ADMIN (header  x-staff-key: <ADMIN_PASSWORD, or STAFF_PASSWORD if no admin one is set>)
//   POST /tour                     -> publish public itinerary
//   POST /tour?type=private        -> publish staff-only data
//   DELETE /tour?type=register|roomnums|alerts -> clear test data
//
// Passwords live in Netlify environment variables, never in the repo:
//   STAFF_PASSWORD (required for anything staff-only), ADMIN_PASSWORD (optional).

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
  const isStaff = same(given, staffPass) || same(given, adminPass);
  const isAdmin = same(given, adminPass);
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
    if (!staffPass) return notConfigured();
    let parsed;
    try { parsed = JSON.parse(await req.text()); } catch { return reply(headers, 400, { ok: false, error: "invalid JSON" }); }

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
      await store.set(key, JSON.stringify(parsed.slice(0, 30)));
      return reply(headers, 200, { ok: true });
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
    if (type === "auth") return reply(headers, 200, { ok: true, admin: isAdmin });
    if (type === "private") {
      const [priv, rooms, reg] = await Promise.all([store.get("private"), store.get("roomnums"), store.get("register")]);
      const out = priv ? JSON.parse(priv) : null;
      return reply(headers, 200, { ok: true, data: out, roomnums: safeObj(rooms), register: safeObj(reg) });
    }
    return new Response((await store.get(key)) || "{}", { headers });
  }
  if (type && type !== "alerts") return reply(headers, 400, { ok: false, error: "unknown slot" });
  const data = await store.get(key);
  if (data != null) return new Response(data, { headers });
  return new Response(type === "alerts" ? "[]" : "null", { headers });
};

function safeObj(s) { try { const o = JSON.parse(s || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; } }
function reply(headers, status, obj) { return new Response(JSON.stringify(obj), { status, headers }); }
