# Connect your Apple Watch

The full step-by-step guide is inside the app: **Settings → Apple Watch → Set up the Shortcut**.

In short: Apple only lets App Store apps read Apple Health, so a free iPhone Shortcut reads your watch's numbers each night and posts them to one personal link (Settings → Apple Watch → Create Shortcut link). The link goes to the `cut` Edge Function, which saves them into that day:

| From Apple Health | Becomes in Cut Log |
|---|---|
| Workouts (count) | Gym sessions (1 = Session 1, 2 or more = double) |
| Active Energy | Gym kcal (replaces the 1,000 per session guess) |
| Resting Energy | Resting burn (replaces the flat 2,400) |
| Weight | Weigh-in (pounds or stones are converted) |
| Steps | Shown on Home and on the day |

Anything you type into the app yourself always wins. Running the Shortcut several times a day is fine; it just updates the day. The Home screen's **Sync watch now** button runs the Shortcut (it must be named exactly `Cut Log Sync`).
