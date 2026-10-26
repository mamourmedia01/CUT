# Cut Log

A gamified tracker for a fat-loss cut, built as an installable web app. Streaks, a ten-day boss, XP and badges, gym sessions, an automatic protein schedule, and a countdown to the goal weight based on calories burned versus eaten.

- Works offline: everything saves on the phone first.
- Free to run: GitHub Pages for hosting, Supabase free tier for sync and photos.
- No build step: plain HTML, CSS and JavaScript.

## Files

| File | What it does |
|---|---|
| `index.html` | App layout and styles |
| `app.js` | All the rules: streaks, XP, boss, protein schedule, calories to weight, badges, charts |
| `store.js` | Saves on the phone (IndexedDB) and syncs to Supabase when signed in |
| `sw.js` | Service worker, so the app opens with no signal |
| `config.js` | Supabase address and public key (empty = phone-only mode) |
| `supabase/schema.sql` | Database tables, security rules, Apple Health endpoint, photo storage, reminder functions |
| `supabase/functions/cut/index.ts` | Edge Function: receives Apple Watch data from the iPhone Shortcut and sends daily reminders (Web Push on Web Crypto, no libraries) |
| `.github/workflows/reminders.yml` | Free hourly GitHub Action that pings the function (no secrets) |
| `APPLE-WATCH-SHORTCUT.md` | How to connect the Apple Watch through an iPhone Shortcut |

## Setup

1. **Hosting.** Repo Settings → General → Change visibility → Public. Then Settings → Pages → Deploy from a branch → `main` / root → Save. The app appears at `https://<username>.github.io/cut/`.
2. **Database.** Create a free Supabase project. Open SQL Editor → New query, paste all of `supabase/schema.sql`, Run.
3. **Auth address.** Supabase → Authentication → URL Configuration → Site URL = the GitHub Pages address.
4. **Connect.** Put the Project URL and the `anon` public key into `config.js`. Never put the `service_role` key anywhere in this repo.
5. **Install.** On the iPhone, open the app address in Safari → Share → Add to Home Screen.
6. **Sign in.** Settings tab → Create account, confirm the email, sign in, then "Upload everything from this phone".
7. **Reminders.** Supabase → Edge Functions → Deploy a new function → Via editor. Name it `cut`, paste `supabase/functions/cut/index.ts`, deploy, keeping **Verify JWT** on (the app, the hourly Action and the Shortcut all send the public `anon` key). In the installed app: Settings → Reminders → pick a time → Turn on reminders → Test on this phone.

Reminders need no paid service and no key handling: the function creates its own push key pair on first use and keeps it in a private table, and the GitHub Action only reads the public address from `config.js`. Works on iPhone 16.4 or later once the app is on the Home Screen.

## The rules (summary)

- Day tap modes: Day (completed → cheat → clear), Gym (1 → 2 → 0 sessions), Details. Hold a day to mark the testosterone streak broken.
- Weight: each logged day moves the next morning's estimate by (resting burn + gym burn − food) ÷ 7,700 kg. A weigh-in resets the estimate.
- Protein: every Nth day from the anchor date; taking it on another day resets the rhythm.
- XP: 100 per completed day plus up to +100 for the streak, +20 per intact testosterone-streak day, +30 per session, +50 for a double, +50 comeback, +50 Sunday waist, +75 per PB, +500 per ten-day boss.
