// Cut Log storage: IndexedDB on the device (offline-first) + optional Supabase sync.
(function () {
  const DB_NAME = 'cutlog', DB_VER = 1;
  let idb = null, sb = null, user = null;
  const listeners = new Set();
  const state = { days: {}, plan: null, outbox: new Set(), planDirty: false, lastPull: null, status: 'local', lastSyncAt: null, persisted: null };

  // ---------- IndexedDB helpers ----------
  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('days')) d.createObjectStore('days');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = idb.transaction(store, mode), s = t.objectStore(store);
      let out; try { out = fn(s); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out && 'result' in out ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  const put = (store, key, val) => tx(store, 'readwrite', s => s.put(val, key));
  const del = (store, key) => tx(store, 'readwrite', s => s.delete(key));
  const get = (store, key) => tx(store, 'readonly', s => s.get(key));
  function getAll(store) {
    return new Promise((res, rej) => {
      const out = {}, t = idb.transaction(store, 'readonly'), c = t.objectStore(store).openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { out[cur.key] = cur.value; cur.continue(); } };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
    });
  }

  function setStatus(s) { if (state.status !== s) { state.status = s; emit('status'); } }
  function emit(kind) { listeners.forEach(fn => { try { fn(kind); } catch (e) { console.error(e); } }); }
  async function saveOutbox() { await put('meta', 'outbox', { days: [...state.outbox], plan: state.planDirty }); }

  // ---------- public API ----------
  const Store = {
    get days() { return state.days; },
    get plan() { return state.plan; },
    get status() { return state.status; },
    get user() { return user; },
    get connected() { return !!sb; },
    get pending() { return state.outbox.size + (state.planDirty ? 1 : 0); },
    get lastSyncAt() { return state.lastSyncAt; },
    get persisted() { return state.persisted; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async init(defaultPlan) {
      idb = await openDB();
      state.days = await getAll('days');
      state.plan = Object.assign({}, defaultPlan, (await get('meta', 'plan')) || {});
      const ob = await get('meta', 'outbox'); if (ob) { state.outbox = new Set(ob.days || []); state.planDirty = !!ob.plan; }
      state.lastPull = (await get('meta', 'lastPull')) || null;
      state.lastSyncAt = (await get('meta', 'lastSyncAt')) || null;
      // Ask the browser to never clear this app's storage on its own (granted automatically
      // for Home Screen apps on iPhone and for installed apps elsewhere).
      try {
        if (navigator.storage && navigator.storage.persisted) state.persisted = await navigator.storage.persisted();
        if (!state.persisted && navigator.storage && navigator.storage.persist) state.persisted = await navigator.storage.persist();
      } catch (e) {}
      const cfg = window.CUT_CONFIG || {};
      if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
        sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, experimental: { passkey: true } } });
        const { data } = await sb.auth.getSession();
        user = data.session ? data.session.user : null;
        // No account yet: back up automatically with an anonymous account (if the project allows it).
        // Adding an email later keeps the same account, so nothing moves.
        if (!user && navigator.onLine) {
          try { const r = await sb.auth.signInAnonymously(); if (!r.error && r.data && r.data.user) { user = r.data.user; state.autoBackup = true; } else state.autoBackup = false; }
          catch (e) { state.autoBackup = false; }
        }
        sb.auth.onAuthStateChange((_e, session) => { const was = user && user.id; user = session ? session.user : null; emit('auth'); if (user && user.id !== was) Store._onUser(); });
        setStatus(user ? (navigator.onLine ? 'syncing' : 'offline') : 'signedout');
        if (user) Store._onUser();
      }
      window.addEventListener('online', () => Store.sync());
      window.addEventListener('offline', () => { if (user) setStatus('offline'); });
      // Visible: pull anything new (e.g. tonight's watch data). Hidden (app closed or switched away):
      // push anything waiting straight away. Every tap is already on the phone's disk before this.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' || Store.pending) Store.sync(); });
      window.addEventListener('pagehide', () => { if (Store.pending) Store.sync(); });
      setInterval(() => { if (document.visibilityState === 'visible') Store.sync(); }, 60000);
    },

    async saveDay(id, rec) {
      const health = state.days[id] && state.days[id].health;
      const clean = rec ? Object.assign({}, rec) : {};
      delete clean.health;
      const empty = !Object.values(clean).some(v => v !== null && v !== false && v !== undefined && v !== '');
      if (empty && !health) { delete state.days[id]; await del('days', id); }
      else { state.days[id] = Object.assign(empty ? {} : clean, health ? { health } : {}); await put('days', id, state.days[id]); }
      if (sb) { state.outbox.add(id); await saveOutbox(); Store.syncSoon(); }
    },

    async savePlan(plan) {
      state.plan = Object.assign({}, plan); await put('meta', 'plan', state.plan);
      if (sb) { state.planDirty = true; await saveOutbox(); Store.syncSoon(); }
    },

    async replaceAll(plan, days) {
      for (const id of Object.keys(state.days)) await del('days', id);
      state.days = {};
      for (const [id, rec] of Object.entries(days || {})) { state.days[id] = rec; await put('days', id, rec); if (sb) state.outbox.add(id); }
      if (plan) { state.plan = Object.assign({}, state.plan, plan); await put('meta', 'plan', state.plan); if (sb) state.planDirty = true; }
      if (sb) { await saveOutbox(); Store.syncSoon(); }
    },

    _t: null,
    syncSoon() { clearTimeout(Store._t); Store._t = setTimeout(() => Store.sync(), 1200); },

    _running: null,
    async sync() {
      if (!sb || !user) return;
      if (!navigator.onLine) { setStatus('offline'); return; }
      if (Store._running) return Store._running;
      Store._running = (async () => {
        setStatus('syncing');
        try {
          // push days
          const ids = [...state.outbox];
          if (ids.length) {
            const rows = ids.map(id => { const r = Object.assign({}, state.days[id] || {}); delete r.health; return { user_id: user.id, day: id, data: r, updated_at: new Date().toISOString() }; });
            const { error } = await sb.from('days').upsert(rows, { onConflict: 'user_id,day' });
            if (error) throw error;
            ids.forEach(id => state.outbox.delete(id));
          }
          if (state.planDirty) {
            const { error } = await sb.from('settings').upsert({ user_id: user.id, data: state.plan, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
            if (error) throw error;
            state.planDirty = false;
          }
          await saveOutbox();
          // pull days
          let q = sb.from('days').select('day,data,health,updated_at').order('updated_at', { ascending: true }).limit(1000);
          // Look back 5 minutes past the last pull: re-reading a row is harmless, missing one isn't.
          if (state.lastPull) q = q.gt('updated_at', new Date(new Date(state.lastPull).getTime() - 5 * 60000).toISOString());
          const { data: rows, error: e2 } = await q;
          if (e2) throw e2;
          let changed = false;
          for (const row of rows || []) {
            const id = row.day;
            const local = state.days[id] || {};
            const base = state.outbox.has(id) ? Object.assign({}, local) : Object.assign({}, row.data || {});
            delete base.health;
            const rec = Object.assign(base, row.health ? { health: row.health } : {});
            if (JSON.stringify(rec) !== JSON.stringify(state.days[id] || {})) {
              if (Object.keys(rec).length) { state.days[id] = rec; await put('days', id, rec); }
              else if (state.days[id]) { delete state.days[id]; await del('days', id); }
              changed = true;
            }
            if (!state.lastPull || row.updated_at > state.lastPull) state.lastPull = row.updated_at;
          }
          await put('meta', 'lastPull', state.lastPull);
          // pull settings
          if (!state.planDirty) {
            const { data: srow } = await sb.from('settings').select('data').eq('user_id', user.id).maybeSingle();
            if (srow && srow.data && JSON.stringify(srow.data) !== JSON.stringify(state.plan)) { state.plan = Object.assign({}, state.plan, srow.data); await put('meta', 'plan', state.plan); changed = true; }
          }
          state.lastSyncAt = new Date().toISOString(); await put('meta', 'lastSyncAt', state.lastSyncAt);
          setStatus('synced');
          if (changed) emit('data');
        } catch (err) {
          console.error('sync failed', err);
          setStatus(navigator.onLine ? 'error' : 'offline');
        } finally { Store._running = null; }
      })();
      return Store._running;
    },

    // ---------- account ----------
    async signOut() { if (sb) await sb.auth.signOut(); user = null; await del('meta', 'lastPull'); state.lastPull = null; setStatus('signedout'); emit('auth'); },
    // First time on this phone with this account: upload everything already on the phone, then sync.
    async _onUser() {
      if (!user) return;
      Store.refreshPasskeys();
      const done = await get('meta', 'uploadedFor');
      if (done !== user.id && Object.keys(state.days).length) { await Store.firstSyncUploadAll(); await put('meta', 'uploadedFor', user.id); }
      else { if (done !== user.id) await put('meta', 'uploadedFor', user.id); await Store.sync(); }
    },
    get isAnonymous() { return !!(user && (user.is_anonymous || (!user.email && !user.phone))); },
    get autoBackup() { return state.autoBackup; },
    // ---------- Face ID (passkeys) + email links, no passwords ----------
    get passkeys() { return state.passkeys || []; },
    async refreshPasskeys() {
      state.passkeys = [];
      if (!sb || !user || Store.isAnonymous) return [];
      try { const { data } = await sb.auth.passkey.list(); state.passkeys = data || []; } catch (e) {}
      emit('auth'); return state.passkeys;
    },
    async refreshUser() {
      if (!sb || !user) return null;
      const { data } = await sb.auth.getUser(); if (data && data.user) { user = data.user; emit('auth'); }
      return user;
    },
    async passkeySignIn() {
      if (!sb) throw new Error('Not connected yet.');
      const { data, error } = await sb.auth.signInWithPasskey();
      if (error) throw error;
      return data;
    },
    async passkeyAdd() {
      if (!sb || !user) throw new Error('Not connected yet.');
      const { data, error } = await sb.auth.registerPasskey();
      if (error) throw error;
      await Store.refreshPasskeys();
      return data;
    },
    // New or returning user: one-time sign-in link. Automatic (anonymous) account: confirm an email on it.
    async emailLink(email) {
      if (!sb) throw new Error('Not connected yet.');
      const redirect = location.origin + location.pathname;
      if (user && Store.isAnonymous) {
        const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: redirect });
        if (error) throw error; return 'confirm';
      }
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
      if (error) throw error; return 'link';
    },
    async firstSyncUploadAll() { if (!sb || !user) return; Object.keys(state.days).forEach(id => state.outbox.add(id)); state.planDirty = true; await saveOutbox(); await Store.sync(); },

    // ---------- Apple Health link ----------
    async createHealthToken() {
      if (!sb || !user) throw new Error('Sign in first.');
      const { data, error } = await sb.rpc('create_health_token');
      if (error) throw error;
      return data;
    },
    healthEndpoint() { const c = window.CUT_CONFIG || {}; return c.SUPABASE_URL ? c.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/health_sync' : ''; },

    // ---------- photos ----------
    async putPhoto(key, blob) {
      await put('photos', key, blob);
      if (sb && user && navigator.onLine) {
        try { await sb.storage.from('photos').upload(user.id + '/' + key + '.jpg', blob, { upsert: true, contentType: 'image/jpeg' }); } catch (e) { console.error(e); }
      }
    },
    async getPhoto(key) {
      const local = await get('photos', key);
      if (local) return local;
      if (sb && user && navigator.onLine) {
        const { data } = await sb.storage.from('photos').download(user.id + '/' + key + '.jpg');
        if (data) { await put('photos', key, data); return data; }
      }
      return null;
    },
    async photoKeys() {
      const keys = new Set(Object.keys(await getAll('photos')));
      if (sb && user && navigator.onLine) {
        try { const { data } = await sb.storage.from('photos').list(user.id, { limit: 200 }); (data || []).forEach(f => keys.add(f.name.replace(/\.jpg$/, ''))); } catch (e) {}
      }
      return [...keys].sort();
    },
    async deletePhoto(key) {
      await del('photos', key);
      if (sb && user) { try { await sb.storage.from('photos').remove([user.id + '/' + key + '.jpg']); } catch (e) {} }
    },

    // ---------- push ----------
    async savePushSubscription(sub, prefs) {
      if (!sb || !user) throw new Error('Sign in first.');
      const j = sub.toJSON();
      let tz = 'Europe/London'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
      const { error } = await sb.from('push_subs').upsert({ user_id: user.id, endpoint: j.endpoint, sub: j, prefs, tz }, { onConflict: 'endpoint' });
      if (error) throw error;
    },
    async removePushSubscription(endpoint) {
      if (!sb || !user) return;
      await sb.from('push_subs').delete().eq('endpoint', endpoint);
    },
    get signedIn() { return !!(sb && user); },

    // Compare every day on this phone with the cloud copy. Anything missing or different
    // in the cloud is uploaded again. Returns what it found.
    async verify() {
      if (!sb || !user) throw new Error('Sign in first.');
      await Store.sync();
      const { data: rows, error } = await sb.from('days').select('day,data');
      if (error) throw error;
      const cloud = {}; (rows || []).forEach(r => { cloud[r.day] = r.data || {}; });
      const norm = o => { const c = Object.assign({}, o || {}); delete c.health; Object.keys(c).forEach(k => { if (c[k] === null || c[k] === false || c[k] === '') delete c[k]; }); return JSON.stringify(Object.keys(c).sort().map(k => [k, c[k]])); };
      const mine = Object.keys(state.days).filter(id => norm(state.days[id]) !== '[]');
      const bad = mine.filter(id => norm(state.days[id]) !== norm(cloud[id]));
      if (bad.length) { bad.forEach(id => state.outbox.add(id)); await saveOutbox(); await Store.sync(); }
      return { local: mine.length, cloud: Object.keys(cloud).filter(id => norm(cloud[id]) !== '[]').length, fixed: bad.length, pending: Store.pending };
    },
    healthHeader() { return 'Bearer ' + ((window.CUT_CONFIG || {}).SUPABASE_ANON_KEY || ''); },
    healthLink(token) { const c = window.CUT_CONFIG || {}; return c.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/cut?action=health&k=' + encodeURIComponent(token); },
    // Reminders: the push key lives in the database; the Edge Function creates it the first time.
    _fn(action, body) {
      const c = window.CUT_CONFIG || {};
      return fetch(c.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/cut?action=' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: c.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + c.SUPABASE_ANON_KEY },
        body: JSON.stringify(body || {})
      }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Reminder service error ' + r.status); return j; });
    },
    async vapidPublic() {
      if (!sb) throw new Error('Supabase is not connected yet.');
      const { data } = await sb.rpc('vapid_public');
      if (data) return data;
      return (await Store._fn('init')).publicKey;
    },
    async testPush(endpoint) { return Store._fn('test', { endpoint }); }
  };

  window.Store = Store;
})();
