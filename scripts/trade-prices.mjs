/* ================================================================
   TRADE PRICES — for the items poe.ninja does not price

   poe.ninja publishes an economy overview: one figure per item, and for
   some uniques one figure per roll variant. It has nothing to say about a
   VEILED or UNIDENTIFIED item, because what those are worth depends on the
   mod you happen to roll, and that is a trade search rather than an index.
   Catarina's whole drop pool is exactly that, and it is not the only one.

   So this script asks the official trade site instead — but it does NOT try
   to author trade queries, because a query for "Cinderswallow Urn with the
   Life veiled mod" needs stat ids that change between leagues and are easy to
   get subtly wrong. Instead you build the search in your browser, exactly the
   way you would to price-check it yourself, and paste the URL. The script
   re-runs your saved search and reads the prices off it.

   ---------------------------------------------------------------
   RUN IT LOCALLY. Not in CI. Two reasons:
     - The trade site is not part of GGG's documented public API. It is rate
       limited per IP and tolerates price-check tools that behave; a cron job
       hammering it from a shared CI runner is how an IP gets blocked.
     - If you set POESESSID (below), that is a full account session token.
       It belongs in your shell, never in a repo secret and never in a
       workflow file.
   ---------------------------------------------------------------

   Setup:
     1. cp trade-queries.example.json trade-queries.json
     2. On pathofexile.com/trade, build a search for the item you want priced.
        Narrow it properly — the right base, "Identified: No" for unid items,
        the specific veiled mod, item level, whatever matters.
     3. Copy the URL from the address bar and paste it into trade-queries.json
        with the price key it should feed.
     4. node scripts/trade-prices.mjs

   Optional:
     POESESSID=xxx node scripts/trade-prices.mjs     more headroom on limits
     node scripts/trade-prices.mjs --dry             show the plan, no requests

   Output: public/trade-prices.json, which the boss tab layers over poe.ninja.
   Commit it and the numbers ship to everyone who visits the site.
   ================================================================ */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = process.env.TRADE_CONFIG || path.join(ROOT, "trade-queries.json");
const OUT = process.env.TRADE_OUT || path.join(ROOT, "public", "trade-prices.json");
const DRY = process.argv.includes("--dry");

/* GGG asks tools to identify themselves. Keep the contact link in it. */
const UA = process.env.TRADE_UA
  || "scarab-ledger/0.1 (+https://github.com/Banomx/scarab-ledger) price-check, run manually";

const BASE = "https://www.pathofexile.com/api/trade";

/* Conservative floor between requests. The trade site's published limits are
   stricter than most APIs and the penalty for tripping them is a timed ban,
   so this is deliberately slower than it strictly needs to be. */
const MIN_GAP_MS = 2500;
const PAGE = 10;            // /fetch takes at most 10 ids per call
const SAMPLE = 20;          // listings to look at per item
const PERCENTILE = 0.2;     // where in the sorted asks to read the price

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- rate limiting ----------
   The API answers with its own limit state, so use it rather than guessing:
     X-Rate-Limit-Ip:       8:10:60,15:60:120      hits:seconds:banFor
     X-Rate-Limit-Ip-State: 3:10:0,7:60:0          current usage
   If any bucket is close to full, wait out that bucket's window. */
function backoffFrom(headers) {
  const limit = headers.get("x-rate-limit-ip");
  const state = headers.get("x-rate-limit-ip-state");
  if (!limit || !state) return 0;
  const L = limit.split(",").map((s) => s.split(":").map(Number));
  const S = state.split(",").map((s) => s.split(":").map(Number));
  let wait = 0;
  for (let i = 0; i < Math.min(L.length, S.length); i++) {
    const [max, period] = L[i];
    const [used] = S[i];
    if (!isFinite(max) || !isFinite(period) || !isFinite(used)) continue;
    if (used >= max - 1) wait = Math.max(wait, period * 1000);
  }
  return wait;
}

let lastCall = 0;
async function api(url, init) {
  const gap = Date.now() - lastCall;
  if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);

  const headers = { "User-Agent": UA, Accept: "application/json" };
  if (init?.body) headers["Content-Type"] = "application/json";
  if (process.env.POESESSID) headers.Cookie = `POESESSID=${process.env.POESESSID}`;

  const res = await fetch(url, { ...init, headers });
  lastCall = Date.now();

  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after")) || 60;
    console.log(`    rate limited — waiting ${retry}s (this is the API asking, not an error)`);
    await sleep(retry * 1000 + 500);
    return api(url, init);
  }
  const wait = backoffFrom(res.headers);
  if (wait) {
    console.log(`    approaching the rate limit — pausing ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/* ---------- config ---------- */

/* A trade URL is .../trade/search/<league>/<queryId>, sometimes with a
   /live suffix or a fragment. Pull both parts out, tolerating either. */
export function parseTradeUrl(url) {
  const m = /\/trade\/search\/(?:[a-z]+\/)?([^/]+)\/([A-Za-z0-9]+)/.exec(String(url || ""));
  if (!m) return null;
  return { league: decodeURIComponent(m[1]), queryId: m[2] };
}

async function loadConfig() {
  let raw;
  try {
    raw = await readFile(CONFIG, "utf8");
  } catch {
    console.log(`No ${path.basename(CONFIG)} found.`);
    console.log("Copy trade-queries.example.json to trade-queries.json and add your searches.");
    process.exit(1);
  }
  const cfg = JSON.parse(raw);
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  const bad = [];
  const good = [];
  for (const it of items) {
    if (it.skip) continue;
    const parsed = parseTradeUrl(it.url);
    if (!it.priceKey || !parsed) { bad.push(it); continue; }
    good.push({ ...it, ...parsed });
  }
  for (const b of bad) {
    console.log(`  SKIPPED (needs priceKey and a /trade/search/ URL): ${JSON.stringify(b).slice(0, 120)}`);
  }
  return { cfg, items: good };
}

/* ---------- price extraction ---------- */

/* Listings are quoted in whatever the seller chose. Only the two currencies
   the whole site already speaks are converted; anything else is skipped
   rather than guessed at, and reported so it is not silently dropped. */
export function toChaos(price, divineRate) {
  if (!price || !(price.amount > 0)) return null;
  const c = String(price.currency || "").toLowerCase();
  if (c === "chaos") return price.amount;
  if (c === "divine" && divineRate > 0) return price.amount * divineRate;
  return null;
}

/* The cheapest ask is not the price. It is usually a mispriced item, a bait
   listing, or someone offline for a week. Sort the asks and read a low
   percentile: cheap enough to be achievable, far enough off the floor to not
   be noise. With very few listings there is nothing to trim, so take the
   median and let the low count speak for itself in the output. */
export function priceFrom(chaosAsks, percentile = PERCENTILE) {
  const a = chaosAsks.filter((v) => isFinite(v) && v > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  if (a.length < 5) return a[Math.floor((a.length - 1) / 2)];
  return a[Math.min(a.length - 1, Math.floor(a.length * percentile))];
}

async function priceOne(item, divineRate) {
  const search = await api(`${BASE}/search/${encodeURIComponent(item.league)}/${item.queryId}`);
  const ids = (search.result || []).slice(0, SAMPLE);
  if (!ids.length) return { ...item, total: search.total || 0, chaos: null, n: 0, reason: "no listings" };

  const asks = [];
  let skipped = 0;
  for (let i = 0; i < ids.length; i += PAGE) {
    const batch = ids.slice(i, i + PAGE);
    const j = await api(`${BASE}/fetch/${batch.join(",")}?query=${item.queryId}`);
    for (const r of (j.result || [])) {
      if (!r) continue;
      const c = toChaos(r.listing?.price, divineRate);
      if (c == null) { skipped++; continue; }
      asks.push(c);
    }
  }
  const chaos = priceFrom(asks);
  return {
    ...item, chaos, n: asks.length, skipped,
    total: search.total ?? ids.length,
    reason: chaos == null ? (skipped ? "all listings in currencies we don't convert" : "no usable prices") : null,
  };
}

/* ---------- divine rate ----------
   Reuse the snapshot's own rate so trade prices and poe.ninja prices are
   denominated identically. Without it, divine-priced listings are skipped
   rather than converted at a guessed rate. */
async function divineRateFor(league) {
  const dir = path.join(ROOT, "public", "data");
  try {
    const idx = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8"));
    const hit = (idx.leagues || []).find((l) => l.name === league) || (idx.leagues || [])[0];
    if (!hit) return 0;
    const p = JSON.parse(await readFile(path.join(dir, hit.slug, "prices.json"), "utf8"));
    return p.prices?.["Divine Orb"]?.c || 0;
  } catch {
    return 0;
  }
}

/* ---------- main ---------- */
async function main() {
  const { cfg, items } = await loadConfig();
  if (!items.length) { console.log("Nothing to price."); return; }

  const league = items[0].league;
  const mixed = items.filter((i) => i.league !== league);
  if (mixed.length) {
    console.log(`Note: ${mixed.length} search(es) are for a different league than the first (${league}). Each is queried on its own league.`);
  }

  const divineRate = Number(cfg.divineRate) || await divineRateFor(league);
  console.log(`Trade prices — ${items.length} search(es), league ${league}`);
  console.log(divineRate ? `1 divine = ${Math.round(divineRate)}c (from the snapshot)`
                         : "No divine rate available — divine-priced listings will be skipped. Run scripts/fetch-data.mjs first, or set divineRate in the config.");
  if (DRY) {
    for (const i of items) console.log(`  would query ${i.priceKey}: ${i.league}/${i.queryId}`);
    return;
  }

  const prices = {};
  const problems = [];
  for (const item of items) {
    try {
      const r = await priceOne(item, divineRate);
      if (r.chaos == null) {
        problems.push(`${r.priceKey}: ${r.reason} (${r.total} match the search)`);
        console.log(`  ${r.priceKey}: — (${r.reason})`);
        continue;
      }
      prices[r.priceKey] = {
        c: Math.round(r.chaos * 100) / 100,
        n: r.n, total: r.total, url: r.url,
        ...(r.note ? { note: r.note } : {}),
      };
      console.log(`  ${r.priceKey}: ${Math.round(r.chaos)}c  (from ${r.n} of ${r.total} listings${r.skipped ? `, ${r.skipped} skipped` : ""})`);
    } catch (e) {
      problems.push(`${item.priceKey}: ${e.message}`);
      console.log(`  ${item.priceKey}: FAILED — ${e.message}`);
    }
  }

  if (!Object.keys(prices).length) {
    console.log("\nNothing priced — leaving the existing file alone.");
    if (problems.length) console.log(problems.map((p) => `  ${p}`).join("\n"));
    process.exit(1);
  }

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    league, divineRate, prices,
  }, null, 2));
  console.log(`\nWrote ${Object.keys(prices).length} price(s) to ${path.relative(ROOT, OUT)}`);
  if (problems.length) console.log(`${problems.length} did not price:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  console.log("Commit that file and the boss tab picks it up on the next deploy.");
}

/* Importing this for tests must not fire off requests. */
if (!process.env.TRADE_NO_MAIN) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
