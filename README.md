# Vaal Street

Path of Exile 1 farming profitability and market price tools.

The site opens on a compact **Overview** briefing. It reuses the existing scarab
movement, boss EV, Delve biome and category-price calculations in a selectable
headline, three decision desks and a small data-quality strip. Every result links
to the full tool; **Popular farms** keeps its existing scarab-strategy layout.
Boss price-coverage warnings still open the boss that contains the first gap.

Exchange-traded prices come from **GGG's public Currency Exchange API** first.
The scheduled snapshot reads the latest completed hourly digest and calculates
the volume-weighted chaos price from the quantities that actually traded. GGG
identifies items by internal Metadata paths, so RePoE supplies the display-name
mapping; it does not supply prices.

For a configured boss drop that GGG recognizes but that did not trade in the
latest hour, the snapshot keeps a recent official price from the preceding
deployment or searches up to 24 earlier completed hours. The entry records its
actual `marketHour`, and the boss-price tooltip shows its age. Unsupported names
do not trigger this lookback.

**poe.watch** and **poe.ninja** remain fallbacks. They fill exchange items with
no usable trade in the completed GGG hour and price things the Currency Exchange
does not cover: uniques, maps, gems, unidentified forms and roll variants.

One note for anyone reading the fallback in `scripts/poewatch.mjs`: poe.watch's
`mean`/`min`/`max` are chaos, but you have to infer that — there is no Chaos Orb
row, and Exalted Orb reads 1. Identified items keep the existing mean-based
fallback; unidentified boss uniques use the current listing floor and retain
separate item-level markets where poe.watch provides them. The per-row `divine`
and `exalted` fields are inconsistent with `mean` and with each other. The divine
rate is the currency-exchange one, recovered as `mean / divine` from every row —
that ratio is the same constant across unrelated items, whereas Divine Orb's own
item listing can be thin. These figures are only used when the GGG hourly digest
is unavailable or has no usable pair.

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

GitHub Pages is static-only, so the repo includes a workflow
(`.github/workflows/deploy.yml`) that fetches the data **server-side** every
hour, bakes it into the site as JSON under `data/`, and redeploys. The app loads
those files first, so no browser-side proxy or API credential is needed.

One-time setup:

```bash
cd scarab-ledger
git init -b main
git add -A
git commit -m "Vaal Street"
git remote add origin git@github.com:YOUR_USER/scarab-ledger.git
git push -u origin main
```

Then on github.com: repo **Settings > Pages > Build and deployment > Source >
GitHub Actions**. The first workflow run starts on push (or trigger it under
**Actions > Build & deploy to GitHub Pages > Run workflow**). After ~3-4
minutes the site is live at `https://YOUR_USER.github.io/scarab-ledger/`.

Notes:
- Prices refresh hourly at 17 minutes past the hour. GGG's previous completed
  hour is primary; a thin configured boss item may use its most recent official
  trade hour from the prior 24 hours. The banner shows when the deployed
  snapshot was generated.
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

Expected value per kill from each boss's drop groups, minus what it costs to
open the fight, over how long a run takes — i.e. profit per hour.

Drops don't all roll the same way, so each boss splits them into groups:

| kind | meaning | maths |
|---|---|---|
| `pool` | `rolls` drops picked from the group (the unique pool, the guaranteed fragment / astrolabe tables, and T17 fragment stacks, which use rolls > 1) | `share x rolls` |
| `weighted` | the group as a whole has a `base` chance; if it hits, one line is picked by `weight` (Uber Maven's awakened gems: 2% base, three gems at equal weight) | `base x weight / totalWeight` |
| `independent` | each line rolls on its own | `chance`, x `(1 + quantity/100)` when the group is `quantityScaled` |

The five **Tier 17 maps** are in here too, since they're the only source of uber
fragments and so belong next to the bosses those fragments open. Their fragments
drop as a *stack* sized by area item quantity, not as independent per-item rolls,
so they're modelled as a pool with multiple rolls:

| Area IIQ | fragments | roll count |
|---|---|---|
| below 235% | 1-3 | 2 |
| 235-250% | 2-3 | 2.5 |
| 250%+ | 2-4 | 3 |

Defaults sit at the low-IIQ midpoint; the roll count is editable in the group
header. Which fragment type you get is assumed uniform across the map's types.
The unique drops on those maps are a flat 5% — a community figure, not measured
data — so T17 is the one part of the dataset that's guesswork rather than source.

Area item quantity matters on the Eldritch fights — regular Exarch and Eater
default to 70%, Black Star and Infinite Hunger to 50%, which is what the
reference tool assumes. It's an editable field on those bosses.

Alongside EV there's **profit in N runs**: a seeded Monte Carlo reporting how
often N consecutive runs finish in the black. EV alone hides variance — a boss
can be solidly +EV on the back of a 1% drop and still lose you money most
sessions. The run count is configurable (default 10), and **Sort by → Safest**
ranks every boss by that probability rather than by expected value, breaking
ties on profit/hour. Each row carries its own `N% safe` badge, so the trade-off
between a big average and a reliable one is visible without switching sort.

- **`src/bossData.js`** is the dataset: one block per boss. Add a boss by copying
  a block; no other file changes. Lines carry an optional `label` (when the
  display name differs from the name used for pricing, e.g. unidentified or
  variant items) and an optional `key` (needed only when a boss lists the same
  item twice — Catarina's three Cinderswallow Urn variants).
- The boss list is exactly the set that exists in the current PoE 1 build.
  Content that has been removed from the game (the Breachlord fights, the Atziri
  apex, Aul, the Trialmaster, Lycia, Olroth) is deliberately absent.
- Exceptional support gems are drop-restricted to named bosses, and
  `test-boss.mjs` holds that mapping from poewiki and checks it **both ways** —
  every gem must appear on each boss that drops it, and no boss may claim one it
  shouldn't. Gems restricted to content this tool doesn't list (Legion generals,
  the Zealot's and Arkhon's Vaults, Vruun, Ghorr, K'tash, Beidat, Zorath, Velka,
  Kosis) are deliberately absent.
- `rates` records provenance: `ledger` for the supplied drop tables, `estimate`
  where the drops are documented but no rate is published anywhere (badged `est`
  in the UI). A `wiki` value is also supported for adding a boss from poewiki.
- Everything is editable — times, rates, weights, quantity, entry counts and
  prices. Edits live in **TTK profiles** saved to `localStorage`.
- The **TTK profiles** view manages those profiles: create, duplicate, rename,
  export/import as JSON, switch which one is in use, and edit every boss's kill
  time in one grid laid out by content type. Times are `m:ss` (a plain number is
  read as seconds); fields that differ from the default are highlighted, and
  clearing a profile's overrides puts every boss back to the built-in time.
- Default kill times match the reference tool's own TTK profile, so the kills-per-hour
  figures line up out of the box.
- Prices come from `public/data/<league>/prices.json`, written by the same
  workflow that snapshots scarabs. Items missing from GGG and both fallbacks
  are flagged `no price` rather than silently counted as zero.
- Unidentified drops are priced from the unidentified market when available.
  Exact item-level aliases distinguish Watcher's Eye, Thread of Hope, Forbidden
  Flame and Forbidden Flesh drops; the identified item is only a final fallback.

Two test scripts and a probe:

```bash
node scripts/test-boss.mjs                      # dataset integrity + EV maths
node scripts/test-fetch-shapes.mjs              # snapshot vs. poe.ninja's endpoint shapes
node scripts/probe-price.mjs "Orb of Dominance" # which endpoint actually carries an item
```

`probe-price.mjs` exists because the snapshot has to decide up front which
endpoint serves what, and the docs have been wrong about that more than once. It
throws every type at every endpoint family and reports where a name really
lives, plus how many rows each combination returned — so "this item has no
price" becomes a fact instead of a guess. It writes nothing. `--counts` skips
the search and just prints the per-endpoint totals, which is how you spot a
category returning suspiciously few rows.

Its most useful finding so far: **poe.ninja renders a page for every known item,
but the overview endpoints only return items with confirmed price data.** A URL
like `/poe1/economy/allflame/currency/orb-of-dominance` existing does not mean
the API will price it.

For the handful of drops in that state, a line can declare its own price:

```js
{ item: "Orb of Dominance", chance: 0.03, fallback: { divine: 3.7 } }
```

It is used *only* when poe.ninja returns nothing for that name — a real listing
always wins — and `divine` is the better unit, since it tracks the divine rate
instead of going stale the moment chaos moves. `asOf` records when the figure was
last checked: the UI badges these `set`, and `set 45d` once a month has passed,
so an old hand-typed number announces itself rather than passing as current. The
snapshot lists them with their age, separately from genuine misses.

### GGG Currency Exchange coverage

[GGG's Currency Exchange endpoint](https://www.pathofexile.com/developer/docs/reference#currencyexchange)
is public and needs no OAuth client. `scripts/ggg-exchange.mjs` reads the latest
completed hourly digest, filters it by league and calculates an item's chaos
price as `chaos volume / item volume`. An item with no direct Chaos pair can use
its direct Divine pair and that hour's GGG Divine-to-Chaos rate. If a configured
boss item has a current market row but no completed trade, a bounded lookup can
recover its most recent official price from the preceding 24 hours. The normal
hourly workflow retains that result while it remains within the same age limit,
so it does not repeatedly download the history.

The feed contains internal Metadata paths rather than display names. The
snapshot resolves them through RePoE's `base_items.min.json`; RePoE is metadata
only and never contributes a price. The hourly feed does not cover the current
hour or non-exchange items, so poe.watch and poe.ninja remain necessary for
uniques, maps, gems, roll variants and thin or missing markets.

`test-boss.mjs` checks every pool's shares sum to ~1, that drop keys are unique
per boss, and that EV reproduces the reference tool's numbers for the same rates
and prices (including quantity scaling and the weighted gem group).

`test-fetch-shapes.mjs` guards the three things that have actually broken here:

1. **Which endpoint serves what.** Per [poe.ninja's docs](https://poe.ninja/docs/api),
   bulk goods — currency, *fragments*, scarabs, astrolabes, omens, embers — come
   from `exchange/current/overview`, while uniques, gems, div cards and maps come
   from `stash/current/item/overview`. Reading fragments from the currency
   endpoint gives numbers that look plausible and are wrong.
2. **The chaos conversion.** Exchange lines quote `primaryValue` in a *primary
   reference currency* that isn't always chaos, and the docs don't define the
   sign of `core.rates`. So the script calibrates on Chaos Orb itself —
   `chaos = primaryValue / primaryValue(Chaos Orb)` — which is exact whatever the
   primary is, and logs Chaos Orb's computed price as a self-check (it must be 1).
3. **Coverage.** The docs enumerate exactly which `type` values each family
   accepts, and it's worth following them literally — `DivinationCard` is a valid
   *exchange* type, and leaving it out of that list is what made cards read as
   unpriced. Sources are ranked, and a name found by an earlier one is never
   re-priced by a later one:

   | rank | endpoint | covers | units |
   |---|---|---|---|
   | 1 | `exchange/current/overview` | everything fungible: currency, fragments, scarabs, astrolabes, omens, essences, oils, divination cards | needs calibration |
   | 1 | `stash/current/item/overview` | non-fungible, priced per listing: uniques, gems, maps, **invitations**, incubators, vials, memories, beasts | chaos |
   | 2 | `stash/current/currency/overview` | PoE 1 only, same goods as the exchange priced the older way — gap-fill only | chaos |

   The published type lists have disagreed with reality more than once, so any
   type that comes back empty from its documented family is retried against the
   other one before being written off. Every run prints which sources answered,
   how many names the gap-fill added, and the boss items that ended up with no
   price at all — so a gap shows up in the workflow log instead of on the site.

The test stubs `fetch` with a deliberately **non-chaos primary**, makes every
legacy `/api/data/*` path 404, and runs the real script end to end. `DATA_OUT`
redirects the output directory so it never touches `public/data/`.

Two naming wrinkles it also pins:

- poe.ninja's line ids are slugs, and slugs lose apostrophes — `awakeners-orb`
  can't be turned back into `Awakener's Orb` by guessing. The script borrows real
  names from the stash currency overview as a dictionary (names only; its prices
  are not what we quote against) and matches them on letters and digits alone.
- Maps are labelled inconsistently: the tier 17s are grouped under "Nightmare
  Map" and the base type isn't always the display name. The snapshot indexes map
  lines under both `name` and `baseType`, and prints the tier 17 listings it
  found so their entry costs can be named from fact rather than guesswork. On the
  app side, a price lookup falls back to aliases and then to a
  punctuation-insensitive match, trying the name with and without a trailing
  "Map" — so a near-miss doesn't silently read as `no price`.

## Delve tab

The Delve tool has three views:

- **Fossils & resonators** shows live prices, history, pool value ranges and
  current fractured-wall targets.
- **Biome targets** opens on Depth EV, the practical per-marker estimate for the
  selected depth. It blends the live special-target value with the generic
  fossil-node range using the labelled community special-node curve. Target value
  isolates the special encounter; Opportunity is a relative 0–100 routing score
  from biome share and Depth EV.
- **Bosses** keeps Ahuatotli, Kurgal and Aul separate from fossil routing. Each
  boss has a guaranteed unique pool plus separate card/fragment rolls, with
  preliminary or unpublished rates visibly flagged for the player to edit.
  Unpublished rates start at a marked 3% default. The view shows value and
  distribution per kill plus city-biome share. A labelled community curve also
  leads with the estimated boss-loot value of an eligible city node, then shows
  value and distribution per kill. Boss cards/fragments use GGG pricing first; unique
  markets fall back to poe.watch or poe.ninja. Kurgal's preliminary Eye line
  uses the live arithmetic mean of all four variants and expands to show each
  underlying price. Aul's Uprising similarly shows the strict mean and complete
  breakdown of all 17 identified aura outcomes because no automated source
  exposes the unidentified market.

**My samples** is inside Assumptions beside the active guide values. It stores a
built-in Guide baseline and custom observation profiles. Encounter counts,
fossil totals and minutes can replace guide quantities and unlock a personal
priced-pool hourly range; a timed route with no encounters remains a valid dry
sample.

**How to make money**, beside the Assumptions control, opens a compact pathing
guide sourced from Duddybrainzz's
3.28 depth-5000 test. It separates route priorities and sulphite setup from the
historical six-hour result, links each point to its video timestamp and never
feeds the old league prices or reported hourly rate into the live calculator.

PoEDB supplies biome weights plus exclusive encounter tier, weight and minimum
depth. All six exclusive encounters are tier 4 with weight 100, which supports
a relative comparison. Because the server curve is not public, the working
community model rises linearly from each special node's unlock depth to a 90%
replacement chance at depth 1500. Generic nodes and Smuggler's caches still use
low/median/high pool scenarios rather than an equal-weight fossil average.
The current city-biome ramps are exact: Vaal Outpost reaches full weight at
depth 63, Abyssal City at 135 and Primeval Ruins at 200. Boss selection inside
those cities uses the same explicit working approach: linear from each boss's
minimum depth to a 15% chance per eligible city node at depth 600. The estimates
are marked experimental and can be replaced if a better source appears.

The Guide baseline uses three exclusive fossils per target, two fossils per
generic node and five per cache. Each value is labelled as guide evidence or a
conservative fallback. Custom profile observations replace each category
independently; zero observations never create a fake hourly number.

`scripts/fetch-data.mjs` writes the fossil/resonator price and history snapshots.
`node scripts/test-delve.mjs` covers dataset integrity, value ranges,
opportunity normalisation, sample-profile calculations and boss EV.

## Divine-adjusted prices ("did it go up, or did chaos deflate?")

Chaos drifts against divine all league, so a scarab that reads +20% in chaos can
be *down* in real terms. The **Divine-adjusted** checkbox in the toolbar (Scarabs,
Popular farms, Astrolabes, Catalysts — the boss tab doesn't need it) answers that:

- the price chart gains a dashed **chaos-per-divine** line on its own right-hand
  axis, so a rising price sitting under a faster-rising rate is obvious at a glance;
- dragging a range on the chart shows both the nominal move and the **real** one,
  e.g. `▲ 12.1% · real ▼ 24.8%`;
- every ▲/▼ badge switches to the divine-denominated change, marked with a small
  `div`. Popular farms re-ranks off those numbers, so a mechanic only counts as
  heating up if it outran the divine;
- the status line reports what the divine itself did over the selected window.

Real change is `(price_now / rate_now) / (price_then / rate_then) - 1` — the move
priced in divine, using the rate **as it was on each end of the window**, not
today's. Divine isn't a perfectly stable unit either, but it's the one the
player base actually anchors to.

Where the data comes from: every snapshot stores the divine rate alongside the
prices in `selfhistory.json`, and the script emits a `rateHistory` series on the
same day axis as the price history. On top of that it makes one attempt per league
at poe.ninja's legacy `currencyhistory` endpoint to backfill the league so far —
that endpoint has a habit of dying and of quoting the ratio upside down, so the
result is sanity-checked and silently dropped when it looks wrong. With no
backfill the curve simply grows from our own hourly snapshots.

Consequences worth knowing:

- the checkbox is **disabled** until there are two rate points — on a fresh
  league without backfill that normally takes one to two hourly runs;
- snapshots taken before this feature existed have no rate, so their change
  windows can't be converted; those badges stay in chaos until the windows roll
  past the old points. The status line says so when that's the case;
- the live-API fallback (no static snapshots) has no rate curve at all, so the
  toggle stays off there.

`node scripts/test-rate.mjs` covers the whole data path: rate storage, the
nominal-vs-real split, the upside-down backfill, and the day-axis alignment.

## Where things live

- `src/App.jsx` — shell, scarab catalogue, demo fallback, live fetching, styles
- `src/Overview.jsx` — landing-page signals assembled from the existing tool
  calculations and generated market snapshots
- `src/bossData.js` / `src/bossProfit.js` / `src/BossProfit.jsx` — boss profit
  dataset, pure calculation layer (no React, so the maths is testable), and UI
- `src/PriceChart.jsx` — the price graph, shared by the mechanic panel, the
  category tabs, the fossil list and the biome curve, plus the day/rate/percent
  helpers that go with it
- `src/delveData.js` / `src/delve.js` / `src/Delve.jsx` — delve biomes, fossils
  and bosses, same three-way split. The delve bosses are declared in
  `bossData.js`'s group shape and priced by its `computeBoss`, so there is one
  drop engine in the codebase, not two.
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
- Every % in the app is a chaos figure unless the Divine-adjusted box is
  ticked; see the section above for what changes when it is.
