// @ts-nocheck  (plain JavaScript in a .ts file; Deno runs it as is)
// Cut Log server: one Supabase Edge Function named "cut". Uses only Web Crypto and fetch.
//
//   POST ?action=health&k=KEY   the iPhone Shortcut sends today's Apple Watch numbers here
//   POST ?action=run            hourly (GitHub Action): send each phone its daily reminder if due
//   POST ?action=init           the public push key (the key pair is created on first use and kept
//                               in a private table, so nothing ever has to be copied or pasted)
//   POST ?action=test           body {endpoint}: send a test push to that one phone

const APP_PATH = './#log';
const CONTACT = 'mailto:mamourmedia01@gmail.com';
const PLAN_DEFAULT = { start: '2026-10-14', proteinAnchor: '2026-10-25', proteinEvery: 3, proteinKcal: 600 };

// ---------- base64url ----------
export const b64u = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const ub64u = (s) => { const p = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4); const r = atob(p); const o = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; };
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const te = new TextEncoder();

// ---------- VAPID keys ----------
export async function generateVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { public_key: b64u(pub), private_jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d } };
}

async function vapidHeader(endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT })));
  const key = await crypto.subtle.importKey('jwk', Object.assign({ ext: true }, keys.private_jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body)));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + keys.public_key;
}

// ---------- RFC 8291 payload encryption (aes128gcm) ----------
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
export async function encryptPayload(sub, text) {
  const uaPub = ub64u(sub.keys.p256dh), auth = ub64u(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(te.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export async function pushRequest(sub, msg, keys, ttl = 3 * 3600) {
  return {
    url: sub.endpoint,
    init: {
      method: 'POST',
      headers: { Authorization: await vapidHeader(sub.endpoint, keys), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal' },
      body: await encryptPayload(sub, JSON.stringify(msg))
    }
  };
}

// ---------- reminder rules (mirror app.js) ----------
const toN = id => Date.UTC(+id.slice(0, 4), +id.slice(5, 7) - 1, +id.slice(8, 10)) / 86400000;
const toId = n => new Date(n * 86400000).toISOString().slice(0, 10);
export function localNow(tz, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(at).map(p => [p.type, p.value]));
  return { id: parts.year + '-' + parts.month + '-' + parts.day, hour: +parts.hour, sunday: parts.weekday === 'Sun' };
}
// Due every N days from the anchor; taking it on another day moves the rhythm; skipping a due day keeps it.
export function proteinDue(plan, days, todayId) {
  const a = toN(plan.proteinAnchor), t = toN(todayId);
  let last = null;
  for (let n = a; n <= t; n++) {
    const o = (days[toId(n)] || {}).protein;
    const due = last === null ? n === a : n - last >= plan.proteinEvery;
    if (n === t) return o == null ? due : false;
    if (o === true || due) last = n;
  }
  return false;
}
export function streak(plan, days, todayId) {
  let run = 0;
  for (let n = toN(todayId) - 1; n >= toN(plan.start); n--) { if ((days[toId(n)] || {}).mark === 'done') run++; else break; }
  return run;
}
export function compose(planIn, days, prefs, now) {
  const plan = Object.assign({}, PLAN_DEFAULT, planIn || {}), p = prefs || {}, today = days[now.id] || {};
  const lines = []; let title = 'Cut Log';
  const prot = p.protein !== false && proteinDue(plan, days, now.id);
  const needLog = p.log !== false && !today.mark;
  const waist = p.waist !== false && now.sunday && today.waist == null;
  if (prot) { title = 'Protein day'; lines.push('Shake today, about ' + Math.round(plan.proteinKcal) + ' kcal.'); }
  if (needLog) {
    const run = streak(plan, days, now.id), toBoss = 10 - (run % 10);
    if (!prot) title = run ? run + '-day streak' : 'Log today';
    lines.push(run ? 'Tap today in to make it ' + (run + 1) + '. ' + (toBoss === 1 ? 'Boss falls today.' : toBoss + ' to the boss.') : 'Tap today in and start the run.');
  }
  if (waist) { if (!prot && !needLog) title = 'Sunday check'; lines.push('Measure your waist for +50 XP.'); }
  return lines.length ? { title, body: lines.join(' '), url: APP_PATH } : null;
}

// ---------- database (service role, injected by Supabase) ----------
function dbClient(url, key) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.split('.').length === 3) headers.Authorization = 'Bearer ' + key; // legacy JWT keys
  return async (path, init = {}) => {
    const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + path, Object.assign({}, init, { headers: Object.assign({}, headers, init.headers || {}) }));
    if (!r.ok) throw new Error(path.split('?')[0] + ' ' + r.status + ' ' + await r.text());
    const t = await r.text(); return t ? JSON.parse(t) : null;
  };
}
async function getKeys(db) {
  let rows = await db('push_keys?select=public_key,private_jwk&id=eq.1');
  if (rows.length) return rows[0];
  const k = await generateVapid();
  await db('push_keys?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(Object.assign({ id: 1 }, k)) });
  rows = await db('push_keys?select=public_key,private_jwk&id=eq.1'); // re-read in case two calls raced
  return rows[0];
}
const eq = v => 'eq.' + encodeURIComponent(v);
async function send(db, keys, sub, msg) {
  const { url, init } = await pushRequest(sub.sub, msg, keys);
  const r = await fetch(url, init);
  if (r.status === 404 || r.status === 410) { await db('push_subs?endpoint=' + eq(sub.endpoint), { method: 'DELETE' }); return 'expired'; }
  if (!r.ok) return 'failed ' + r.status + ' ' + (await r.text()).slice(0, 200);
  return 'sent';
}

async function run(db, keys) {
  const subs = await db('push_subs?select=endpoint,user_id,sub,prefs,tz,last_sent');
  if (!subs.length) return { phones: 0, sent: 0 };
  const since = toId(Math.floor(Date.now() / 86400000) - 120);
  const [settings, dayRows] = await Promise.all([db('settings?select=user_id,data'), db('days?select=user_id,day,data&day=gte.' + since)]);
  const plans = {}, days = {};
  settings.forEach(s => { plans[s.user_id] = s.data; });
  dayRows.forEach(d => { (days[d.user_id] = days[d.user_id] || {})[d.day] = d.data || {}; });
  const out = [];
  for (const s of subs) {
    const now = localNow(s.tz || 'Europe/London'), hour = s.prefs && s.prefs.hour != null ? +s.prefs.hour : 20;
    if (s.last_sent === now.id || now.hour < hour || now.hour > hour + 3) continue; // once a day, in a 4-hour window (GitHub cron can run late)
    const msg = compose(plans[s.user_id], days[s.user_id] || {}, s.prefs, now);
    const res = msg ? await send(db, keys, s, msg) : 'nothing due';
    if (res !== 'expired' && !res.startsWith('failed')) await db('push_subs?endpoint=' + eq(s.endpoint), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_sent: now.id }) });
    out.push(res);
  }
  return { phones: subs.length, results: out };
}

// ---------- Apple Watch (iPhone Shortcut) ----------
// The Shortcut posts today's Apple Health numbers to ...?action=health&k=<personal key>.
// No headers or dates needed: the day is today in the phone's zone (Europe/London unless &tz= is given).
const HEALTH_KEYS = ['workouts', 'active_kcal', 'resting_kcal', 'weight_kg', 'steps', 'sleep_h'];
async function health(db, req, q) {
  const text = (s, status = 200) => new Response(s, { status, headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS) });
  const k = q.get('k') || '';
  if (!k) return text('Missing key. Copy the link again from Cut Log → Settings → Apple Watch.', 400);
  let body = {};
  const raw = req.method === 'POST' ? await req.text() : '';
  if (raw) { try { body = JSON.parse(raw); } catch (e) { body = Object.fromEntries(new URLSearchParams(raw)); } }
  for (const key of HEALTH_KEYS) if (body[key] == null && q.get(key) != null) body[key] = q.get(key);
  const payload = {};
  for (const key of HEALTH_KEYS) { const v = body[key]; if (v !== undefined && v !== null && v !== '') payload[key] = typeof v === 'number' ? v : String(v); }
  let tz = q.get('tz') || 'Europe/London'; try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch (e) { tz = 'Europe/London'; }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(body.day || '') ? body.day : localNow(tz).id;
  try {
    await db('rpc/health_sync', { method: 'POST', body: JSON.stringify({ p_token: k, p_day: day, p_payload: payload }) });
  } catch (e) {
    if (/unknown token/.test(e.message)) return text('That key isn’t valid any more. Make a new link in Cut Log → Settings → Apple Watch.', 401);
    throw e;
  }
  const bits = [];
  if (payload.workouts != null) bits.push(payload.workouts + ' workout' + (+payload.workouts === 1 ? '' : 's'));
  if (payload.active_kcal != null) bits.push(Math.round(parseFloat(String(payload.active_kcal).replace(/,/g, ''))) + ' active kcal');
  if (payload.steps != null) bits.push(payload.steps + ' steps');
  return text('Cut Log synced ' + day + (bits.length ? ': ' + bits.join(', ') : ''));
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });

export async function handle(req, env) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const db = dbClient(env.url, env.key);
    const q = new URL(req.url).searchParams, action = q.get('action') || 'run';
    if (action === 'health') return await health(db, req, q);
    const keys = await getKeys(db);
    if (action === 'init') return json({ publicKey: keys.public_key });
    if (action === 'test') {
      const { endpoint } = await req.json().catch(() => ({}));
      const rows = endpoint ? await db('push_subs?select=endpoint,sub&endpoint=' + eq(endpoint)) : [];
      if (!rows.length) return json({ error: 'This phone isn’t subscribed yet.' }, 404);
      return json({ result: await send(db, keys, rows[0], { title: 'Cut Log', body: 'Test reminder. Push is working on this phone.', url: APP_PATH }) });
    }
    return json(await run(db, keys));
  } catch (e) {
    console.error(e);
    return json({ error: String(e && e.message || e) }, 500);
  }
}

if (globalThis.Deno && Deno.serve) {
  Deno.serve(req => handle(req, {
    url: Deno.env.get('SUPABASE_URL'),
    key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY')
  }));
}
