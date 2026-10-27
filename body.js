// Cut Log: the Body tab — recovery, strain and sleep for any day, what drove them, and what to do next.
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fromId = id => new Date(+id.slice(0, 4), +id.slice(5, 7) - 1, +id.slice(8, 10));
  const toId = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addD = (id, n) => { const d = fromId(id); d.setDate(d.getDate() + n); return toId(d); };
  const k = n => Math.round(n).toLocaleString('en-GB');
  const h1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const hrs = v => { const m = Math.round(v * 60); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const WK = { TraditionalStrengthTraining: 'Strength training', FunctionalStrengthTraining: 'Functional strength', HighIntensityIntervalTraining: 'HIIT', Running: 'Run', Walking: 'Walk', Cycling: 'Ride', Soccer: 'Football', Swimming: 'Swim', CoreTraining: 'Core', Elliptical: 'Elliptical', Rowing: 'Row', Boxing: 'Boxing', MixedCardio: 'Cardio', Yoga: 'Yoga', CrossTraining: 'Cross training', StairClimbing: 'Stairs', Other: 'Workout' };
  const wkName = t => WK[t] || (t || 'Workout').replace(/([a-z])([A-Z])/g, '$1 $2');

  // the hero: a 270° dial for recovery, two smaller dials for strain and sleep
  function dial(frac, color, value, unit, caption, size) {
    const r = size === 'big' ? 86 : 40, sw = size === 'big' ? 14 : 8, box = (r + sw) * 2, c = box / 2;
    const len = 2 * Math.PI * r * 0.75, f = frac == null ? 0 : clamp(frac, 0, 1);
    const arc = 'M ' + (c + r * Math.cos(Math.PI * 0.75)).toFixed(1) + ' ' + (c + r * Math.sin(Math.PI * 0.75)).toFixed(1) + ' A ' + r + ' ' + r + ' 0 1 1 ' + (c + r * Math.cos(Math.PI * 0.25)).toFixed(1) + ' ' + (c + r * Math.sin(Math.PI * 0.25)).toFixed(1);
    let ticks = '';
    if (size === 'big') [1 / 3, 2 / 3].forEach(t => { const a = Math.PI * 0.75 + t * Math.PI * 1.5; ticks += '<line x1="' + (c + (r - sw / 2 - 3) * Math.cos(a)).toFixed(1) + '" y1="' + (c + (r - sw / 2 - 3) * Math.sin(a)).toFixed(1) + '" x2="' + (c + (r - sw / 2 - 9) * Math.cos(a)).toFixed(1) + '" y2="' + (c + (r - sw / 2 - 9) * Math.sin(a)).toFixed(1) + '" stroke="var(--line)" stroke-width="2" stroke-linecap="round"/>'; });
    return '<svg class="dial ' + (size || '') + '" viewBox="0 0 ' + box + ' ' + (box * 0.86).toFixed(0) + '" aria-hidden="true">' +
      '<path d="' + arc + '" fill="none" stroke="var(--surface-2)" stroke-width="' + sw + '" stroke-linecap="round"/>' +
      (f > 0.004 ? '<path d="' + arc + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + (len * f).toFixed(1) + ' ' + len.toFixed(1) + '"/>' : '') + ticks +
      '<text x="' + c + '" y="' + (c + (size === 'big' ? 14 : 8)) + '" text-anchor="middle" class="dv">' + value + (unit ? '<tspan class="du">' + unit + '</tspan>' : '') + '</text>' +
      (caption ? '<text x="' + c + '" y="' + (c + (size === 'big' ? 40 : 26)) + '" text-anchor="middle" class="dc">' + esc(caption) + '</text>' : '') + '</svg>';
  }

  // one contributor row: where today sits against your normal (centre line)
  // one contributor row: where today sits against your normal (centre line); right of centre = better than normal
  function contrib(name, valueText, z, note) {
    const pos = z == null ? 50 : clamp(50 + z * 16, 4, 96);
    const col = z == null ? 'var(--muted)' : z >= 0.5 ? 'var(--done)' : z <= -1 ? 'var(--cheat)' : 'var(--ink)';
    return '<div class="crow"><div class="cname"><b>' + esc(name) + '</b><span>' + esc(note) + '</span></div><div class="cval">' + valueText + '</div>' +
      '<div class="ctrack" role="img" aria-label="' + esc(name + ': ' + note) + '"><i class="cmid"></i><i class="cdot" style="left:' + pos + '%;background:' + col + '"></i></div></div>';
  }

  function stacked(parts, label) { // parts: [{v, c, t}] — thin bar with 2px gaps, labelled legend underneath
    const tot = parts.reduce((s, p) => s + p.v, 0); if (!tot) return '';
    const segs = parts.filter(p => p.v > 0).map(p => '<i style="flex:' + p.v + ';background:' + p.c + '" title="' + esc(p.t) + '"></i>').join('');
    const leg = parts.filter(p => p.v > 0).map(p => '<span><i style="background:' + p.c + '"></i>' + esc(p.t) + '</span>').join('');
    return '<div class="stack" role="img" aria-label="' + esc(label + ': ' + parts.map(p => p.t).join(', ')) + '">' + segs + '</div><div class="sleg">' + leg + '</div>';
  }

  function spark(vals, color) {
    const v = vals.map(x => typeof x === 'number' ? x : null), got = v.filter(x => x != null); if (got.length < 2) return '';
    const lo = Math.min(...got), hi = Math.max(...got), W = 100, H = 26;
    let d = '', pen = false; v.forEach((x, i) => { if (x == null) { pen = false; return; } const px = i / 6 * W, py = H - 3 - (hi === lo ? 0.5 : (x - lo) / (hi - lo)) * (H - 6); d += (pen ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); pen = true; });
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function render(ctx) {
    const CH = window.CutHealth, days = ctx.days, sc = ctx.scores, sel = ctx.selected, today = ctx.today;
    const any = Object.keys(days).some(id => days[id] && days[id].health);
    $('bdEmpty').hidden = any; $('bdMain').hidden = !any;
    // date + week strip
    const sd = fromId(sel);
    $('bdDate').textContent = sel === today ? 'Today' : sel === addD(today, -1) ? 'Yesterday' : WD[sd.getDay()] + ' ' + sd.getDate() + ' ' + MON[sd.getMonth()];
    $('bdNext').disabled = sel >= today;
    const mon = addD(sel, -((sd.getDay() + 6) % 7));
    let wk = '';
    for (let i = 0; i < 7; i++) {
      const id = addD(mon, i), s = sc[id] || {}, b = CH.band(s.recovery), d = fromId(id), future = id > today;
      wk += '<button type="button" data-day="' + id + '"' + (future ? ' disabled' : '') + ' aria-pressed="' + (id === sel) + '" aria-label="' + WD[d.getDay()] + ' ' + d.getDate() + (s.recovery != null ? ', recovery ' + s.recovery + '%' : '') + '"><span>' + WD[d.getDay()].slice(0, 1) + '</span><b>' + d.getDate() + '</b><i style="' + (b ? 'background:' + b.c : 'border:2px solid var(--line)') + '"></i></button>';
    }
    $('bdWeek').innerHTML = wk;
    if (!any) return;

    const h = (days[sel] && days[sel].health) || {}, s = sc[sel] || {}, b = CH.band(s.recovery), co = CH.coach(s);
    const plan = CH.sleepPlan(days, sc, sel);
    // hero
    $('bdHero').innerHTML =
      '<div class="hero-main">' + dial(s.recovery != null ? s.recovery / 100 : null, b ? b.c : 'var(--line)', s.recovery != null ? s.recovery : '–', s.recovery != null ? '%' : '', s.recovery != null ? b.t : (s.calibrating != null ? 'Recovery calibrating' : 'Recovery needs HRV'), 'big') + '</div>' +
      '<div class="hero-side">' +
        '<button type="button" class="mini" data-goto="bdStrain">' + dial(s.strain != null ? s.strain / 21 : null, 'var(--blue)', s.strain != null ? h1(s.strain) : '–', '', 'Strain', 'small') + '</button>' +
        '<button type="button" class="mini" data-goto="bdSleep">' + dial(s.sleepPerf != null ? s.sleepPerf / 100 : null, 'var(--sleep)', s.sleepPerf != null ? s.sleepPerf : '–', s.sleepPerf != null ? '%' : '', 'Sleep', 'small') + '</button>' +
      '</div>';
    $('bdCoach').textContent = co ? co.t : (s.calibrating != null ? 'Recovery needs 7 days of HRV to learn your normal (' + s.calibrating + ' so far). Importing your Apple Health history fills this in straight away.' : 'Recovery comes from your heart rate variability. Import your Apple Health history or add HRV to your nightly sync.');

    // recovery contributors
    $('bdRecVal').textContent = s.recovery != null ? s.recovery + '%' : '';
    const pctTxt = (v, n) => { const p = Math.round((v - n) / n * 100); return (p > 0 ? '+' : '') + p + '% vs your ' + Math.round(n); };
    let cr = '';
    if (s.hrv != null) cr += contrib('HRV', Math.round(s.hrv) + '<small> ms</small>', s.hrvZ != null ? s.hrvZ : null, s.hrvNorm ? pctTxt(s.hrv, s.hrvNorm) + ' ms normal' : 'learning your normal');
    if (s.rhr != null) cr += contrib('Resting heart rate', Math.round(s.rhr) + '<small> bpm</small>', s.rhrZ != null ? s.rhrZ : null, s.rhrNorm ? (Math.round(s.rhr) - s.rhrNorm > 0 ? '+' : '') + (Math.round(s.rhr) - s.rhrNorm) + ' vs your ' + s.rhrNorm + ' bpm normal' : 'learning your normal');
    if (s.sleepPerf != null) cr += contrib('Sleep', s.sleepPerf + '<small>%</small>', s.sleepZ, hrs(s.sleep) + ' of ' + hrs(s.need) + ' needed');
    $('bdContrib').innerHTML = cr || '<p class="note">No recovery data for this day.</p>';
    const flags = [];
    if (s.respHigh) flags.push('Your breathing rate was above your normal (' + h.resp_rate + ' vs ' + s.respNorm + '). That often comes before a cold, or after alcohol or a very late meal.');
    if (s.tempDev != null && s.tempDev >= 0.5) flags.push('Wrist temperature was ' + s.tempDev + '°C above your normal overnight.');
    $('bdRecNote').hidden = !flags.length; $('bdRecNote').textContent = flags.join(' ');

    // strain
    $('bdStrainVal').textContent = s.strain != null ? h1(s.strain) + (s.strainEst ? ' est.' : '') : '';
    if (co) {
      const p = v => (v / 21 * 100).toFixed(1) + '%';
      $('bdTarget').innerHTML = '<div class="tbar" role="img" aria-label="Strain target ' + co.lo + ' to ' + co.hi + ', now ' + (s.strain != null ? h1(s.strain) : 'none') + '"><i class="tband" style="left:' + p(co.lo) + ';width:' + p(co.hi - co.lo) + '"></i>' + (s.strain != null ? '<i class="tnow" style="left:' + p(Math.min(21, s.strain)) + '"></i>' : '') + '</div><div class="tlab"><span>0</span><span>Target ' + co.lo + '–' + co.hi + '</span><span>21</span></div>';
    } else $('bdTarget').innerHTML = '';
    const z = h.hr_zones;
    $('bdZones').innerHTML = z && z.some(v => v > 0) ? '<p class="sub">Time in heart-rate zones</p>' + stacked(z.map((m, i) => ({ v: m, c: 'color-mix(in srgb, var(--blue) ' + [30, 48, 66, 84, 100][i] + '%, var(--surface-2))', t: 'Zone ' + (i + 1) + ' ' + m + ' min' })), 'Heart-rate zones') : '';
    const wl = h.workout_list || [];
    $('bdWk').innerHTML = wl.map(w => '<li><div><b>' + esc(wkName(w.t)) + '</b><span>' + esc(w.s + (w.e ? '–' + w.e : '')) + '</span></div><div class="wnum">' + w.min + '<small> min</small>' + (w.kcal ? '<br>' + k(w.kcal) + '<small> kcal</small>' : '') + '</div></li>').join('') ||
      (h.exercise_min != null ? '<li><div><b>Exercise</b><span>from your watch</span></div><div class="wnum">' + h.exercise_min + '<small> min</small></div></li>' : '');
    $('bdStrainNote').hidden = !s.strainEst; $('bdStrainNote').textContent = s.strainEst ? 'Estimated from exercise minutes and steps. Import your Apple Health history for heart-rate based strain.' : '';

    // sleep
    $('bdSleepVal').textContent = s.sleep != null ? hrs(s.sleep) : '';
    $('bdStages').innerHTML = h.sleep_deep_h != null ? stacked([
      { v: h.sleep_deep_h, c: 'var(--sleep)', t: 'Deep ' + hrs(h.sleep_deep_h) },
      { v: h.sleep_rem_h || 0, c: 'color-mix(in srgb, var(--sleep) 62%, var(--surface-2))', t: 'REM ' + hrs(h.sleep_rem_h || 0) },
      { v: h.sleep_core_h || 0, c: 'color-mix(in srgb, var(--sleep) 34%, var(--surface-2))', t: 'Core ' + hrs(h.sleep_core_h || 0) },
      { v: h.sleep_awake_h || 0, c: 'var(--line)', t: 'Awake ' + hrs(h.sleep_awake_h || 0) }], 'Sleep stages') : '';
    const t = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const kv = [];
    if (s.sleep != null) kv.push(['Asleep', hrs(s.sleep) + ' of ' + hrs(s.need)]);
    if (h.bed_ms && h.wake_ms) kv.push(['Fell asleep → woke', t(h.bed_ms) + ' → ' + t(h.wake_ms)]);
    if (plan.debt != null && s.sleep != null) kv.push(['Sleep debt, last 7 days', plan.debt > 0.1 ? hrs(plan.debt) : 'None']);
    if (plan.consistency != null) kv.push(['Consistency', plan.consistency + '%']);
    if (sel === today && plan.bed) { kv.push(['Sleep needed tonight', hrs(plan.need)]); kv.push(['Be asleep by', plan.bed + ' to wake at ' + plan.wake]); }
    $('bdSleepKv').innerHTML = kv.map(([a, v]) => '<div><span>' + esc(a) + '</span><b>' + esc(v) + '</b></div>').join('') || '<p class="note">No sleep recorded for this night. Sleep comes from your Apple Health history import.</p>';
    $('bdSleepNote').hidden = true;

    // trends
    const tr = CH.trends(days, sc, sel);
    const TR = [['recovery', 'Recovery', '%', 'up', 'var(--done)'], ['hrv', 'HRV', ' ms', 'up', 'var(--blue)'], ['rhr', 'Resting HR', ' bpm', 'down', 'var(--primary)'], ['sleep', 'Sleep', ' h', 'up', 'var(--sleep)'], ['strain', 'Strain', '', null, 'var(--blue)'], ['steps', 'Steps', '', 'up', 'var(--primary)']];
    $('bdTrends').innerHTML = TR.filter(([key]) => tr[key]).map(([key, name, u, better, col]) => {
      const x = tr[key], dp = key === 'sleep' || key === 'strain' ? 1 : 0, val = key === 'steps' ? k(x.now) : x.now.toFixed(dp);
      let delta = '';
      if (x.prev != null && x.prev !== 0) {
        const ch = x.now - x.prev, pct = Math.round(ch / Math.abs(x.prev) * 100), up = ch > 0;
        const good = better == null ? null : (better === 'up') === up;
        delta = '<span class="delta' + (Math.abs(pct) < 3 ? '' : good === true ? ' good' : good === false ? ' bad' : '') + '">' + (Math.abs(pct) < 3 ? 'steady' : (up ? '▲ ' : '▼ ') + Math.abs(pct) + '%') + '</span>';
      }
      return '<div class="tr"><span class="trn">' + name + '</span><b>' + val + '<small>' + u + '</small></b>' + delta + spark(x.spark, col) + '</div>';
    }).join('');

    // insights
    const ins = CH.insights(days, sc, ctx.isCheat, ctx.isDone, ctx.sessions);
    $('bdInsights').innerHTML = ins.length ? ins.slice(0, 5).map(i => '<li>' + esc(i.text) + '</li>').join('') : '<li class="muted">Patterns appear once there are a few days to compare, for example 3 cheat days and 3 clean days with watch data. Importing your Apple Health history speeds this up.</li>';

    // data sources
    const src = [];
    src.push(ctx.lastWatch ? ['ok', 'Nightly watch sync', 'Last ' + ctx.ago(ctx.lastWatch)] : ['todo', 'Nightly watch sync', 'Not set up yet', 'watchCard', 'Set up']);
    src.push(ctx.morningSync ? ['ok', 'Morning sync', 'Running, so today\'s recovery is ready each morning'] : ['todo', 'Morning sync', 'Add a 09:00 automation so recovery is ready each morning', 'watchCard', 'How']);
    const imp = ctx.lastImport, stale = imp && (Date.now() - Date.parse(imp)) > 8 * 864e5;
    src.push(imp ? [stale ? 'todo' : 'ok', 'Apple Health history', 'Imported ' + ctx.ago(imp) + (stale ? '. Refresh for the latest sleep stages and heart-rate strain' : ''), stale ? 'impCard' : null, 'Refresh'] : ['todo', 'Apple Health history', 'Not imported yet: adds sleep stages, workouts and heart-rate strain', 'impCard', 'Import']);
    $('bdSources').innerHTML = src.map(([st, name, txt, go, btn]) => '<li class="' + st + '"><div><b>' + esc(name) + '</b><span>' + esc(txt) + '</span></div>' + (go ? '<button type="button" class="btn" data-goto="' + go + '">' + esc(btn) + '</button>' : '<span class="tick" aria-label="Done">✓</span>') + '</li>').join('');
  }

  window.CutBody = { render };
})();
