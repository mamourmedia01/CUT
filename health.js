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
    const hist = { hrv: [], rhr: [] }; // [dayN, value]
    let prevStrain = null, prevN = null;
    for (const id of ids) {
      const h = days[id].health, n = dayN(id), o = {};
      const s = strainOf(h); if (s) { o.strain = Math.round(s.v * 10) / 10; o.strainEst = s.est; }
      const need = 8 + (prevStrain != null && prevN === n - 1 ? Math.max(0, prevStrain - 10) * 0.06 : 0);
      if (num(h.sleep_h) != null) { o.sleep = h.sleep_h; o.need = need; o.sleepPerf = Math.round(100 * Math.min(1, h.sleep_h / need)); }
      // baselines from the previous 60 days only
      ['hrv', 'rhr'].forEach(k => { hist[k] = hist[k].filter(p => p[0] >= n - W && p[0] < n); });
      const hrv = num(h.hrv_ms), rhr = num(h.rhr);
      const parts = [];
      if (hrv != null && hrv > 0 && hist.hrv.length >= MIN) {
        const a = hist.hrv.map(p => Math.log(p[1])); const z = (Math.log(hrv) - mean(a)) / Math.max(sd(a), 0.08);
        parts.push([0.5, z]); o.hrvNorm = Math.round(Math.exp(mean(a)));
      }
      if (rhr != null && hist.rhr.length >= MIN) {
        const a = hist.rhr.map(p => p[1]); const z = -(rhr - mean(a)) / Math.max(sd(a), 2);
        parts.push([0.25, z]); o.rhrNorm = Math.round(mean(a));
      }
      if (o.sleepPerf != null && parts.length) parts.push([0.25, (Math.min(1.1, h.sleep_h / need) - 0.9) / 0.12]);
      if (parts.length && hrv != null && hist.hrv.length >= MIN) {
        const w = parts.reduce((s, p) => s + p[0], 0), z = clamp(parts.reduce((s, p) => s + p[0] * p[1], 0) / w, -2.5, 2.5);
        o.recovery = Math.round(clamp(60 + 20 * z, 1, 99));
      } else if (hrv != null) o.calibrating = hist.hrv.length;
      o.hrv = hrv; o.rhr = rhr;
      if (hrv != null && hrv > 0) hist.hrv.push([n, hrv]);
      if (rhr != null) hist.rhr.push([n, rhr]);
      if (o.strain != null) { prevStrain = o.strain; prevN = n; }
      out[id] = o;
    }
    return out;
  }

  const band = r => r == null ? null : r >= 67 ? { c: 'var(--done)', t: 'Ready' } : r >= 34 ? { c: 'var(--xp)', t: 'Moderate' } : { c: 'var(--cheat)', t: 'Rest' };

  function ring(frac, color, big, small, label) {
    const R = 34, C = 2 * Math.PI * R, f = clamp(frac || 0, 0, 1);
    return '<div class="ring"><svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="' + R + '" fill="none" stroke="var(--surface-2)" stroke-width="8"/>' +
      (frac != null && f > 0.005 ? '<circle cx="42" cy="42" r="' + R + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + (C * f).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 42 42)"/>' : '') +
      '</svg><div class="ring-in"><b>' + big + '</b>' + (small ? '<span>' + small + '</span>' : '') + '</div><span class="label">' + label + '</span></div>';
  }

  // ---------- history chart (single series, hover/tap crosshair + tooltip) ----------
  const METRICS = {
    recovery: { name: 'Recovery', unit: '%', color: 'var(--done)', get: (h, s) => s && s.recovery, lo: 0, hi: 100 },
    strain: { name: 'Strain', unit: '', color: 'var(--blue)', get: (h, s) => s && s.strain, lo: 0, hi: 21, dp: 1 },
    sleep: { name: 'Sleep', unit: 'h', color: 'var(--sleep)', get: h => h.sleep_h, dp: 1 },
    hrv: { name: 'HRV', unit: 'ms', color: 'var(--blue)', get: h => h.hrv_ms },
    rhr: { name: 'Resting HR', unit: 'bpm', color: 'var(--primary)', get: h => h.rhr },
    steps: { name: 'Steps', unit: '', color: 'var(--primary)', get: h => h.steps, lo: 0 },
    active: { name: 'Active kcal', unit: 'kcal', color: 'var(--primary)', get: h => h.active_kcal, lo: 0 },
    weight: { name: 'Weight', unit: 'kg', color: 'var(--primary)', get: h => h.weight_kg, dp: 1 },
    vo2: { name: 'VO₂ max', unit: '', color: 'var(--primary)', get: h => h.vo2max, dp: 1 }
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
    const W2 = 340, H2 = 190, L = 40, R = 10, T = 12, B = 24;
    const n0 = startN || pts[0].n, n1 = endN;
    const vs = pts.map(p => p.v); let lo = M.lo != null ? M.lo : Math.min(...vs), hi = M.hi != null ? M.hi : Math.max(...vs);
    if (M.lo == null || M.hi == null) { const pad = (hi - lo) * 0.12 || Math.max(1, Math.abs(hi) * 0.05); if (M.lo == null) lo -= pad; if (M.hi == null) hi += pad; }
    const x = nn => L + (n1 === n0 ? 0.5 : (nn - n0) / (n1 - n0)) * (W2 - L - R), y = v => T + (hi - v) / ((hi - lo) || 1) * (H2 - T - B);
    let g = '';
    for (let i = 0; i <= 3; i++) { const v = lo + (hi - lo) * i / 3; g += '<line x1="' + L + '" x2="' + (W2 - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + fmtN(v, (hi - lo) < 10 && M.dp ? 1 : 0) + '</text>'; }
    const firstId = startN ? idFromN(n0) : pts[0].id;
    g += '<text x="' + L + '" y="' + (H2 - 6) + '" text-anchor="start">' + nice(firstId) + '</text><text x="' + (W2 - R) + '" y="' + (H2 - 6) + '" text-anchor="end">Today</text>';
    // line breaks across gaps longer than 3 days
    let d = ''; pts.forEach((p, i) => { d += (i && p.n - pts[i - 1].n <= 3 ? 'L' : 'M') + x(p.n).toFixed(1) + ' ' + y(p.v).toFixed(1); });
    g += '<path d="' + d + '" fill="none" stroke="' + M.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    if (pts.length <= 45) pts.forEach(p => { g += '<circle cx="' + x(p.n).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="3" fill="' + M.color + '" stroke="var(--surface)" stroke-width="2"/>'; });
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
    return { n: pts.length, avg, last: last.v, unit: M.unit, dp: M.dp, name: M.name };
  }
  function idFromN(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }

  window.CutHealth = { compute, strainOf, band, ring, chart, METRICS, fmtN };
})();
