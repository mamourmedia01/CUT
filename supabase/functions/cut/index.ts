// @ts-nocheck  (plain JavaScript in a .ts file; Deno runs it as is)
// Cut Log server: one Supabase Edge Function named "cut". Uses only Web Crypto and fetch.
//
//   POST ?action=health&k=KEY   the iPhone Shortcut sends today's Apple Watch numbers here
//   POST ?action=push&k=KEY     the Cut Log Sync iPhone app sends whole days (live + history)
//   POST ?action=run            hourly (GitHub Action): send each phone its daily reminder if due
//   POST ?action=init           the public push key (the key pair is created on first use and kept
//                               in a private table, so nothing ever has to be copied or pasted)
//   POST ?action=test           body {endpoint}: send a test push to that one phone
//   POST ?action=login          body {username, password}: sign in with a username (returns a session)
//   GET  ?action=ping&k=KEY     the phone was used just now (Shortcut automation): for sleep without the Watch
//   GET  ?action=widget&k=KEY   today's numbers for the lock-screen widget (Scriptable)

const APP_PATH = './#log';
const CONTACT = 'mailto:mamourmedia01@gmail.com';
const PLAN_DEFAULT = { start: '2026-10-14', proteinAnchor: '2026-10-25', proteinEvery: 3, proteinKcal: 600, shake: '5 scoops in 500 ml water', baseBurn: 2400, sessionKcal: 1000, kcalPerKg: 7700, autoHour: 12 };

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
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const niceId = id => WD[new Date(toN(id) * 864e5).getUTCDay()] + ' ' + (+id.slice(8, 10)) + ' ' + MON[+id.slice(5, 7) - 1];
const kf = n => Math.round(n).toLocaleString('en-GB');
export function localNow(tz, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(at).map(p => [p.type, p.value]));
  return { id: parts.year + '-' + parts.month + '-' + parts.day, hour: +parts.hour, sunday: parts.weekday === 'Sun' };
}
// Same schedule as the app: due every N days from the anchor; taking it on another day moves the rhythm,
// skipping a due day keeps it. Returns { id: true } for every protein day up to `untilId`.
export function proteinDays(plan, days, untilId) {
  const a = toN(plan.proteinAnchor), s = toN(plan.start), end = toN(untilId), out = {};
  let last = null;
  for (let n = Math.min(a, s); n <= end; n++) {
    const id = toId(n), o = (days[id] || {}).protein;
    if (n < a) { if (o === true) out[id] = true; continue; }
    const due = last === null ? n === a : n - last >= plan.proteinEvery;
    if (o === true) { out[id] = true; last = n; }
    else if (o === false) { if (due) last = n; }
    else if (due) { out[id] = true; last = n; }
  }
  return out;
}
// kept for older callers/tests: is today a protein day that hasn't been answered yet?
export function proteinDue(plan, days, todayId) { return !!proteinDays(plan, days, todayId)[todayId] && (days[todayId] || {}).protein == null; }
export function streak(plan, days, todayId) {
  let run = 0;
  for (let n = toN(todayId) - 1; n >= toN(plan.start); n--) { if ((days[toId(n)] || {}).mark === 'done') run++; else break; }
  return run;
}
const H = (r, k) => r && r.health && typeof r.health[k] === 'number' ? r.health[k] : null;
function sessOf(r) {
  const u = (r.am ? 1 : 0) + (r.pm ? 1 : 0); if (u) return u;
  const w = H(r, 'workouts'); if (w != null) return Math.min(2, Math.round(w));
  const ex = H(r, 'exercise_min'); return ex == null ? 0 : ex >= 90 ? 2 : ex >= 20 ? 1 : 0;
}
// the app's energy model: kg the day takes off the next morning's weight (null = blank day)
export function dayKg(plan, r, protein) {
  const sess = sessOf(r);
  if (!r.mark && !sess && r.food == null && r.gymKcal == null) return null;
  const gym = r.gymKcal != null ? r.gymKcal : (H(r, 'active_kcal') != null ? H(r, 'active_kcal') : sess * plan.sessionKcal);
  const rest = H(r, 'resting_kcal') != null ? H(r, 'resting_kcal') : plan.baseBurn;
  const meals = Array.isArray(r.meals) && r.meals.length ? r.meals.reduce((a, m) => a + (+m.k || 0), 0) : null;
  const food = r.food != null ? r.food : meals != null ? meals + (protein ? plan.proteinKcal : 0) : (r.mark === 'cheat' ? rest : (protein ? plan.proteinKcal : 0));
  return (rest + gym - food) / plan.kcalPerKg;
}
const merge = (days, health) => { const o = {}; new Set([...Object.keys(days), ...Object.keys(health)]).forEach(id => { o[id] = Object.assign({}, days[id] || {}, health[id] ? { health: health[id] } : {}); }); return o; };

// The app's weight estimate: from the start weight, each day's deficit comes off the next morning;
// a weigh-in (typed or from the scale) resets it.
export function estimate(planIn, all, todayId) {
  const plan = Object.assign({}, PLAN_DEFAULT, planIn || {});
  const prot = proteinDays(plan, all, todayId);
  let est = +plan.startWeight || 0, morning = est, weighed = null;
  for (let n = toN(plan.start); n <= toN(todayId); n++) {
    const id = toId(n), r = all[id] || {};
    const w = r.weight != null ? +r.weight : H(r, 'weight_kg');
    if (w != null) { est = w; weighed = id; }
    morning = est;
    const kg = dayKg(plan, r, !!prot[id]); if (kg != null) est -= kg;
  }
  const days = Math.max(1, toN(todayId) - toN(plan.start));
  return { morning, tomorrow: est, weighed, pace: (plan.startWeight - morning) / days };
}
// end of the cut-week (weeks run from the start date) that is still ahead, and the weight there at the current pace
export function weekTarget(planIn, all, todayId) {
  const plan = Object.assign({}, PLAN_DEFAULT, planIn || {}), e = estimate(plan, all, todayId);
  const k = toN(todayId) - toN(plan.start); let end = toN(plan.start) + Math.floor(k / 7) * 7 + 6;
  if (end <= toN(todayId)) end += 7;
  const left = end - toN(todayId); // mornings after tomorrow until the morning after `end`
  return { endId: toId(end), kg: e.tomorrow - Math.max(0, e.pace) * left, est: e };
}

// Morning: recovery (once today's HRV is in), protein day, Sunday check-in.
export function morningPush(planIn, days, health, prefs, now, opts = {}) {
  const plan = Object.assign({}, PLAN_DEFAULT, planIn || {}), p = prefs || {}, t = days[now.id] || {};
  const mh = p.mhour != null ? +p.mhour : 8;
  const rec = p.morning !== false && health[now.id] && health[now.id].hrv_ms != null ? morningMsg(health, now.id) : null;
  const prot = p.protein !== false && !!proteinDays(plan, days, now.id)[now.id] && t.protein !== true;
  const sun = p.waist !== false && now.sunday && t.waist == null;
  // wait up to two hours for the watch; then send what's due without the recovery line
  if (!rec && !((prot || sun) && (now.hour >= mh + 2 || opts.force))) return null;
  const titles = [], lines = [];
  if (rec) { titles.push(rec.title); lines.push(rec.body); }
  if (prot) { titles.push('Protein day'); lines.push('Shake today: ' + plan.shake + ', about ' + kf(plan.proteinKcal) + ' kcal.'); }
  if (sun) { titles.push('Sunday check-in'); lines.push('Weigh in, measure your waist (+50 XP) and take this week’s photo.'); }
  return { title: titles.join(' · '), body: lines.join(' '), url: rec && !prot && !sun ? './#body' : './#log', tag: 'morning' };
}

// Evening: what today added up to, and what Autopilot will do with it.
export function eveningPush(planIn, days, health, prefs, now) {
  const plan = Object.assign({}, PLAN_DEFAULT, planIn || {}), p = prefs || {};
  if (p.log === false) return null;
  const all = merge(days, health), r = all[now.id] || {}, tomorrow = toId(toN(now.id) + 1);
  const prot = proteinDays(plan, all, tomorrow), dayNo = toN(now.id) - toN(plan.start) + 1;
  if (dayNo < 1) return null;
  const bits = [], sess = sessOf(r), act = H(r, 'active_kcal'), steps = H(r, 'steps');
  if (sess) bits.push(sess === 2 ? 'Double session' : '1 session');
  if (Array.isArray(r.meals) && r.meals.length) bits.push(r.meals.length + ' meal' + (r.meals.length > 1 ? 's' : '') + ' logged');
  if (act != null) bits.push(kf(act) + ' active kcal');
  if (steps != null) bits.push(kf(steps) + ' steps');
  const kg = dayKg(plan, Object.assign({}, r, { mark: r.mark || (plan.autopilot !== false ? 'done' : null) }), !!prot[now.id]);
  const lines = [];
  if (bits.length) lines.push(bits.join(' · ') + '.');
  if (kg != null && r.mark !== 'cheat') lines.push('About ' + (kg >= 0 ? '−' : '+') + Math.abs(kg).toFixed(2) + ' kg by the morning.');
  const run = streak(plan, all, now.id);
  let title = 'Day ' + dayNo + ' recap';
  if (r.mark === 'cheat') { title = 'Cheat day logged'; lines.push('Reset tomorrow: the boss heals, the streak starts again.'); }
  else if (r.mark === 'done') { const toBoss = 10 - ((run + 1) % 10 || 10); lines.push('Locked in. Streak ' + (run + 1) + (toBoss ? ', ' + toBoss + ' to the boss.' : ', boss down.')); }
  else if (plan.autopilot !== false) lines.push('Autopilot completes today at ' + String(plan.autoHour).padStart(2, '0') + ':00 tomorrow. Cheated? Tap to mark it.');
  else lines.push(run ? 'Tap today in to make it ' + (run + 1) + '.' : 'Tap today in and start the run.');
  if (p.protein !== false && prot[tomorrow] && (all[tomorrow] || {}).protein == null) lines.push('Tomorrow is a protein day.');
  return { title, body: lines.join(' '), url: './#log', tag: 'evening' };
}

// Sunday evening: the week in one push (the same numbers as the brief on Home).
export function weeklyBrief(planIn, days, health, now, lastImport, name) {
  const plan = Object.assign({}, PLAN_DEFAULT, planIn || {}), all = merge(days, health);
  const ids = []; for (let i = 6; i >= 0; i--) ids.push(toId(toN(now.id) - i));
  const prev = []; for (let i = 13; i >= 7; i--) prev.push(toId(toN(now.id) - i));
  const prot = proteinDays(plan, all, toId(toN(now.id) + 14));
  let done = 0, cheats = 0, sess = 0, kg = 0, shakes = 0;
  ids.forEach(id => { const r = all[id] || {}; if (r.mark === 'done') done++; if (r.mark === 'cheat') cheats++; sess += sessOf(r); if (prot[id]) shakes++; const k = dayKg(plan, r, !!prot[id]); if (k != null) kg += k; });
  const sc = compute(all), avg = (list, f) => { const v = list.map(id => sc[id] && sc[id][f]).filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const rec = avg(ids, 'recovery'), recP = avg(prev, 'recovery'), sl = avg(ids, 'sleep'), hrv = avg(ids, 'hrv');
  const next = Object.keys(prot).filter(id => id > now.id).sort()[0];
  const lines = [done + '/7 days completed' + (cheats ? ', ' + cheats + ' cheat' + (cheats > 1 ? 's' : '') : '') + ' · ' + sess + ' session' + (sess === 1 ? '' : 's') + ' · about −' + Math.max(0, kg).toFixed(1) + ' kg.'];
  const h = [];
  if (rec != null) h.push('Recovery ' + Math.round(rec) + '%' + (recP != null ? ' (' + (rec - recP >= 0 ? '▲' : '▼') + Math.abs(Math.round(rec - recP)) + ')' : ''));
  if (sl != null) h.push('sleep ' + sl.toFixed(1) + ' h');
  if (hrv != null) h.push('HRV ' + Math.round(hrv));
  if (h.length) lines.push(h.join(', ') + '.');
  if (next) lines.push('Next shake ' + niceId(next) + '.');
  if (!lastImport || Date.now() - Date.parse(lastImport) > 8 * 864e5) lines.push('Tip: refresh your Health history for sleep stages.');
  const wt = weekTarget(plan, all, now.id); lines.push('This week’s target: ' + wt.kg.toFixed(1) + ' kg by ' + niceId(toId(toN(wt.endId) + 1)) + '.');
  return { title: (name ? name + ', your' : 'Your') + ' week in review', body: lines.join(' '), url: './#home', tag: 'weekly', stats: { done, cheats, sess, kg, shakes, rec, recP, sl, hrv, next } };
}

// 1st of the month: last month in one push.
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthlyBrief(planIn, days, health, now, name) {
  const plan = Object.assign({}, PLAN_DEFAULT, planIn || {}), all = merge(days, health);
  const first = toN(now.id.slice(0, 8) + '01'), prevFirst = toN(toId(first - 1).slice(0, 8) + '01');
  const from = Math.max(prevFirst, toN(plan.start)); if (from >= first) return null;
  const prot = proteinDays(plan, all, toId(first)), sc = compute(all);
  let done = 0, cheats = 0, sess = 0, shakes = 0; const rec = [], sl = [];
  for (let n = from; n < first; n++) { const id = toId(n), r = all[id] || {}; if (r.mark === 'done') done++; if (r.mark === 'cheat') cheats++; sess += sessOf(r); if (prot[id]) shakes++; if (sc[id] && sc[id].recovery != null) rec.push(sc[id].recovery); if (sc[id] && sc[id].sleep != null) sl.push(sc[id].sleep); }
  const a = estimate(plan, all, toId(from)).morning, b = estimate(plan, all, now.id).morning;
  const m = MONTHS_LONG[+toId(prevFirst).slice(5, 7) - 1], avg = x => x.reduce((p, v) => p + v, 0) / x.length;
  const lines = [done + '/' + (first - from) + ' days completed' + (cheats ? ', ' + cheats + ' cheat' + (cheats > 1 ? 's' : '') : '') + ' · ' + sess + ' sessions · ' + shakes + ' shakes.',
    (a - b >= 0 ? '−' : '+') + Math.abs(a - b).toFixed(1) + ' kg (' + a.toFixed(1) + ' → ' + b.toFixed(1) + ').'];
  if (rec.length) lines.push('Recovery ' + Math.round(avg(rec)) + '%' + (sl.length ? ', sleep ' + avg(sl).toFixed(1) + ' h' : '') + '.');
  return { title: (name ? name + ', ' : '') + m + ' in review', body: lines.join(' '), url: './#stats', tag: 'monthly' };
}
// Every 5 kg off the start weight (and the goal itself) gets its own moment.
export function milestone(planIn, all, todayId, doneCount, name) {
  const plan = Object.assign({}, PLAN_DEFAULT, planIn || {}), e = estimate(plan, all, todayId);
  const lost = plan.startWeight - e.morning, reached = Math.max(0, Math.floor(lost / 5)), goal = e.morning <= plan.goal;
  const count = reached + (goal ? 1 : 0);
  if (count <= (doneCount || 0)) return { count, msg: null };
  const msg = goal ? { title: (name ? name + ', ' : '') + 'goal reached: ' + plan.goal + ' kg', body: 'From ' + plan.startWeight + ' kg to ' + e.morning.toFixed(1) + ' kg. Open Cut Log to share your card.', url: './#stats', tag: 'milestone' }
    : { title: reached * 5 + ' kg down' + (name ? ', ' + name : ''), body: plan.startWeight + ' → ' + e.morning.toFixed(1) + ' kg. ' + Math.max(0, e.morning - plan.goal).toFixed(1) + ' kg to ' + plan.goal + '. Your milestone card is in Stats.', url: './#stats', tag: 'milestone' };
  return { count, msg };
}

// The Watch has gone quiet: the Shortcut automation probably stopped (iOS sometimes asks again after updates).
export function stalledPush(lastSync, nowMs = Date.now()) {
  if (!lastSync || nowMs - Date.parse(lastSync) < 36 * 3600e3) return null;
  const d = new Date(lastSync), id = d.toISOString().slice(0, 10);
  return { title: 'Watch sync paused', body: 'No Apple Watch data since ' + niceId(id) + '. Open Shortcuts and run your Cut Log sync once, and check its automation is set to Run Immediately.', url: './#settings', tag: 'stalled' };
}

// Autopilot: a past day you didn't mark counts as completed once the grace hour passes (cheat days you mark yourself).
// Only days from the day Autopilot was switched on; never days before the cut started; at most 3 days back.
export function autopilotDays(planIn, days, now) {
  const plan = Object.assign({}, PLAN_DEFAULT, planIn || {});
  if (plan.autopilot === false || !plan.autopilotFrom) return [];
  const from = Math.max(toN(plan.autopilotFrom), toN(plan.start), toN(now.id) - 3), t = toN(now.id), out = [];
  for (let n = from; n < t; n++) {
    if (n === t - 1 && now.hour < plan.autoHour) continue;
    const id = toId(n), r = days[id] || {};
    if (!r.mark) out.push(id);
  }
  return out;
}

// ---------- recovery (same maths as health.js in the app; keep the two in step) ----------
const BASE_W = 60, BASE_MIN = 7;
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, a.length - 1)); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = v => typeof v === 'number' && isFinite(v) ? v : null;
const dayN = id => Date.UTC(+id.slice(0, 4), +id.slice(5, 7) - 1, +id.slice(8, 10)) / 864e5;
// Sleep you actually got: the Watch's number, capped by phone use (you can't be asleep while using
// your phone); with the Watch off (charging), the longest phone-free stretch. Same as health.js.
export function sleepOf(h) {
  if (!h) return null;
  const raw = num(h.sleep_h), cap = num(h.sleep_cap_h), ph = num(h.sleep_phone_h);
  if (raw != null) return cap != null && raw > cap + 0.25 ? { v: ph != null ? ph : cap, src: 'capped', raw } : { v: raw, src: 'watch' };
  if (ph != null) return { v: ph, src: 'phone' };
  return null;
}

function strainOf(h) {
  if (!h) return null;
  if (num(h.trimp) != null) return { v: 21 * (1 - Math.exp(-h.trimp / 250)), est: false };
  const ex = num(h.exercise_min), st = num(h.steps), wm = num(h.workout_min);
  if (ex == null && st == null && wm == null) return null;
  const t = (ex != null ? ex : (wm || 0)) * 2.6 + (st || 0) / 120;
  return { v: 21 * (1 - Math.exp(-t / 250)), est: true };
}

// scores for every day that has Apple Health data; days = Store.days
function compute(days) {
  const ids = Object.keys(days).filter(id => days[id] && days[id].health).sort();
  const out = {};
  const hist = { hrv: [], rhr: [], resp: [], temp: [], sleep: [] }; // [dayN, value]
  let prevStrain = null, prevN = null;
  for (const id of ids) {
    const h = days[id].health, n = dayN(id), o = {};
    const s = strainOf(h); if (s) { o.strain = Math.round(s.v * 10) / 10; o.strainEst = s.est; }
    const need = 8 + (prevStrain != null && prevN === n - 1 ? Math.max(0, prevStrain - 10) * 0.06 : 0);
    const sl = sleepOf(h);
    if (sl) { o.sleep = sl.v; o.sleepSrc = sl.src; o.need = need; o.sleepPerf = Math.round(100 * Math.min(1, sl.v / need)); }
    // baselines from the previous 60 days only
    ['hrv', 'rhr', 'resp', 'temp'].forEach(k => { hist[k] = hist[k].filter(p => p[0] >= n - BASE_W && p[0] < n); });
    hist.sleep = hist.sleep.filter(p => p[0] >= n - 7 && p[0] < n);
    const hrv = num(h.hrv_ms), rhr = num(h.rhr);
    const parts = [];
    if (hrv != null && hrv > 0 && hist.hrv.length >= BASE_MIN) {
      const a = hist.hrv.map(p => Math.log(p[1])); const z = (Math.log(hrv) - mean(a)) / Math.max(sd(a), 0.08);
      parts.push([0.5, z]); o.hrvNorm = Math.round(Math.exp(mean(a))); o.hrvZ = z;
    }
    if (rhr != null && hist.rhr.length >= BASE_MIN) {
      const a = hist.rhr.map(p => p[1]); const z = -(rhr - mean(a)) / Math.max(sd(a), 2);
      parts.push([0.25, z]); o.rhrNorm = Math.round(mean(a)); o.rhrZ = z;
    }
    if (o.sleepPerf != null) { o.sleepZ = (Math.min(1.1, o.sleep / need) - 0.9) / 0.12; if (parts.length) parts.push([0.25, o.sleepZ]); }
    // not scored, but flagged: breathing rate and wrist temperature well above your normal often mean illness or poor recovery
    const resp = num(h.resp_rate), temp = num(h.wrist_temp);
    if (resp != null && hist.resp.length >= BASE_MIN) { const a = hist.resp.map(p => p[1]); o.respNorm = Math.round(mean(a) * 10) / 10; o.respHigh = resp > mean(a) + Math.max(1, 2 * sd(a)); }
    if (temp != null && hist.temp.length >= BASE_MIN) { const a = hist.temp.map(p => p[1]); o.tempDev = Math.round((temp - mean(a)) * 10) / 10; }
    if (o.sleepPerf != null) { o.debt = Math.round(hist.sleep.reduce((t, p) => t + Math.max(0, p[1]), 0) * 10) / 10; }
    if (parts.length && hrv != null && hist.hrv.length >= BASE_MIN) {
      const w = parts.reduce((s, p) => s + p[0], 0), z = clamp(parts.reduce((s, p) => s + p[0] * p[1], 0) / w, -2.5, 2.5);
      o.recovery = Math.round(clamp(60 + 20 * z, 1, 99));
    } else if (hrv != null) o.calibrating = hist.hrv.length;
    o.hrv = hrv; o.rhr = rhr;
    if (hrv != null && hrv > 0) hist.hrv.push([n, hrv]);
    if (rhr != null) hist.rhr.push([n, rhr]);
    if (resp != null) hist.resp.push([n, resp]);
    if (temp != null) hist.temp.push([n, temp]);
    if (o.sleep != null) hist.sleep.push([n, need - o.sleep]);
    if (o.strain != null) { prevStrain = o.strain; prevN = n; }
    out[id] = o;
  }
  return out;
}


function coachLine(r) {
  if (r >= 67) return { lo: 14, hi: 18, t: 'a heavy session or a double fits.' };
  if (r >= 34) return { lo: 10, hi: 14, t: 'train, but keep it controlled.' };
  return { lo: 0, hi: 10, t: 'rest, walk, and hit your protein.' };
}
export function morningMsg(healthDays, todayId) {
  const wrapped = {}; for (const id in healthDays) wrapped[id] = { health: healthDays[id] };
  const sc = compute(wrapped)[todayId];
  if (!sc || sc.recovery == null) return null;
  const r = sc.recovery, band = r >= 67 ? 'green' : r >= 34 ? 'amber' : 'red', c = coachLine(r);
  const bits = [];
  if (sc.hrv != null) bits.push('HRV ' + Math.round(sc.hrv) + (sc.hrvNorm ? ' (normal ' + sc.hrvNorm + ')' : ''));
  if (sc.rhr != null) bits.push('resting HR ' + Math.round(sc.rhr));
  if (sc.sleep != null) bits.push(sc.sleep.toFixed(1) + ' h sleep' + (sc.sleepSrc === 'phone' ? ' (from phone use)' : sc.sleepSrc === 'capped' ? ' (capped by phone use)' : ''));
  return { title: 'Recovery ' + r + '%, ' + band, body: (bits.length ? bits.join(', ') + '. ' : '') + 'Strain target ' + c.lo + '–' + c.hi + ': ' + c.t, url: './#body' };
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

async function run(db, keys, opts = {}) {
  const since = toId(Math.floor(Date.now() / 86400000) - 120);
  const nowD = opts.at || new Date();
  const [subs, settings, dayRows, tokens, pings, profs] = await Promise.all([
    db('push_subs?select=endpoint,user_id,sub,prefs,tz,sent'),
    db('settings?select=user_id,data'),
    db('days?select=user_id,day,data,health&day=gte.' + since),
    db('health_tokens?select=user_id'),
    db('phone_pings?select=user_id,at&at=gte.' + new Date(nowD.getTime() - 3 * 864e5).toISOString()).catch(() => []),
    db('profiles?select=user_id,username,display_name').catch(() => [])
  ]);
  const names = {}; profs.forEach(p => { names[p.user_id] = p.display_name || (p.username ? '@' + p.username : ''); });
  const plans = {}, days = {}, health = {}, lastImport = {}, lastSync = {}, tzOf = {};
  settings.forEach(s => { plans[s.user_id] = s.data || {}; });
  subs.forEach(s => { if (!tzOf[s.user_id]) tzOf[s.user_id] = s.tz; });
  dayRows.forEach(d => {
    (days[d.user_id] = days[d.user_id] || {})[d.day] = d.data || {};
    if (d.health) {
      (health[d.user_id] = health[d.user_id] || {})[d.day] = d.health;
      const t = d.health.imported_at; if (t && (!lastImport[d.user_id] || t > lastImport[d.user_id])) lastImport[d.user_id] = t;
      const w = d.health.synced_at; if (w && (!lastSync[d.user_id] || w > lastSync[d.user_id])) lastSync[d.user_id] = w;
    }
  });
  const out = [];
  // 0. Sleep from phone use, for today and yesterday (the Watch's sleep is capped by it; with the Watch off it is the estimate)
  const byUser = {}; pings.forEach(p => { (byUser[p.user_id] = byUser[p.user_id] || []).push(Date.parse(p.at)); });
  for (const uid of Object.keys(byUser)) {
    const tz = tzOf[uid] || 'Europe/London', now = localNow(tz, nowD), off = tzOffset(tz, nowD);
    for (const id of [toId(toN(now.id) - 1), now.id]) {
      const ps = phoneSleep(byUser[uid], id, off); if (!ps) continue;
      const cur = (health[uid] || {})[id] || {}, keys = ['sleep_phone_h', 'sleep_cap_h', 'phone_bed_ms', 'phone_wake_ms', 'phone_n'];
      if (keys.every(k => cur[k] === ps[k])) continue;
      const next = Object.assign({}, cur); keys.forEach(k => { if (ps[k] == null) delete next[k]; else next[k] = ps[k]; });
      if (!opts.dry) await db('days?on_conflict=user_id,day', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ user_id: uid, day: id, health: next }]) });
      (health[uid] = health[uid] || {})[id] = next;
      out.push('phone sleep ' + id + ' ' + (ps.sleep_phone_h != null ? ps.sleep_phone_h + ' h' : 'cap ' + ps.sleep_cap_h));
    }
  }
  // 1. Autopilot: complete the days you didn't mark (cheats are the only thing left to log by hand)
  for (const uid of Object.keys(plans)) {
    const now = localNow(tzOf[uid] || 'Europe/London', opts.at);
    // Autopilot is on by default; it starts from the day it first runs, so past days are never rewritten
    if (plans[uid].autopilot !== false && !plans[uid].autopilotFrom) {
      plans[uid] = Object.assign({}, plans[uid], { autopilotFrom: now.id });
      if (!opts.dry) await db('settings?user_id=' + eq(uid), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data: plans[uid] }) });
      out.push('autopilot on from ' + now.id);
    }
    const ids = autopilotDays(plans[uid], days[uid] || {}, now);
    for (const id of ids) {
      const data = Object.assign({}, (days[uid] || {})[id] || {}, { mark: 'done', auto: true });
      if (!opts.dry) await db('days?on_conflict=user_id,day', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ user_id: uid, day: id, data }]) });
      (days[uid] = days[uid] || {})[id] = data;
      out.push('autopilot ' + id);
    }
  }
  // 2. Pushes: each kind at most once a day per phone, inside its window (the clock runs every 15 minutes)
  const hasToken = new Set(tokens.map(t => t.user_id));
  for (const s of subs) {
    const now = localNow(s.tz || 'Europe/London', opts.at), p = s.prefs || {}, sent = Object.assign({}, s.sent || {}), uid = s.user_id;
    const plan = plans[uid], dd = days[uid] || {}, hh = health[uid] || {};
    const mh = p.mhour != null ? +p.mhour : 8, eh = p.hour != null ? +p.hour : 20;
    const inWin = (h, len) => now.hour >= h && now.hour < h + len;
    const due = [];
    if (sent.morning !== now.id && inWin(mh, 4)) { const m = morningPush(plan, dd, hh, p, now, { force: now.hour >= mh + 3 }); if (m) due.push(['morning', m]); else if (now.hour >= mh + 3) sent.morning = now.id; }
    if (sent.evening !== now.id && inWin(eh, 3)) {
      const m = now.sunday && p.weekly !== false ? weeklyBrief(plan, dd, hh, now, lastImport[uid], names[uid]) : eveningPush(plan, dd, hh, p, now);
      if (m) due.push(['evening', m]); else sent.evening = now.id;
    }
    if (p.weekly !== false && now.id.endsWith('-01') && sent.monthly !== now.id && inWin(eh, 3)) { const m = monthlyBrief(plan, dd, hh, now, names[uid]); if (m) due.push(['monthly', m]); else sent.monthly = now.id; }
    if (p.milestone !== false && inWin(9, 13)) {
      const ms = milestone(plan, merge(dd, hh), now.id, sent.ms, names[uid]);
      if (ms.msg) due.push(['ms', ms.msg, ms.count]);
    }
    if (p.stalled !== false && hasToken.has(uid) && now.hour >= 9 && now.hour < 22 && (!sent.stalled || toN(now.id) - toN(sent.stalled) >= 3)) {
      const m = stalledPush(lastSync[uid], opts.at ? opts.at.getTime() : Date.now()); if (m) due.push(['stalled', m]);
    }
    let gone = false;
    for (const [kind, m] of due) {
      let res; try { res = opts.dry ? 'dry' : await send(db, keys, s, { title: m.title, body: m.body, url: m.url, tag: m.tag }); } catch (e) { res = 'failed ' + (e && e.message || e); }
      out.push(kind + ' ' + res + (opts.dry ? ': ' + m.title + ' | ' + m.body : ''));
      if (res === 'expired') { gone = true; break; }
      if (!res.startsWith('failed')) sent[kind] = kind === 'ms' ? due.find(d => d[0] === 'ms')[2] : now.id;
    }
    if (!gone && !opts.dry && JSON.stringify(sent) !== JSON.stringify(s.sent || {})) await db('push_subs?endpoint=' + eq(s.endpoint), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ sent }) });
  }
  return { phones: subs.length, results: out };
}

// ---------- sign in with a username ----------
// The email behind a username never leaves the server: we look it up with the service key and ask
// Supabase Auth for a session with the password, then hand the client only the session.
async function login(db, req, env) {
  const { username, password } = await req.json().catch(() => ({}));
  const nope = () => json({ error: 'That username and password don’t match.' }, 401);
  const u = String(username || '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_.]{3,20}$/.test(u) || !password) return nope();
  const email = await db('rpc/email_for_username', { method: 'POST', body: JSON.stringify({ p_username: u }) });
  if (!email) return nope();
  const r = await fetch(env.url.replace(/\/$/, '') + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: env.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return r.status === 429 ? json({ error: 'Too many tries. Wait a few minutes, then try again.' }, 429) : nope();
  return json({ access_token: j.access_token, refresh_token: j.refresh_token });
}

// ---------- Apple Watch (iPhone Shortcut) ----------
// The Shortcut posts today's Apple Health numbers to ...?action=health&k=<personal key>.
// No headers or dates needed: the day is today in the phone's zone (Europe/London unless &tz= is given).
const HEALTH_KEYS = ['workouts', 'active_kcal', 'resting_kcal', 'weight_kg', 'steps', 'sleep_h', 'sleep_min', 'exercise_min', 'rhr', 'hrv_ms', 'resp_rate', 'spo2', 'vo2max', 'body_fat', 'lean_kg'];
async function health(db, req, q) {
  const text = (s, status = 200) => new Response(s, { status, headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS) });
  const k = q.get('k') || '';
  if (!k) return text('Missing key. Copy the link again from Cut Log → Settings → Apple Watch.', 400);
  let body = {};
  const raw = req.method === 'POST' ? await req.text() : '';
  if (raw) { try { body = JSON.parse(raw); } catch (e) { body = Object.fromEntries(new URLSearchParams(raw)); } }
  for (const key of HEALTH_KEYS) if (body[key] == null && q.get(key) != null) body[key] = q.get(key);
  // Shortcuts may send a value as a number, as text ("1,234 kcal"), or as a list of samples; turn each into one number.
  const toNum = v => { if (typeof v === 'number') return v; const t = String(v).replace(/[^0-9.,-]/g, ''); const c = /,\d{3}(\D|$)/.test(t) && !/\.\d+$/.test(t.split(',').pop()) ? t.replace(/,/g, '') : (t.includes('.') ? t.replace(/,/g, '') : t.replace(',', '.')); const n = parseFloat(c); return isFinite(n) ? n : null; };
  const SUMS = ['active_kcal', 'resting_kcal', 'steps', 'exercise_min', 'workouts', 'sleep_min'];
  const payload = {};
  for (const key of HEALTH_KEYS) {
    let v = body[key];
    if (typeof v === 'string' && /\n/.test(v.trim())) v = v.trim().split(/\n+/);       // several samples as lines of text
    if (Array.isArray(v)) {
      const ns = v.map(toNum).filter(n => n != null);
      if (!ns.length) continue;
      v = SUMS.includes(key) ? ns.reduce((a, b) => a + b, 0) : ['weight_kg', 'body_fat', 'lean_kg'].includes(key) ? ns[ns.length - 1] : ns.reduce((a, b) => a + b, 0) / ns.length;
    }
    if (v === undefined || v === null || v === '') continue;
    // Shortcuts sends an empty reading (nothing recorded yet today) as 0: treat it as missing
    if (key !== 'workouts' && !(toNum(v) > 0)) continue;
    payload[key] = typeof v === 'number' ? v : String(v);
  }
  let tz = q.get('tz') || 'Europe/London'; try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch (e) { tz = 'Europe/London'; }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(body.day || '') ? body.day : localNow(tz).id;
  try {
    await db('rpc/health_sync', { method: 'POST', body: JSON.stringify({ p_token: k, p_day: day, p_payload: payload }) });
  } catch (e) {
    if (/unknown token/.test(e.message)) return text('That key isn’t valid any more. Make a new link in Cut Log → Settings → Apple Watch.', 401);
    throw e;
  }
  const bits = [], N = k => payload[k] == null ? null : toNum(payload[k]);
  if (N('exercise_min') != null) bits.push(Math.round(N('exercise_min')) + ' exercise min');
  if (N('active_kcal') != null) bits.push(Math.round(N('active_kcal')) + ' active kcal');
  if (N('hrv_ms') != null) bits.push('HRV ' + Math.round(N('hrv_ms')));
  if (N('rhr') != null) bits.push('resting HR ' + Math.round(N('rhr')));
  if (N('weight_kg') != null) bits.push(N('weight_kg') + ' kg');
  if (N('body_fat') != null) bits.push((N('body_fat') <= 1 ? N('body_fat') * 100 : N('body_fat')).toFixed(1) + '% body fat');
  if (N('steps') != null) bits.push(Math.round(N('steps')) + ' steps');
  return text('Cut Log synced ' + day + (bits.length ? ': ' + bits.join(', ') : ''));
}

// ---------- phone use ----------
// The "App is opened" Shortcut automation calls ?action=ping&k=KEY: one timestamp, nothing else.
async function ping(db, q) {
  const k = q.get('k') || '';
  try { await db('rpc/phone_ping', { method: 'POST', body: JSON.stringify({ p_token: k }) }); }
  catch (e) { if (/unknown token/.test(e.message)) return new Response('That key isn’t valid any more.', { status: 401, headers: CORS }); throw e; }
  return new Response('ok', { headers: Object.assign({ 'Content-Type': 'text/plain' }, CORS) });
}
// Sleep for day D = the night that ended on D: phone-free stretches between 18:00 the evening before and 18:00 on D.
export function phoneSleep(pingsMs, dayId, tzOffsetMin = 0) {
  const start = Date.UTC(+dayId.slice(0, 4), +dayId.slice(5, 7) - 1, +dayId.slice(8, 10)) - 6 * 3600e3 - tzOffsetMin * 60e3;
  const end = start + 24 * 3600e3;
  const inWin = pingsMs.filter(t => t >= start - 3 * 3600e3 && t <= end).sort((a, b) => a - b);
  if (inWin.filter(t => t >= start && t <= end).length < 4) return null; // not enough to tell
  // the main sleep is the longest stretch with no phone use; nobody sleeps longer than that in one go
  let longest = 0, lStart = 0;
  for (let i = 1; i < inWin.length; i++) {
    const a = Math.max(inWin[i - 1], start), b = Math.min(inWin[i], end), g = (b - a) / 3600e3;
    if (g > longest) { longest = g; lStart = a; }
  }
  const r2 = v => Math.round(v * 100) / 100;
  if (longest < 2) return { sleep_cap_h: r2(Math.max(longest, 0)), phone_n: inWin.length };
  return { sleep_phone_h: r2(longest - 0.25), sleep_cap_h: r2(longest), phone_bed_ms: lStart, phone_wake_ms: lStart + longest * 3600e3, phone_n: inWin.length };
}
const tzOffset = (tz, at) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(x => [x.type, x.value])); return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(at.getTime() / 60e3) * 60e3) / 60e3; };

// ---------- lock-screen widget (Scriptable) ----------
// GET ?action=widget&k=KEY  -> small JSON with today's numbers, for the iPhone widget.
async function sha256hex(t) { const b = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(t))); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
async function widget(db, q) {
  const k = q.get('k') || '';
  const rows = k ? await db('health_tokens?select=user_id&token_hash=eq.' + await sha256hex(k)) : [];
  if (!rows.length) return json({ error: 'unknown key' }, 401);
  const uid = rows[0].user_id, since = toId(Math.floor(Date.now() / 864e5) - 400);
  const [set, dr, prof, subs] = await Promise.all([
    db('settings?select=data&user_id=' + eq(uid)), db('days?select=day,data,health&user_id=' + eq(uid) + '&day=gte.' + since),
    db('profiles?select=username,display_name&user_id=' + eq(uid)), db('push_subs?select=tz&user_id=' + eq(uid) + '&limit=1')
  ]);
  const plan = Object.assign({}, PLAN_DEFAULT, (set[0] || {}).data || {}), now = localNow((subs[0] || {}).tz || 'Europe/London');
  const all = {}, health = {}; dr.forEach(r => { all[r.day] = Object.assign({}, r.data || {}, r.health ? { health: r.health } : {}); if (r.health) health[r.day] = r.health; });
  const sc = compute(all), t = sc[now.id] || {}, y = sc[toId(toN(now.id) - 1)] || {};
  const prot = proteinDays(plan, all, toId(toN(now.id) + 14)), next = Object.keys(prot).filter(id => id >= now.id).sort()[0];
  const wt = weekTarget(plan, all, now.id), p = prof[0] || {};
  return json({
    name: p.display_name || (p.username ? '@' + p.username : ''), day: toN(now.id) - toN(plan.start) + 1,
    streak: streak(plan, all, now.id) + ((all[now.id] || {}).mark === 'done' ? 1 : 0), today: (all[now.id] || {}).mark || null,
    recovery: t.recovery != null ? t.recovery : null, strain: t.strain != null ? t.strain : null,
    sleep: t.sleep != null ? Math.round(t.sleep * 10) / 10 : (y.sleep != null ? Math.round(y.sleep * 10) / 10 : null),
    protein: !!prot[now.id], nextShake: next || null, shake: plan.shake,
    weight: Math.round(wt.est.morning * 10) / 10, tomorrow: Math.round(wt.est.tomorrow * 10) / 10,
    weekEnd: wt.endId, weekBy: toId(toN(wt.endId) + 1), weekTarget: Math.round(wt.kg * 10) / 10, goal: plan.goal, toGo: Math.max(0, Math.round((wt.est.morning - plan.goal) * 10) / 10),
    updated: new Date().toISOString()
  });
}

// ---------- Cut Log Sync (iPhone app) ----------
// POST ?action=push&k=KEY  body {rows:[{day:'YYYY-MM-DD', health:{...}}]}  -> merged into each day
async function pushApp(db, req, q) {
  const k = q.get('k') || '';
  if (!k) return json({ error: 'missing key' }, 400);
  let body; try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const rows = Array.isArray(body && body.rows) ? body.rows.slice(0, 400) : [];
  try {
    const n = await db('rpc/health_push', { method: 'POST', body: JSON.stringify({ p_token: k, p_rows: rows }) });
    return json({ ok: true, days: n });
  } catch (e) {
    if (/unknown token/.test(e.message)) return json({ error: 'unknown token' }, 401);
    throw e;
  }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });

export async function handle(req, env) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const db = dbClient(env.url, env.key);
    const q = new URL(req.url).searchParams, action = q.get('action') || 'run';
    if (action === 'health') return await health(db, req, q);
    if (action === 'push') return await pushApp(db, req, q);
    if (action === 'login') return await login(db, req, env);
    if (action === 'ping') return await ping(db, q);
    if (action === 'widget') return await widget(db, q);
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
    key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY'),
    anon: Deno.env.get('SUPABASE_ANON_KEY')
  }));
}
