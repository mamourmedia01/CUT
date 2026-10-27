// Cut Log: Whoop-style body scores from Apple Watch data (all computed on the phone).
//
// Recovery 0-100: today's HRV (log scale) and resting heart rate against YOUR last 60 days, plus last night's sleep
//   against what you needed. Weights HRV 50%, resting HR 25%, sleep 25% (shared out if one is missing).
//   Needs 7 days of HRV to calibrate. 67+ green (ready), 34-66 amber (moderate), 33 or less red (rest).
// Strain 0-21: Edwards TRIMP (minutes in each heart-rate zone x zone number) from the Health import,
//   squashed onto 0-21 like Whoop: 21 x (1 - e^(-TRIMP/250)). Without heart-rate detail it is estimated from
//   exercise minutes and steps, and marked as an estimate.
// Sleep %: hours asleep / sleep needed (8 h, plus a little more after a hard day).
(function () {
  const W = 60, MIN = 7;
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, a.length - 1)); };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = v => typeof v === 'number' && isFinite(v) ? v : null;
  const dayN = id => Date.UTC(+id.slice(0, 4), +id.slice(5, 7) - 1, +id.slice(8, 10)) / 864e5;

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
      if (num(h.sleep_h) != null) { o.sleep = h.sleep_h; o.need = need; o.sleepPerf = Math.round(100 * Math.min(1, h.sleep_h / need)); }
      // baselines from the previous 60 days only
      ['hrv', 'rhr', 'resp', 'temp'].forEach(k => { hist[k] = hist[k].filter(p => p[0] >= n - W && p[0] < n); });
      hist.sleep = hist.sleep.filter(p => p[0] >= n - 7 && p[0] < n);
      const hrv = num(h.hrv_ms), rhr = num(h.rhr);
      const parts = [];
      if (hrv != null && hrv > 0 && hist.hrv.length >= MIN) {
        const a = hist.hrv.map(p => Math.log(p[1])); const z = (Math.log(hrv) - mean(a)) / Math.max(sd(a), 0.08);
        parts.push([0.5, z]); o.hrvNorm = Math.round(Math.exp(mean(a))); o.hrvZ = z;
      }
      if (rhr != null && hist.rhr.length >= MIN) {
        const a = hist.rhr.map(p => p[1]); const z = -(rhr - mean(a)) / Math.max(sd(a), 2);
        parts.push([0.25, z]); o.rhrNorm = Math.round(mean(a)); o.rhrZ = z;
      }
      if (o.sleepPerf != null) { o.sleepZ = (Math.min(1.1, h.sleep_h / need) - 0.9) / 0.12; if (parts.length) parts.push([0.25, o.sleepZ]); }
      // not scored, but flagged: breathing rate and wrist temperature well above your normal often mean illness or poor recovery
      const resp = num(h.resp_rate), temp = num(h.wrist_temp);
      if (resp != null && hist.resp.length >= MIN) { const a = hist.resp.map(p => p[1]); o.respNorm = Math.round(mean(a) * 10) / 10; o.respHigh = resp > mean(a) + Math.max(1, 2 * sd(a)); }
      if (temp != null && hist.temp.length >= MIN) { const a = hist.temp.map(p => p[1]); o.tempDev = Math.round((temp - mean(a)) * 10) / 10; }
      if (o.sleepPerf != null) { o.debt = Math.round(hist.sleep.reduce((t, p) => t + Math.max(0, p[1]), 0) * 10) / 10; }
      if (parts.length && hrv != null && hist.hrv.length >= MIN) {
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

  const band = r => r == null ? null : r >= 67 ? { c: 'var(--done)', t: 'Ready to push' } : r >= 34 ? { c: 'var(--xp)', t: 'Moderate' } : { c: 'var(--cheat)', t: 'Rest day' };

  function ring(frac, color, big, small, label) {
    const R = 34, C = 2 * Math.PI * R, f = clamp(frac || 0, 0, 1);
    return '<div class="ring"><svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="' + R + '" fill="none" stroke="var(--surface-2)" stroke-width="8"/>' +
      (frac != null && f > 0.005 ? '<circle cx="42" cy="42" r="' + R + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + (C * f).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 42 42)"/>' : '') +
      '</svg><div class="ring-in"><b>' + big + '</b>' + (small ? '<span>' + small + '</span>' : '') + '</div><span class="label">' + label + '</span></div>';
  }

  // ---------- history chart (single series, hover/tap crosshair + tooltip) ----------
  const METRICS = {
    recovery: { name: 'Recovery', unit: '%', color: 'var(--done)', get: (h, s) => s && s.recovery, lo: 0, hi: 100, better: 1 },
    strain: { name: 'Strain', unit: '', color: 'var(--blue)', get: (h, s) => s && s.strain, lo: 0, hi: 21, dp: 1 },
    sleep: { name: 'Sleep', unit: 'h', color: 'var(--sleep)', get: h => h.sleep_h, dp: 1, better: 1 },
    hrv: { name: 'HRV', unit: 'ms', color: 'var(--blue)', get: h => h.hrv_ms, better: 1 },
    rhr: { name: 'Resting HR', unit: 'bpm', color: 'var(--primary)', get: h => h.rhr, better: -1 },
    steps: { name: 'Steps', unit: '', color: 'var(--primary)', get: h => h.steps, lo: 0, better: 1 },
    active: { name: 'Active kcal', unit: 'kcal', color: 'var(--primary)', get: h => h.active_kcal, lo: 0, better: 1 },
    weight: { name: 'Weight', unit: 'kg', color: 'var(--primary)', get: h => h.weight_kg, dp: 1, better: -1 },
    vo2: { name: 'VO₂ max', unit: '', color: 'var(--primary)', get: h => h.vo2max, dp: 1, better: 1 }
  };
  const fmtN = (v, dp) => v == null ? '–' : (dp ? v.toFixed(dp) : Math.round(v).toLocaleString('en-GB'));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nice = id => +id.slice(8, 10) + ' ' + MON[+id.slice(5, 7) - 1] + (id.slice(0, 4) !== String(new Date().getFullYear()) ? ' ' + id.slice(2, 4) : '');

  function chart(el, days, scores, metric, rangeDays, todayId) {
    const M = METRICS[metric]; const endN = dayN(todayId);
    const startN = rangeDays ? endN - rangeDays + 1 : null;
    const pts = Object.keys(days).filter(id => days[id] && days[id].health && (!startN || dayN(id) >= startN) && dayN(id) <= endN).sort()
      .map(id => ({ id, n: dayN(id), v: M.get(days[id].health, scores[id]) })).filter(p => typeof p.v === 'number' && isFinite(p.v));
    if (!pts.length) { el.innerHTML = '<p class="note">No ' + M.name.toLowerCase() + ' data for this period yet.</p>'; return null; }
    const W2 = 340, H2 = 210, L = 36, R = 8, T = 12, B = 24;
    const n0 = startN || pts[0].n, n1 = endN;
    const vs = pts.map(p => p.v); let lo = M.lo != null ? M.lo : Math.min(...vs), hi = M.hi != null ? M.hi : Math.max(...vs);
    if (M.lo == null || M.hi == null) { const pad = (hi - lo) * 0.12 || Math.max(1, Math.abs(hi) * 0.05); if (M.lo == null) lo -= pad; if (M.hi == null) hi += pad; }
    const x = nn => L + (n1 === n0 ? 0.5 : (nn - n0) / (n1 - n0)) * (W2 - L - R), y = v => T + (hi - v) / ((hi - lo) || 1) * (H2 - T - B);
    let g = '';
    for (let i = 0; i <= 3; i++) { const v = lo + (hi - lo) * i / 3; g += '<line x1="' + L + '" x2="' + (W2 - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="var(--line)" stroke-width="1" opacity="' + (i === 0 ? 1 : 0.6) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + fmtN(v, (hi - lo) < 10 && M.dp ? 1 : 0) + '</text>'; }
    const firstId = startN ? idFromN(n0) : pts[0].id;
    g += '<text x="' + L + '" y="' + (H2 - 6) + '" text-anchor="start">' + nice(firstId) + '</text><text x="' + (W2 - R) + '" y="' + (H2 - 6) + '" text-anchor="end">Today</text>';
    // soft fill under the line, then the line (breaks across gaps longer than 3 days)
    const gid = 'g' + metric;
    g += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:' + M.color + ';stop-opacity:.22"/><stop offset="1" style="stop-color:' + M.color + ';stop-opacity:0"/></linearGradient></defs>';
    const segs = []; pts.forEach((p, i) => { if (!i || p.n - pts[i - 1].n > 3) segs.push([]); segs[segs.length - 1].push(p); });
    segs.forEach(sg => { if (sg.length > 1) g += '<path d="M' + sg.map(p => x(p.n).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' L') + ' L' + x(sg[sg.length - 1].n).toFixed(1) + ' ' + (H2 - B) + ' L' + x(sg[0].n).toFixed(1) + ' ' + (H2 - B) + ' Z" fill="url(#' + gid + ')"/>'; });
    let d = ''; pts.forEach((p, i) => { d += (i && p.n - pts[i - 1].n <= 3 ? 'L' : 'M') + x(p.n).toFixed(1) + ' ' + y(p.v).toFixed(1); });
    g += '<path d="' + d + '" fill="none" stroke="' + M.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    // dashed average line
    const avgV = mean(pts.map(p => p.v));
    g += '<line x1="' + L + '" x2="' + (W2 - R) + '" y1="' + y(avgV).toFixed(1) + '" y2="' + y(avgV).toFixed(1) + '" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 4"/>';
    if (pts.length <= 45) pts.forEach(p => { g += '<circle cx="' + x(p.n).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="2.5" fill="' + M.color + '" stroke="var(--surface)" stroke-width="1.5"/>'; });
    const last = pts[pts.length - 1];
    g += '<circle cx="' + x(last.n).toFixed(1) + '" cy="' + y(last.v).toFixed(1) + '" r="4.5" fill="' + M.color + '" stroke="var(--surface)" stroke-width="2"/>';
    g += '<g class="hov" visibility="hidden"><line class="hl" y1="' + T + '" y2="' + (H2 - B) + '" stroke="var(--muted)" stroke-width="1"/><circle class="hc" r="5" fill="' + M.color + '" stroke="var(--surface)" stroke-width="2"/></g>';
    g += '<rect class="hit" x="' + L + '" y="0" width="' + (W2 - L - R) + '" height="' + H2 + '" fill="transparent"/>';
    const avg = mean(vs);
    el.innerHTML = '<div class="tip" hidden></div><svg viewBox="0 0 ' + W2 + ' ' + H2 + '" role="img" aria-label="' + M.name + ' over ' + pts.length + ' days, average ' + fmtN(avg, M.dp) + ' ' + M.unit + ', latest ' + fmtN(last.v, M.dp) + ' ' + M.unit + '">' + g + '</svg>';
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), hov = svg.querySelector('.hov');
    const move = ev => {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * W2 / r.width;
      let best = pts[0]; for (const p of pts) if (Math.abs(x(p.n) - sx) < Math.abs(x(best.n) - sx)) best = p;
      const px = x(best.n), py = y(best.v);
      hov.setAttribute('visibility', 'visible'); hov.querySelector('.hl').setAttribute('x1', px); hov.querySelector('.hl').setAttribute('x2', px);
      hov.querySelector('.hc').setAttribute('cx', px); hov.querySelector('.hc').setAttribute('cy', py);
      tip.hidden = false; tip.innerHTML = '<span>' + nice(best.id) + '</span><b>' + fmtN(best.v, M.dp) + (M.unit ? ' ' + M.unit : '') + '</b>';
      const lx = px / W2 * r.width; tip.style.left = Math.max(4, Math.min(r.width - tip.offsetWidth - 4, lx - tip.offsetWidth / 2)) + 'px';
    };
    const leave = () => { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
    // the same length of time just before this period, for "vs previous"
    let prevAvg = null;
    if (rangeDays) {
      const pv = Object.keys(days).filter(id => days[id] && days[id].health && dayN(id) >= startN - rangeDays && dayN(id) < startN)
        .map(id => M.get(days[id].health, scores[id])).filter(v => typeof v === 'number' && isFinite(v));
      if (pv.length >= Math.min(5, rangeDays / 3)) prevAvg = mean(pv);
    }
    let best = pts[0], low = pts[0]; pts.forEach(p => { if (p.v > best.v) best = p; if (p.v < low.v) low = p; });
    return { n: pts.length, avg, last: last.v, lastId: last.id, best, low, prevAvg, firstId, unit: M.unit, dp: M.dp, name: M.name, better: M.better };
  }
  function idFromN(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }

  // ---------- coach ----------
  function coach(sc) {
    const r = sc && sc.recovery;
    if (r == null) return null;
    if (r >= 67) return { lo: 14, hi: 18, t: 'Green light. A heavy session or a double fits today.' };
    if (r >= 34) return { lo: 10, hi: 14, t: 'Train, but keep it controlled. One solid session, no extra volume.' };
    return { lo: 0, hi: 10, t: 'Your body is asking for rest. Walk, stretch, and hit your protein to protect muscle on the cut.' };
  }

  const minsOfDay = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  const hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  // circular mean/sd for clock times (bedtimes cross midnight)
  function clockStats(mins) {
    const a = mins.map(m => m / 1440 * 2 * Math.PI), sx = mean(a.map(Math.sin)), cx = mean(a.map(Math.cos));
    const m = (Math.atan2(sx, cx) / (2 * Math.PI) * 1440 + 1440) % 1440, R = Math.min(1, Math.hypot(sx, cx));
    return { mean: m, sd: Math.sqrt(-2 * Math.log(Math.max(R, 1e-6))) / (2 * Math.PI) * 1440 };
  }
  function sleepPlan(days, scores, id) {
    const ids = Object.keys(days).filter(k => k <= id && days[k] && days[k].health && days[k].health.wake_ms).sort().slice(-14);
    const wakes = ids.map(k => minsOfDay(days[k].health.wake_ms)), beds = ids.slice(-7).map(k => minsOfDay(days[k].health.bed_ms || days[k].health.wake_ms));
    const sc = scores[id] || {};
    const debt = sc.debt || 0, strain = sc.strain || 0;
    const need = 8 + Math.max(0, strain - 10) * 0.06 + Math.min(1, debt * 0.25);
    const out = { need: Math.round(need * 10) / 10, debt };
    if (wakes.length >= 3) { const w = clockStats(wakes); out.wake = hm(w.mean); out.bed = hm(w.mean - need * 60 - 15); }
    if (beds.length >= 4) { const b = clockStats(beds); out.consistency = Math.round(clamp(100 - b.sd * 0.8, 0, 100)); out.bedSd = Math.round(b.sd); }
    return out;
  }

  // 7 days vs the 7 before
  function trends(days, scores, id) {
    const end = dayN(id);
    const get = { hrv: (h) => h.hrv_ms, rhr: h => h.rhr, sleep: h => h.sleep_h, strain: (h, s) => s.strain, recovery: (h, s) => s.recovery, steps: h => h.steps };
    const out = {};
    for (const k in get) {
      const a = [], b = [], spark = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date((end - i) * 864e5).toISOString().slice(0, 10), h = days[d] && days[d].health, v = h ? get[k](h, scores[d] || {}) : null;
        if (i < 7) spark.push(typeof v === 'number' ? v : null);
        if (typeof v === 'number') (i < 7 ? a : b).push(v);
      }
      if (a.length) out[k] = { now: mean(a), prev: b.length ? mean(b) : null, spark };
    }
    return out;
  }

  // What moves your body: compare groups of your own days (needs 3+ days in each group)
  function insights(days, scores, isCheat, isDone, sessions) {
    const ids = Object.keys(scores).sort(), next = id => new Date((dayN(id) + 1) * 864e5).toISOString().slice(0, 10);
    const out = [];
    const cmp = (label, aIds, bIds, metric, fmtFn) => {
      const va = aIds.map(metric).filter(v => typeof v === 'number'), vb = bIds.map(metric).filter(v => typeof v === 'number');
      if (va.length < 3 || vb.length < 3) return;
      const d = mean(va) - mean(vb), rel = Math.abs(d) / Math.max(1, Math.abs(mean(vb)));
      if (Math.abs(d) < 3 && rel < 0.05) return; // too small to mean anything
      out.push({ label, diff: rel, text: fmtFn(d, mean(va), mean(vb)), n: va.length + vb.length });
    };
    const rec = id => (scores[id] || {}).recovery, hrvOf = id => (scores[id] || {}).hrv;
    const pct = (a, b) => Math.round((a - b) / b * 100);
    cmp('cheat', ids.filter(isCheat).map(next), ids.filter(isDone).map(next), rec,
      (d, a, b) => 'After a cheat day your recovery averages ' + Math.round(a) + '%, against ' + Math.round(b) + '% after a clean day.');
    cmp('sleep7', ids.filter(id => (scores[id] || {}).sleep >= 7), ids.filter(id => (scores[id] || {}).sleep != null && scores[id].sleep < 7), rec,
      (d, a, b) => '7+ hours of sleep gives you ' + Math.round(a) + '% recovery on average, under 7 hours gives ' + Math.round(b) + '%.');
    cmp('gym', ids.filter(id => sessions(id) > 0).map(next), ids.filter(id => sessions(id) === 0).map(next), hrvOf,
      (d, a, b) => 'The morning after a gym day your HRV is ' + (a >= b ? pct(a, b) + '% higher' : pct(b, a) + '% lower') + ' than after a rest day (' + Math.round(a) + ' vs ' + Math.round(b) + ' ms).');
    cmp('strain', ids.filter(id => (scores[id] || {}).strain >= 14).map(next), ids.filter(id => (scores[id] || {}).strain != null && scores[id].strain < 10).map(next), rec,
      (d, a, b) => 'After a high-strain day (14+) you recover to ' + Math.round(a) + '%, after an easy day (under 10) to ' + Math.round(b) + '%.');
    const late = id => { const h = days[id] && days[id].health; if (!h || !h.bed_ms) return null; const m = minsOfDay(h.bed_ms); return (m + 720) % 1440; };
    cmp('bedtime', ids.filter(id => late(id) != null && late(id) >= 720 + 30), ids.filter(id => late(id) != null && late(id) < 720), rec,
      (d, a, b) => 'Going to sleep after 00:30 averages ' + Math.round(a) + '% recovery, before midnight ' + Math.round(b) + '%.');
    return out.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  }

  window.CutHealth = { compute, strainOf, band, ring, chart, METRICS, fmtN, coach, sleepPlan, trends, insights, hm, dayN };
})();
