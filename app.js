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

  const PLAN_DEFAULT = { start: '2026-10-14', startWeight: 102, goal: 85, markWeeks: 6, proteinAnchor: '2026-10-25', proteinEvery: 3, proteinKcal: 600, baseBurn: 2400, sessionKcal: 1000, kcalPerKg: 7700 };
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
  const days = () => Store.days;
  let today = new Date();
  let viewY = today.getFullYear(), viewM = today.getMonth();
  let sel = idOf(today);
  let last = null;
  let mode = 'day'; try { const m = localStorage.getItem('cutlog-mode'); if (m === 'day' || m === 'gym' || m === 'details') mode = m; } catch (e) {}

  const rec = id => Object.assign({ mark: null, broken: false, am: false, pm: false, weight: null, waist: null, curl: null, chest: null, protein: null, gymKcal: null, food: null, health: null }, days()[id] || {});
  const H = (r, k) => (r.health && typeof r.health[k] === 'number') ? r.health[k] : null;
  const userSess = r => (r.am ? 1 : 0) + (r.pm ? 1 : 0);
  const watchSess = r => userSess(r) ? 0 : Math.min(2, Math.round(H(r, 'workouts') || 0));
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
    if (!r.mark && !sess && r.food == null && r.gymKcal == null) return null;
    const active = H(r, 'active_kcal');
    const gym = r.gymKcal != null ? r.gymKcal : (active != null ? active : sess * p.sessionKcal);
    const rest = H(r, 'resting_kcal') != null ? H(r, 'resting_kcal') : p.baseBurn;
    const taken = !!(prot[id] && prot[id].taken);
    const food = r.food != null ? r.food : (r.mark === 'cheat' ? rest : (taken ? p.proteinKcal : 0));
    const burn = rest + gym, deficit = burn - food;
    return { burn, gym, rest, food, foodAuto: r.food == null, gymSrc: r.gymKcal != null ? 'you' : (active != null ? 'watch' : 'auto'), restSrc: H(r, 'resting_kcal') != null ? 'watch' : 'auto', deficit, kg: deficit / p.kcalPerKg, protein: taken };
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
    $('wake').textContent = 'Tomorrow morning ≈ ' + st.tomorrow.toFixed(1) + ' kg' + (Math.abs(dTm) >= 0.05 ? ' (' + (dTm > 0 ? '−' : '+') + Math.abs(dTm).toFixed(2) + ')' : '');
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
    void endV;
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
    setSeg($('segGym'), { am: r.am, pm: r.pm });
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
    $('fFood').placeholder = (r.mark === 'cheat' ? kfmt(en ? en.rest : p.baseBurn) : (taken ? kfmt(p.proteinKcal) : '0')) + ' (auto)';
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
    last = compute();
    renderHome(last); renderCal(last); renderSheet(last); renderStats(last); renderBadges(last);
    renderWatchToday(); renderSafe(); renderSetup();
  }
  function renderWatchToday() {
    const lastW = watchLast(), r = rec(idOf(today)), h = r.health || {};
    $('watchToday').hidden = !lastW;
    if (!lastW) return;
    $('wtWhen').textContent = 'Synced ' + ago(lastW);
    $('wtWork').textContent = h.workouts != null ? h.workouts : '–';
    $('wtActive').textContent = h.active_kcal != null ? kfmt(h.active_kcal) : '–';
    $('wtSteps').textContent = h.steps != null ? kfmt(h.steps) : '–';
  }

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
  function setMark(id, m) { sel = id; change(id, r => { r.mark = m; }, markMsg(m)); }
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
  $('segGym').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const v = b.dataset.v;
    const on = !rec(sel)[v]; change(sel, r => { r[v] = on; }, on ? 'Session logged' : 'Session removed'); });
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
  const TABS = ['home', 'log', 'stats', 'badges', 'settings'];
  function show(t, scroll) {
    if (!TABS.includes(t)) t = 'home';
    TABS.forEach(n => { $('tab-' + n).hidden = n !== t; });
    document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.go === t ? 'true' : 'false'));
    try { history.replaceState(null, '', '#' + t); } catch (e) {}
    if (scroll !== false) window.scrollTo(0, 0);
    if (t === 'stats') renderPhotos();
    if (t === 'settings') renderSettings();
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
  }
  $('photoA').addEventListener('change', () => showPhoto('photoAImg', $('photoA').value));
  $('photoB').addEventListener('change', () => showPhoto('photoBImg', $('photoB').value));
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

  // ---------- settings ----------
  const SET = [['sStart', 'start', 'd'], ['sStartW', 'startWeight'], ['sGoal', 'goal'], ['sBase', 'baseBurn'], ['sSess', 'sessionKcal'], ['sPerKg', 'kcalPerKg'], ['sProtK', 'proteinKcal'], ['sProtE', 'proteinEvery'], ['sProtA', 'proteinAnchor', 'd'], ['sWeeks', 'markWeeks']];
  function renderSettings() {
    const p = plan();
    SET.forEach(([i, k]) => { if (document.activeElement !== $(i)) $(i).value = p[k]; });
    const cfg = !!Store.connected, u = Store.user, anon = Store.isAnonymous;
    $('acctNoCfg').hidden = cfg; $('acctForm').hidden = !cfg || (!!u && !showSignIn); $('acctIn').hidden = !u || anon; $('acctAnon').hidden = !u || !anon || showSignIn;
    if (u && !anon) {
      $('aWho').textContent = u.email || 'you';
      const pk = Store.passkeys;
      $('pkOffer').hidden = pk.length > 0; $('pkOn').hidden = !pk.length;
      $('pkNames').textContent = pk.length ? ' (' + pk.map(x => x.friendly_name || x.friendlyName || 'passkey').join(', ') + ')' : '';
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
      else { const n = num(v); if (n != null && n > 0) p[k] = n; }
    }
    p.proteinEvery = Math.max(1, Math.round(p.proteinEvery)); p.markWeeks = Math.max(1, Math.round(p.markWeeks));
    await Store.savePlan(p); render(); toast('Plan saved');
  });

  function renderSync() {
    const s = Store.status, dot = $('syncDot');
    const text = { local: 'On this phone only', signedout: 'Not signed in', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline, will sync later', error: 'Sync problem, will retry' }[s] || s;
    dot.dataset.s = s; dot.setAttribute('aria-label', text); dot.title = text; $('syncText').textContent = text;
  }
  const authMsg = t => { $('aMsg').textContent = t; };
  const pkError = e => {
    const c = (e && (e.code || e.name || '')) + ' ' + (e && e.message || '');
    if (/NotAllowed|AbortError|cancel/i.test(c)) return 'Cancelled.';
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
  $('aLink').addEventListener('click', async () => {
    const em = $('aEmail').value.trim(); if (!okEmail(em)) { authMsg('Enter your email.'); return; }
    try { authMsg('Sending…'); await Store.emailLink(em); authMsg('Sent. Open the email on this phone and tap the link. Once you’re in, tap Turn on Face ID and you won’t need email again.'); }
    catch (e) { authMsg(/rate|too many/i.test(e.message || '') ? 'Too many emails just now. Wait a few minutes and try again.' : (e.message || 'Couldn’t send. Check you’re online.')); }
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
  $('wToken').addEventListener('click', async () => {
    try {
      const t = await Store.createHealthToken();
      watchLink = Store.healthLink(t);
      $('wLink').textContent = watchLink; $('wHead').textContent = Store.healthHeader(); $('wOut').hidden = false; $('wGuide').open = true;
      toast('Link created. Copy it now.');
    } catch (e) { toast('Couldn’t create the link. Check you’re signed in and online.'); }
  });
  $('wCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(watchLink); toast('Link copied'); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('wLink')); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); toast('Selected. Copy it from the menu.'); }
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
    items.push({ k: 'rem', done: remOnCache, t: 'Daily reminder', s: remOnCache ? 'On at ' + pad(remPrefs.hour) + ':00' : 'One tap, then Allow', btn: 'Turn on' });
    items.push({ k: 'watch', done: !!watchLast(), t: 'Apple Watch', s: watchLast() ? 'Connected' : 'Free Shortcut, about 5 minutes', btn: 'Set up' });
    const allDone = items.every(i => i.done);
    $('setup').hidden = allDone || setupHidden;
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
  $('setupHide').addEventListener('click', () => { setupHidden = true; try { localStorage.setItem('cutlog-setup-hidden', '1'); } catch (e) {} $('setup').hidden = true; });

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
    $('safeBanner').hidden = !(n > 0 && Store.connected && !u);
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
  $('safeBannerGo').addEventListener('click', () => show('settings', true));

  // reminders (web push)
  const REM_KEY = 'cutlog-rem';
  let remPrefs = { hour: 20, log: true, protein: true, waist: true };
  try { const j = JSON.parse(localStorage.getItem(REM_KEY) || 'null'); if (j) remPrefs = Object.assign(remPrefs, j); } catch (e) {}
  const saveRemLocal = () => { try { localStorage.setItem(REM_KEY, JSON.stringify(remPrefs)); } catch (e) {} };
  const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const remMsg = t => { $('remMsg').textContent = t; };
  const vapidBytes = k => { const b = (k + '='.repeat((4 - k.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); const r = atob(b); return Uint8Array.from(r, c => c.charCodeAt(0)); };
  (function fillHours() { const sel = $('remHour'); for (let h = 0; h < 24; h++) { const o = document.createElement('option'); o.value = h; o.textContent = pad(h) + ':00'; sel.appendChild(o); } })();
  async function currentSub() { if (!pushOK()) return null; try { const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 2000))]); return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; } }
  async function renderRem() {
    $('remHour').value = String(remPrefs.hour); setSeg($('segRem'), remPrefs);
    const u = Store.user;
    let why = '';
    if (!Store.connected) why = 'Reminders switch on once the database is connected.';
    else if (!u) why = 'Sign in to sync first. Reminders are sent from your private database.';
    else if (isIOS && !standalone()) why = 'On iPhone, reminders only work once the app is on your Home Screen: Safari, Share, Add to Home Screen, then open it from there.';
    else if (!pushOK()) why = 'This browser can’t receive notifications.';
    $('remNeeds').hidden = !why; $('remNeedsText').textContent = why; $('remReady').hidden = !!why;
    if (why) { $('remStatus').textContent = 'Off'; return; }
    const sub = await currentSub(), on = !!sub && Notification.permission === 'granted';
    $('remStatus').textContent = on ? 'On at ' + pad(remPrefs.hour) + ':00' : Notification.permission === 'denied' ? 'Blocked' : 'Off';
    $('remOn').textContent = on ? 'Save reminder settings' : 'Turn on reminders';
    $('remTest').hidden = !on; $('remOff').hidden = !on;
    if (Notification.permission === 'denied') remMsg('Notifications are blocked for this app. Allow them in your phone’s Settings, then come back.');
  }
  $('remHour').addEventListener('change', () => { remPrefs.hour = Number($('remHour').value); saveRemLocal(); });
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
      remMsg(''); toast('Reminders on at ' + pad(remPrefs.hour) + ':00'); renderRem(); renderSetup();
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
  Store.on(kind => { if (kind === 'data') render(); if (kind === 'status' || kind === 'auth') { renderSync(); renderSafe(); renderSetup(); if (!$('tab-settings').hidden) renderSettings(); } });

  Store.init(PLAN_DEFAULT).then(() => {
    renderMode(); render(); renderSync();
    show(location.hash.slice(1), false);
  }).catch(err => { console.error(err); toast('Storage isn’t available in this browser mode.'); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
