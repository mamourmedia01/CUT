// Cut Log: Apple Health history importer (runs in a background worker on the phone).
// Reads the Health app's "Export All Health Data" file (export.zip, or the export.xml inside it),
// streams it so even multi-gigabyte exports never sit in memory, and boils it down to one row per day.
// Nothing leaves the phone from here; the app decides what to upload.
/* global fflate */
importScripts('vendor/fflate.min.js');

const SUM = { // per-day totals; when iPhone and Watch both record, the larger source wins (no double counting)
  HKQuantityTypeIdentifierActiveEnergyBurned: 'active_kcal',
  HKQuantityTypeIdentifierBasalEnergyBurned: 'resting_kcal',
  HKQuantityTypeIdentifierStepCount: 'steps',
  HKQuantityTypeIdentifierAppleExerciseTime: 'exercise_min',
  HKQuantityTypeIdentifierDistanceWalkingRunning: 'distance_km'
};
const AVG = { // per-day averages
  HKQuantityTypeIdentifierRestingHeartRate: 'rhr',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'hrv_ms',
  HKQuantityTypeIdentifierRespiratoryRate: 'resp_rate',
  HKQuantityTypeIdentifierOxygenSaturation: 'spo2',
  HKQuantityTypeIdentifierVO2Max: 'vo2max'
};
const LAST = { HKQuantityTypeIdentifierBodyMass: 'weight_kg', HKQuantityTypeIdentifierBodyFatPercentage: 'body_fat' };
const HR = 'HKQuantityTypeIdentifierHeartRate';
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const STAGE = {
  HKCategoryValueSleepAnalysisAsleepDeep: 'deep', HKCategoryValueSleepAnalysisAsleepREM: 'rem',
  HKCategoryValueSleepAnalysisAsleepCore: 'core', HKCategoryValueSleepAnalysisAsleepUnspecified: 'asleep',
  HKCategoryValueSleepAnalysisAsleep: 'asleep', HKCategoryValueSleepAnalysisAwake: 'awake'
};

const days = new Map();              // 'YYYY-MM-DD' -> accumulator
const hrPrev = new Map();            // source -> { t, bpm, day }
let dob = null, records = 0, workouts = 0, firstDay = null, lastDay = null, allHrMax = [];

const D = id => { let d = days.get(id); if (!d) { d = { sum: {}, avg: {}, last: {}, hr: {}, sleep: {}, wk: { n: 0, min: 0, kcal: 0, types: {} } }; days.set(id, d); } return d; };
const toMs = s => Date.parse(s.slice(0, 10) + 'T' + s.slice(11, 19) + (s.length > 20 ? s.slice(20, 23) + ':' + s.slice(23, 25) : 'Z'));
const dayOf = s => s.slice(0, 10);
function attrs(tag) { const o = {}; const re = /(\w+)="([^"]*)"/g; let m; while ((m = re.exec(tag))) o[m[1]] = m[2]; return o; }
function seen(id) { if (!firstDay || id < firstDay) firstDay = id; if (!lastDay || id > lastDay) lastDay = id; }

function unitValue(type, v, unit) {
  if (type.endsWith('EnergyBurned')) return unit === 'kJ' ? v / 4.184 : v;                 // kcal / Cal
  if (type.endsWith('DistanceWalkingRunning')) return unit === 'mi' ? v * 1.609344 : unit === 'm' ? v / 1000 : v;
  if (type.endsWith('BodyMass')) return unit === 'lb' ? v / 2.20462 : unit === 'st' ? v * 6.35029 : unit === 'g' ? v / 1000 : v;
  if (type.endsWith('OxygenSaturation') || type.endsWith('BodyFatPercentage')) return v <= 1 ? v * 100 : v;
  if (type.endsWith('AppleExerciseTime')) return unit === 's' ? v / 60 : unit === 'hr' ? v * 60 : v;
  return v;
}

function onRecord(a) {
  const type = a.type; if (!type || !a.startDate) return;
  records++;
  if (type === SLEEP) {
    const stage = STAGE[a.value]; if (!stage || stage === 'awake') return;
    const id = dayOf(a.endDate || a.startDate); seen(id);   // a night belongs to the morning you wake up
    const sec = Math.max(0, (toMs(a.endDate) - toMs(a.startDate)) / 1000); if (!(sec > 0 && sec < 16 * 3600)) return;
    const src = a.sourceName || '?', sl = D(id).sleep; const s = sl[src] || (sl[src] = { deep: 0, rem: 0, core: 0, asleep: 0, start: Infinity, end: 0 });
    s[stage] += sec; s.start = Math.min(s.start, toMs(a.startDate)); s.end = Math.max(s.end, toMs(a.endDate));
    return;
  }
  const v0 = parseFloat(a.value); if (!isFinite(v0)) return;
  const id = dayOf(a.startDate); seen(id);
  if (type === HR) { // each reading covers the time until the next one; a long gap (watch off) counts as 1 min
    const src = a.sourceName || '?', t = toMs(a.startDate), p = hrPrev.get(src);
    if (p && t > p.t) { const gap = t - p.t, dur = (gap <= 10 * 60000 ? gap : 60000) / 1000; const h = D(p.day).hr; const hs = h[src] || (h[src] = { bins: {}, max: 0, secs: 0 }); const b = Math.max(0, Math.min(44, Math.floor(p.bpm / 5))); hs.bins[b] = (hs.bins[b] || 0) + dur; hs.secs += dur; }
    hrPrev.set(src, { t, bpm: v0, day: id });
    const h = D(id).hr; const hs = h[src] || (h[src] = { bins: {}, max: 0, secs: 0 }); if (v0 > hs.max) hs.max = v0;
    return;
  }
  const v = unitValue(type, v0, a.unit || '');
  const d = D(id);
  if (SUM[type]) { const k = SUM[type], src = a.sourceName || '?'; const m = d.sum[k] || (d.sum[k] = {}); m[src] = (m[src] || 0) + v; }
  else if (AVG[type]) { const k = AVG[type]; const m = d.avg[k] || (d.avg[k] = [0, 0]); m[0] += v; m[1]++; }
  else if (LAST[type]) { const k = LAST[type]; const t = toMs(a.startDate); if (!d.last[k] || t >= d.last[k][0]) d.last[k] = [t, v]; }
}

let curWk = null;
function onWorkout(a) {
  const id = dayOf(a.startDate); seen(id); workouts++;
  const d = D(id); d.wk.n++;
  let min = parseFloat(a.duration) || 0; if (a.durationUnit === 's') min /= 60; else if (a.durationUnit === 'hr') min *= 60;
  d.wk.min += min;
  const kcal = parseFloat(a.totalEnergyBurned); if (isFinite(kcal)) d.wk.kcal += a.totalEnergyBurnedUnit === 'kJ' ? kcal / 4.184 : kcal;
  const t = (a.workoutActivityType || '').replace('HKWorkoutActivityType', ''); d.wk.types[t] = (d.wk.types[t] || 0) + 1;
  curWk = { d, hadKcal: isFinite(kcal) };
}
function onWorkoutStat(a) { // newer exports put energy here instead of on <Workout>
  if (!curWk || curWk.hadKcal || a.type !== 'HKQuantityTypeIdentifierActiveEnergyBurned') return;
  const v = parseFloat(a.sum); if (isFinite(v)) curWk.d.wk.kcal += a.unit === 'kJ' ? v / 4.184 : v;
}

// ---------- streaming XML scan ----------
let buf = '';
const TAG = /<(Record|Workout|WorkoutStatistics|Me)\s([^>]*)>|<\/Workout>/g;
function scan(final) {
  TAG.lastIndex = 0; let m, end = 0;
  while ((m = TAG.exec(buf))) {
    end = TAG.lastIndex;
    if (!m[1]) { curWk = null; continue; }
    const a = attrs(m[2]);
    if (m[1] === 'Record') onRecord(a);
    else if (m[1] === 'Workout') onWorkout(a);
    else if (m[1] === 'WorkoutStatistics') onWorkoutStat(a);
    else if (m[1] === 'Me') { const b = a.HKCharacteristicTypeIdentifierDateOfBirth; if (b && /^\d{4}-\d{2}-\d{2}/.test(b)) dob = b.slice(0, 10); }
  }
  // keep only an unfinished tag at the end of the chunk
  const rest = buf.slice(end); const lt = rest.lastIndexOf('<');
  buf = final ? '' : (lt >= 0 && rest.indexOf('>', lt) < 0 ? rest.slice(lt) : '');
}

// ---------- finish: one row per day ----------
const r1 = v => Math.round(v * 10) / 10;
function finish() {
  // Max heart rate: from date of birth (Tanaka 208 - 0.7 x age) if present, else your highest readings.
  let hrMax = 190;
  for (const d of days.values()) { let m = 0; for (const s in d.hr) m = Math.max(m, d.hr[s].max); if (m > 60) allHrMax.push(m); }
  if (dob && lastDay) { const age = (Date.parse(lastDay) - Date.parse(dob)) / (365.25 * 864e5); if (age > 10 && age < 100) hrMax = 208 - 0.7 * age; }
  else if (allHrMax.length > 20) { allHrMax.sort((a, b) => a - b); hrMax = Math.min(210, Math.max(170, allHrMax[Math.floor(allHrMax.length * 0.99)])); }
  const out = [];
  for (const [id, d] of days) {
    const h = {};
    for (const k in d.sum) h[k] = Math.max(...Object.values(d.sum[k]));
    for (const k in d.avg) h[k] = d.avg[k][0] / d.avg[k][1];
    for (const k in d.last) h[k] = d.last[k][1];
    // heart rate: pick the source with the most coverage, then Edwards TRIMP (minutes in each %HRmax zone x zone number)
    let best = null; for (const s in d.hr) if (!best || d.hr[s].secs > best.secs) best = d.hr[s];
    if (best && best.secs > 0) {
      let trimp = 0;
      for (const b in best.bins) { const bpm = b * 5 + 2.5, pct = bpm / hrMax, z = pct >= 0.9 ? 5 : pct >= 0.8 ? 4 : pct >= 0.7 ? 3 : pct >= 0.6 ? 2 : pct >= 0.5 ? 1 : 0; trimp += (best.bins[b] / 60) * z; }
      h.trimp = Math.round(trimp); h.hr_max = Math.round(best.max); h.hr_minutes = Math.round(best.secs / 60);
    }
    // sleep: the source with the most sleep (usually the Watch)
    // prefer a source that records sleep stages (the Watch) over a bedtime estimate; then the longest
    let sb = null; for (const s in d.sleep) { const x = d.sleep[s], tot = x.deep + x.rem + x.core + x.asleep, st = x.deep + x.rem + x.core > 0 ? 1 : 0; if (!sb || st > sb.st || (st === sb.st && tot > sb.tot)) sb = Object.assign({ tot, st }, x); }
    if (sb && sb.tot > 1800) { h.sleep_h = sb.tot / 3600; if (sb.deep + sb.rem + sb.core > 0) { h.sleep_deep_h = sb.deep / 3600; h.sleep_rem_h = sb.rem / 3600; h.sleep_core_h = (sb.core + sb.asleep) / 3600; } h.bed_ms = sb.start; h.wake_ms = sb.end; }
    if (d.wk.n) { h.workouts = d.wk.n; h.workout_min = d.wk.min; if (d.wk.kcal) h.workout_kcal = d.wk.kcal; h.workout_types = Object.keys(d.wk.types).join(','); }
    for (const k in h) if (typeof h[k] === 'number') h[k] = ['steps', 'workouts', 'trimp', 'hr_max', 'hr_minutes', 'bed_ms', 'wake_ms'].includes(k) ? Math.round(h[k]) : k === 'active_kcal' || k === 'resting_kcal' || k === 'workout_kcal' || k === 'exercise_min' || k === 'workout_min' ? Math.round(h[k]) : (k.startsWith('sleep') ? Math.round(h[k] * 100) / 100 : r1(h[k]));
    if (Object.keys(h).length) out.push({ day: id, health: h });
  }
  out.sort((a, b) => a.day < b.day ? -1 : 1);
  return { rows: out, stats: { records, workouts, days: out.length, firstDay: out.length ? out[0].day : null, lastDay: out.length ? out[out.length - 1].day : null, nights: out.filter(r => r.health.sleep_h).length, hrMax: Math.round(hrMax) } };
}

// ---------- read the file ----------
onmessage = async e => {
  const file = e.data.file;
  try {
    const total = file.size; let read = 0, lastPost = 0;
    const dec = new TextDecoder();
    const feedXml = (chunk, final) => { buf += dec.decode(chunk, { stream: !final }); scan(final); };
    const isZip = /\.zip$/i.test(file.name) || (await file.slice(0, 2).text()) === 'PK';
    let xmlFound = !isZip, done = false;
    let unzip = null;
    if (isZip) {
      unzip = new fflate.Unzip();
      unzip.register(fflate.UnzipInflate);
      unzip.onfile = f => {
        if (!/(^|\/)export\.xml$/i.test(f.name)) return; // skip export_cda.xml, workout routes, ECGs
        xmlFound = true;
        f.ondata = (err, chunk, final) => { if (err) throw err; feedXml(chunk, final); if (final) done = true; };
        f.start();
      };
    }
    const reader = file.stream().getReader();
    for (;;) {
      const { value, done: eof } = await reader.read();
      if (value) { read += value.length; if (unzip) unzip.push(value, false); else feedXml(value, false); }
      if (eof) { if (unzip) unzip.push(new Uint8Array(0), true); else { feedXml(new Uint8Array(0), true); done = true; } break; }
      const now = Date.now(); if (now - lastPost > 250) { lastPost = now; postMessage({ progress: read / total, records }); }
    }
    if (!xmlFound) throw new Error('No export.xml inside that file. In the Health app use Export All Health Data, then pick export.zip.');
    if (!done) scan(true);
    postMessage({ progress: 1, records });
    postMessage({ result: finish() });
  } catch (err) {
    postMessage({ error: String(err && err.message || err) });
  }
};
