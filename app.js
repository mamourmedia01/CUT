// Cut Log app logic.
(function () {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const idOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseId = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const diff = (a, b) => Math.round((parseId(idOf(b)) - parseId(idOf(a))) / 86400000);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmt = d => d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  const kfmt = n => Math.round(n).toLocaleString('en-GB');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SHAKE = '<svg class="shake" viewBox="0 0 20 26" aria-hidden="true"><path d="M6 0h8v4l2 3v17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7l2-3z"/></svg>';

  const PLAN_DEFAULT = { start: '2026-10-14', startWeight: 102, goal: 85, markWeeks: 6, proteinAnchor: '2026-10-25', proteinEvery: 3, proteinKcal: 600, baseBurn: 2400, sessionKcal: 1000, kcalPerKg: 7700, shake: '5 scoops in 500 ml water', autoHour: 12, bfGoal: 15, waterGoal: 3000 };
  const LEVELS = [[0, 'Rookie'], [400, 'Starter'], [1000, 'Grinder'], [2000, 'Machine'], [3500, 'Warrior'], [5500, 'Beast'], [8000, 'Shredded'], [11000, 'Legend']];
  const BADGES = [
    { m: '1', name: 'First Step', desc: 'First completed day', test: s => s.done >= 1 },
    { m: '7', name: 'Full Week', desc: '7-day cut streak', test: s => s.best >= 7 },
    { m: '10', name: 'Boss Slayer', desc: 'Beat a ten-day boss', test: s => s.bosses >= 1 },
    { m: '14', name: 'Fortnight', desc: '14-day cut streak', test: s => s.best >= 14 },
    { m: '42', name: 'Six Weeks', desc: '42 completed days', test: s => s.done >= 42 },
    { m: '↺', name: 'Comeback Kid', desc: 'Completed day after a cheat', test: s => s.comebacks >= 1 },
    { m: '×2', name: 'Double Trouble', desc: '10 double-session days', test: s => s.doubles >= 10 },
    { m: 'PB', name: 'Record Breaker', desc: 'Beat a personal best', test: s => s.pbs >= 1 },
    { m: '4', name: 'Tape Check', desc: '4 Sunday waist check-ins', test: s => s.checkins >= 4 },
    { m: '85', name: '85 Club', desc: 'Reach your goal weight', test: s => s.est <= plan().goal },
    { m: '7', name: 'Locked In', desc: '7-day testosterone streak', t: true, test: s => s.teeBest >= 7 },
    { m: '30', name: 'Iron Will', desc: '30-day testosterone streak', t: true, test: s => s.teeBest >= 30 }
  ];

  const plan = () => Store.plan;
  const SW_V = (document.querySelector('script[src^="app.js?v="]') || { getAttribute: () => '' }).getAttribute('src').split('v=')[1] || '0';
  const days = () => Store.days;
  let today = new Date();
  let viewY = today.getFullYear(), viewM = today.getMonth();
  let sel = idOf(today);
  let last = null;
  let mode = 'day'; try { const m = localStorage.getItem('cutlog-mode'); if (m === 'day' || m === 'gym' || m === 'details') mode = m; } catch (e) {}

  const rec = id => Object.assign({ lifts: null, water: null, salt: false, meals: null, mark: null, broken: false, am: false, pm: false, weight: null, waist: null, curl: null, chest: null, protein: null, gymKcal: null, food: null, health: null }, days()[id] || {});
  const H = (r, k) => (r.health && typeof r.health[k] === 'number') ? r.health[k] : null;
  const userSess = r => (r.am ? 1 : 0) + (r.pm ? 1 : 0);
  // Watch sessions: real workouts (Health import) if known, else from Exercise Minutes (20+ = 1 session, 90+ = 2).
  const watchSess = r => {
    if (userSess(r) || r.noGym) return 0; // noGym: you said no session, whatever the watch thinks
    const w = H(r, 'workouts'); if (w != null) return Math.min(2, Math.round(w));
    const ex = H(r, 'exercise_min'); return ex == null ? 0 : ex >= 90 ? 2 : ex >= 20 ? 1 : 0;
  };
  const sessOf = r => userSess(r) || watchSess(r);
  const weightOf = r => r.weight != null ? r.weight : H(r, 'weight_kg');

  // ---------- protein schedule ----------
  function proteinMap() {
    const p = plan(), out = {}, s = parseId(p.start), a = parseId(p.proteinAnchor);
    const from = s < a ? s : a, until = addDays(today, 75);
    let lastPoint = null;
    for (let d = new Date(from); d <= until; d = addDays(d, 1)) {
      const id = idOf(d), o = (days()[id] || {}).protein;
      if (d < a) { if (o === true) out[id] = { taken: true, status: 'moved' }; continue; }
      const due = lastPoint === null ? id === p.proteinAnchor : diff(lastPoint, d) >= p.proteinEvery;
      if (o === true) { out[id] = { taken: true, status: due ? 'scheduled' : 'moved' }; lastPoint = d; }
      else if (o === false) { if (due) { out[id] = { taken: false, status: 'skipped' }; lastPoint = d; } }
      else if (due) { out[id] = { taken: true, status: 'scheduled' }; lastPoint = d; }
    }
    return out;
  }

  // ---------- energy ----------
  function energy(id, r, prot) {
    const p = plan(), sess = sessOf(r);
    if (!r.mark && !sess && r.food == null && r.gymKcal == null && !(Array.isArray(r.meals) && r.meals.length)) return null;
    const active = H(r, 'active_kcal');
    const gym = r.gymKcal != null ? r.gymKcal : (active != null ? active : sess * p.sessionKcal);
    const rest = H(r, 'resting_kcal') != null ? H(r, 'resting_kcal') : p.baseBurn;
    const taken = !!(prot[id] && prot[id].taken);
    const meals = Array.isArray(r.meals) && r.meals.length ? r.meals.reduce((a, m) => a + (+m.k || 0), 0) : null;
    const food = r.food != null ? r.food : meals != null ? meals + (taken ? p.proteinKcal : 0) : (r.mark === 'cheat' ? rest : (taken ? p.proteinKcal : 0));
    const burn = rest + gym, deficit = burn - food;
    return { burn, gym, rest, food, foodAuto: r.food == null && meals == null, meals, gymSrc: r.gymKcal != null ? 'you' : (active != null ? 'watch' : 'auto'), restSrc: H(r, 'resting_kcal') != null ? 'watch' : 'auto', deficit, kg: deficit / p.kcalPerKg, protein: taken };
  }

  // ---------- main computation ----------
  function compute() {
    const p = plan(), s = parseId(p.start), tId = idOf(today), prot = proteinMap();
    let run = 0, best = 0, done = 0, cheats = 0, xp = 0, tee = 0, teeBest = 0, bosses = 0, comebacks = 0, doubles = 0, sessions = 0, pbs = 0, checkins = 0;
    let est = p.startWeight, lastWeigh = null, prevMark = null;
    let bestCurl = null, bestChest = null, bestCurlD = null, bestChestD = null, lastCurl = null, lastChest = null;
    const perDay = {}, bossAt = {}, weighIns = [];
    for (let d = new Date(s); d <= today; d = addDays(d, 1)) {
      const id = idOf(d), r = rec(id); let x = 0;
      if (r.mark === 'done') {
        run++; done++; x += 100 + Math.min(run - 1, 10) * 10;
        if (prevMark === 'cheat') { x += 50; comebacks++; }
        if (run % 10 === 0) { x += 500; bosses++; bossAt[id] = true; }
      } else if (r.mark === 'cheat') { run = 0; cheats++; }
      else if (id !== tId) run = 0;
      best = Math.max(best, run);
      if (r.broken) tee = 0; else { tee++; x += 20; }
      teeBest = Math.max(teeBest, tee);
      const c = sessOf(r); sessions += c; x += c * 30; if (c === 2) { x += 50; doubles++; }
      if (r.waist != null && d.getDay() === 0) { x += 50; checkins++; }
      if (r.curl != null) { lastCurl = r.curl; if (bestCurl != null && r.curl > bestCurl) { x += 75; pbs++; } if (bestCurl == null || r.curl > bestCurl) { bestCurl = r.curl; bestCurlD = id; } }
      if (r.chest != null) { lastChest = r.chest; if (bestChest != null && r.chest > bestChest) { x += 75; pbs++; } if (bestChest == null || r.chest > bestChest) { bestChest = r.chest; bestChestD = id; } }
      const w = weightOf(r);
      if (w != null) { est = w; lastWeigh = id; weighIns.push({ id, w }); }
      const morning = est, en = energy(id, r, prot); if (en) est -= en.kg;
      perDay[id] = { xp: x, est, morning };
      xp += x; prevMark = r.mark;
    }
    let li = 0; LEVELS.forEach((l, i) => { if (xp >= l[0]) li = i; });
    const estNow = perDay[tId] ? perDay[tId].morning : est;
    return { run, best, done, cheats, xp, tee, teeBest, bosses, comebacks, doubles, sessions, pbs, checkins, est: estNow, tomorrow: est, lastWeigh, bestCurl, bestChest, bestCurlD, bestChestD, lastCurl, lastChest, perDay, bossAt, li, prot, weighIns };
  }

  // ---------- render: home ----------
  function renderHome(st) {
    const p = plan(), s = parseId(p.start), n = Math.max(0, diff(s, today) + 1), six = p.markWeeks * 7, sixD = addDays(s, six - 1);
    $('dayOf').innerHTML = n < 1 ? 'Starts <b>' + esc(fmt(s)) + '</b>' : 'Day <b>' + n + '</b>';
    $('dates').textContent = 'Started ' + fmt(s);
    $('goalLabel').textContent = p.startWeight + ' kg to ' + p.goal + ' kg';
    $('trackFill').style.width = Math.min(100, n / six * 100) + '%';
    const toSix = diff(today, sixD);
    $('sixWk').textContent = toSix > 0 ? p.markWeeks + '-week mark ' + fmt(sixD) + ' · ' + toSix + ' days' : (toSix === 0 ? p.markWeeks + '-week mark today' : 'Past ' + p.markWeeks + ' weeks · keep going');

    $('stStreak').textContent = st.run; $('stStreakSub').textContent = 'days in a row · best ' + st.best;
    const f = $('flame'); f.classList.toggle('lit', st.run > 0); f.style.transform = 'scale(' + (0.85 + Math.min(st.run, 21) / 21 * 0.75) + ')';
    $('stTee').textContent = st.tee; $('stTeeSub').textContent = 'days since last break · best ' + st.teeBest;
    const cur = LEVELS[st.li], nxt = LEVELS[st.li + 1];
    $('lvlNum').textContent = 'LV ' + (st.li + 1); $('lvlName').textContent = cur[1];
    if (nxt) { $('xpFill').style.width = ((st.xp - cur[0]) / (nxt[0] - cur[0]) * 100) + '%'; $('xpText').textContent = kfmt(st.xp) + ' XP · ' + kfmt(nxt[0] - st.xp) + ' to ' + nxt[1]; }
    else { $('xpFill').style.width = '100%'; $('xpText').textContent = kfmt(st.xp) + ' XP · max level'; }

    // strength alarm
    const drops = [];
    if (st.bestCurl && st.lastCurl != null && st.lastCurl < st.bestCurl * 0.9) drops.push('curl ' + st.lastCurl + ' kg vs best ' + st.bestCurl);
    if (st.bestChest && st.lastChest != null && st.lastChest < st.bestChest * 0.9) drops.push('chest press ' + st.lastChest + ' kg vs best ' + st.bestChest);
    $('alarm').hidden = !drops.length;
    if (drops.length) $('alarmText').textContent = 'Down more than 10%: ' + drops.join(', ') + '. That usually means muscle is going, not just fat. Take a protein day.';

    // boss
    const into = st.run % 10, hpLeft = 10 - into;
    $('bossLabel').textContent = 'Ten-day boss #' + (st.bosses + 1);
    $('hp').querySelectorAll('i').forEach((el, i) => el.classList.toggle('hit', i < into));
    $('bossLine').textContent = 'Boss HP ' + hpLeft + ' / 10';
    let sub;
    if (st.run >= 10 && st.run < 14) sub = 'Boss down. ' + (14 - st.run) + ' more day' + (14 - st.run > 1 ? 's' : '') + ' to two full weeks.';
    else if (st.run >= 14 && into === 0) sub = 'Another boss down. Next one starts tomorrow.';
    else if (into === 0) sub = 'Complete 10 days in a row to beat it. +500 XP.';
    else sub = hpLeft + ' more day' + (hpLeft > 1 ? 's' : '') + ' to take it down. A cheat day heals it.';
    $('bossSub').textContent = sub;

    // countdown
    const lost = p.startWeight - st.est, left = Math.max(0, st.est - p.goal);
    $('kgTitle').textContent = 'Countdown to ' + p.goal + ' kg';
    $('kgNow').textContent = st.est.toFixed(1);
    $('kgLeft').textContent = left > 0 ? left.toFixed(1) + ' kg to go' : 'Goal reached';
    $('kgFill').style.width = Math.max(0, Math.min(100, lost / (p.startWeight - p.goal) * 100)) + '%';
    $('kgSource').textContent = st.lastWeigh ? 'Weighed ' + fmt(parseId(st.lastWeigh)) : 'Estimate';
    $('kgStartLbl').textContent = p.startWeight + ' kg · ' + fmt(s); $('kgGoalLbl').textContent = p.goal + ' kg';
    const nd = Math.max(0, diff(s, today)), pd = nd > 0 ? lost / nd : 0;
    const dTm = st.est - st.tomorrow;
    $('wake').textContent = st.tomorrow.toFixed(1) + ' kg';
    $('wakeD').textContent = Math.abs(dTm) >= 0.05 ? (dTm > 0 ? '−' : '+') + Math.abs(dTm).toFixed(2) + ' kg overnight' : 'about the same';
    // Sunday weigh-in: this calendar week's Sunday morning (next Sunday if it's Sunday already), at your last 7 days' pace
    const toSun = (7 - today.getDay()) % 7 || 7, sun = addDays(today, toSun);
    const rk = []; for (let i = 1; i <= 7; i++) { const id = idOf(addDays(today, -i)); if (id < p.start) break; const en = energy(id, rec(id), st.prot); if (en) rk.push(en.kg); }
    const pace7 = rk.length >= 3 ? rk.reduce((a, b) => a + b, 0) / rk.length : pd;
    const sunKg = st.tomorrow - Math.max(0, pace7) * (toSun - 1);
    $('wkTgtLbl').textContent = 'Sunday weigh-in';
    $('wkTgt').textContent = sunKg.toFixed(1) + ' kg';
    $('wkTgtD').textContent = sun.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' morning · −' + Math.max(0, st.est - sunKg).toFixed(1) + ' kg from today';
    $('perDay').textContent = pd.toFixed(2); $('perWeek').textContent = (pd * 7).toFixed(1);
    $('eta').textContent = left <= 0 ? 'Done' : (pd > 0.01 ? fmt(addDays(today, Math.ceil(left / pd))) : '–');
  }

  // ---------- render: stats ----------
  function renderStats(st) {
    const p = plan(), s = parseId(p.start);
    $('pbCurl').textContent = st.bestCurl != null ? st.bestCurl + ' kg' : '–';
    $('pbCurlD').textContent = st.bestCurlD ? 'Set ' + fmt(parseId(st.bestCurlD)) : 'Log a top set';
    $('pbChest').textContent = st.bestChest != null ? st.bestChest + ' kg' : '–';
    $('pbChestD').textContent = st.bestChestD ? 'Set ' + fmt(parseId(st.bestChestD)) : 'Log a top set';
    $('pbBoss').textContent = st.bosses;
    $('trophyCount').textContent = st.pbs + ' PB trophies';

    const tb = $('weeks'); tb.textContent = '';
    const totalWeeks = Math.floor(Math.max(0, diff(s, today)) / 7) + 1;
    for (let w = totalWeeks - 1; w >= 0; w--) {
      const ws = addDays(s, w * 7); let dn = 0, ch = 0, gym = 0, x = 0, waist = null, est = null; const dots = [];
      for (let k = 0; k < 7; k++) {
        const d = addDays(ws, k); if (d > today) { dots.push(''); continue; }
        const id = idOf(d), r = rec(id), pdx = st.perDay[id];
        if (r.mark === 'done') { dn++; dots.push('d'); } else if (r.mark === 'cheat') { ch++; dots.push('c'); } else dots.push('');
        gym += sessOf(r); if (pdx) { x += pdx.xp; est = pdx.est; } if (r.waist != null) waist = r.waist;
      }
      const tr = document.createElement('tr'); if (w === totalWeeks - 1) tr.className = 'cur';
      tr.innerHTML = '<td><div class="wk"></div><small></small></td><td><span class="dots"></span><span class="dn"></span></td><td class="ch"></td><td class="gy"></td><td class="wa"></td><td class="we"></td><td class="xp"></td>';
      tr.querySelector('.wk').textContent = 'Week ' + (w + 1);
      tr.querySelector('small').textContent = fmt(ws) + ' – ' + fmt(addDays(ws, 6));
      const dEl = tr.querySelector('.dots'); dots.forEach(c => { const i = document.createElement('i'); if (c) i.className = c; dEl.appendChild(i); });
      tr.querySelector('.dn').textContent = dn + '/7';
      tr.querySelector('.ch').textContent = ch; tr.querySelector('.gy').textContent = gym;
      tr.querySelector('.wa').textContent = waist != null ? waist + ' cm' : '–';
      tr.querySelector('.we').textContent = est != null ? est.toFixed(1) : '–';
      tr.querySelector('.xp').textContent = '+' + x;
      tb.appendChild(tr);
    }
    renderChart(st);
    renderMilestones(st); renderMonths(st); renderStrength();
  }

  // ---------- milestones: every 5 kg, and the goal ----------
  let msData = [];
  function renderMilestones(st) {
    const p = plan(), ids = Object.keys(st.perDay).sort(), out = [];
    const marks = []; for (let k = 5; p.startWeight - k > p.goal + 0.01; k += 5) marks.push({ kg: k, at: p.startWeight - k, label: '−' + k });
    marks.push({ kg: p.startWeight - p.goal, at: p.goal, label: p.goal + '', goal: true });
    const lost = p.startWeight - st.est, nd = Math.max(1, diff(parseId(p.start), today)), pace = lost / nd;
    marks.forEach(m => {
      const hit = ids.find(id => st.perDay[id].morning <= m.at + 1e-9);
      const eta = !hit && pace > 0.01 ? addDays(today, Math.ceil((st.est - m.at) / pace)) : null;
      out.push(Object.assign({}, m, { hit, eta }));
    });
    msData = out;
    const on = out.filter(m => m.hit).length;
    $('msCount').textContent = on + ' / ' + out.length;
    $('msList').innerHTML = out.map((m, i) => '<li class="' + (m.hit ? 'on' : '') + '"><span class="mk">' + esc(m.label) + '<br><small style="font-size:.6rem">KG</small></span><div><b>' + (m.goal ? 'Goal: ' + m.at + ' kg' : m.kg + ' kg down (' + m.at.toFixed(0) + ' kg)') + '</b><span>' +
      (m.hit ? 'Reached ' + fmt(parseId(m.hit)) + ', day ' + (diff(parseId(p.start), parseId(m.hit)) + 1) : m.eta ? 'On pace for ' + fmt(m.eta) : 'Ahead') + '</span></div>' +
      (m.hit ? '<button class="btn" type="button" data-ms="' + i + '">Share</button>' : '') + '</li>').join('');
  }
  $('msList').addEventListener('click', e => { const b = e.target.closest('[data-ms]'); if (b) shareMilestone(msData[+b.dataset.ms]); });
  // a 1080 × 1350 card (Instagram portrait) drawn on the phone
  async function shareMilestone(m) {
    const p = plan(), st = last, prof = Store.profile || {}, name = prof.display_name || (prof.username ? '@' + prof.username : '');
    try { await Promise.all(['800 100px', '700 40px', '600 54px'].map(f => document.fonts.load(f + ' "Barlow Condensed"'))); } catch (e) {}
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 1350); g.addColorStop(0, '#111'); g.addColorStop(1, '#000'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
    x.fillStyle = '#ff6b35'; x.fillRect(80, 120, 120, 14);
    const F = (w, sz) => w + ' ' + sz + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
    x.fillStyle = '#fff'; x.font = F(800, 60); x.fillText('CUT LOG', 80, 100);
    x.fillStyle = '#ff6b35'; x.font = F(800, 300); x.fillText(m.goal ? p.goal + '' : '−' + m.kg, 70, 470);
    x.fillStyle = '#fff'; x.font = F(800, 110); x.fillText(m.goal ? 'KG. GOAL REACHED.' : 'KG DOWN', 80, 600);
    const dayN = diff(parseId(p.start), parseId(m.hit)) + 1;
    x.fillStyle = '#9a9a9a'; x.font = F(600, 54);
    x.fillText(p.startWeight + ' kg → ' + st.perDay[m.hit].morning.toFixed(1) + ' kg in ' + dayN + ' day' + (dayN === 1 ? '' : 's'), 80, 700);
    const tiles = [['Streak', st.best + ' best'], ['Bosses', st.bosses + ''], ['Sessions', st.sessions + '']];
    tiles.forEach((t, i) => { const tx = 80 + i * 320; x.fillStyle = '#1c1c1c'; x.fillRect(tx, 790, 290, 200); x.fillStyle = '#9a9a9a'; x.font = F(700, 40); x.fillText(t[0].toUpperCase(), tx + 30, 850); x.fillStyle = '#fff'; x.font = F(800, 90); x.fillText(t[1], tx + 30, 950); });
    x.fillStyle = '#fff'; x.font = F(800, 64); if (name) x.fillText(name.toUpperCase(), 80, 1150);
    x.fillStyle = '#9a9a9a'; x.font = F(600, 44); x.fillText(fmt(parseId(m.hit)) + ' ' + m.hit.slice(0, 4) + ' · Run on conviction, not hope.', 80, 1220);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'cut-log-' + (m.goal ? 'goal' : m.kg + 'kg') + '.png', { type: 'image/png' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Cut Log' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- monthly report ----------
  function renderMonths(st) {
    const p = plan(), s = parseId(p.start), tb = $('months'); tb.textContent = '';
    const months = []; for (let d = new Date(s.getFullYear(), s.getMonth(), 1); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
    months.reverse().forEach((m0, i) => {
      const from = m0 < s ? s : m0, nextM = new Date(m0.getFullYear(), m0.getMonth() + 1, 1), to = nextM > today ? today : addDays(nextM, -1);
      let dn = 0, ch = 0, gym = 0, n = 0; const rc = [], sl = [];
      for (let d = new Date(from); d <= to; d = addDays(d, 1)) { const id = idOf(d), r = rec(id); n++; if (r.mark === 'done') dn++; if (r.mark === 'cheat') ch++; gym += sessOf(r); const sc = bodyScores[id]; if (sc && sc.recovery != null) rc.push(sc.recovery); if (sc && sc.sleep != null) sl.push(sc.sleep); }
      const a = st.perDay[idOf(from)] ? st.perDay[idOf(from)].morning : p.startWeight, b = nextM > today ? st.est : (st.perDay[idOf(addDays(to, 1))] || st.perDay[idOf(to)] || {}).morning;
      const avg = x => x.reduce((q, v) => q + v, 0) / x.length;
      const tr = document.createElement('tr'); if (!i) tr.className = 'cur';
      tr.innerHTML = '<td><div class="wk"></div><small></small></td><td></td><td></td><td></td><td></td><td></td>';
      tr.querySelector('.wk').textContent = MONTHS[m0.getMonth()].slice(0, 3) + ' ' + String(m0.getFullYear()).slice(2);
      tr.querySelector('small').textContent = fmt(from) + ' – ' + fmt(to);
      const td = tr.querySelectorAll('td');
      td[1].textContent = dn + '/' + n + (ch ? ' · ' + ch + '✕' : '');
      td[2].textContent = gym;
      td[3].textContent = b != null ? (a - b >= 0 ? '−' : '+') + Math.abs(a - b).toFixed(1) + ' kg' : '–';
      td[4].textContent = rc.length ? Math.round(avg(rc)) + '%' : '–';
      td[5].textContent = sl.length ? avg(sl).toFixed(1) + ' h' : '–';
      tb.appendChild(tr);
    });
  }

  function renderChart(st) {
    const p = plan(), s = parseId(p.start);
    const ids = Object.keys(st.perDay).sort();
    const W = 340, Hh = 190, L = 34, R = 10, T = 10, B = 24;
    const pts = [{ id: p.start, v: p.startWeight }].concat(ids.map(id => ({ id: idOf(addDays(parseId(id), 1)), v: st.perDay[id].est })));
    const maxDay = Math.max(diff(s, today) + 1, 7);
    const vals = pts.map(q => q.v).concat(st.weighIns.map(q => q.w), [p.goal, p.startWeight]);
    let lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
    const x = id => L + (diff(s, parseId(id)) / maxDay) * (W - L - R);
    const y = v => T + (hi - v) / (hi - lo) * (Hh - T - B);
    const step = (hi - lo) > 12 ? 4 : 2;
    let g = '';
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    const xt = [[p.start, fmt(s)], [idOf(today), 'Today']];
    xt.forEach(([id, lab], i) => { g += '<text x="' + x(id) + '" y="' + (Hh - 6) + '" text-anchor="' + (i ? 'end' : 'start') + '">' + esc(lab) + '</text>'; });
    g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(p.goal) + '" y2="' + y(p.goal) + '" stroke="var(--done)" stroke-width="2" stroke-dasharray="5 4"/>';
    const path = pts.filter(q => diff(s, parseId(q.id)) <= maxDay).map((q, i) => (i ? 'L' : 'M') + x(q.id).toFixed(1) + ' ' + y(q.v).toFixed(1)).join(' ');
    g += '<path d="' + path + '" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    st.weighIns.forEach(q => { g += '<circle cx="' + x(q.id) + '" cy="' + y(q.w) + '" r="4.5" fill="var(--blue)" stroke="var(--surface)" stroke-width="1.5"><title>' + esc(fmt(parseId(q.id)) + ': ' + q.w + ' kg') + '</title></circle>'; });
    const endV = st.tomorrow;
    g += '<circle cx="' + x(idOf(addDays(today, 0))) + '" cy="' + y(st.est) + '" r="4" fill="var(--primary)"/>';
    $('chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Weight estimate from ' + p.startWeight + ' kg to ' + st.est.toFixed(1) + ' kg this morning, goal ' + p.goal + ' kg">' + g + '</svg>';
    $('chartRange').textContent = st.weighIns.length + ' weigh-in' + (st.weighIns.length === 1 ? '' : 's');
    renderBodyFat(p);
    void endV;
  }

  // body fat from the smart scale (Apple Health), toward the body-fat goal
  function renderBodyFat(p) {
    const pts = Object.keys(days()).filter(id => H(rec(id), 'body_fat') != null).sort().map(id => ({ id, v: H(rec(id), 'body_fat'), lean: H(rec(id), 'lean_kg'), w: weightOf(rec(id)) }));
    $('bfBox').hidden = !pts.length; $('bfEmpty').hidden = !!pts.length;
    if (!pts.length) return;
    const first = pts[0], last = pts[pts.length - 1], goal = p.bfGoal || 15;
    $('bfNow').textContent = last.v.toFixed(1) + '%';
    $('bfWhen').textContent = 'Scale ' + fmt(parseId(last.id));
    const ch = last.v - first.v;
    $('bfSub').textContent = pts.length > 1 ? (ch <= 0 ? '−' : '+') + Math.abs(ch).toFixed(1) + ' since ' + fmt(parseId(first.id)) : 'first reading';
    $('bfFill').style.width = Math.max(0, Math.min(100, first.v > goal ? (first.v - last.v) / (first.v - goal) * 100 : 100)) + '%';
    $('bfStart').textContent = first.v.toFixed(1) + '% · ' + fmt(parseId(first.id)); $('bfGoalLbl').textContent = 'under ' + goal + '%';
    const w = last.w != null ? last.w : null, fatKg = w != null ? w * last.v / 100 : null, lean = last.lean != null ? last.lean : (w != null ? w - fatKg : null);
    // weight you'd be at the goal body fat, keeping today's lean mass
    const atGoal = lean != null ? lean / (1 - goal / 100) : null;
    $('bfTiles').innerHTML = '<div><b>' + (fatKg != null ? fatKg.toFixed(1) : '–') + '</b><span>kg of fat</span></div><div><b>' + (lean != null ? lean.toFixed(1) : '–') + '</b><span>kg lean mass</span></div><div><b>' + (atGoal != null ? atGoal.toFixed(1) : '–') + '</b><span>kg at ' + goal + '% (same muscle)</span></div>';
  }

  // ---------- render: badges ----------
  function renderBadges(st) {
    const bg = $('bgrid'); bg.textContent = ''; let on = 0;
    BADGES.forEach(b => {
      const got = b.test(st); if (got) on++;
      const el = document.createElement('div'); el.className = 'badge' + (got ? ' on' : '') + (b.t ? ' t' : '');
      el.innerHTML = '<div class="medal"></div><b></b><small></small>';
      el.querySelector('.medal').textContent = b.m; el.querySelector('b').textContent = b.name; el.querySelector('small').textContent = b.desc;
      el.setAttribute('aria-label', b.name + ', ' + b.desc + (got ? ', unlocked' : ', locked'));
      bg.appendChild(el);
    });
    $('badgeCount').textContent = on + ' / ' + BADGES.length;
  }

  // ---------- render: calendar ----------
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(t => { const e = document.createElement('div'); e.className = 'dow'; e.textContent = t; $('dow').appendChild(e); });
  for (let i = 0; i < 10; i++) $('hp').appendChild(document.createElement('i'));

  function renderCal(st) {
    const p = plan();
    $('monthTitle').textContent = MONTHS[viewM] + ' ' + viewY;
    const s = parseId(p.start), sixD = addDays(s, p.markWeeks * 7 - 1), tId = idOf(today);
    $('prev').disabled = viewY * 12 + viewM <= s.getFullYear() * 12 + s.getMonth();
    $('next').disabled = viewY * 12 + viewM >= today.getFullYear() * 12 + today.getMonth() + 2;
    const g = $('grid'); g.textContent = '';
    const lead = (new Date(viewY, viewM, 1).getDay() + 6) % 7, n = new Date(viewY, viewM + 1, 0).getDate();
    for (let i = 0; i < lead; i++) { const b = document.createElement('div'); b.className = 'cell blank'; g.appendChild(b); }
    for (let d = 1; d <= n; d++) {
      const dt = new Date(viewY, viewM, d), id = idOf(dt), r = rec(id);
      const c = document.createElement('button'); c.type = 'button'; c.className = 'cell'; c.dataset.id = id;
      const before = dt < s, future = id > tId;
      if (before) c.classList.add('out'); else if (future) c.classList.add('future');
      if (id === tId) c.classList.add('today');
      if (id === sel) c.classList.add('sel');
      if (r.mark) c.classList.add(r.mark);
      c.innerHTML = '<span class="ring"></span><span class="d"></span>';
      c.querySelector('.d').textContent = d;
      if (id === p.start) c.insertAdjacentHTML('beforeend', '<span class="tag">START</span>');
      else if (id === idOf(sixD)) c.insertAdjacentHTML('beforeend', '<span class="tag">' + p.markWeeks + ' WK</span>');
      else if (st.bossAt[id]) c.insertAdjacentHTML('beforeend', '<svg class="ccrown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z"/></svg>');
      if (r.broken) c.insertAdjacentHTML('beforeend', '<span class="brk"></span>');
      const pr = st.prot[id], hasP = !!(pr && pr.taken); if (hasP) c.insertAdjacentHTML('beforeend', SHAKE);
      const cnt = sessOf(r), fromWatch = !userSess(r) && cnt > 0;
      if (cnt) { const pp = document.createElement('span'); pp.className = 'pips'; for (let k = 0; k < cnt; k++) { const i = document.createElement('i'); if (fromWatch) i.className = 'w'; pp.appendChild(i); } c.appendChild(pp); }
      const usable = !before && !future;
      if (!usable) c.disabled = true;
      c.setAttribute('aria-label', dt.toDateString() + (r.mark === 'done' ? ', completed' : r.mark === 'cheat' ? ', cheat day' : '') + (r.broken ? ', testosterone streak broken' : '') + (cnt ? ', ' + cnt + ' gym session' + (cnt > 1 ? 's' : '') + (fromWatch ? ' from watch' : '') : '') + (hasP ? (future ? ', protein day due' : ', protein day') : '') + (st.bossAt[id] ? ', boss beaten' : ''));
      g.appendChild(c);
    }
  }

  // ---------- render: day sheet ----------
  function setSeg(el, on) { el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', on[b.dataset.v] ? 'true' : 'false')); }
  function renderSheet(st) {
    const p = plan(), dt = parseId(sel), r = rec(sel), tId = idOf(today);
    $('selTitle').textContent = (sel === tId ? 'Today · ' : '') + dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const sunday = dt.getDay() === 0;
    $('selSub').innerHTML = sunday ? 'Weekly check-in day <span class="chip">+50 XP</span>' : '';
    $('waistField').classList.toggle('hl', sunday && r.waist == null);
    setSeg($('segMark'), { done: r.mark === 'done', cheat: r.mark === 'cheat', broken: r.broken });
    $('autoNote').hidden = !(r.auto && r.mark === 'done');
    const gn = sessOf(r), fromW = !userSess(r) && gn > 0;
    $('gymBtn').dataset.n = gn; $('gymBtn').setAttribute('aria-pressed', String(gn > 0));
    $('gymTxt').textContent = gn === 2 ? 'Double session' : gn === 1 ? '1 session' : 'No session';
    $('gymSub').textContent = (fromW ? 'From your Apple Watch. ' : '') + (gn === 0 ? 'Tap once for 1 session, twice for a double' : gn === 1 ? 'Tap again for a double' : 'Tap again to clear');
    const ws = watchSess(r);
    $('watchNote').hidden = !ws && !r.health;
    if (r.health) $('watchNote').textContent = ws ? 'Apple Watch logged ' + ws + ' workout' + (ws > 1 ? 's' : '') + '. Tap a session to set it yourself.' : 'Apple Watch data synced for this day.';
    [['fWeight', 'weight'], ['fWaist', 'waist'], ['fCurl', 'curl'], ['fChest', 'chest'], ['fGym', 'gymKcal'], ['fFood', 'food']].forEach(([i, k]) => { const el = $(i); if (document.activeElement !== el) el.value = r[k] != null ? r[k] : ''; });
    $('fWeight').placeholder = H(r, 'weight_kg') != null ? H(r, 'weight_kg') + ' (scale)' : 'Optional';

    const pr = st.prot[sel], taken = !!(pr && pr.taken);
    setSeg($('segProt'), { protein: taken });
    $('protLabel').textContent = 'Protein · about ' + kfmt(p.proteinKcal) + ' kcal';
    let nextDue = null; for (let d = addDays(dt, 1), k = 0; k < 15; d = addDays(d, 1), k++) { const q = st.prot[idOf(d)]; if (q && q.taken) { nextDue = d; break; } }
    const ndt = nextDue ? ' Next: ' + nextDue.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + '.' : '';
    $('protStatus').textContent = !pr ? 'Not a protein day.' + ndt : pr.status === 'scheduled' ? 'On schedule.' + ndt : pr.status === 'moved' ? 'Moved to this day.' + ndt : 'Skipped, it was due today.' + ndt;

    const en = energy(sel, r, st.prot), sess = sessOf(r);
    $('fGym').placeholder = H(r, 'active_kcal') != null ? kfmt(H(r, 'active_kcal')) + ' (watch)' : (sess ? kfmt(sess * p.sessionKcal) + ' (auto)' : kfmt(p.sessionKcal) + ' a session');
    $('fFood').placeholder = en && en.meals != null ? kfmt(en.food) + ' (meals)' : (r.mark === 'cheat' ? kfmt(en ? en.rest : p.baseBurn) : (taken ? kfmt(p.proteinKcal) : '0')) + ' (auto)';
    renderMeals(r); renderWater($('sheetWater'), sel); renderLifts(r);
    const e = $('energy');
    const extra = [];
    if (H(r, 'steps') != null) extra.push(kfmt(H(r, 'steps')) + ' steps');
    if (H(r, 'sleep_h') != null) extra.push(H(r, 'sleep_h').toFixed(1) + ' h sleep');
    if (!en) e.innerHTML = '<span class="wide">Mark the day or log a session to count it toward your weight.' + (extra.length ? ' Watch: ' + esc(extra.join(' · ')) + '.' : '') + '</span>';
    else {
      e.innerHTML = '<span>Burned <b></b></span><span>Eaten <b></b></span><span>Deficit <b></b></span><span>Next morning <b></b></span>' + (extra.length ? '<span class="wide"></span>' : '');
      const bs = e.querySelectorAll('b');
      bs[0].textContent = kfmt(en.burn); bs[1].textContent = kfmt(en.food) + (en.foodAuto ? ' est.' : ''); bs[2].textContent = kfmt(en.deficit);
      bs[3].textContent = (en.kg >= 0 ? '−' : '+') + Math.abs(en.kg).toFixed(2) + ' kg';
      if (extra.length) e.querySelector('.wide').textContent = 'From your watch: ' + extra.join(' · ') + (en.restSrc === 'watch' ? ' · resting ' + kfmt(en.rest) + ' kcal' : '');
    }
    $('energyNote').textContent = 'Each day burns about ' + kfmt(p.baseBurn) + ' kcal at rest plus ' + kfmt(p.sessionKcal) + ' a gym session, unless your watch or you give the real number. Food counts automatically: nothing on water days, about ' + kfmt(p.proteinKcal) + ' on protein days, a full day’s worth on cheat days. The gap shows on the scale next morning, at ' + kfmt(p.kcalPerKg) + ' kcal per kg. A weigh-in replaces the estimate.';
    $('dPrev').disabled = sel <= p.start;
    $('dNext').disabled = sel >= tId;
  }

  function render() {
    bodyScores = window.CutHealth ? CutHealth.compute(days()) : {};
    last = compute();
    renderHome(last); renderCal(last); renderSheet(last); renderStats(last); renderBadges(last);
    renderWatchToday(); renderSafe(); renderSetup(); renderBody(); renderToday(last); renderWeek(last);
  }
  // ---------- Home: what today needs (mostly nothing: Autopilot has it) ----------
  const IC = {
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    auto: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/>',
    cheat: '<path d="M6 6l12 12M18 6L6 18"/>',
    shake: '<path d="M9 3h6v3l2 3v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9l2-3z"/>',
    scale: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.5a4 4 0 0 1 6 0M12 9.5l1.2-1.5"/>',
    watch: '<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3M12 10v2.2l1.4 1"/>',
    log: '<path d="M7 4h10v16H7z"/><path d="M10 9h4M10 13h4"/>',
    lift: '<path d="M3 12h18M6 8v8M18 8v8M3 10v4M21 10v4"/>'
  };
  const dayName = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  let agendaActs = {};
  function renderToday(st) {
    const p = plan(), tId = idOf(today), yId = idOf(addDays(today, -1)), r = rec(tId), y = rec(yId);
    const prof = Store.profile || {}, name = prof.display_name || (prof.username ? '@' + prof.username : '');
    const h = new Date().getHours();
    const hi = h < 5 ? 'Late one' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
    $('hello').textContent = hi + (name ? ', ' + name : '');
    const nm = prof.display_name || prof.username || '';
    $('meChip').hidden = !Store.user; $('meInit').textContent = nm ? nm.replace(/^@/, '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) : '•';
    $('meChip').title = prof.display_name ? prof.display_name + (prof.username ? ' (@' + prof.username + ')' : '') : (prof.username ? '@' + prof.username : 'Your profile');
    $('badgeTitle').textContent = prof.display_name ? prof.display_name.split(/\s+/)[0] + '’s badges' : 'Badges';
    $('todayDate').textContent = dayName(today);
    const autoOn = p.autopilot !== false && !!Store.user, started = tId >= p.start, items = []; agendaActs = {};
    const hm = String(p.autoHour != null ? p.autoHour : 12).padStart(2, '0') + ':00';
    if (started) {
      if (r.mark === 'done') items.push(['ok', IC.ok, 'Today is locked in', 'Streak ' + st.run + (r.auto ? ' · by Autopilot' : '')]);
      else if (r.mark === 'cheat') items.push(['warn', IC.cheat, 'Cheat day logged', 'Reset tomorrow. The boss heals, the streak restarts.', 'Undo', () => setMark(tId, null)]);
      else if (autoOn) items.push(['auto', IC.auto, 'Autopilot has today', 'Completes at ' + hm + ' tomorrow. Only a cheat needs a tap.', 'Cheat day', () => setMark(tId, 'cheat')]);
      else items.push(['', IC.log, 'Log today', st.run ? 'Make it ' + (st.run + 1) + ' in a row.' : 'Start the run.', 'Complete', () => setMark(tId, 'done')]);
      if (y.auto && y.mark === 'done' && yId >= p.start) items.push(['', IC.auto, 'Yesterday auto-completed', 'Was it a cheat day?', 'Mark cheat', () => setMark(yId, 'cheat')]);
    }
    if (started && window.CutHealth && CutHealth.train) {
      const tp = CutHealth.train(bodyScores[tId] || {});
      items.push([tp.key === 'green' ? 'ok' : tp.key === 'red' ? 'warn' : 'prot', IC.lift, 'Training: ' + tp.name, 'Strain target ' + tp.lo + '–' + tp.hi + (tp.strain != null ? ' · now ' + tp.strain.toFixed(1) + (tp.status === 'hit' ? ', target reached' : tp.status === 'over' ? ', over' : '') : ' · ' + tp.am[0]), 'Plan', () => show('body')]);
    }
    const pr = st.prot[tId];
    const next = Object.keys(st.prot).filter(id => id > tId && st.prot[id].taken).sort()[0];
    if (pr && pr.taken) items.push(['prot', IC.shake, 'Protein day', (p.shake ? p.shake + ' · ' : '') + 'about ' + kfmt(p.proteinKcal) + ' kcal', pr.status === 'scheduled' && r.protein == null ? 'Skip' : null, () => change(tId, x => { x.protein = false; }, 'Shake skipped')]);
    else if (pr && !pr.taken) items.push(['', IC.shake, 'Shake skipped today', next ? 'Next ' + dayName(parseId(next)) : '', 'Undo', () => change(tId, x => { x.protein = null; }, 'Protein day back on')]);
    else if (next) items.push(['', IC.shake, 'Water day', 'Next shake ' + dayName(parseId(next))]);
    if (today.getDay() === 0 && started) {
      const doneSun = r.waist != null;
      items.push([doneSun ? 'ok' : 'blue', doneSun ? IC.ok : IC.scale, 'Sunday check-in', doneSun ? 'Waist logged · +50 XP' : 'Weigh in, waist (+50 XP) and this week’s photo', doneSun ? null : 'Open', () => { sel = tId; show('log'); setTimeout(() => { const f = $('fWaist'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } }, 80); }]);
    }
    const lw = watchLast();
    if (lw && Date.now() - Date.parse(lw) > 36 * 3600e3) items.push(['warn', IC.watch, 'Watch sync paused', 'Nothing since ' + ago(lw) + '. Run the Shortcut once.', 'Sync', () => { location.href = 'shortcuts://run-shortcut?name=Cut%20Log%20Sync'; }]);
    $('agenda').innerHTML = items.map(([c, ic, t, sub, btn], i) => { if (btn) agendaActs[i] = items[i][5];
      return '<li><span class="ic ' + c + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ic + '</svg></span><div><b>' + esc(t) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>' + (btn ? '<button class="btn" type="button" data-ag="' + i + '">' + esc(btn) + '</button>' : '') + '</li>'; }).join('');
    $('todayCard').hidden = false;
    renderWater($('homeWater'), tId);
  }
  // a <label for=mealInput>: the iPhone opens the camera/library itself; we just move to today's Log
  $('homeMeal').addEventListener('click', () => { sel = idOf(today); show('log'); render(); });
  $('homeBody').addEventListener('click', () => show('body'));
  $('meChip').addEventListener('click', () => { show('settings'); setTimeout(() => { $('acct').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); });
  $('agenda').addEventListener('click', e => { const b = e.target.closest('[data-ag]'); if (b && agendaActs[b.dataset.ag]) agendaActs[b.dataset.ag](); });

  // ---------- Home: last 7 days (the same numbers as the Sunday brief) ----------
  function renderWeek(st) {
    const ids = [], prev = []; for (let i = 6; i >= 0; i--) ids.push(idOf(addDays(today, -i))); for (let i = 13; i >= 7; i--) prev.push(idOf(addDays(today, -i)));
    const p = plan(), inCut = ids.filter(id => id >= p.start);
    if (!inCut.length) { $('weekCard').hidden = true; return; }
    let done = 0, cheats = 0, sess = 0, kg = 0, shakes = 0, act = 0;
    inCut.forEach(id => { const r = rec(id); if (r.mark === 'done') done++; if (r.mark === 'cheat') cheats++; sess += sessOf(r); if (st.prot[id] && st.prot[id].taken) shakes++; const en = energy(id, r, st.prot); if (en) kg += en.kg; const a = H(r, 'active_kcal'); if (a != null) act += a; });
    const avg = (list, f) => { const v = list.map(id => bodyScores[id] && bodyScores[id][f]).filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const rc = avg(ids, 'recovery'), rcP = avg(prev, 'recovery'), sl = avg(ids, 'sleep'), slP = avg(prev, 'sleep'), hv = avg(ids, 'hrv'), hvP = avg(prev, 'hrv');
    const delta = (a, b, dp, unit) => a == null || b == null ? '' : '<i class="' + (a - b >= 0 ? 'up' : 'down') + '">' + (a - b >= 0 ? '▲ ' : '▼ ') + Math.abs(a - b).toFixed(dp) + (unit || '') + '</i>';
    const tile = (v, lbl, extra) => '<div><b>' + v + '</b><span>' + lbl + '</span>' + (extra || '') + '</div>';
    $('wkGrid').innerHTML =
      tile(done + '<small style="font-size:.8rem;color:var(--muted)">/' + inCut.length + '</small>', 'days completed', cheats ? '<i class="down">' + cheats + ' cheat' + (cheats > 1 ? 's' : '') + '</i>' : '') +
      tile(sess, 'gym sessions', act ? '<i>' + kfmt(act) + ' kcal</i>' : '') +
      tile((kg >= 0 ? '−' : '+') + Math.abs(kg).toFixed(1), 'kg (estimate)') +
      tile(rc != null ? Math.round(rc) + '%' : '–', 'recovery', delta(rc, rcP, 0)) +
      tile(sl != null ? sl.toFixed(1) : '–', 'h sleep', delta(sl, slP, 1, ' h')) +
      tile(hv != null ? Math.round(hv) : '–', 'ms HRV', delta(hv, hvP, 0));
    const next = Object.keys(st.prot).filter(id => id > idOf(today) && st.prot[id].taken).sort()[0];
    const wl = inCut.map(id => rec(id).water).filter(v => v), wavg = wl.length ? wl.reduce((a, b) => a + b, 0) / wl.length : null;
    $('wkLine').textContent = shakes + ' protein shake' + (shakes === 1 ? '' : 's') + ' this week' + (next ? ' · next ' + dayName(parseId(next)) : '') + (wavg ? ' · water ' + L(Math.round(wavg / 50) * 50) + ' L a day on ' + wl.length + ' day' + (wl.length > 1 ? 's' : '') : '') + '. Arrows compare with the week before.';
    $('wkRange').textContent = fmt(parseId(inCut[0])) + ' – ' + fmt(today);
    $('weekCard').hidden = false;
  }

  // ---------- Body today (Whoop-style) + history ----------
  let bodyScores = {};
  function renderWatchToday() {
    const CH = window.CutHealth, tId = idOf(today), yId = idOf(addDays(today, -1));
    const pick = [tId, yId].find(id => days()[id] && days()[id].health);
    $('bodyToday').hidden = !CH || !pick;
    renderBodyHist();
    if (!CH || !pick) return;
    const h = days()[pick].health, sc = bodyScores[pick] || {}, lastW = watchLast();
    $('wtWhen').textContent = (pick === tId ? 'Today' : 'Yesterday') + (lastW ? ' · synced ' + ago(lastW) : '');
    const b = CH.band(sc.recovery);
    $('rings').innerHTML =
      CH.ring(sc.recovery != null ? sc.recovery / 100 : null, b ? b.c : 'var(--line)', sc.recovery != null ? sc.recovery + '%' : '–', b ? b.t : (sc.calibrating != null ? 'calibrating' : 'needs HRV'), 'Recovery') +
      CH.ring(sc.strain != null ? sc.strain / 21 : null, 'var(--blue)', sc.strain != null ? sc.strain.toFixed(1) : '–', sc.strain != null ? (sc.strainEst ? 'estimate' : 'of 21') : 'no data', 'Strain') +
      CH.ring(sc.sleepPerf != null ? sc.sleepPerf / 100 : null, 'var(--sleep)', sc.sleepPerf != null ? sc.sleepPerf + '%' : '–', sc.sleep != null ? sc.sleep.toFixed(1) + ' h' : 'no data', 'Sleep');
    const notes = [];
    if (sc.recovery == null && sc.calibrating != null) notes.push('Recovery appears after 7 days of HRV (' + sc.calibrating + ' so far). Import your Apple Health history to start straight away.');
    if (sc.recovery == null && sc.calibrating == null) notes.push('Recovery needs HRV: add Heart Rate Variability to the Shortcut, or import your Apple Health history.');
    if (sc.strainEst) notes.push('Strain is estimated from exercise minutes and steps. Import Apple Health for heart-rate based strain.');
    $('bodyNote').hidden = !notes.length; $('bodyNote').textContent = notes.join(' ');
    const t = (v, lab, sub) => '<div><b>' + v + '</b><span>' + lab + (sub ? ' · ' + sub : '') + '</span></div>';
    $('bodyTiles').innerHTML =
      t(h.hrv_ms != null ? Math.round(h.hrv_ms) : '–', 'HRV ms', sc.hrvNorm ? 'normal ' + sc.hrvNorm : '') +
      t(h.rhr != null ? Math.round(h.rhr) : '–', 'resting HR', sc.rhrNorm ? 'normal ' + sc.rhrNorm : '') +
      t(h.steps != null ? kfmt(h.steps) : '–', 'steps') +
      t(h.active_kcal != null ? kfmt(h.active_kcal) : '–', 'active kcal');
  }
  // ---------- Body tab ----------
  let bdSel = null, bdPicked = false;
  // Body opens on today. Before any watch data arrives today it shows yesterday; never anything older.
  function defaultBodyDay() {
    const t = idOf(today), y = idOf(addDays(today, -1)), has = id => days()[id] && days()[id].health;
    return has(t) || !has(y) ? t : y;
  }
  function lastImport() { let b = null; for (const r of Object.values(days())) { const t = r && r.health && r.health.imported_at; if (t && (!b || t > b)) b = t; } return b; }
  function morningSync() {
    for (let i = 0; i < 7; i++) { const r = days()[idOf(addDays(today, -i))]; const t = r && r.health && r.health.synced_at; if (t) { const hr = new Date(t).getHours(); if (hr >= 5 && hr < 12) return true; } }
    return false;
  }
  function renderBody() {
    if (!window.CutBody || $('tab-body').hidden) return;
    if (!bdPicked || !bdSel || bdSel > idOf(today)) bdSel = defaultBodyDay();
    CutBody.render({
      days: days(), scores: bodyScores, selected: bdSel, today: idOf(today),
      isCheat: id => (days()[id] || {}).mark === 'cheat', isDone: id => (days()[id] || {}).mark === 'done', sessions: id => sessOf(rec(id)),
      lastWatch: watchLast(), lastImport: lastImport(), morningSync: morningSync(), ago
    });
    const th = (days()[idOf(today)] || {}).health || {};
    const fresh = th.hr_latest != null && th.hr_latest_ms && Date.now() - th.hr_latest_ms < 60 * 60000;
    $('bdLive').hidden = !fresh || bdSel !== idOf(today);
    if (fresh) $('bdLive').innerHTML = esc(Math.round(th.hr_latest)) + ' bpm <span>heart rate, ' + esc(ago(new Date(th.hr_latest_ms).toISOString())) + '</span>';
  }
  const shiftDay = n => { const d = addDays(parseId(bdSel || idOf(today)), n); if (idOf(d) <= idOf(today)) { bdSel = idOf(d); bdPicked = bdSel !== idOf(today); renderBody(); } };
  $('bdPrev').addEventListener('click', () => shiftDay(-1));
  $('bdNext').addEventListener('click', () => shiftDay(1));
  $('bdWeek').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b && !b.disabled) { bdSel = b.dataset.day; bdPicked = bdSel !== idOf(today); renderBody(); } });
  // swipe left/right on the hero to change day
  (() => { let x0 = null; const el = $('bdHero'); el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true }); el.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) shiftDay(dx > 0 ? -1 : 1); }); })();
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-goto]'); if (!b) return;
    const id = b.dataset.goto, inSettings = ['impCard', 'watchCard', 'remCard'].includes(id);
    if (inSettings) show('settings', false);
    setTimeout(() => { const el = $(id); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (id === 'watchCard') $('wGuide').open = true; }, 60);
  });
  $('openBody').addEventListener('click', () => show('body'));
  // while Body is on screen, pull new watch data every 20 seconds
  setInterval(() => { if (!$('tab-body').hidden && document.visibilityState === 'visible' && Store.user) Store.sync(); }, 20000);
  // tap a grey word in the Shortcut guide to copy it
  document.addEventListener('click', async e => {
    const k = e.target.closest('.key[data-copy]'); if (!k) return;
    try { await navigator.clipboard.writeText(k.dataset.copy); k.classList.add('copied'); setTimeout(() => k.classList.remove('copied'), 1200); toast('Copied “' + esc(k.dataset.copy) + '”'); }
    catch (err) { toast('Copy didn’t work here: type it instead.'); }
  });
  let bhMetric = 'recovery', bhRange = 30, bhPicked = false;
  try { const j = JSON.parse(localStorage.getItem('cutlog-bh') || 'null'); if (j && j.picked) { bhMetric = j.m || bhMetric; bhRange = j.r != null ? j.r : bhRange; bhPicked = true; } } catch (e) {}
  function renderBodyHist() {
    const CH = window.CutHealth; if (!CH) return;
    const ds = days(), ids = Object.keys(ds).filter(id => ds[id] && ds[id].health);
    $('bodyHist').hidden = false;
    if (!ids.length) {
      $('bhMetric').innerHTML = ''; $('bhBig').textContent = '–'; $('bhUnit').textContent = ''; $('bhDelta').hidden = true; $('bhStats').innerHTML = '';
      $('bhSum').textContent = ''; $('bhChart').innerHTML = '<p class="note">Your trends appear here once your Apple Watch syncs: recovery, sleep, strain, HRV, resting heart rate, steps and weight. Set it up in Settings → Apple Watch, or import your Apple Health history for months of trends at once.</p>';
      return;
    }
    // most important first; only measures that have data
    const ORDER = ['recovery', 'sleep', 'strain', 'hrv', 'rhr', 'weight', 'bodyfat', 'steps', 'active', 'vo2'];
    const has = (k, from) => ids.some(id => (!from || id >= from) && typeof CH.METRICS[k].get(ds[id].health, bodyScores[id]) === 'number');
    const avail = ORDER.filter(k => CH.METRICS[k] && has(k)).concat(Object.keys(CH.METRICS).filter(k => !ORDER.includes(k) && has(k)));
    // default view: the most important measure with data in the last 30 days (until you pick one yourself)
    const d30 = idOf(addDays(today, -29));
    if (!bhPicked || !avail.includes(bhMetric)) { bhMetric = avail.find(k => has(k, d30)) || avail[0]; if (!bhPicked) bhRange = 30; }
    $('bhMetric').innerHTML = avail.map(k => '<button type="button" data-m="' + k + '" aria-pressed="' + (k === bhMetric) + '">' + CH.METRICS[k].name + '</button>').join('');
    // nothing in the chosen period? widen it rather than show an empty chart
    let r = CH.chart($('bhChart'), ds, bodyScores, bhMetric, bhRange, idOf(today)), widened = null;
    for (const rr of [90, 365, 0]) { if (r || (bhRange !== 0 && rr !== 0 && rr <= bhRange)) continue; r = CH.chart($('bhChart'), ds, bodyScores, bhMetric, rr, idOf(today)); if (r) widened = rr; }
    const shownRange = widened != null ? widened : bhRange;
    $('bhRange').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.r === shownRange)));
    const M = CH.METRICS[bhMetric], u = M.unit ? ' ' + M.unit : '';
    const short = id => +id.slice(8, 10) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+id.slice(5, 7) - 1];
    const period = shownRange === 30 ? '30 days' : shownRange === 90 ? '90 days' : shownRange === 365 ? '12 months' : 'all time';
    const dl = $('bhDelta');
    if (!r) { $('bhBig').textContent = '–'; $('bhUnit').textContent = ''; $('bhSum').textContent = M.name + ' · ' + period; dl.hidden = true; $('bhStats').innerHTML = ''; return; }
    $('bhBig').textContent = CH.fmtN(r.avg, r.dp);
    $('bhUnit').textContent = M.unit;
    $('bhSum').textContent = M.name + ' average · ' + (shownRange ? 'last ' + period : 'since ' + short(r.firstId)) + (widened != null ? ' (nothing in the last ' + (bhRange === 30 ? '30 days' : bhRange === 90 ? '90 days' : '12 months') + ')' : '') + ' · ' + r.n + ' day' + (r.n === 1 ? '' : 's') + ' logged';
    if (r.prevAvg != null && r.prevAvg !== 0) {
      const diff = r.avg - r.prevAvg, pct = diff / Math.abs(r.prevAvg) * 100, flat = Math.abs(pct) < 1;
      const good = M.better ? diff * M.better > 0 : null;
      dl.hidden = false;
      dl.className = 'trdelta' + (flat || good == null ? '' : good ? ' up' : ' down');
      dl.textContent = flat ? '— Steady vs prior' : (diff > 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0) + '% vs prior';
      dl.title = 'Previous ' + period + ': ' + CH.fmtN(r.prevAvg, r.dp) + u;
    } else dl.hidden = true;
    const hiLbl = M.better === -1 ? 'Lowest' : 'Best', hiP = M.better === -1 ? r.low : r.best;
    const loLbl = M.better === -1 ? 'Highest' : M.better ? 'Lowest' : 'Low', loP = M.better === -1 ? r.best : r.low;
    const cell = (lbl, v, sub) => '<div><span>' + lbl + '</span><b>' + CH.fmtN(v, r.dp) + '</b><small>' + sub + '</small></div>';
    $('bhStats').innerHTML = cell('Latest', r.last, r.lastId === idOf(today) ? 'Today' : short(r.lastId)) + cell(M.better ? hiLbl : 'High', hiP.v, short(hiP.id)) + cell(loLbl, loP.v, short(loP.id));
  }
  const saveBh = () => { bhPicked = true; try { localStorage.setItem('cutlog-bh', JSON.stringify({ m: bhMetric, r: bhRange, picked: true })); } catch (e) {} };
  $('bhMetric').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; bhMetric = b.dataset.m; saveBh(); renderBodyHist(); });
  $('bhRange').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; bhRange = +b.dataset.r; saveBh(); renderBodyHist(); });

  // ---------- Apple Health history import ----------
  $('impFile').addEventListener('change', () => {
    const f = $('impFile').files[0]; $('impFile').value = ''; if (!f) return;
    let w; try { w = new Worker('health-import-worker.js'); } catch (e) { $('impMsg').textContent = 'This browser can’t run the importer.'; return; }
    $('impBar').hidden = false; $('impFill').style.width = '0%'; $('impStatus').textContent = 'Reading…';
    $('impMsg').textContent = 'Reading ' + (f.size / 1048576).toFixed(0) + ' MB on this phone. Keep the app open.';
    w.onmessage = async ev => {
      const m = ev.data;
      if (m.progress != null) { $('impFill').style.width = Math.round(m.progress * 100) + '%'; if (m.records) $('impMsg').textContent = kfmt(m.records) + ' measurements read…'; return; }
      w.terminate();
      if (m.error) { $('impStatus').textContent = ''; $('impBar').hidden = true; $('impMsg').textContent = m.error; return; }
      const { rows, stats } = m.result;
      if (!rows.length) { $('impStatus').textContent = ''; $('impMsg').textContent = 'No Apple Health data found in that file.'; return; }
      $('impMsg').textContent = 'Saving ' + kfmt(rows.length) + ' days…';
      try {
        const up = await Store.importHealth(rows);
        render();
        $('impStatus').textContent = 'Imported';
        $('impMsg').textContent = 'Done: ' + kfmt(stats.days) + ' days from ' + fmt(parseId(stats.firstDay)) + ' ' + stats.firstDay.slice(0, 4) + ' to ' + fmt(parseId(stats.lastDay)) + ', ' + kfmt(stats.workouts) + ' workouts, ' + kfmt(stats.nights) + ' nights of sleep. ' +
          (up.cloud ? 'Backed up to your database.' : up.pending ? 'Saved on this phone; it uploads when you’re online and signed in.' : 'Saved on this phone.');
      } catch (e) { $('impMsg').textContent = 'Read it, but saving failed: ' + (e.message || e); }
    };
    w.onerror = e => { $('impMsg').textContent = 'The importer stopped: ' + (e.message || 'unknown error'); w.terminate(); };
    w.postMessage({ file: f });
  });

  // ---------- toast + undo ----------
  let tt, undoFn = null;
  function toast(html, undo) {
    $('toastMsg').innerHTML = html; undoFn = undo || null; $('toastUndo').hidden = !undo;
    $('toast').classList.add('show'); clearTimeout(tt); tt = setTimeout(() => { $('toast').classList.remove('show'); undoFn = null; }, undo ? 4500 : 1800);
  }
  $('toastUndo').addEventListener('click', async () => { const f = undoFn; undoFn = null; $('toast').classList.remove('show'); if (f) { await f(); render(); toast('Undone'); } });

  // ---------- changes ----------
  async function change(id, mutate, msg) {
    const before = compute();
    const prevRaw = days()[id] ? JSON.parse(JSON.stringify(days()[id])) : null;
    const r = rec(id); mutate(r);
    const saveRec = Object.assign({}, r); delete saveRec.health;
    await Store.saveDay(id, saveRec);
    render();
    const cell = document.querySelector('.cell[data-id="' + id + '"]'); if (cell) cell.classList.add('pop');
    const after = last, gained = after.xp - before.xp;
    const newB = BADGES.filter(b => b.test(after) && !b.test(before));
    const undo = async () => { const pr = prevRaw ? Object.assign({}, prevRaw) : null; if (pr) delete pr.health; await Store.saveDay(id, pr); };
    if (after.bosses > before.bosses) toast('Boss defeated <span class="x">+500 XP</span>', undo);
    else if (after.li > before.li) toast('Level up · ' + esc(LEVELS[after.li][1]), undo);
    else if (newB.length) toast('Badge unlocked · ' + esc(newB[0].name), undo);
    else if (after.pbs > before.pbs) toast('New personal best <span class="x">+75 XP</span>', undo);
    else if (after.comebacks > before.comebacks) toast('Comeback bonus <span class="x">+' + gained + ' XP</span>', undo);
    else if (gained > 0) toast(esc(msg || 'Logged') + ' <span class="x">+' + gained + ' XP</span>', undo);
    else toast(esc(msg || 'Saved'), undo);
  }

  const markMsg = m => m === 'done' ? 'Day completed' : m === 'cheat' ? 'Cheat day logged' : 'Day cleared';
  function setMark(id, m) { sel = id; change(id, r => { r.mark = m; delete r.auto; }, markMsg(m)); }
  function hold(id) {
    sel = id; try { navigator.vibrate && navigator.vibrate(30); } catch (e) {}
    const nb = !rec(id).broken; change(id, r => { r.broken = nb; }, nb ? 'Testosterone streak reset' : 'Break removed');
  }
  function tap(id) {
    if (mode === 'details') { sel = id; render(); try { $('sheet').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); } catch (e) {} return; }
    if (mode === 'gym') {
      sel = id; const r0 = rec(id), nn = (sessOf(r0) + 1) % 3;
      change(id, r => { r.am = nn >= 1; r.pm = nn >= 2; }, nn === 0 ? 'Sessions cleared' : nn === 1 ? '1 session' : 'Double session'); return;
    }
    const cur = rec(id).mark; setMark(id, cur === null ? 'done' : (cur === 'done' ? 'cheat' : null));
  }

  const HINTS = { day: 'Tap: completed, then cheat, then clear.', gym: 'Tap: 1 session, then double, then clear. Day marks stay as they are.', details: 'Tap a day to open it below without changing anything.' };
  function renderMode() { setSeg($('segMode'), { [mode]: true }); $('modeHint').textContent = HINTS[mode]; }
  $('segMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.v; try { localStorage.setItem('cutlog-mode', mode); } catch (err) {} renderMode(); });

  // calendar pointer: tap vs hold
  const grid = $('grid'); let ht = null, hid = null, held = false, sx = 0, sy = 0;
  function cancelHold() { clearTimeout(ht); ht = null; const c = hid && document.querySelector('.cell[data-id="' + hid + '"]'); if (c) c.classList.remove('holding'); }
  grid.addEventListener('pointerdown', e => {
    const c = e.target.closest('.cell'); if (!c || c.disabled || e.button !== 0) return;
    hid = c.dataset.id; held = false; sx = e.clientX; sy = e.clientY; c.classList.add('holding');
    const id = hid; ht = setTimeout(() => { held = true; ht = null; hold(id); }, 550);
  });
  grid.addEventListener('pointermove', e => { if (ht && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) { cancelHold(); hid = null; } });
  grid.addEventListener('pointerup', () => { if (!hid) return; const id = hid, wasHeld = held; cancelHold(); hid = null; if (!wasHeld) tap(id); });
  grid.addEventListener('pointercancel', () => { cancelHold(); hid = null; });
  grid.addEventListener('pointerleave', () => { if (ht) { cancelHold(); hid = null; } });
  grid.addEventListener('contextmenu', e => { if (e.target.closest('.cell')) e.preventDefault(); });
  grid.addEventListener('keydown', e => {
    const c = e.target.closest('.cell'); if (!c || c.disabled) return; const id = c.dataset.id;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(id); refocus(id); }
    else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); hold(id); refocus(id); }
  });
  function refocus(id) { setTimeout(() => { const c = document.querySelector('.cell[data-id="' + id + '"]'); if (c) c.focus(); }, 0); }

  // day sheet
  $('segMark').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const v = b.dataset.v;
    if (v === 'broken') { hold(sel); return; }
    setMark(sel, rec(sel).mark === v ? null : v); });
  // one button: tap → 1 session, tap again → double, tap again → none (starts from what's shown, watch included)
  $('gymBtn').addEventListener('click', () => {
    const n = (sessOf(rec(sel)) + 1) % 3;
    change(sel, r => { r.am = n >= 1; r.pm = n >= 2; delete r.noGym; if (n === 0 && watchSess(r) > 0) r.noGym = true; }, n === 2 ? 'Double session' : n === 1 ? '1 session' : 'Sessions cleared');
  });
  $('segProt').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
    const pr = last.prot[sel], taken = !!(pr && pr.taken), due = !!(pr && (pr.status === 'scheduled' || pr.status === 'skipped')), nt = !taken;
    change(sel, r => { r.protein = (nt === due) ? null : nt; }, nt ? 'Protein logged' : 'Protein removed'); });
  [['fWeight', 'weight', 'Weigh-in saved'], ['fWaist', 'waist', 'Waist logged'], ['fCurl', 'curl', 'Curl logged'], ['fChest', 'chest', 'Chest press logged'], ['fGym', 'gymKcal', 'Gym calories saved'], ['fFood', 'food', 'Food saved']].forEach(([i, k, msg]) => {
    $(i).addEventListener('change', () => { const v = num($(i).value); if (rec(sel)[k] === v) return; change(sel, r => { r[k] = v; }, v == null ? 'Cleared' : msg); });
  });
  $('dPrev').addEventListener('click', () => { sel = idOf(addDays(parseId(sel), -1)); followSel(); });
  $('dNext').addEventListener('click', () => { sel = idOf(addDays(parseId(sel), 1)); followSel(); });
  function followSel() { const d = parseId(sel); viewY = d.getFullYear(); viewM = d.getMonth(); render(); }
  $('prev').addEventListener('click', () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderCal(last); });
  $('next').addEventListener('click', () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderCal(last); });
  $('ctaLog').addEventListener('click', () => { sel = idOf(today); viewY = today.getFullYear(); viewM = today.getMonth(); render(); show('log'); });

  // ---------- tabs ----------
  const TABS = ['home', 'log', 'stats', 'body', 'settings'];
  function show(t, scroll) {
    if (!TABS.includes(t)) t = 'home';
    TABS.forEach(n => { $('tab-' + n).hidden = n !== t; });
    document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.go === t ? 'true' : 'false'));
    try { history.replaceState(null, '', '#' + t); } catch (e) {}
    if (scroll !== false) window.scrollTo(0, 0);
    if (t === 'stats') renderPhotos();
    if (t === 'settings') renderSettings();
    if (t === 'body') { bdPicked = false; renderBody(); }
  }
  document.querySelector('.nav').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) show(b.dataset.go); });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  // ---------- photos ----------
  const weekKey = d => 'w' + pad(Math.floor(Math.max(0, diff(parseId(plan().start), d)) / 7) + 1);
  const weekLabel = k => { const n = parseInt(k.slice(1), 10); return 'Week ' + n + ' · ' + fmt(addDays(parseId(plan().start), (n - 1) * 7)); };
  const urls = {};
  async function showPhoto(slot, key) {
    const box = $(slot);
    if (!key) { box.className = 'photo'; box.textContent = 'No photo yet'; return; }
    let blob = null; try { blob = await Store.getPhoto(key); } catch (e) {}
    if (!blob) { box.className = 'photo'; box.textContent = 'Photo not on this phone yet'; return; }
    if (urls[slot]) URL.revokeObjectURL(urls[slot]);
    urls[slot] = URL.createObjectURL(blob);
    box.className = 'photo has'; box.innerHTML = '<img alt="Progress photo, ' + esc(weekLabel(key)) + '">'; box.querySelector('img').src = urls[slot];
  }
  async function renderPhotos() {
    let keys = []; try { keys = await Store.photoKeys(); } catch (e) {}
    $('photoCount').textContent = keys.length + ' week' + (keys.length === 1 ? '' : 's');
    const fill = (sel, val) => { const s = $(sel); s.innerHTML = keys.length ? keys.map(k => '<option value="' + k + '">' + esc(weekLabel(k)) + '</option>').join('') : '<option value="">No photos yet</option>'; if (val) s.value = val; };
    fill('photoA', keys[0]); fill('photoB', keys[keys.length - 1]);
    showPhoto('photoAImg', keys[0]); showPhoto('photoBImg', keys[keys.length - 1]);
    renderCmp();
  }
  $('photoA').addEventListener('change', () => { showPhoto('photoAImg', $('photoA').value); renderCmp(); });
  $('photoB').addEventListener('change', () => { showPhoto('photoBImg', $('photoB').value); renderCmp(); });
  // compare: side by side, a slider that wipes from then to now, or a fade
  let pmode = 'side'; try { pmode = localStorage.getItem('cutlog-pmode') || 'side'; } catch (e) {}
  async function renderCmp() {
    $('photoMode').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pm === pmode)));
    const side = pmode === 'side';
    document.querySelector('#tab-stats .photos').hidden = !side; $('photoCmp').hidden = side;
    if (side) return;
    const a = $('photoA').value, b = $('photoB').value;
    for (const [img, key] of [['cmpA', a], ['cmpB', b]]) {
      let blob = null; try { blob = key ? await Store.getPhoto(key) : null; } catch (e) {}
      if (urls[img]) URL.revokeObjectURL(urls[img]); urls[img] = blob ? URL.createObjectURL(blob) : '';
      $(img).src = urls[img] || ''; $(img).hidden = !blob;
    }
    $('cmpTagA').textContent = a ? weekLabel(a).split(' · ')[0] : 'Then'; $('cmpTagB').textContent = b ? weekLabel(b).split(' · ')[0] : 'Now';
    applyCmp();
  }
  function applyCmp() {
    const v = +$('cmpRange').value;
    if (pmode === 'slide') { $('cmpB').style.clipPath = 'inset(0 0 0 ' + v + '%)'; $('cmpB').style.opacity = 1; $('cmpLine').hidden = false; $('cmpLine').style.left = 'calc(' + v + '% - 1px)'; }
    else { $('cmpB').style.clipPath = 'none'; $('cmpB').style.opacity = v / 100; $('cmpLine').hidden = true; }
  }
  $('cmpRange').addEventListener('input', applyCmp);
  $('photoMode').addEventListener('click', e => { const b = e.target.closest('[data-pm]'); if (!b) return; pmode = b.dataset.pm; try { localStorage.setItem('cutlog-pmode', pmode); } catch (er) {} renderCmp(); });

  // camera with last week's photo as a ghost, and a 3-second timer
  let camStream = null, camFacing = 'user', camTimer = true;
  async function camStart() {
    if (camStream) camStream.getTracks().forEach(t => t.stop());
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: camFacing, width: { ideal: 1440 }, height: { ideal: 1920 } }, audio: false });
    const v = $('camVideo'); v.srcObject = camStream; v.classList.toggle('mirror', camFacing === 'user'); await v.play().catch(() => {});
  }
  function camStop() { if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null; $('cam').hidden = true; }
  $('camOpen').addEventListener('click', async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('photoInput').click(); return; }
    let keys = []; try { keys = await Store.photoKeys(); } catch (e) {}
    const prev = keys.filter(k => k !== weekKey(today)).pop() || keys[keys.length - 1];
    const g = $('camGhost'); g.hidden = true;
    if (prev) { try { const b = await Store.getPhoto(prev); if (b) { if (urls.ghost) URL.revokeObjectURL(urls.ghost); urls.ghost = URL.createObjectURL(b); g.src = urls.ghost; g.hidden = false; } } catch (e) {} }
    $('camHint').textContent = prev ? 'Line up with ' + weekLabel(prev).split(' · ')[0] + '’s ghost' : 'First photo: stand where you can repeat it each week';
    $('cam').hidden = false;
    try { await camStart(); } catch (e) { camStop(); toast('Camera not available here. Choose a photo instead.'); $('photoInput').click(); }
  });
  $('camClose').addEventListener('click', camStop);
  $('camFlip').addEventListener('click', () => { camFacing = camFacing === 'user' ? 'environment' : 'user'; camStart().catch(() => {}); });
  $('camTimer').addEventListener('click', () => { camTimer = !camTimer; $('camTimer').setAttribute('aria-pressed', String(camTimer)); });
  $('camGhostOp').addEventListener('input', () => { $('camGhost').style.opacity = $('camGhostOp').value / 100; });
  $('camShoot').addEventListener('click', async () => {
    const v = $('camVideo'); if (!v.videoWidth) return;
    if (camTimer) for (let n = 3; n > 0; n--) { $('camCount').hidden = false; $('camCount').textContent = n; await new Promise(r => setTimeout(r, 1000)); }
    $('camCount').hidden = true;
    const c = document.createElement('canvas'), sc = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc);
    const x = c.getContext('2d'); if (camFacing === 'user') { x.translate(c.width, 0); x.scale(-1, 1); } x.drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    camStop();
    if (!blob) { toast('Couldn’t take the photo.'); return; }
    await Store.putPhoto(weekKey(today), blob); toast('Photo saved for ' + esc(weekLabel(weekKey(today)))); renderPhotos();
  });
  $('photoInput').addEventListener('change', async () => {
    const f = $('photoInput').files[0]; if (!f) return;
    try {
      const blob = await shrink(f, 1280, 0.82);
      await Store.putPhoto(weekKey(today), blob);
      toast('Photo saved for ' + esc(weekLabel(weekKey(today))));
      renderPhotos();
    } catch (e) { toast('Couldn’t read that photo. Try another.'); }
    $('photoInput').value = '';
  });
  function shrink(file, max, q) {
    return new Promise((res, rej) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => { const sc = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', q); };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('load')); };
      img.src = u;
    });
  }

  // ---------- workout: exercises, sets × reps ----------
  const EXERCISES = ['Chest press', 'Incline press', 'Shoulder press', 'Lat pulldown', 'Seated row', 'Bicep curl', 'Tricep pushdown', 'Squat', 'Leg press', 'Leg extension', 'Hamstring curl', 'Deadlift', 'Lunges', 'Pull-ups', 'Press-ups', 'Dips'];
  const LINKED = { 'Bicep curl': 'curl', 'Chest press': 'chest' }; // feed the existing PB + strength alarm
  const e1rm = (kg, reps) => kg * (1 + Math.min(reps, 15) / 30);       // Epley
  const setTxt = s => (s[0] ? s[0] + ' kg' : 'body') + ' × ' + s[1];
  (function fillLifts() { const sel = $('liftPick'); sel.innerHTML = EXERCISES.map(e => '<option>' + esc(e) + '</option>').join('') + '<option value="__custom">Something else…</option>'; })();
  // the last time you did an exercise before `id`, and your best ever before `id`
  function liftHistory(name, beforeId) {
    let last = null, best = 0;
    Object.keys(days()).filter(d => d < beforeId).sort().forEach(d => { const L = (days()[d].lifts || []).find(x => x.e === name); if (L && L.s.length) { last = { id: d, s: L.s }; L.s.forEach(s => { best = Math.max(best, e1rm(s[0], s[1])); }); } });
    return { last, best };
  }
  function renderLifts(r) {
    const ls = Array.isArray(r.lifts) ? r.lifts : [];
    let sets = 0, vol = 0;
    $('liftList').innerHTML = ls.map((L, i) => {
      const h = liftHistory(L.e, sel); let best = h.best;
      const chips = L.s.map((s, j) => { sets++; vol += s[0] * s[1]; const v = e1rm(s[0], s[1]), pb = h.last && v > best + 0.01; if (pb) best = v; return '<span class="' + (pb ? 'pb' : '') + '">' + esc(setTxt(s)) + (pb ? ' · PB' : '') + '<button type="button" data-lact="delset" data-i="' + i + '" data-j="' + j + '" aria-label="Remove set">✕</button></span>'; }).join('');
      const prev = L.s[L.s.length - 1] || (h.last && h.last.s[0]) || [0, 10];
      return '<div class="lift" data-i="' + i + '"><div class="lh"><b>' + esc(L.e) + '</b><button type="button" data-lact="delex" data-i="' + i + '" aria-label="Remove ' + esc(L.e) + '">✕</button></div>' +
        (h.last ? '<div class="last">Last time ' + esc(fmt(parseId(h.last.id))) + ': ' + esc(h.last.s.map(setTxt).join(', ')) + '</div>' : '<div class="last">First time logged: this sets your baseline.</div>') +
        (chips ? '<div class="sets">' + chips + '</div>' : '') +
        '<div class="addset"><input type="number" inputmode="decimal" step="0.5" min="0" max="500" placeholder="kg" value="' + prev[0] + '" aria-label="Weight kg"><input type="number" inputmode="numeric" step="1" min="1" max="100" placeholder="reps" value="' + prev[1] + '" aria-label="Reps"><button class="btn primary" type="button" data-lact="addset" data-i="' + i + '">+ Set</button></div></div>';
    }).join('');
    $('liftSum').textContent = sets ? sets + ' set' + (sets > 1 ? 's' : '') + ' · ' + kfmt(vol) + ' kg moved' : '';
  }
  $('liftPick').addEventListener('change', () => { $('liftCustom').hidden = $('liftPick').value !== '__custom'; if (!$('liftCustom').hidden) $('liftCustom').focus(); });
  $('liftAdd').addEventListener('click', () => {
    let name = $('liftPick').value;
    if (name === '__custom') { name = $('liftCustom').value.trim().slice(0, 40); if (!name) { $('liftCustom').hidden = false; $('liftCustom').focus(); toast('Type the exercise name'); return; } $('liftCustom').value = ''; }
    if ((rec(sel).lifts || []).some(L => L.e === name)) { toast(esc(name) + ' is already on today'); return; }
    change(sel, r => { r.lifts = (r.lifts || []).concat([{ e: name, s: [] }]); }, name + ' added');
  });
  $('liftList').addEventListener('click', e => {
    const b = e.target.closest('[data-lact]'); if (!b) return;
    const i = +b.dataset.i, act = b.dataset.lact;
    if (act === 'addset') {
      const box = b.closest('.lift'), ins = box.querySelectorAll('input'), kg = num(ins[0].value), reps = num(ins[1].value);
      if (kg == null || kg < 0 || !reps || reps < 1) { toast('Enter the weight and reps'); return; }
      const name = rec(sel).lifts[i].e, h = liftHistory(name, sel), soFar = rec(sel).lifts[i].s.reduce((m, s) => Math.max(m, e1rm(s[0], s[1])), 0);
      const pb = h.last && e1rm(kg, Math.round(reps)) > Math.max(h.best, soFar) + 0.01;
      change(sel, r => {
        r.lifts = r.lifts.map((L, k) => k === i ? { e: L.e, s: L.s.concat([[kg, Math.round(reps)]]) } : L);
        const f = LINKED[name]; if (f) { const top = Math.max(...r.lifts[i].s.map(s => s[0])); if (r[f] == null || top > r[f]) r[f] = top; }
        if (!userSess(r) && !watchSess(r)) r.am = true; // lifting today counts as a session
      }, pb ? 'New personal best · ' + name : 'Set logged');
    } else if (act === 'delset') {
      const j = +b.dataset.j;
      change(sel, r => { r.lifts = r.lifts.map((L, k) => k === i ? { e: L.e, s: L.s.filter((_, q) => q !== j) } : L); }, 'Set removed');
    } else if (act === 'delex') {
      change(sel, r => { const l = r.lifts.filter((_, k) => k !== i); r.lifts = l.length ? l : null; }, 'Exercise removed');
    }
  });
  // Stats: best set per exercise
  function renderStrength() {
    const by = {};
    Object.keys(days()).sort().forEach(d => (days()[d].lifts || []).forEach(L => L.s.forEach(s => {
      const b = by[L.e] || (by[L.e] = { best: null, e: 0, last: d });
      const v = e1rm(s[0], s[1]); if (v > b.e) { b.e = v; b.best = s; } b.last = d;
    })));
    const names = Object.keys(by).sort((a, b) => by[b].last.localeCompare(by[a].last));
    $('strCount').textContent = names.length ? names.length + ' exercise' + (names.length > 1 ? 's' : '') : '';
    $('strRows').innerHTML = names.length ? names.map(n => '<tr><td><div class="wk" style="font-size:.95rem">' + esc(n) + '</div></td><td>' + esc(setTxt(by[n].best)) + '</td><td>' + (by[n].best[0] ? Math.round(by[n].e) + ' kg' : '–') + '</td><td>' + esc(fmt(parseId(by[n].last))) + '</td></tr>').join('')
      : '<tr><td colspan="4" class="muted" style="padding:12px 0;color:var(--muted)">No lifts logged yet. Open Log, pick today and add an exercise.</td></tr>';
  }

  // ---------- coach: questions answered from your own numbers (on the phone, free, works offline) ----------
  const CQ = [
    { k: 'today', re: /\b(today|train|training|workout|session|gym|what should i do|plan)\b/ },
    { k: 'whatif', re: /\b(what if|if i (eat|have|ate|drink))\b|\d+\s*(k?cal|calories)/ },
    { k: 'weight', re: /\b(weigh|weight|kg|lost|lose|losing|85|goal|when will|eta|pace|sunday|scale)\b/ },
    { k: 'sleep', re: /\b(sleep|slept|bed|tired|nap|rest)\b/ },
    { k: 'recovery', re: /\b(recover|recovery|hrv|resting heart|rhr|ready|readiness|strain)\b/ },
    { k: 'protein', re: /\b(protein|shake|scoop)\b/ },
    { k: 'water', re: /\b(water|drink|hydrat|electrolyte|salt)\b/ },
    { k: 'food', re: /\b(food|eat|ate|meal|cheat|calorie|kcal|hungry|diet)\b/ },
    { k: 'strength', re: /\b(strength|strong|lift|lifts|lifting|pbs?|records?|bests|personal best|bench|chest|curl|press|squat|1rm)\b/ },
    { k: 'streak', re: /\b(streak|boss|xp|level|badge|testosterone)\b/ },
    { k: 'fat', re: /\b(body ?fat|fat %|bf|lean|muscle)\b/ },
    { k: 'week', re: /\b(week|weekly|month|progress|how am i doing|how.?s it going|summary|overall)\b/ }
  ];
  const b1 = v => '<b>' + v + '</b>';
  function coachCtx() {
    const st = last || compute(), p = plan(), tId = idOf(today), CH = window.CutHealth;
    const sc = bodyScores[tId] || {}, scY = bodyScores[idOf(addDays(today, -1))] || {};
    const s = parseId(p.start), nd = Math.max(1, diff(s, today)), lost = p.startWeight - st.est, pace = lost / nd;
    const rk = []; for (let i = 1; i <= 7; i++) { const id = idOf(addDays(today, -i)); if (id < p.start) break; const en = energy(id, rec(id), st.prot); if (en) rk.push(en.kg); }
    const pace7 = rk.length >= 3 ? rk.reduce((a, b) => a + b, 0) / rk.length : pace;
    return { st, p, tId, CH, sc: sc.recovery != null || sc.sleep != null ? sc : Object.assign({}, scY, sc), lost, pace, pace7 };
  }
  function coachAnswer(q0) {
    const q = ' ' + q0.toLowerCase() + ' ', c = coachCtx(), { st, p, tId, CH } = c, out = [];
    const hits = CQ.filter(x => x.re.test(q)).map(x => x.k);
    // a named topic beats the generic "today" / "week" words: "water today" is about water
    const k = hits.includes('whatif') ? 'whatif' : hits.find(h => h !== 'today' && h !== 'week') || hits[0];
    const nextShake = Object.keys(st.prot).filter(id => id > tId && st.prot[id].taken).sort()[0];
    if (k === 'whatif') {
      const m = q.match(/(\d[\d,]*)\s*(k?cal|calories)?/); const kcal = m ? +m[1].replace(/,/g, '') : null;
      if (kcal == null) return '<p>Give me a number, e.g. “what if I eat 1,500 kcal tomorrow?”</p>';
      const burn = p.baseBurn + p.sessionKcal * Math.max(1, Math.round(st.sessions / Math.max(1, diff(parseId(p.start), today)))), d = burn - kcal, kg = d / p.kcalPerKg;
      return '<p>On a normal gym day you burn about ' + b1(kfmt(burn) + ' kcal') + '. Eating ' + b1(kfmt(kcal) + ' kcal') + ' leaves a ' + (d >= 0 ? 'deficit' : 'surplus') + ' of ' + b1(kfmt(Math.abs(d)) + ' kcal') + ', about ' + b1((kg >= 0 ? '−' : '+') + Math.abs(kg).toFixed(2) + ' kg') + ' on the next morning’s estimate.</p>' +
        '<p>Compared with a water day (about −' + ((burn - 0) / p.kcalPerKg).toFixed(2) + ' kg), that costs ' + (kcal / p.kcalPerKg).toFixed(2) + ' kg of progress.</p>';
    }
    if (k === 'weight') {
      const left = Math.max(0, st.est - p.goal), eta = c.pace7 > 0.01 ? addDays(today, Math.ceil(left / c.pace7)) : null;
      const toSun = (7 - today.getDay()) % 7 || 7, sunKg = st.tomorrow - Math.max(0, c.pace7) * (toSun - 1);
      out.push('<p>You’re at about ' + b1(st.est.toFixed(1) + ' kg') + ' this morning (' + (st.lastWeigh ? 'last weighed ' + fmt(parseId(st.lastWeigh)) : 'estimate') + '), ' + b1(c.lost.toFixed(1) + ' kg') + ' down from ' + p.startWeight + ' kg.</p>');
      out.push('<p>Last 7 days you averaged ' + b1((c.pace7 * 7).toFixed(1) + ' kg a week') + '. At that pace: about ' + b1(sunKg.toFixed(1) + ' kg') + ' on Sunday’s weigh-in, and ' + p.goal + ' kg ' + (left <= 0 ? b1('reached') : eta ? 'around ' + b1(fmt(eta)) : 'not yet in sight') + '.</p>');
      if (left > 0 && c.pace7 * 7 > 2.5) out.push('<p>That’s a fast rate. Keep the protein days and strength work going so it’s fat, not muscle.</p>');
      return out.join('');
    }
    if (k === 'today') {
      const tp = CH && CH.train ? CH.train(bodyScores[tId] || {}) : null, pr = st.prot[tId];
      if (tp) out.push('<p>' + b1(tp.name) + '. ' + esc(tp.why) + ' Strain target ' + b1(tp.lo + '–' + tp.hi) + (tp.strain != null ? ', you’re at ' + tp.strain.toFixed(1) + (tp.status === 'hit' ? ': target reached, you can stop.' : tp.status === 'over' ? ': over, keep tomorrow easy.' : '.') : '.') + '</p>' +
        '<p>Session 1: ' + esc(tp.am[0]) + ' (' + esc(tp.am[1].join('; ')) + ').<br>Session 2: ' + esc(tp.pm[0]) + '.</p>');
      out.push('<p>' + (pr && pr.taken ? 'It’s a ' + b1('protein day') + ': ' + esc(p.shake || 'your shake') + '.' : 'Water day.' + (nextShake ? ' Next shake ' + esc(dayName(parseId(nextShake))) + '.' : '')) + '</p>');
      return out.join('');
    }
    if (k === 'sleep') {
      const sc = c.sc;
      if (sc.sleep == null) return '<p>No sleep recorded for last night yet. It arrives when your watch syncs, or from phone use if you set that up (Settings → Apple Watch).</p>';
      out.push('<p>Last night: ' + b1(sc.sleep.toFixed(1) + ' h') + ' of the ' + (sc.need || 8).toFixed(1) + ' h you needed' + (sc.sleepSrc === 'capped' ? ' (Health said ' + sc.sleepRaw.toFixed(1) + ' h, corrected by your phone use)' : sc.sleepSrc === 'phone' ? ' (from phone use, the watch was off)' : '') + '.</p>');
      const sl = []; for (let i = 0; i < 7; i++) { const x = bodyScores[idOf(addDays(today, -i))]; if (x && x.sleep != null) sl.push(x.sleep); }
      if (sl.length > 2) out.push('<p>7-night average ' + b1((sl.reduce((a, b) => a + b, 0) / sl.length).toFixed(1) + ' h') + (sc.debt ? ', sleep debt ' + sc.debt.toFixed(1) + ' h' : '') + '.</p>');
      const ins = CH ? CH.insights(days(), bodyScores, id => rec(id).mark === 'cheat', id => rec(id).mark === 'done', id => sessOf(rec(id))).find(i => i.label === 'sleep7') : null;
      if (ins) out.push('<p>' + esc(ins.text) + '</p>');
      return out.join('');
    }
    if (k === 'recovery') {
      const sc = c.sc;
      if (sc.recovery == null) return '<p>No recovery score yet today' + (sc.calibrating != null ? ' (calibrating: ' + sc.calibrating + ' of 7 days of HRV)' : '') + '. It needs this morning’s HRV from your watch.</p>';
      const band = sc.recovery >= 67 ? 'green, ready to push' : sc.recovery >= 34 ? 'amber, train but controlled' : 'red, take it easy';
      out.push('<p>Recovery ' + b1(sc.recovery + '%') + ': ' + band + '.</p>');
      const bits = []; if (sc.hrv != null) bits.push('HRV ' + Math.round(sc.hrv) + (sc.hrvNorm ? ' vs your normal ' + sc.hrvNorm : '')); if (sc.rhr != null) bits.push('resting HR ' + Math.round(sc.rhr) + (sc.rhrNorm ? ' vs ' + sc.rhrNorm : '')); if (sc.sleep != null) bits.push(sc.sleep.toFixed(1) + ' h sleep');
      if (bits.length) out.push('<p>' + esc(bits.join(', ')) + '.</p>');
      const ins = CH ? CH.insights(days(), bodyScores, id => rec(id).mark === 'cheat', id => rec(id).mark === 'done', id => sessOf(rec(id)))[0] : null;
      if (ins) out.push('<p>Pattern in your data: ' + esc(ins.text) + '</p>');
      return out.join('');
    }
    if (k === 'protein') {
      const pr = st.prot[tId]; let wk = 0; for (let i = 0; i < 7; i++) { const x = st.prot[idOf(addDays(today, -i))]; if (x && x.taken) wk++; }
      return '<p>' + (pr && pr.taken ? 'Today ' + b1('is') + ' a protein day: ' + esc(p.shake || 'shake') + ', about ' + kfmt(p.proteinKcal) + ' kcal.' : 'Today is a water day.') + (nextShake ? ' Next shake ' + b1(esc(dayName(parseId(nextShake)))) + '.' : '') + '</p><p>' + wk + ' shake' + (wk === 1 ? '' : 's') + ' in the last 7 days, every ' + p.proteinEvery + ' days. Take one early if your curl or chest press drops more than 10%.</p>';
    }
    if (k === 'water') {
      const w = rec(tId).water || 0, g = p.waterGoal || 3000; const wl = []; for (let i = 1; i <= 7; i++) { const v = rec(idOf(addDays(today, -i))).water; if (v) wl.push(v); }
      return '<p>Today ' + b1(L(w) + ' of ' + L(g) + ' L') + (w >= g ? ': goal hit.' : ', ' + L(g - w) + ' L to go.') + '</p>' + (wl.length ? '<p>Last 7 days you averaged ' + L(Math.round(wl.reduce((a, b) => a + b, 0) / wl.length / 50) * 50) + ' L on the ' + wl.length + ' day' + (wl.length === 1 ? '' : 's') + ' you logged.</p>' : '<p>Log water with the +250 / +500 buttons on Home.</p>') + '<p>Water with a pinch of salt or electrolytes keeps energy up on a cut.</p>';
    }
    if (k === 'food') {
      const ms = rec(tId).meals || []; let cheats = 0; for (let d = parseId(p.start); d <= today; d = addDays(d, 1)) if (rec(idOf(d)).mark === 'cheat') cheats++;
      const en = energy(tId, Object.assign({}, rec(tId), { mark: rec(tId).mark || 'done' }), st.prot);
      out.push('<p>' + (ms.length ? 'Today: ' + esc(ms.map(m => m.n + ' ' + kfmt(m.k)).join(', ')) + ' kcal.' : 'No meals logged today.') + (en ? ' Eaten so far about ' + b1(kfmt(en.food) + ' kcal') + ', deficit ' + b1(kfmt(en.deficit)) + '.' : '') + '</p>');
      out.push('<p>' + cheats + ' cheat day' + (cheats === 1 ? '' : 's') + ' since ' + fmt(parseId(p.start)) + '. A cheat day costs about ' + (p.baseBurn / p.kcalPerKg).toFixed(2) + ' kg of progress against a water day.</p>');
      const ins = CH ? CH.insights(days(), bodyScores, id => rec(id).mark === 'cheat', id => rec(id).mark === 'done', id => sessOf(rec(id))).find(i => i.label === 'cheat') : null;
      if (ins) out.push('<p>' + esc(ins.text) + '</p>');
      return out.join('');
    }
    if (k === 'strength') {
      const by = {}; Object.keys(days()).sort().forEach(d => (days()[d].lifts || []).forEach(Lf => Lf.s.forEach(x => { const v = e1rm(x[0], x[1]); if (!by[Lf.e] || v > by[Lf.e].v) by[Lf.e] = { v, s: x, d }; })));
      const names = Object.keys(by);
      if (st.bestCurl) by['Bicep curl'] = by['Bicep curl'] || { v: st.bestCurl, s: [st.bestCurl, 1], d: st.bestCurlD };
      if (!names.length && !st.bestCurl && !st.bestChest) return '<p>No lifts logged yet. Add them in Log → Workout and I’ll track your bests and warn you if strength drops.</p>';
      out.push('<p>Your bests: ' + Object.keys(by).slice(0, 6).map(n => esc(n) + ' ' + b1(esc(setTxt(by[n].s)))).join(', ') + '.</p>');
      const drops = []; if (st.bestCurl && st.lastCurl != null && st.lastCurl < st.bestCurl * 0.9) drops.push('curl'); if (st.bestChest && st.lastChest != null && st.lastChest < st.bestChest * 0.9) drops.push('chest press');
      out.push('<p>' + (drops.length ? 'Your ' + drops.join(' and ') + ' is down more than 10%: take a protein day.' : 'No strength drop: the cut is taking fat, not muscle.') + '</p>');
      return out.join('');
    }
    if (k === 'streak') {
      const cur = LEVELS[st.li], nxt = LEVELS[st.li + 1], into = st.run % 10;
      return '<p>Cut streak ' + b1(st.run) + ' (best ' + st.best + '), testosterone streak ' + b1(st.tee) + '.</p><p>Boss HP ' + (10 - into) + ' / 10: ' + (10 - into) + ' more clean day' + (10 - into === 1 ? '' : 's') + ' to beat it. Level ' + (st.li + 1) + ' ' + esc(cur[1]) + (nxt ? ', ' + kfmt(nxt[0] - st.xp) + ' XP to ' + esc(nxt[1]) : '') + '.</p>';
    }
    if (k === 'fat') {
      const pts = Object.keys(days()).filter(id => H(rec(id), 'body_fat') != null).sort();
      if (!pts.length) return '<p>No body-fat readings yet. Add Body Fat Percentage to the Shortcut (Settings → Apple Watch) if your smart scale writes it to Apple Health.</p>';
      const a = H(rec(pts[0]), 'body_fat'), z = H(rec(pts[pts.length - 1]), 'body_fat');
      return '<p>Body fat ' + b1(z.toFixed(1) + '%') + ' (' + fmt(parseId(pts[pts.length - 1])) + '), ' + (z <= a ? '−' : '+') + Math.abs(z - a).toFixed(1) + ' since ' + fmt(parseId(pts[0])) + '. Goal under ' + (p.bfGoal || 15) + '%.</p>';
    }
    if (k === 'week') {
      let dn = 0, ch = 0, ss = 0, kg = 0; const rc = [];
      for (let i = 0; i < 7; i++) { const id = idOf(addDays(today, -i)); if (id < p.start) break; const r = rec(id); if (r.mark === 'done') dn++; if (r.mark === 'cheat') ch++; ss += sessOf(r); const en = energy(id, r, st.prot); if (en) kg += en.kg; const x = bodyScores[id]; if (x && x.recovery != null) rc.push(x.recovery); }
      return '<p>Last 7 days: ' + b1(dn + ' days completed') + (ch ? ', ' + ch + ' cheat' + (ch > 1 ? 's' : '') : '') + ', ' + ss + ' gym sessions, about ' + b1('−' + kg.toFixed(1) + ' kg') + '.' + (rc.length ? ' Recovery averaged ' + Math.round(rc.reduce((a, b) => a + b, 0) / rc.length) + '%.' : '') + '</p><p>Overall ' + b1(c.lost.toFixed(1) + ' kg') + ' down in ' + (diff(parseId(p.start), today) + 1) + ' days. Streak ' + st.run + '.</p>';
    }
    return '<p>I answer from your own numbers. Ask me things like:</p><p>“What should I train today?”, “When will I hit ' + p.goal + ' kg?”, “How did I sleep?”, “Why is my recovery low?”, “Next protein day?”, “What if I eat 1,500 kcal tomorrow?”, “How’s my week going?”, “What are my bests?”</p>';
  }
  const COACH_SUG = () => { const p = plan(), pr = last && last.prot[idOf(today)]; return ['What should I train today?', 'When will I hit ' + p.goal + ' kg?', 'How did I sleep?', 'How’s my week going?', pr && pr.taken ? 'What’s my shake today?' : 'Next protein day?', 'Why is my recovery where it is?', 'What if I eat 1,500 kcal tomorrow?', 'What are my bests?']; };
  function coachSay(who, html) { const d = document.createElement('div'); d.className = 'msg ' + who; d.innerHTML = html; $('coachLog').appendChild(d); $('coachLog').scrollTop = $('coachLog').scrollHeight; }
  function coachAsk(q) { if (!q.trim()) return; coachSay('you', esc(q)); try { coachSay('bot', coachAnswer(q)); } catch (e) { console.error(e); coachSay('bot', '<p>I couldn’t work that one out. Try asking another way.</p>'); } }
  function coachOpen() {
    $('coach').hidden = false;
    if (!$('coachLog').children.length) { const prof = Store.profile || {}; coachSay('bot', '<p>' + (prof.display_name ? 'Hi ' + esc(prof.display_name.split(' ')[0]) + '. ' : '') + 'Ask me anything about your cut. Here’s today:</p>' + coachAnswer('today')); }
    $('coachSug').innerHTML = COACH_SUG().map(t => '<button type="button">' + esc(t) + '</button>').join('');
  }
  $('coachOpen').addEventListener('click', coachOpen); $('homeCoach').addEventListener('click', coachOpen);
  $('coachClose').addEventListener('click', () => { $('coach').hidden = true; });
  $('coachSug').addEventListener('click', e => { const b = e.target.closest('button'); if (b) coachAsk(b.textContent); });
  $('coachForm').addEventListener('submit', e => { e.preventDefault(); const q = $('coachQ').value; $('coachQ').value = ''; coachAsk(q); });

  // ---------- water ----------
  const L = ml => (ml / 1000).toFixed(ml % 1000 && ml < 10000 ? (ml % 100 ? 2 : 1) : 1).replace(/\.0$/, '');
  function renderWater(el, id) {
    const r = rec(id), goal = plan().waterGoal || 3000, w = r.water || 0, pct = Math.min(100, w / goal * 100);
    const isToday = id === idOf(today);
    el.innerHTML = '<div class="wtop"><span class="label">Water' + (isToday ? '' : ' · ' + esc(fmt(parseId(id)))) + '</span><span>' + (w >= goal ? 'Goal hit' : L(goal - w) + ' L to go') + '</span></div>' +
      '<div class="wtop"><b>' + L(w) + ' <small style="font-size:.85rem;color:var(--muted)">/ ' + L(goal) + ' L</small></b></div>' +
      '<div class="wbar" role="img" aria-label="' + L(w) + ' of ' + L(goal) + ' litres"><i style="width:' + pct + '%"></i></div>' +
      '<div class="wbtns"><button type="button" data-w="250">+250 ml</button><button type="button" data-w="500">+500 ml</button><button type="button" data-w="750">+750 ml</button>' +
      (w ? '<button type="button" class="minus" data-w="-250" aria-label="Remove 250 ml">−250</button>' : '') +
      '<button type="button" class="salt" data-salt="1" aria-pressed="' + !!r.salt + '">+ Salt / electrolytes</button></div>';
    el.dataset.day = id;
  }
  function waterClick(e) {
    const el = e.currentTarget, id = el.dataset.day, b = e.target.closest('button'); if (!b || !id) return;
    if (b.dataset.salt) { const on = !rec(id).salt; change(id, r => { r.salt = on; }, on ? 'Electrolytes ticked' : 'Electrolytes unticked'); return; }
    const ml = +b.dataset.w;
    change(id, r => { const v = Math.max(0, (r.water || 0) + ml); r.water = v || null; }, ml > 0 ? 'Water +' + ml + ' ml' : 'Water −' + (-ml) + ' ml');
  }
  $('homeWater').addEventListener('click', waterClick); $('sheetWater').addEventListener('click', waterClick);

  // ---------- meals: photo → on-phone food recognition → kcal ----------
  (function fillFoods() { const dl = $('foodList'); (window.CUT_FOODS || []).forEach(f => { const o = document.createElement('option'); o.value = f[0]; dl.appendChild(o); }); })();
  const foodByName = n => (window.CUT_FOODS || []).find(f => f[0] === String(n || '').trim().toLowerCase());
  function renderMeals(r) {
    const ms = Array.isArray(r.meals) ? r.meals : [];
    $('mealList').innerHTML = ms.map((m, i) => '<li><span>' + esc(m.n) + '</span><small>' + (m.t ? esc(m.t) + ' · ' : '') + kfmt(m.k) + ' kcal</small><button type="button" data-meal-del="' + i + '" aria-label="Remove ' + esc(m.n) + '">✕</button></li>').join('');
    $('mealTotal').textContent = ms.length ? kfmt(ms.reduce((a, m) => a + (+m.k || 0), 0)) + ' kcal' : 'none logged';
  }
  let mealBase = null, mealGuessToken = 0;
  function mealFill(name, base, serving) {
    $('mealName').value = name; mealBase = base;
    $('mealKcal').value = base != null ? Math.round(base * +$('mealPortion').value / 10) * 10 : '';
    $('mealServing').textContent = serving ? 'Regular = ' + serving + ', about ' + kfmt(base) + ' kcal. Change the portion or type your own number.' : '';
  }
  function mealOpen(photo) {
    $('mealBox').hidden = false; $('mealPrev').hidden = !photo; $('mealGuess').innerHTML = ''; $('mealPortion').value = '1'; mealFill('', null, '');
    setTimeout(() => { $('mealBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); if (!photo) $('mealName').focus(); }, 50);
  }
  $('mealType').addEventListener('click', () => mealOpen(false));
  // barcode: camera → ZXing (on the phone) → Open Food Facts (free) → a meal you can adjust
  let scanStream = null, scanLoop = null, scanBusy = false;
  const scanStop = () => { clearTimeout(scanLoop); scanLoop = null; if (scanStream) scanStream.getTracks().forEach(t => t.stop()); scanStream = null; $('scan').hidden = true; };
  async function scanFound(code) {
    scanStop(); mealOpen(false); $('mealName').value = ''; $('mealStatus').textContent = '';
    $('mealServing').textContent = 'Looking up ' + code + '…';
    try {
      const B = await import('./food/barcode.js?v=' + SW_V);
      const p = await B.lookup(code);
      if (!p) { $('mealServing').textContent = 'Barcode ' + code + ' isn’t in Open Food Facts yet. Type the name and calories from the pack.'; $('mealName').focus(); return; }
      mealFill(p.name, p.kcal, p.serving);
      $('mealPortion').value = '1';
      $('mealServing').textContent = (p.kcal != null ? kfmt(p.kcal) + ' kcal per ' + (p.serving || 'serving') : 'No calories listed: type them from the pack') + (p.per100 != null ? ' · ' + kfmt(p.per100) + ' kcal per 100 g' : '') + '. Portion multiplies it.';
    } catch (e) { $('mealServing').textContent = navigator.onLine ? 'Couldn’t look that up just now. Type it instead.' : 'You’re offline: type it instead.'; }
  }
  $('mealScan').addEventListener('click', async () => {
    $('scan').hidden = false; $('scanCode').value = ''; $('scanHint').textContent = 'Point at the barcode';
    let B; try { B = await import('./food/barcode.js?v=' + SW_V); } catch (e) { $('scanHint').textContent = 'Scanner didn’t load. Type the number below.'; return; }
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      const v = $('scanVideo'); v.srcObject = scanStream; await v.play().catch(() => {});
    } catch (e) { $('scanHint').textContent = 'No camera here: type the barcode number below.'; return; }
    const tick = async () => {
      if (!scanStream) return;
      const v = $('scanVideo');
      if (v.videoWidth && !scanBusy) { scanBusy = true; try { const code = await B.read(v); if (code) { try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} scanBusy = false; scanFound(code); return; } } catch (e) {} scanBusy = false; }
      scanLoop = setTimeout(tick, 250);
    };
    tick();
  });
  $('scanClose').addEventListener('click', scanStop);
  $('scanGo').addEventListener('click', () => { const c = $('scanCode').value.replace(/\D/g, ''); if (c.length >= 8) scanFound(c); else $('scanHint').textContent = 'Barcodes are 8 to 14 digits.'; });
  $('mealCancel').addEventListener('click', () => { $('mealBox').hidden = true; mealGuessToken++; });
  $('mealPortion').addEventListener('change', () => { if (mealBase != null) $('mealKcal').value = Math.round(mealBase * +$('mealPortion').value / 10) * 10; });
  $('mealName').addEventListener('input', () => { const f = foodByName($('mealName').value); if (f) mealFill(f[0], f[1], f[2]); else mealBase = null; });
  $('mealGuess').addEventListener('click', e => { const b = e.target.closest('[data-food]'); if (!b) return; const f = foodByName(b.dataset.food); if (f) mealFill(f[0], f[1], f[2]); $('mealGuess').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  $('mealInput').addEventListener('change', async () => {
    const f = $('mealInput').files[0]; $('mealInput').value = ''; if (!f) return;
    mealOpen(true); const tok = ++mealGuessToken;
    if (urls.meal) URL.revokeObjectURL(urls.meal); urls.meal = URL.createObjectURL(f); $('mealImg').src = urls.meal;
    const stat = t => { if (tok === mealGuessToken) $('mealStatus').textContent = t; };
    stat('Looking at your plate…');
    try {
      const small = await shrink(f, 640, 0.85);
      const F = await import('./food/food.js?v=' + SW_V);
      const first = !(await F.cached());
      if (first) stat('Getting the food recogniser ready (one time, about 64 MB)…');
      const res = await F.guess(small, (frac) => stat('Downloading the food recogniser: ' + Math.round(frac * 100) + '% (one time)'));
      if (tok !== mealGuessToken) return;
      $('mealGuess').innerHTML = res.top.slice(0, 3).map((g, i) => '<button type="button" data-food="' + esc(g.name) + '" aria-pressed="' + (i === 0 && res.food) + '">' + esc(g.name) + ' · ' + kfmt(g.kcal) + '</button>').join('');
      if (res.food) { mealFill(res.top[0].name, res.top[0].kcal, res.top[0].serving); stat('Looks like ' + res.top[0].name + '. Not right? Tap another or type it.'); }
      else stat('Couldn’t spot food in that photo. Type what it is.');
    } catch (e) { console.error(e); stat(navigator.onLine ? 'Recognition didn’t work on this phone. Type what it is.' : 'Offline: type what it is (recognition needs one download first).'); }
  });
  $('mealAdd').addEventListener('click', () => {
    const n = $('mealName').value.trim(), k = num($('mealKcal').value);
    if (!n) { $('mealName').focus(); toast('Say what it is first.'); return; }
    if (k == null || k < 0) { $('mealKcal').focus(); toast('Add the calories (or pick a food from the list).'); return; }
    const now = new Date(), t = sel === idOf(today) ? pad(now.getHours()) + ':' + pad(now.getMinutes()) : '';
    const portion = $('mealPortion').selectedOptions[0].textContent;
    change(sel, r => { r.meals = (Array.isArray(r.meals) ? r.meals.slice() : []).concat([{ n: n + (portion !== 'Regular' ? ' (' + portion.toLowerCase() + ')' : ''), k: Math.round(k), t }]); }, 'Meal logged · ' + kfmt(k) + ' kcal');
    $('mealBox').hidden = true; mealGuessToken++;
  });
  $('mealList').addEventListener('click', e => { const b = e.target.closest('[data-meal-del]'); if (!b) return; const i = +b.dataset.mealDel; change(sel, r => { const m = (r.meals || []).slice(); m.splice(i, 1); r.meals = m.length ? m : null; }, 'Meal removed'); });

  // ---------- settings ----------
  const SET = [['sStart', 'start', 'd'], ['sStartW', 'startWeight'], ['sGoal', 'goal'], ['sBase', 'baseBurn'], ['sSess', 'sessionKcal'], ['sPerKg', 'kcalPerKg'], ['sProtK', 'proteinKcal'], ['sProtE', 'proteinEvery'], ['sProtA', 'proteinAnchor', 'd'], ['sWeeks', 'markWeeks'], ['sShake', 'shake', 't'], ['sBf', 'bfGoal'], ['sWater', 'waterGoal']];
  function renderSettings() {
    const p = plan();
    SET.forEach(([i, k]) => { if (document.activeElement !== $(i)) $(i).value = p[k] != null ? p[k] : ''; });
    renderAuto(); renderProfile();
    const cfg = !!Store.connected, u = Store.user, anon = Store.isAnonymous;
    $('acctNoCfg').hidden = cfg; $('acctForm').hidden = !cfg || (!!u && !showSignIn); $('acctIn').hidden = !u || anon; $('acctAnon').hidden = !u || !anon || showSignIn;
    if (u && !anon) {
      const pr = Store.profile || {};
      $('aWho').textContent = (pr.display_name ? pr.display_name + (pr.username ? ' (@' + pr.username + ')' : '') + ' · ' : (pr.username ? '@' + pr.username + ' · ' : '')) + (u.email || 'you');
      const pk = Store.passkeys;
      $('pkOffer').hidden = pk.length > 0; $('pkOn').hidden = !pk.length;
      $('pkNames').textContent = pk.length ? ' (' + pk.map(x => x.friendly_name || x.friendlyName || 'passkey').join(', ') + ')' : '';
      $('evText').textContent = Store.emailVerified ? 'Email verified ✓' : 'Email not verified.';
      $('evBtn').hidden = Store.emailVerified;
    }
    if (u && anon) {
      const pending = u.new_email || (u.email && !u.email_confirmed_at ? u.email : '');
      $('anonEmailStep').hidden = !!pending && !retypeEmail; $('anonPkStep').hidden = !pending || retypeEmail;
      if (pending) $('anonPkText').textContent = 'We sent a link to ' + pending + '. Tap it, then come back here and tap Turn on Face ID.';
    }
    renderWatch(); renderSafe();
    renderSync(); renderRem();
  }
  $('sSave').addEventListener('click', async () => {
    const p = Object.assign({}, plan());
    for (const [i, k, t] of SET) {
      const v = $(i).value;
      if (t === 'd') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) p[k] = v; }
      else if (t === 't') { p[k] = v.trim().slice(0, 60); }
      else { const n = num(v); if (n != null && n > 0) p[k] = n; }
    }
    p.proteinEvery = Math.max(1, Math.round(p.proteinEvery)); p.markWeeks = Math.max(1, Math.round(p.markWeeks));
    await Store.savePlan(p); render(); toast('Plan saved');
  });

  // Autopilot
  (function fillAutoHours() { const sel = $('autoHour'); for (let h = 0; h < 24; h++) { const o = document.createElement('option'); o.value = h; o.textContent = pad(h) + ':00'; sel.appendChild(o); } })();
  function renderAuto() {
    const p = plan(), on = p.autopilot !== false;
    $('autoOn').setAttribute('aria-pressed', String(on)); $('autoOn').querySelector('span').textContent = on ? 'On' : 'Off';
    $('autoHour').value = String(p.autoHour != null ? p.autoHour : 12); $('autoHour').disabled = !on;
    $('autoStatus').textContent = !Store.user ? 'Needs sign-in' : on ? 'On' : 'Off';
    $('autoMsg').textContent = !Store.user ? 'Autopilot runs in your private database, so sign in first.' : on ? 'Runs in your private database every 15 minutes, even with the app closed.' + (p.autopilotFrom ? ' Active since ' + fmt(parseId(p.autopilotFrom)) + '.' : ' Starts within 15 minutes.') : 'Off: days stay blank until you mark them.';
  }
  $('autoOn').addEventListener('click', async () => { const on = plan().autopilot === false; await Store.savePlan(Object.assign({}, plan(), { autopilot: on })); renderAuto(); render(); toast(on ? 'Autopilot on' : 'Autopilot off'); });
  $('autoHour').addEventListener('change', async () => { await Store.savePlan(Object.assign({}, plan(), { autoHour: Number($('autoHour').value) })); renderAuto(); render(); toast('Days now complete at ' + pad(Number($('autoHour').value)) + ':00'); });

  // Profile: name + username
  const prMsg = t => { $('prHint').textContent = t; };
  function renderProfile() {
    const pr = Store.profile || {};
    if (document.activeElement !== $('prName')) $('prName').value = pr.display_name || '';
    if (document.activeElement !== $('prUser')) $('prUser').value = pr.username || '';
    if (!$('prHint').dataset.busy) prMsg(pr.username ? 'Sign in anywhere with @' + pr.username + ' and your password' + (Store.passkeys.length ? ', or Face ID.' : '.') : 'Pick a username to sign in with it and your password on any device.');
  }
  let prT = null;
  $('prUser').addEventListener('input', () => {
    const v = $('prUser').value.trim().toLowerCase().replace(/^@/, ''); $('prUser').value = v.replace(/[^a-z0-9_.]/g, '');
    clearTimeout(prT); $('prHint').dataset.busy = '1';
    if (!v) { prMsg('No username: sign in with your email.'); return; }
    if (!/^[a-z0-9_.]{3,20}$/.test(v)) { prMsg('3 to 20 characters: letters, numbers, _ and .'); return; }
    prT = setTimeout(async () => { try { prMsg((await Store.usernameFree(v)) ? '@' + v + ' is free.' : '@' + v + ' is taken.'); } catch (e) {} }, 350);
  });
  $('prSave').addEventListener('click', async () => {
    const u = $('prUser').value.trim().toLowerCase(), n = $('prName').value.trim();
    if (u && !/^[a-z0-9_.]{3,20}$/.test(u)) { prMsg('Usernames are 3 to 20 characters: letters, numbers, _ and .'); return; }
    try { await Store.setProfile(u, n); delete $('prHint').dataset.busy; renderProfile(); render(); toast('Profile saved'); if (u) prMsg('Saved. Sign in anywhere with @' + u + ' and your password (set one below if you haven’t yet).'); }
    catch (e) { prMsg(e.message); }
  });

  function renderSync() {
    const s = Store.status, dot = $('syncDot');
    const text = { local: 'On this phone only', signedout: 'Not signed in', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline, will sync later', error: 'Sync problem, will retry' }[s] || s;
    dot.dataset.s = s; dot.setAttribute('aria-label', text); dot.title = text; $('syncText').textContent = text;
  }
  const authMsg = t => { $('aMsg').textContent = t; };
  const pkError = e => {
    const c = (e && (e.code || e.name || '')) + ' ' + (e && e.message || '');
    if (/NotAllowed|AbortError|cancel|not allowed|timed out/i.test(c)) return 'No Face ID for Cut Log on this phone yet, or it was cancelled. First time? Use the email link below once, then turn on Face ID.';
    if (/credential_not_found/.test(c)) return 'There’s no Cut Log passkey on this phone yet. Use the email link once, then turn on Face ID.';
    if (/passkey_disabled/.test(c)) return 'Face ID sign-in isn’t switched on for this app yet.';
    if (/credential_exists/.test(c)) return 'This phone’s Face ID is already set up for Cut Log.';
    if (/email_not_confirmed/.test(c)) return 'Confirm your email first: tap the link we sent.';
    if (/anonymous|confirmed/i.test(c)) return 'Tap the link in your email first, then try again.';
    return (e && e.message) || 'That didn’t work. Check you’re online and try again.';
  };
  const okEmail = v => /^\S+@\S+\.\S+$/.test(v);
  $('pkIn').addEventListener('click', async () => {
    try { authMsg('Waiting for Face ID…'); await Store.passkeySignIn(); authMsg(''); showSignIn = false; renderSettings(); toast('Signed in with Face ID'); }
    catch (e) { authMsg(pkError(e)); }
  });
  // Sign in / Create account switch
  $('acctMode').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    const up = b.dataset.mode === 'up';
    $('modeIn').hidden = up; $('modeUp').hidden = !up; authMsg('');
    $('acctMode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('aIn').addEventListener('click', async () => {
    const em = $('aEmail').value.trim(), pw = $('aPass').value, isUser = /^@?[a-zA-Z0-9_.]{3,20}$/.test(em);
    if (!okEmail(em) && !isUser) { authMsg('Enter your email or username.'); return; }
    if (!pw) { authMsg('Enter your password, or use Sign in with Face ID.'); return; }
    try {
      authMsg('Signing in…');
      if (isUser) await Store.signInUsername(em.replace(/^@/, '').toLowerCase(), pw); else await Store.signInPassword(em, pw);
      authMsg(''); $('aPass').value = ''; showSignIn = false; renderSettings(); toast('Signed in');
    }
    catch (e) { authMsg(/invalid|match/i.test(e.message || '') ? (isUser ? 'That username and password don’t match.' : 'Email or password isn’t right.') + ' No password yet? Use Sign in with Face ID, then set one in Settings.' : (e.message || 'Couldn’t sign in.')); }
  });
  $('aCode').addEventListener('click', async () => {
    const em = $('aEmail').value.trim(); if (!okEmail(em)) { authMsg('Enter your email first (not your username) and we’ll send a link.'); return; }
    // Supabase's free email sender only sends a sign-in link (no code) and links open in Safari,
    // so: open it in Safari, set a password there (Settings), then sign in here with it.
    try { authMsg('Sending…'); await Store.sendCode(em); authMsg('Sent. Open the email and tap Sign in: it opens Cut Log in Safari, signed in. There, go to Settings → Set a password, then come back here and sign in with it. Or just use Sign in with Face ID.'); }
    catch (e) { authMsg(/rate|too many|security purposes/i.test(e.message || '') ? 'Too many emails just now. Wait a few minutes, or use Sign in with Face ID.' : /not found|signups not allowed/i.test(e.message || '') ? 'No account with that email. Tap Create account above.' : (e.message || 'Couldn’t send the email.')); }
  });
  $('aCodeGo').addEventListener('click', async () => {
    const em = $('aEmail').value.trim(), code = $('aCodeIn').value.replace(/\D/g, '');
    if (code.length < 6) { authMsg('Type the 6-digit code from the email.'); return; }
    try { authMsg('Checking…'); await Store.verifyCode(em, code); authMsg(''); $('codeRow').hidden = true; $('aCodeIn').value = ''; showSignIn = false; renderSettings(); toast('Signed in'); }
    catch (e) { authMsg(/expired|invalid/i.test(e.message || '') ? 'That code didn’t work or has expired. Tap Email me a code instead to get a new one.' : (e.message || 'Couldn’t sign in.')); }
  });
  $('pwSave').addEventListener('click', async () => {
    const pw = $('pwNew').value; if (pw.length < 8) { $('pkMsg').textContent = 'Use at least 8 characters.'; return; }
    try { await Store.setPassword(pw); $('pwNew').value = ''; $('pwBox').open = false; $('pwSummary').textContent = 'Change password'; $('pkMsg').textContent = ''; toast('Password saved'); }
    catch (e) { $('pkMsg').textContent = e.message || 'Couldn’t save the password.'; }
  });
  $('aCreate').addEventListener('click', async () => {
    const em = $('uEmail').value.trim(); if (!okEmail(em)) { authMsg('Enter your email.'); return; }
    const chosenPw = $('uPass').value; if (chosenPw && chosenPw.length < 8) { authMsg('Use a password of at least 8 characters, or leave it empty.'); return; }
    try {
      authMsg('Creating your account…');
      const r = await Store.createAccount(em, chosenPw);
      if (r === 'in') { authMsg(''); showSignIn = false; renderSettings(); toast('Account created. Now turn on Face ID.'); setTimeout(() => { const b = $('pkAdd'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80); }
      else authMsg('Check your email and tap the link to finish.');
    } catch (e) {
      authMsg(/already|exists|registered/i.test((e.code || '') + (e.message || '')) ? 'You already have an account with that email. Tap Sign in above.' : (e.message || 'Couldn’t create the account. Check you’re online.'));
    }
  });
  $('evBtn').addEventListener('click', async () => {
    try { $('pkMsg').textContent = 'Sending…'; await Store.verifyEmail(); $('pkMsg').textContent = 'Sent. Tap the link in the email to verify. If it doesn’t arrive, the free email allowance is used up for the hour: try later.'; }
    catch (e) { $('pkMsg').textContent = /rate|too many/i.test(e.message || '') ? 'The free email allowance is used up for the hour. Try again later. Everything else works without it.' : (e.message || 'Couldn’t send.'); }
  });
  let showSignIn = false, retypeEmail = false;
  $('lHave').addEventListener('click', () => { showSignIn = true; renderSettings(); });
  $('lRetype').addEventListener('click', () => { retypeEmail = true; renderSettings(); });
  $('lSave').addEventListener('click', async () => {
    const em = $('lEmail').value.trim(); if (!okEmail(em)) { $('lMsg').textContent = 'Enter your email.'; return; }
    try { $('lMsg').textContent = 'Sending…'; await Store.emailLink(em); await Store.refreshUser(); retypeEmail = false; $('lMsg').textContent = ''; renderSettings(); }
    catch (e) { $('lMsg').textContent = /rate|too many/i.test(e.message || '') ? 'Too many emails just now. Wait a few minutes and try again.' : (e.message || 'Couldn’t send. Check you’re online.'); }
  });
  $('lPk').addEventListener('click', async () => {
    try {
      $('lMsg').textContent = 'Checking your email is confirmed…';
      await Store.refreshUser();
      if (Store.isAnonymous) { $('lMsg').textContent = 'Not confirmed yet. Tap the link in the email first (check spam too).'; return; }
      $('lMsg').textContent = 'Waiting for Face ID…';
      await Store.passkeyAdd(); $('lMsg').textContent = ''; renderSettings(); renderSetup(); toast('Face ID sign-in is on');
    } catch (e) { $('lMsg').textContent = pkError(e); }
  });
  $('pkAdd').addEventListener('click', async () => {
    try { $('pkMsg').textContent = 'Waiting for Face ID…'; await Store.passkeyAdd(); $('pkMsg').textContent = ''; renderSettings(); renderSetup(); toast('Face ID sign-in is on'); }
    catch (e) { $('pkMsg').textContent = pkError(e); }
  });
  $('aOut').addEventListener('click', async () => { await Store.signOut(); renderSettings(); toast('Signed out. Your data stays on this phone.'); });
  $('aSync').addEventListener('click', async () => { await Store.sync(); toast(Store.status === 'synced' ? 'Synced' : 'Sync didn’t finish, it will retry'); });

  // Apple Watch link
  let watchLink = '';
  // Permanent Shortcut link: loaded from your account each time the card shows
  let wConfirmAct = null;
  async function loadWatchLink(force) {
    if (!Store.user) return;
    if (watchLink && !force) return;
    try {
      const t = await Store.getHealthToken();
      watchLink = Store.healthLink(t);
      $('wLink').textContent = watchLink; $('wHead').textContent = Store.healthHeader(); $('pLink').textContent = watchLink.replace('action=health', 'action=ping');
    } catch (e) { $('wLink').textContent = 'Couldn’t load your link. Check you’re online.'; }
  }
  const copyText = async (t, ok) => { try { await navigator.clipboard.writeText(t); toast(ok); } catch (e) { toast('Copy didn’t work here: press and hold the text instead.'); } };
  // iPhone only allows copying straight from the tap, so the script is fetched ahead of time
  let widgetTpl = null;
  const loadWidgetTpl = () => { if (!widgetTpl) fetch('widget/cut-log-widget.js', { cache: 'no-cache' }).then(r => r.ok ? r.text() : null).then(t => { widgetTpl = t; }).catch(() => {}); };
  $('widgetCopy').addEventListener('click', () => {
    if (!watchLink || !widgetTpl) { loadWidgetTpl(); loadWatchLink(true); toast('Getting your widget ready. Tap again in a second.'); return; }
    copyText(widgetTpl.replace('__LINK__', watchLink.replace('action=health', 'action=widget')).replace('__AUTH__', Store.healthHeader()), 'Widget script copied. Paste it into Scriptable.');
  });
  $('pCopy').addEventListener('click', () => { if (watchLink) copyText(watchLink.replace('action=health', 'action=ping'), 'Phone-use link copied'); });
  $('pCopyHead').addEventListener('click', () => copyText(Store.healthHeader(), 'Header copied'));
  $('wNew').addEventListener('click', () => { wConfirmAct = 'new'; $('wConfirmText').textContent = 'Make a new link? The old one stops working, so you’ll need to paste the new one into your Shortcut.'; $('wConfirm').hidden = false; });
  $('wDel').addEventListener('click', () => { wConfirmAct = 'del'; $('wConfirmText').textContent = 'Delete your link? Your Shortcut stops sending until you make a new one.'; $('wConfirm').hidden = false; });
  $('wNo').addEventListener('click', () => { wConfirmAct = null; $('wConfirm').hidden = true; });
  $('wYes').addEventListener('click', async () => {
    $('wConfirm').hidden = true;
    try {
      if (wConfirmAct === 'new') { const t = await Store.createHealthToken(); watchLink = Store.healthLink(t); $('wLink').textContent = watchLink; toast('New link made. Paste it into your Shortcut.'); }
      else if (wConfirmAct === 'del') { await Store.deleteHealthToken(); watchLink = ''; $('wLink').textContent = 'Deleted. Tap Make a new link when you want one.'; toast('Link deleted'); }
    } catch (e) { toast('That didn’t work. Check you’re online.'); }
    wConfirmAct = null;
  });
  $('wCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(watchLink); toast('Link copied'); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('wLink')); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); toast('Selected. Copy it from the menu.'); }
  });
  // Cut Log Sync (iPhone app): one tap creates a key and hands it to the app through its link
  $('appConnect').addEventListener('click', async () => {
    try {
      $('appMsg').textContent = 'Connecting…';
      const t = await Store.getHealthToken();
      const c = window.CUT_CONFIG || {};
      const push = c.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/cut?action=push&k=' + encodeURIComponent(t);
      $('appMsg').textContent = 'Opening Cut Log Sync… If nothing happens, install the app first (steps below).';
      location.href = 'cutlogsync://setup?u=' + encodeURIComponent(push) + '&a=' + encodeURIComponent(c.SUPABASE_ANON_KEY);
    } catch (e) { $('appMsg').textContent = 'Couldn’t connect: check you’re signed in and online.'; }
  });
  $('wCopyHead').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(Store.healthHeader()); toast('Header copied'); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('wHead')); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); toast('Selected. Copy it from the menu.'); }
  });
  function watchLast() {
    let best = null;
    for (const r of Object.values(days())) { const t = r && r.health && r.health.synced_at; if (t && (!best || t > best)) best = t; }
    return best;
  }
  function ago(iso) {
    if (!iso) return '';
    const d = new Date(iso), mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return 'just now'; if (mins < 60) return mins + ' min ago';
    const sameDay = idOf(d) === idOf(new Date()), yest = idOf(d) === idOf(addDays(new Date(), -1));
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return sameDay ? 'today ' + hm : yest ? 'yesterday ' + hm : fmt(d) + ' ' + hm;
  }
  function renderWatch() {
    const u = Store.user, lastW = watchLast();
    $('watchNeedsText').textContent = !Store.connected ? 'Connects once the database is set up.' : 'Sign in to sync first. The Shortcut sends data to your private database.';
    $('watchNeedsAcct').hidden = !!u; $('watchReady').hidden = !u;
    $('widgetNeeds').hidden = !!u; $('widgetReady').hidden = !u; if (u) loadWidgetTpl();
    if (u) loadWatchLink(false); else watchLink = '';
    $('watchStatus').textContent = lastW ? 'Last sync ' + ago(lastW) : 'Not connected';
    $('wRun').hidden = !lastW;
  }

  // ---------- Home: Get set up ----------
  let setupHidden = false; try { setupHidden = localStorage.getItem('cutlog-setup-hidden') === '1'; } catch (e) {}
  let remOnCache = false;
  async function renderSetup() {
    if (!Store.connected) { $('setup').hidden = true; return; }
    const sub = await currentSub(); remOnCache = !!sub && 'Notification' in window && Notification.permission === 'granted';
    const items = [];
    if (isIOS && !standalone()) items.push({ k: 'home', done: false, t: 'Add to your Home Screen', s: 'In Safari: Share, then Add to Home Screen. Open it from the icon.' });
    items.push({ k: 'backup', done: !!Store.user, t: 'Back up', s: Store.user ? 'Backed up automatically' : 'Keep a copy safe in your private database', btn: 'Back up' });
    const anon = Store.isAnonymous, hasPk = Store.passkeys.length > 0;
    items.push({ k: 'pk', done: hasPk, t: 'Face ID sign-in', s: hasPk ? 'On: restore on any of your Apple devices' : (Store.user && !anon ? 'One tap, then Face ID' : 'Restore everything on a new phone'), btn: 'Turn on' });
    items.push({ k: 'rem', done: remOnCache, t: 'Reminders', s: remOnCache ? 'On: protein days, Sundays, recaps' : 'One tap, then Allow', btn: 'Turn on' });
    // the watch counts as set up once any watch data or a Health history import has arrived
    const watchOn = !!(watchLast() || lastImport() || [0, 1, 2, 3, 4, 5, 6].some(i => { const r = days()[idOf(addDays(today, -i))]; return r && r.health; }));
    items.push({ k: 'watch', done: watchOn, t: 'Apple Watch', s: watchOn ? 'Connected' : 'Free Shortcut, about 5 minutes', btn: 'Set up' });
    // The card is for the essentials: once you're backed up and your watch is connected, it goes away by itself.
    // "Hide" is saved with your account, so it stays hidden after reinstalling.
    const essentialsDone = !!Store.user && watchOn;
    $('setup').hidden = essentialsDone || setupHidden || !!(plan() && plan().hideSetup);
    $('setupList').innerHTML = items.map(i => '<li class="' + (i.done ? 'done' : '') + '"><div><b>' + esc(i.t) + '</b><span>' + esc(i.s) + '</span></div>' +
      (i.done ? '<span class="tick" aria-label="Done">✓</span>' : i.btn ? '<button class="btn primary" type="button" data-setup="' + i.k + '">' + esc(i.btn) + '</button>' : '') + '</li>').join('');
  }
  $('setupList').addEventListener('click', e => {
    const b = e.target.closest('[data-setup]'); if (!b) return;
    const k = b.dataset.setup;
    if (k === 'rem') {
      if (!Store.user) { show('settings'); toast('Back up first, then reminders can switch on.'); return; }
      if (isIOS && !standalone()) { toast('Add the app to your Home Screen first.'); return; }
      turnOnReminders();
    } else if (k === 'backup') { show('settings'); }
    else if (k === 'pk') {
      if (Store.user && !Store.isAnonymous) Store.passkeyAdd().then(() => { toast('Face ID sign-in is on'); renderSetup(); }).catch(err => toast(esc(pkError(err))));
      else { show('settings'); setTimeout(() => { const f = Store.user ? $('lEmail') : $('aEmail'); if (f) f.focus(); }, 60); }
    }
    else if (k === 'watch') { show('settings'); setTimeout(() => { $('watchCard').scrollIntoView({ behavior: 'smooth' }); $('wGuide').open = true; }, 50); }
  });
  $('setupHide').addEventListener('click', async () => {
    setupHidden = true; $('setup').hidden = true;
    try { localStorage.setItem('cutlog-setup-hidden', '1'); } catch (e) {}
    try { await Store.savePlan(Object.assign({}, plan(), { hideSetup: true })); } catch (e) {}
  });

  // data safety
  function renderSafe() {
    const n = Object.values(days()).filter(r => r && Object.keys(r).some(k => k !== 'health' && r[k] != null && r[k] !== false && r[k] !== '')).length;
    const u = Store.user, items = [];
    items.push(['', 'Every tap is written to this phone’s storage before the screen updates, so closing the app can’t lose it. ' + n + ' day' + (n === 1 ? '' : 's') + ' saved here.']);
    if (Store.persisted === true || standalone()) items.push(['', 'Protected: the phone won’t clear this app’s storage on its own' + (standalone() ? ' (opened from the Home Screen).' : '.')]);
    else items.push(['warn', 'This browser may clear storage it thinks is unused. Open the app from your Home Screen icon to protect it, and keep the cloud copy on.']);
    if (!Store.connected) items.push(['off', 'Cloud copy isn’t connected yet.']);
    else if (!u) items.push(['warn', 'Cloud copy is off: sign in above and everything uploads.']);
    else {
      const p = Store.pending;
      items.push([p ? 'warn' : '', p ? p + ' change' + (p === 1 ? '' : 's') + ' waiting to upload. They go up as soon as you’re online.' : 'Cloud copy up to date' + (Store.lastSyncAt ? ', last synced ' + ago(Store.lastSyncAt) : '') + '. A new phone gets everything back by signing in.']);
    }
    $('safeList').innerHTML = items.map(([c, t]) => '<li' + (c ? ' class="' + c + '"' : '') + '>' + esc(t) + '</li>').join('');
    $('safeStatus').textContent = !u ? 'Phone only' : Store.pending ? 'Uploading' : 'Safe';
    $('safeCheck').hidden = !u;
    // Home banner: data that exists only on this phone
    $('safeBanner').hidden = !(Store.connected && !u);
    $('safeBannerTitle').textContent = n > 0 ? 'You’re signed out' : 'Sign in or create an account';
    $('safeBannerText').textContent = n > 0 ? 'Sign in so your data syncs and stays backed up.' : 'Your days, watch data and settings then sync and stay backed up.';
  }
  $('safeCheck').addEventListener('click', async () => {
    $('safeMsg').textContent = 'Checking every day against the cloud copy…';
    try {
      const r = await Store.verify();
      $('safeMsg').textContent = r.fixed
        ? r.fixed + ' day' + (r.fixed === 1 ? ' was' : 's were') + ' missing or out of date in the cloud and ' + (r.pending ? 'will upload when you’re online.' : (r.fixed === 1 ? 'has' : 'have') + ' been uploaded again. Everything matches now.')
        : 'All ' + r.local + ' days on this phone match the cloud copy exactly.';
      renderSafe();
    } catch (e) { $('safeMsg').textContent = navigator.onLine ? (e.message || 'The check didn’t finish.') : 'You’re offline. Your data is safe on the phone; check again when you’re online.'; }
  });
  $('safeBannerGo').addEventListener('click', () => { show('settings', true); setTimeout(() => { $('acct').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); });

  // reminders (web push)
  const REM_KEY = 'cutlog-rem';
  let remPrefs = { hour: 20, log: true, protein: true, waist: true, morning: true, history: true, weekly: true, stalled: true, water: true, mhour: 8 };
  try { const j = JSON.parse(localStorage.getItem(REM_KEY) || 'null'); if (j) remPrefs = Object.assign(remPrefs, j); } catch (e) {}
  let remSaveT = null;
  // every change goes straight to this phone's subscription on the server: no Save button to forget
  const saveRemLocal = () => {
    try { localStorage.setItem(REM_KEY, JSON.stringify(remPrefs)); } catch (e) {}
    clearTimeout(remSaveT); remSaveT = setTimeout(async () => { const sub = await currentSub(); if (sub && Store.user && Notification.permission === 'granted') { try { await Store.savePushSubscription(sub, remPrefs); remMsg('Saved.'); } catch (e) {} } }, 500);
  };
  const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const remMsg = t => { $('remMsg').textContent = t; };
  const vapidBytes = k => { const b = (k + '='.repeat((4 - k.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); const r = atob(b); return Uint8Array.from(r, c => c.charCodeAt(0)); };
  (function fillHours() { const sel = $('remHour'); for (let h = 0; h < 24; h++) { const o = document.createElement('option'); o.value = h; o.textContent = pad(h) + ':00'; sel.appendChild(o); $('remMHour').appendChild(o.cloneNode(true)); } })();
  async function currentSub() { if (!pushOK()) return null; try { const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 2000))]); return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; } }
  async function renderRem() {
    $('remHour').value = String(remPrefs.hour); $('remMHour').value = String(remPrefs.mhour); setSeg($('segRem'), remPrefs);
    const u = Store.user;
    let why = '';
    if (!Store.connected) why = 'Reminders switch on once the database is connected.';
    else if (!u) why = 'Sign in to sync first. Reminders are sent from your private database.';
    else if (isIOS && !standalone()) why = 'On iPhone, reminders only work once the app is on your Home Screen: Safari, Share, Add to Home Screen, then open it from there.';
    else if (!pushOK()) why = 'This browser can’t receive notifications.';
    $('remNeeds').hidden = !why; $('remNeedsText').textContent = why; $('remReady').hidden = !!why;
    if (why) { $('remStatus').textContent = 'Off'; return; }
    const sub = await currentSub(), on = !!sub && Notification.permission === 'granted';
    $('remStatus').textContent = on ? 'On' : Notification.permission === 'denied' ? 'Blocked' : 'Off';
    $('remOn').hidden = on; $('remOn').textContent = 'Turn on reminders';
    $('remTest').hidden = !on; $('remOff').hidden = !on;
    if (Notification.permission === 'denied') remMsg('Notifications are blocked for this app. Allow them in your phone’s Settings, then come back.');
  }
  $('remHour').addEventListener('change', () => { remPrefs.hour = Number($('remHour').value); saveRemLocal(); });
  $('remMHour').addEventListener('change', () => { remPrefs.mhour = Number($('remMHour').value); saveRemLocal(); });
  $('segRem').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; remPrefs[b.dataset.v] = !remPrefs[b.dataset.v]; saveRemLocal(); setSeg($('segRem'), remPrefs); });
  $('remOn').addEventListener('click', () => turnOnReminders());
  async function turnOnReminders() {
    try {
      remMsg('Asking for permission…');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { remMsg('Permission wasn’t given, so no reminders. You can allow it later in Settings.'); renderRem(); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(await Store.vapidPublic()) });
      await Store.savePushSubscription(sub, remPrefs);
      remMsg(''); toast('Reminders on. Autopilot sends them for you.'); renderRem(); renderSetup();
    } catch (e) { console.error(e); remMsg('Couldn’t turn reminders on. Check you’re online, then try again.'); toast('Couldn’t turn reminders on. Try again in Settings.'); }
  }
  $('remTest').addEventListener('click', async () => {
    // A real push from the server, the same route the daily reminder takes.
    try { remMsg('Sending a test…'); const sub = await currentSub(); const r = await Store.testPush(sub && sub.endpoint); remMsg(r.result === 'sent' ? 'Sent. It should arrive in a few seconds.' : 'The push service said: ' + r.result); }
    catch (e) { remMsg(e.message || 'The test didn’t send. Check you’re online.'); }
  });
  $('remOff').addEventListener('click', async () => {
    const sub = await currentSub();
    if (sub) { try { await Store.removePushSubscription(sub.endpoint); } catch (e) {} try { await sub.unsubscribe(); } catch (e) {} }
    toast('Reminders off'); remMsg(''); renderRem();
  });

  // backup
  $('bExport').addEventListener('click', () => {
    const data = { app: 'cut-log', version: 1, exported: new Date().toISOString(), plan: plan(), days: days() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cut-log-backup-' + idOf(today) + '.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  let pendingImport = null;
  $('bImport').addEventListener('change', async () => {
    const f = $('bImport').files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || typeof j !== 'object' || !j.days || typeof j.days !== 'object') throw new Error('shape');
      pendingImport = j;
      $('bConfirmText').textContent = 'This file has ' + Object.keys(j.days).length + ' days. Replace what’s on this phone?';
      $('bConfirm').hidden = false;
    } catch (e) { toast('That file isn’t a Cut Log backup.'); }
    $('bImport').value = '';
  });
  $('bNo').addEventListener('click', () => { pendingImport = null; $('bConfirm').hidden = true; });
  $('bYes').addEventListener('click', async () => {
    if (!pendingImport) return;
    const clean = {};
    for (const [id, r] of Object.entries(pendingImport.days)) { if (/^\d{4}-\d{2}-\d{2}$/.test(id) && r && typeof r === 'object') { const c = Object.assign({}, r); delete c.health; clean[id] = c; } }
    await Store.replaceAll(pendingImport.plan || null, clean);
    pendingImport = null; $('bConfirm').hidden = true; render(); toast('Backup loaded');
  });

  // ---------- boot ----------
  setInterval(() => { const n = new Date(); if (idOf(n) !== idOf(today)) { today = n; render(); } }, 60000);
  Store.on(kind => { if (kind === 'data') render(); if (kind === 'status' || kind === 'auth') { renderSync(); renderSafe(); renderSetup(); if (last) { renderToday(last); renderAuto(); } if (!$('tab-settings').hidden) renderSettings(); } });

  Store.init(PLAN_DEFAULT).then(() => {
    renderMode(); render(); renderSync();
    show(location.hash.slice(1), false);
  }).catch(err => { console.error(err); toast('Storage isn’t available in this browser mode.'); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
