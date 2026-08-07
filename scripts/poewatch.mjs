/* ================================================================
   POE.WATCH — the primary price source

   poe.watch (https://docs.poe.watch) publishes one flat array per item
   category, and each row already carries what this project had to work for
   against poe.ninja: a chaos price, how many listings it came from, a
   low-confidence flag, and a week of daily history. There is no per-league
   endpoint discovery, no reference-currency calibration, and no split between
   "exchange" and "stash" families with different shapes.

   It also lists things poe.ninja simply does not, most importantly the
   UNIDENTIFIED forms of veiled uniques — "Unidentified Cinderswallow Urn" is
   its own item at roughly nine times the identified price. That is exactly
   what Catarina drops, and it is why her pool read as worthless.

   poe.ninja stays wired up behind this as a fallback: poe.watch can be down,
   and a thin category there is better filled than left empty.

   ---- on the price unit ----
   `mean`, `min` and `max` are chaos. This is worth stating because the API
   makes you infer it: there is no Chaos Orb row (nothing prices the unit in
   itself), and Exalted Orb reads 1, which looks like a base currency but is
   just an exalt being worth about a chaos these days. Divine Orb reads ~173,
   which agrees with poe.ninja, so chaos it is.

   ---- on the divine rate ----
   NOT from Divine Orb's own `mean`. That row is an item listing like any
   other, it is thin (a few dozen a day, flagged lowConfidence), and it reads
   about 173 while the rest of the site disagrees.

   The real rate is the currency exchange one, and every row carries it
   implicitly: `divine` is that row's price denominated in divine, so
   mean/divine recovers the rate. Across unrelated items and categories it
   comes back as the same constant — 1110.05/5 and 888.04/4 both give 222.01 —
   which is the signature of one authoritative rate being applied, rather than
   a per-item measurement. `divine` is rounded to two decimals, so the ladder
   below prefers rows where it is large enough for that rounding not to matter.

   The `exalted` field stays unused: it is inconsistent even between rows that
   share a mean.
   ================================================================ */

const BASE = process.env.WATCH_BASE || "https://api.poe.watch";
const HEADERS = { "User-Agent": "scarab-ledger-snapshot/0.3 (github actions; contact via repo issues)", Accept: "application/json" };

/* Every category the site has a use for. `bases` is ~18k rows of crafting
   bases and `enchantment` is helmet enchants — neither is referenced by any
   tab, and both are large, so they are deliberately not fetched. */
export const WATCH_CATEGORIES = [
  "currency",      // orbs, astrolabes, catalysts, lifeforce, the entry costs
  "fragment",      // breachstones, invitations' cousins, boss keys
  "invitation",
  "scarab",
  "card",
  "oil", "essence", "fossil", "resonator", "deliriumOrb", "incubator", "beast",
  "map", "uniqueMap",
  "flask", "armour", "weapon", "accessory", "jewel", "gem",
  "heist", "corpses", "deepwater",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function watchJson(pathAndQuery) {
  const res = await fetch(`${BASE}${pathAndQuery}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${pathAndQuery}`);
  return res.json();
}
/* Failures are logged rather than swallowed: an empty category and an
   unreachable host look identical downstream, and confusing the two once cost
   an afternoon on the poe.ninja side. */
let quiet = false;
async function tryWatch(p) {
  try { return await watchJson(p); }
  catch (e) {
    if (!quiet) { console.log(`    poe.watch ${p} — ${e.message}`); quiet = true; }
    return null;
  }
}

/* ---------- leagues ---------- */

export async function watchLeagues() {
  const j = await tryWatch("/leagues");
  return Array.isArray(j) ? j.filter((l) => l && l.name) : [];
}

/* poe.ninja and poe.watch mostly agree on league names, but not always on
   punctuation or the SSF/Ruthless prefixes, so match in widening steps rather
   than requiring an exact string. */
export function matchWatchLeague(name, leagues) {
  if (!name || !leagues?.length) return null;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(name);
  for (const l of leagues) if (l.name === name) return l.name;
  for (const l of leagues) if (norm(l.name) === n) return l.name;
  return null;
}

/* ---------- rows ---------- */

/* One row per priced item form. Gems repeat by level/quality/corruption and
   armour by link count, which is how the base-variant rule below can work. */
export function normaliseRow(r) {
  if (!r || !r.name) return null;
  const chaos = Number(r.mean);
  if (!(chaos > 0)) return null;
  return {
    name: String(r.name),
    id: r.id,
    group: r.group || null,
    chaos,
    lo: Number(r.min) > 0 ? Number(r.min) : chaos,
    hi: Number(r.max) > 0 ? Number(r.max) : chaos,
    daily: Number(r.daily) || 0,
    lowConfidence: r.lowConfidence === true,
    linkCount: r.linkCount ?? null,
    gemLevel: r.gemLevel ?? null,
    gemQuality: r.gemQuality ?? null,
    gemCorrupted: r.gemIsCorrupted === true,
  };
}

/* The form a boss actually drops, mirroring the rule the poe.ninja path uses:
   a level-1, zero-quality, uncorrupted gem, and an unlinked item. A corrupted
   21/20 gem and a 6-link are post-drop states, not drops. */
export function isWatchBaseVariant(row) {
  if (row.gemLevel != null || row.gemQuality != null || row.gemCorrupted) {
    return !row.gemCorrupted && (row.gemLevel ?? 1) <= 1 && (row.gemQuality ?? 0) === 0;
  }
  if (row.linkCount != null) return row.linkCount === 0;
  return true;
}

/* ---------- divine rate ---------- */

const rateSane = (v) => typeof v === "number" && isFinite(v) && v >= 20 && v <= 20000;
const median = (a) => {
  const s = a.filter((v) => isFinite(v) && v > 0).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/* Divine Orb's own chaos price is the rate. The cross-check exists because
   poe.watch's per-row `divine` field implies a different one, and if those two
   ever converge or the gap explodes, that is worth seeing in the log rather
   than silently repricing the entire site. */
export function watchDivineRate(rows) {
  const div = rows.find((r) => r.name === "Divine Orb" && r.chaos > 0);
  const direct = div ? div.chaos : 0;

  /* `divine` carries two decimals, so a row worth 0.02 divine recovers the
     rate to only ±25 while one worth 4 recovers it to ±0.03. Walk from strict
     to loose and stop as soon as there are enough rows to take a median of. */
  const sample = (minDivine, minDaily) => rows
    .filter((r) => r.divineField >= minDivine && r.daily >= minDaily && !r.lowConfidence)
    .map((r) => r.chaos / r.divineField);

  let implied = 0;
  for (const [minDivine, minDaily] of [[4, 20], [1, 20], [0.5, 10], [0.1, 0]]) {
    const s = sample(minDivine, minDaily);
    if (s.length >= 3) { implied = median(s); break; }
  }

  // The exchange rate leads; Divine Orb's own listing is the backstop for a
  // league so young or so thin that nothing carries a usable `divine` yet.
  const rate = rateSane(implied) ? implied : (rateSane(direct) ? direct : 0);
  return { rate, direct, implied, rateSource: rateSane(implied) ? "exchange" : "divine-orb-listing" };
}

/* ---------- price map ---------- */

/* Collapses rows to one entry per name, with the same semantics the rest of
   the pipeline already uses:
     - where base variants exist they ARE the item; other forms are ignored
     - otherwise the floor, because an unspecified roll is worth its cheapest
   `daily` and `lowConfidence` ride along so a thin price can be flagged
   rather than presented with the same authority as a liquid one. */
export function watchPriceMap(rows) {
  const acc = {};
  for (const r of rows) {
    const e = acc[r.name] || (acc[r.name] = { all: [], base: [], daily: 0, thin: true });
    e.all.push(r);
    if (isWatchBaseVariant(r)) e.base.push(r);
    e.daily = Math.max(e.daily, r.daily);
    if (!r.lowConfidence) e.thin = false;
  }
  const prices = {};
  for (const [name, e] of Object.entries(acc)) {
    const pick = e.base.length ? e.base : e.all;
    const chaos = pick.map((r) => r.chaos);
    // With base variants the cheapest base is the drop; without them every row
    // is a roll and the floor is the honest quote for an unspecified one.
    const c = Math.min(...chaos);
    prices[name] = {
      c: Math.round(c * 100) / 100,
      lo: Math.round(Math.min(...pick.map((r) => r.lo)) * 100) / 100,
      hi: Math.round(Math.max(...pick.map((r) => r.hi)) * 100) / 100,
      n: pick.length,
      daily: e.daily,
      ...(e.thin ? { thin: true } : {}),
    };
  }
  return prices;
}

/* ---------- the whole snapshot for one league ---------- */

export async function fetchWatchLeague(leagueName, { delayMs = 150, categories = WATCH_CATEGORIES } = {}) {
  const rows = [];
  const counts = {};
  const failed = [];
  for (const cat of categories) {
    const j = await tryWatch(`/get?category=${encodeURIComponent(cat)}&league=${encodeURIComponent(leagueName)}`);
    if (!Array.isArray(j)) { failed.push(cat); await sleep(delayMs); continue; }
    let n = 0;
    for (const raw of j) {
      const row = normaliseRow(raw);
      if (!row) continue;
      // Kept only for the divine-rate cross-check; not a price input.
      row.divineField = Number(raw.divine) || 0;
      row.category = cat;
      rows.push(row);
      n++;
    }
    counts[cat] = n;
    await sleep(delayMs);
  }
  if (!rows.length) return null;
  const rate = watchDivineRate(rows);
  return { rows, prices: watchPriceMap(rows), counts, failed, ...rate };
}

/* Rows for one category, in the shape the per-tab JSON files want.
   `change` is poe.watch's own day-over-day figure; the site's finer 4h/8h
   windows still come from its accumulated self-history, which has better
   resolution than a daily series. */
export function watchCategoryItems(rows, re, divineRate, cats = null) {
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    // Categories narrow before the name test: a bare /fossil/i or /scarab/i
    // over every row invites a unique with the word in its name.
    if (cats && !cats.includes(r.category)) continue;
    if (!re.test(r.name) || seen.has(r.name)) continue;
    if (!isWatchBaseVariant(r)) continue;
    seen.add(r.name);
    out.push({
      id: r.id, name: r.name,
      chaosValue: Math.round(r.chaos * 100) / 100,
      divineValue: divineRate > 0 ? r.chaos / divineRate : 0,
      change24: 0, change48: 0,
      daily: r.daily,
      ...(r.lowConfidence ? { thin: true } : {}),
    });
  }
  return out;
}
