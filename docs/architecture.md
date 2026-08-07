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
project data and are not supplied by any price API.

For unidentified boss uniques, the poe.watch adapter uses the current listing
floor and preserves separate item-level markets. Boss data names the exact
market for Watcher's Eye, Thread of Hope, Forbidden Flame and Forbidden Flesh;
the resolver prefers that alias, then a generic unidentified listing, and only
then the identified item.

## UI composition

`src/App.jsx` owns the shared shell, global market controls and scarab views.
`src/Overview.jsx` is the default view and reads the same generated snapshots as
the detailed tools. It calls the pure boss and Delve calculation modules instead
of maintaining separate estimates. Popular farms remains a dedicated scarab-only
view, while TTK profiles stay inside Boss profit. Boss signals carry a boss id
through `src/App.jsx`, so profitability and missing-price links open the relevant
boss instead of the first boss in the list.
