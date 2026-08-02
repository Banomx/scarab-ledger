# Scarab Ledger

Path of Exile 1 scarab price tracker, grouped by league mechanic. Live data from poe.ninja.

## Run locally

Requires Node.js 18+ (you have a matching setup if `node --version` prints v18 or higher).

```bash
cd scarab-ledger
npm install
npm run dev
```

Open http://localhost:5173 — done. The dev server proxies `/ninja/*` to
`https://poe.ninja/*`, so the browser never makes a cross-origin request
and CORS is a non-issue.

## VS Code

Open the folder (`File > Open Folder...` or `code scarab-ledger`), then run
`npm run dev` in the integrated terminal (Ctrl+`). Vite hot-reloads on every
save of `src/App.jsx`.

## Font

The UI uses **Kei Font (けいふぉんと)** — free for commercial use, Apache License
2.0. The font file isn't bundled; add it once:

1. Download: http://font.sumomo.ne.jp/fontdata-c2157415/k-font.zip
2. Extract and copy the `.ttf` to `public/fonts/keifont.ttf` (rename it to
   exactly that — the original filename contains Japanese characters).
3. Commit and push. Until the file exists, the site falls back to the previous
   serif stack automatically.

Note: the TTF is several MB because it includes thousands of kanji. If load
time ever bothers you, ask me to subset it to Latin glyphs (~50 KB).

## Host on GitHub Pages

GitHub Pages is static-only and poe.ninja blocks cross-origin browser requests,
so the repo includes a workflow (`.github/workflows/deploy.yml`) that fetches
the data **server-side** every 6 hours, bakes it into the site as JSON under
`data/`, and redeploys. The app loads those files first, so no proxy is needed.

One-time setup:

```bash
cd scarab-ledger
git init -b main
git add -A
git commit -m "Scarab Ledger"
git remote add origin git@github.com:YOUR_USER/scarab-ledger.git
git push -u origin main
```

Then on github.com: repo **Settings > Pages > Build and deployment > Source >
GitHub Actions**. The first workflow run starts on push (or trigger it under
**Actions > Build & deploy to GitHub Pages > Run workflow**). After ~3-4
minutes the site is live at `https://YOUR_USER.github.io/scarab-ledger/`.

Notes:
- Prices refresh on the 4-hour cron; the banner shows the snapshot timestamp.
- poe.ninja restructured their API in 2026 and no longer documents a public
  price-history endpoint. The fetch script still tries the legacy history
  route, but if it's gone, the site **accumulates its own history**: every
  scheduled run reads the previous deployment's `selfhistory.json` and appends
  the current prices. Graphs start appearing after the second run and grow
  from there — so the earlier in the league you deploy, the better.
- You can also run `node scripts/fetch-data.mjs` locally — the dev server will
  then serve the same snapshots from `public/data/`. Delete that folder to go
  back to the live `/ninja` proxy during development. (Self-history needs the
  deployed site URL; locally set `PAGES_BASE_URL=https://YOUR_USER.github.io/scarab-ledger`
  if you want it, same if you later use a custom domain.)

## Production build (for later, e.g. serving from your own box)

```bash
npm run build        # outputs static files to dist/
npm run preview      # serves dist/ on :5173 with the same /ninja proxy
```

If you later serve `dist/` with nginx instead, keep the proxy — the app calls
`/ninja/api/data/...` first and only falls back to poe.ninja directly:

```nginx
location /ninja/ {
    proxy_pass https://poe.ninja/;
    proxy_set_header Host poe.ninja;
    proxy_ssl_server_name on;
}
```

## Boss profit tab

Expected value per kill from each boss's drop pool, minus what it costs to open
the fight, divided by how long a run takes you — i.e. profit per hour.

- **`src/bossData.js`** is the dataset: one block per boss with its entry cost,
  drop table and default times. Adding a boss means copying a block; no other
  file changes. Each drop line is one of `share` (share of the guaranteed unique
  pool), `chance` (independent chance per kill) or `qty` (flat expected count).
- Bosses tagged **est** have a known drop pool but no published split, so it's
  spread evenly — treat those as a starting point. The rest use the percentages
  published on poewiki, which are crowdsourced and go stale whenever GGG
  rebalances drops.
- Uber-fragment names and quantities are tagged **verify** where they were worth
  double-checking against an actual map device.
- Everything on the page is editable — times, drop rates, quantities and prices.
  Edits live in **TTK profiles** saved to `localStorage`, so you can keep one
  profile per character and export/import them as JSON.
- Prices come from `public/data/<league>/prices.json`, written by the same
  workflow that snapshots scarabs. Items with no poe.ninja listing are flagged
  `no price` rather than silently counted as zero.
- `@awakened-common` / `@awakened-exceptional` are synthetic entries: the mean
  price of the matching gem set, so "Maven drops a random awakened gem" prices
  correctly.

Run `node scripts/test-boss.mjs` to check the dataset and the maths.

## Where things live

- `src/App.jsx` — shell, scarab catalogue, demo fallback, live fetching, styles
- `src/bossData.js` / `src/bossProfit.js` / `src/BossProfit.jsx` — boss profit
  dataset, pure calculation layer, and UI
- `vite.config.js` — the `/ninja` proxy for dev and preview
- Scarab grouping is derived from names automatically; new scarabs poe.ninja
  adds get sorted into the right mechanic without code changes.

## Notes

- If poe.ninja is unreachable, the app shows a clearly labelled demo snapshot
  instead of breaking. Reload once you're back online.
- Price history loads lazily per mechanic (one request per scarab in the
  group, cached), so opening a group the first time takes a moment.
- 24h/48h change comes from poe.ninja's daily sparkline, i.e. "since
  yesterday's / the day before's data point".
