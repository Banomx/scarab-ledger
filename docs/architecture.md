# Architecture

## Market snapshot pipeline

The React app is static and reads generated JSON from `public/data/`. GitHub
Actions runs `scripts/fetch-data.mjs` at 17 minutes past every hour, builds the
site and deploys it to GitHub Pages.

Price precedence is:

1. GGG's public Currency Exchange hourly digest for completed exchange trades.
2. poe.watch for missing exchange markets and non-exchange listings.
3. poe.ninja for remaining gaps and roll-variant detail.
4. For configured boss items still unpriced by those sources, the most recent
   completed GGG trade hour within the preceding 24 hours, but only when the
   current GGG market data recognizes the item.
5. Explicit, dated fallback values in the boss/Delve datasets when all market
   sources lack the item.

`scripts/ggg-exchange.mjs` requests the previous completed UTC hour from
`https://web.poecdn.com/api/currency-exchange/<timestamp>`. If that hour has not
reached the CDN, it retries one hour earlier. The response contains internal
Metadata paths and aggregate quantities, not display names or ready-made item
prices.

For a direct item/Chaos pair, the hourly volume-weighted price is:

```text
chaos price = chaos volume traded / item volume traded
```

When only a direct item/Divine pair exists, that rate is multiplied by the same
hour's direct Divine/Chaos rate. Arbitrary multi-hop conversions are not used.
Zero-volume markets are ignored.

A zero-volume market can still identify a thin supported item. For configured
boss-price gaps only, the snapshot first retains a still-recent official entry
from the preceding deployment, then searches up to 24 older completed GGG
digests for unresolved names. Names absent from the current Currency Exchange
market do not widen the search. Recovered entries carry their actual
`marketHour` and `staleHours`; they expire rather than becoming permanent
hand-set prices.

RePoE's `base_items.min.json` maps GGG Metadata paths to display names and tags.
It contributes no prices. If either the GGG digest or the name mapping is
unavailable, the snapshot completes with poe.watch and poe.ninja instead.

Each deployed JSON file records `generatedAt`; files using GGG also record
`gggHour`, the newest completed market hour used by the snapshot. Individual
GGG entries record `marketHour`, which differs when a thin boss item came from a
recent earlier hour. The existing `selfhistory.json` files accumulate hourly
snapshots for charts.

## Coverage boundary

The GGG feed prices only items with completed trades on the in-game Currency
Exchange. The normal basis is the selected hour; the bounded boss-gap lookup can
use a recent earlier completed hour for a currently recognized thin item.
Uniques, maps, gems, unidentified forms and roll variants generally require
poe.watch or poe.ninja. Boss drop rates and Delve biome rules remain curated
project data and are not supplied by any price API. Delve biome weights and
encounter tier/weight/minimum-depth fields are transcribed from current PoEDB
data-mined tables; creator observations are labelled separately.

For unidentified boss uniques, the poe.watch adapter uses the current listing
floor and preserves separate item-level markets. Boss data names the exact
market for Watcher's Eye, Thread of Hope, Forbidden Flame and Forbidden Flesh;
the resolver prefers that alias, then a generic unidentified listing, and only
then the identified item. Aul's Uprising is the current exception: the aggregate
feeds do not expose its unidentified market, so the Delve dataset carries a
dated, visibly flagged official-trade floor which wins before the identified
item value. Current aggregate feeds also do not split Kurgal's one- and
two-Abyssal-socket uniques; those lines keep the live name-wide quote and are
badged `shared quote` rather than implying variant-level precision.

## UI composition

`src/App.jsx` owns the shared shell, global market controls and scarab views.
`src/Overview.jsx` is the default view and reads the same generated snapshots as
the detailed tools. It calls the pure boss and Delve calculation modules instead
of maintaining separate estimates. Popular farms remains a dedicated scarab-only
view, while TTK profiles stay inside Boss profit and Delve sample profiles stay
inside Delve. Boss signals carry a boss id through `src/App.jsx`, so profitability
and missing-price links open the relevant boss instead of the first boss in the
list.

## Delve estimation boundary

The six biome-exclusive fossil encounters share PoEDB tier 4 and encounter
weight 100. `src/delve.js` uses this to produce a relative Opportunity index:
biome share times live target value, normalised to 0–100. It does not convert
that score to currency per Delve because the depth-dependent reward-tier
selection curve is not public. City boss EV is calculated separately and never
enters the fossil ranking.

Delve boss distributions use one guaranteed roll from each boss's measured
unique pool. Cards and fragments remain independent rolls. The older 3.25
sample supplies the published shares; current drops without a published sample,
such as Zorath's Eye, remain visibly preliminary and editable. Kurgal currently
uses the requested 50% preliminary rate. Its conditional value is the arithmetic
mean of Malevolence, Authority, the Inevitable and the Endless; the row expands
to expose the four live inputs, and the one-kill simulation rolls an actual
variant rather than a fixed average item. Exchange-backed boss drops use the
same GGG-first resolver as the main Boss profit tab.

Generic fossil nodes and Smuggler's caches use low/median/high outcomes from the
priced biome pool instead of assuming equal fossil probabilities. The active
Delve sample profile supplies per-encounter quantities. A custom profile gets a
personal hourly projection when it contains elapsed minutes; a timed route with
zero recorded encounters remains valid zero-rate evidence. Profiles and active selection use the versioned
`sl.delve.sampleProfiles.v1` and `sl.delve.activeSampleProfile.v1` localStorage
keys; global Delve settings keep depth, wall preference and price/boss overrides.
