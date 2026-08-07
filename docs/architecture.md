# Architecture

## Market snapshot pipeline

The React app is static and reads generated JSON from `public/data/`. GitHub
Actions runs `scripts/fetch-data.mjs` at 17 minutes past every hour, builds the
site and deploys it to GitHub Pages.

Price precedence is:

1. GGG's public Currency Exchange hourly digest for completed exchange trades.
2. poe.watch for missing exchange markets and non-exchange listings.
3. poe.ninja for remaining gaps and roll-variant detail.
4. Explicit, dated fallback values in the boss/Delve datasets when all market
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

RePoE's `base_items.min.json` maps GGG Metadata paths to display names and tags.
It contributes no prices. If either the GGG digest or the name mapping is
unavailable, the snapshot completes with poe.watch and poe.ninja instead.

Each deployed JSON file records `generatedAt`; files using GGG also record
`gggHour`, the completed market hour represented by the official prices. The
existing `selfhistory.json` files accumulate hourly snapshots for charts.

## Coverage boundary

The GGG feed covers only items that completed trades on the in-game Currency
Exchange during the selected hour. Uniques, maps, gems, unidentified forms and
roll variants generally require poe.watch or poe.ninja. Boss drop rates and
Delve biome rules remain curated project data and are not supplied by any price
API.

