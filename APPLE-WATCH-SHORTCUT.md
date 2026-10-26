# Connect your Apple Watch

Apple only lets App Store apps read Apple Health directly, so the Cut Log uses a free iPhone **Shortcut** instead. It reads today's numbers from Apple Health and sends them to your private database. Takes about 10 minutes, once.

What it sends for the day:

| From Apple Health | Becomes in Cut Log |
|---|---|
| Number of workouts | Gym sessions (1 = Session 1, 2 or more = double) |
| Active Energy | Gym kcal (replaces the 1,000 per session guess) |
| Resting Energy | Resting burn (replaces the flat 2,400) |
| Weight | Weigh-in (if your scale's app saves to Apple Health) |
| Steps | Shown on the day |

Anything you type into the app yourself always wins over the watch.

## 1. Get your key

In the Cut Log: **Settings → Apple Watch → Create Shortcut key**. Tap **Copy all three** and paste them into Notes for a minute. You get:

- **Key**: your personal Shortcut key (shown once; create a new one any time to replace it)
- **Address**: ends in `/rest/v1/rpc/health_sync`
- **App key**: the long public key

## 2. Build the Shortcut

Open the **Shortcuts** app → **+** → name it **Cut Log Sync**. Add these actions in order (search for each by name). Menu wording can differ slightly between iOS versions.

1. **Find Health Samples** → Type: **Workouts**, Start Date **is today**. (On some iOS versions this is a separate **Find Workouts** action.)
2. **Count** → Items (the workouts). Then **Set Variable** → name it `workouts`.
3. **Find Health Samples** → Type: **Active Energy**, Start Date **is today**, **Group By: Day**. Then **Calculate Statistics** → **Sum**. **Set Variable** `active`.
4. **Find Health Samples** → Type: **Resting Energy**, Start Date **is today**, **Group By: Day**. **Calculate Statistics** → **Sum**. **Set Variable** `resting`.
5. **Find Health Samples** → Type: **Steps**, Start Date **is today**, **Group By: Day**. **Calculate Statistics** → **Sum**. **Set Variable** `steps`.
6. **Find Health Samples** → Type: **Weight**, Start Date **is today**, Sort by **Start Date**, Order **Latest First**, **Limit 1**. **Set Variable** `weight`. (If you don't weigh in that day it's simply empty.)
7. **Format Date** → Date: **Current Date**, Format: **Custom**, `yyyy-MM-dd`. **Set Variable** `day`.
8. **Dictionary** with these keys (all **Number** except where noted):
   - `workouts` → variable `workouts`
   - `active_kcal` → `active`
   - `resting_kcal` → `resting`
   - `steps` → `steps`
   - `weight_kg` → `weight`
   **Set Variable** `payload`.
9. **Get Contents of URL**
   - URL: your **Address**
   - Method: **POST**
   - Headers: `apikey` = your **App key**; `Authorization` = `Bearer ` followed by your **App key**; `Content-Type` = `application/json`
   - Request Body: **JSON** with three fields:
     - `p_token` (Text) = your **Key**
     - `p_day` (Text) = variable `day`
     - `p_payload` (Dictionary) = variable `payload`
10. **Show Notification** → "Cut Log synced" (optional, handy while testing).

Run it once with the ▶ button. It should say `ok`. Open the Cut Log: today's day sheet shows "Apple Watch data synced for this day".

## 3. Make it automatic

**Shortcuts → Automation → + → Time of Day** → 23:55, **Daily** → **Run Immediately** (turn off "Notify When Run" if you like) → choose **Cut Log Sync**.

If you train after midnight on night shifts, add a second one at 05:30 too. Each run updates that day's numbers, so running it more than once is fine.

## 4. Sync on demand

In the Shortcut, tap the **ⓘ** → **Add to Home Screen**. Tap it after a session to send the numbers straight away.

## If it fails

- `unknown token`: create a new key in Settings and paste it into step 9 again.
- Nothing arrives: check the Address ends in `/rest/v1/rpc/health_sync` and both headers use the App key.
- Weight never comes through: your scale's app isn't writing to Apple Health. Open its settings and allow Apple Health.
