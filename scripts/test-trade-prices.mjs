/* Trade-price fetching: the parts that can be wrong without erroring.

   This script talks to an API this project cannot reach from CI, so the value
   here is in the pure functions around the request — URL parsing, currency
   conversion, and which listing becomes "the price". Those are where a silent
   mistake turns into a wrong EV rather than a stack trace.

   Run: node scripts/test-trade-prices.mjs
*/
process.env.TRADE_NO_MAIN = "1";   // importing must not fire off requests

const { parseTradeUrl, toChaos, priceFrom } = await import("./trade-prices.mjs");
const { makeResolver } = await import("../src/bossProfit.js");

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ---- URL parsing ----
   These get pasted straight out of a browser, so every shape the browser can
   produce has to survive: the plain search, the live one, one with a fragment,
   and a league whose name has a space in it. */
eq(parseTradeUrl("https://www.pathofexile.com/trade/search/Allflame/abc123"),
   { league: "Allflame", queryId: "abc123" }, "plain search URL");
eq(parseTradeUrl("https://www.pathofexile.com/trade/search/Allflame/abc123/live"),
   { league: "Allflame", queryId: "abc123" }, "live search URL");
eq(parseTradeUrl("https://www.pathofexile.com/trade/search/Hardcore%20Allflame/xyz"),
   { league: "Hardcore Allflame", queryId: "xyz" }, "league name with a space");
eq(parseTradeUrl("https://www.pathofexile.com/trade/search/Allflame/abc123#hash"),
   { league: "Allflame", queryId: "abc123" }, "URL with a fragment");
eq(parseTradeUrl("https://www.pathofexile.com/trade/exchange/Allflame/abc"), null,
   "the bulk exchange is a different endpoint and must not parse as a search");
eq(parseTradeUrl("nonsense"), null, "junk is null, not a crash");
eq(parseTradeUrl(null), null, "null is null");

/* ---- currency ----
   Skipping is deliberate: converting an exalt at a guessed rate silently
   mis-prices a drop, and a missing price is honest where a wrong one isn't. */
eq(toChaos({ amount: 5, currency: "chaos" }, 180), 5, "chaos passes through");
eq(toChaos({ amount: 2, currency: "divine" }, 180), 360, "divine converts at the rate");
eq(toChaos({ amount: 2, currency: "divine" }, 0), null, "no rate means skip, never guess");
eq(toChaos({ amount: 2, currency: "exalted" }, 180), null, "unknown currency is skipped");
eq(toChaos({ amount: 0, currency: "chaos" }, 180), null, "a zero ask is not a price");
eq(toChaos(null, 180), null, "no price object");

/* ---- which listing is "the price" ----
   The floor of a trade search is not the market: it is bait, mispricings and
   people who logged off a week ago. */
{
  const asks = [1, 2, 90, 95, 100, 105, 110, 120, 130, 400];
  const p = priceFrom(asks);
  ok(p > 2, `must not take the lowball floor: got ${p}`);
  ok(p < 400, `must not take the outlier ceiling: got ${p}`);
  eq(p, 90, "20th percentile of ten sorted asks");
}
eq(priceFrom([50, 10, 30]), 30, "under five listings, take the median");
eq(priceFrom([42]), 42, "a single listing is all there is");
eq(priceFrom([]), null, "no listings, no price");
eq(priceFrom([0, -5, NaN, 7]), 7, "junk values are filtered before ranking");
// Order must not matter — the API returns listings in relevance order, not price order.
eq(priceFrom([130, 1, 100, 95, 2, 120, 110, 400, 90, 105]), 90, "unsorted input gives the same answer");

/* ---- the resolver layer ----
   Trade prices exist where poe.ninja's number is absent or describes a
   different item, so they outrank it — but never a price the user set by hand. */
{
  const pm = { "Cinderswallow Urn": { c: 12, lo: 12, hi: 900, n: 3 } };
  const tp = { "Cinderswallow Urn|Life": { c: 850 }, "Spinehail": { c: 60 } };

  const r = makeResolver(pm, { tradePrices: tp });
  eq(r("Cinderswallow Urn", [], null, "Life").chaos, 850, "trade price wins over poe.ninja");
  ok(r("Cinderswallow Urn", [], null, "Life").trade === true, "and is flagged as a trade price");
  eq(r("Cinderswallow Urn", [], null, "Mana").chaos, 12,
     "a variant with no trade entry falls back to poe.ninja rather than borrowing another variant's price");
  eq(r("Spinehail", [], null, null).chaos, 60, "an unvarianted trade key works too");
  eq(r("Spinehail", [], null, "Life").chaos, 60, "a hint with no keyed match still finds the flat key");

  eq(makeResolver(pm, { tradePrices: tp, priceOverrides: { "Cinderswallow Urn": 5 } })("Cinderswallow Urn", [], null, "Life").chaos,
     5, "a manual override still beats everything");
  eq(makeResolver(pm)("Cinderswallow Urn", [], null, "Life").chaos, 12, "no trade file at all is fine");

  // A key with no usable price must not shadow the poe.ninja entry.
  eq(makeResolver(pm, { tradePrices: { "Cinderswallow Urn|Life": { c: 0 } } })("Cinderswallow Urn", [], null, "Life").chaos,
     12, "a zero trade price is ignored, not applied");

  // The loose variant match applies here as well: "ES" must find "|Energy Shield".
  eq(makeResolver(pm, { tradePrices: { "Cinderswallow Urn|Energy Shield": { c: 700 } } })("Cinderswallow Urn", [], null, "ES").chaos,
     700, "abbreviated hints match trade keys too");
}

console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
