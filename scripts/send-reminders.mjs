// Cut Log reminder sender. Run hourly by .github/workflows/reminders.yml.
// Reads the Supabase address and public keys from config.js, and the VAPID private
// key from the VAPID_PRIVATE_KEY secret. Exits quietly if either isn't set up yet.
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import webpush from 'web-push';

const cfgSrc = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const cfg = k => (cfgSrc.match(new RegExp(k + "\\s*:\\s*'([^']*)'")) || [])[1] || '';
const URL_ = cfg('SUPABASE_URL').replace(/\/$/, ''), ANON = cfg('SUPABASE_ANON_KEY'), PUB = cfg('VAPID_PUBLIC_KEY');
const PRIV = process.env.VAPID_PRIVATE_KEY || '';
const TEST = process.env.TEST === 'true';
const APP = process.env.APP_URL || './';

if (!URL_ || !ANON) { console.log('Supabase not connected in config.js yet. Nothing to do.'); process.exit(0); }
if (!PUB || !PRIV) { console.log('VAPID_PRIVATE_KEY secret not set yet. Nothing to do.'); process.exit(0); }

webpush.setVapidDetails('mailto:mamourmedia01@gmail.com', PUB, PRIV);
const KEY = createHmac('sha256', PRIV).update('cut-log-cron').digest('hex');

async function rpc(fn, body) {
  const r = await fetch(URL_ + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ p_key: KEY }, body)) });
  if (!r.ok) throw new Error(fn + ' ' + r.status + ' ' + await r.text());
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

// Date helpers on plain YYYY-MM-DD strings (no time zone drift).
const toN = id => Date.UTC(+id.slice(0, 4), +id.slice(5, 7) - 1, +id.slice(8, 10)) / 86400000;
const toId = n => new Date(n * 86400000).toISOString().slice(0, 10);
function localNow(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return { id: parts.year + '-' + parts.month + '-' + parts.day, hour: +parts.hour, sunday: parts.weekday === 'Sun' };
}

const PLAN_DEFAULT = { start: '2026-10-14', proteinAnchor: '2026-10-25', proteinEvery: 3 };

// Same rule as proteinMap() in app.js: due every N days from the anchor; taking it on
// another day moves the rhythm, skipping a due day keeps it.
function proteinDue(plan, days, todayId) {
  const a = toN(plan.proteinAnchor), t = toN(todayId);
  let last = null;
  for (let n = a; n <= t; n++) {
    const id = toId(n), o = (days[id] || {}).protein;
    const due = last === null ? n === a : n - last >= plan.proteinEvery;
    if (n === t) return o === true ? false : (o === false ? false : due);
    if (o === true || due) last = n;
  }
  return false;
}

// Streak of completed days ending yesterday (an unmarked or cheat day breaks it).
function streak(plan, days, todayId) {
  let run = 0;
  for (let n = toN(todayId) - 1; n >= toN(plan.start); n--) { if ((days[toId(n)] || {}).mark === 'done') run++; else break; }
  return run;
}

function compose(s, now) {
  const plan = Object.assign({}, PLAN_DEFAULT, s.plan || {}), days = s.days || {}, p = s.prefs || {};
  const today = days[now.id] || {};
  const lines = [];
  let title = 'Cut Log';
  const prot = p.protein !== false && proteinDue(plan, days, now.id);
  const needLog = p.log !== false && !today.mark;
  const waist = p.waist !== false && now.sunday && today.waist == null;
  if (prot) { title = 'Protein day'; lines.push('Shake today, about ' + (plan.proteinKcal || 600) + ' kcal.'); }
  if (needLog) {
    const run = streak(plan, days, now.id), toBoss = 10 - (run % 10);
    if (!prot) title = run ? run + '-day streak' : 'Log today';
    lines.push(run ? 'Tap today in to make it ' + (run + 1) + '. ' + (toBoss === 1 ? 'Boss falls today.' : toBoss + ' to the boss.') : 'Tap today in and start the run.');
  }
  if (waist) { if (!prot && !needLog) title = 'Sunday check'; lines.push('Measure your waist for +50 XP.'); }
  return lines.length ? { title, body: lines.join(' '), url: APP + '#log' } : null;
}

const subs = await rpc('reminder_batch', {});
console.log(subs.length + ' subscribed phone(s).');
let sent = 0;
for (const s of subs) {
  const tz = s.tz || 'Europe/London', now = localNow(tz), hour = (s.prefs && s.prefs.hour != null) ? +s.prefs.hour : 20;
  let msg;
  if (TEST) msg = { title: 'Cut Log', body: 'Test reminder. Push is working.', url: APP + '#log' };
  else {
    if (s.last_sent === now.id) continue;               // already nudged today
    if (now.hour < hour || now.hour > hour + 3) continue; // outside the window (GitHub cron can run late)
    msg = compose(s, now);
    if (!msg) { await rpc('reminder_done', { p_endpoint: s.endpoint, p_day: now.id }); continue; }
  }
  try {
    await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 3 * 3600, urgency: 'normal' });
    sent++;
    if (!TEST) await rpc('reminder_done', { p_endpoint: s.endpoint, p_day: now.id });
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { await rpc('reminder_drop', { p_endpoint: s.endpoint }); console.log('Removed an expired phone.'); }
    else console.error('Send failed', e.statusCode || '', e.body || e.message);
  }
}
console.log(sent + ' reminder(s) sent.');
