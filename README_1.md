# Gladestown Rulership Tracker

An Obsidian plugin for tracking a D&D city-rulership subsystem: four city
stats (Stability, Loyalty, Renown, Military), a break-even treasury economy,
an Unrest track, a 30-law menu, a Court Turn cycle, and a **Court Date /
Long Rest** tracker so you always know when the next Court Turn is due.

This was built to match a specific homebrew system, but the numbers are all
editable in Settings if you want to reuse it for a different campaign.

## Features

- **Sidebar dashboard** (click the castle icon in the ribbon, or run the
  "Open Gladestown Tracker" command) showing everything at a glance.
- **Long Rest button** — click it every time the party takes a long rest.
  It advances your in-game day counter by a configurable number of days
  (default 1, or type a custom number) and flags when a Court Turn is due.
- **Process Court Turn button** — automatically applies income/upkeep to
  the treasury, calculates Unrest drift from your current stat tiers and
  reserve health, and resets Action Points.
- **Stat trackers** with automatic tier labels (Crisis/Weak/Sound/Strong/
  Legendary) for Stability, Loyalty, Renown, Military, and Unrest.
- **Treasury** with live Monthly Income / Upkeep / Net Flow / Reserve Ratio,
  computed from your stats and any active recurring laws.
- **All 30 laws**, grouped by category, one click to Enact (applies gold
  cost + immediate stat effects, and tracks recurring upkeep/income if the
  law has an ongoing effect) and Repeal.
- **Court Log** — every change is timestamped with the in-game day/turn it
  happened on, so you can scroll back through the whole campaign's history.
- All data is saved locally in your vault (`data.json` inside the plugin's
  folder) — nothing leaves your machine.

## Installing via BRAT

1. Install the **BRAT** plugin from Obsidian's Community Plugins if you
   don't have it already, and enable it.
2. Push this repo to your own GitHub account (see below).
3. In Obsidian: `Settings → BRAT → Add Beta Plugin`.
4. Enter your repo as `yourusername/gladestown-rulership-tracker`.
5. BRAT will pull the latest GitHub Release and install it. Enable
   **Gladestown Rulership Tracker** under `Settings → Community Plugins`.

## Publishing your own copy to GitHub

From inside this folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/gladestown-rulership-tracker.git
git push -u origin main
```

Then cut a release so BRAT has something to install:

```bash
git tag 1.0.0
git push origin 1.0.0
```

The included GitHub Actions workflow (`.github/workflows/release.yml`)
will automatically build the plugin and attach `main.js`, `manifest.json`,
and `styles.css` to a GitHub Release whenever you push a tag. That's the
only step BRAT needs — you don't have to build or upload anything by hand
after the first push.

## Local development

```bash
npm install
npm run dev     # rebuilds on file changes
npm run build   # one-off production build
```

## Adjusting the numbers

`Settings → Gladestown Rulership Tracker` lets you change:
- Days per Court Turn (default 30)
- Default days per Long Rest (default 1)
- Base monthly income / upkeep
- Starting treasury reserve (used for the Reserve Ratio calculation)

The 30 laws and their gold costs / effects are defined in `main.ts` under
the `LAWS` array if you want to hand-edit any of them.
