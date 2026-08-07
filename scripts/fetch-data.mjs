/* Snapshots poe.ninja scarab data into public/data/ so the site can run on
   static hosting (GitHub Pages) without a CORS proxy.
   Run: node scripts/fetch-data.mjs

   poe.ninja moved its API (docs: https://poe.ninja/docs/api). This script
   adapts at runtime:
     leagues:  /poe1/api/economy/leagues  (fallback: index-state, legacy)
     prices:   legacy itemoverview        (fallback: new exchange overview)
     history:  legacy itemhistory if alive; otherwise the script accumulates
               its OWN history by reading the previous deployment's data and
               appending today's prices (selfhistory.json).

   Every self-history point also carries the divine rate at that moment, which
   is what lets the site tell "this scarab got more valuable" apart from "chaos
   deflated under it" (rateHistory + the change*R fields below).             */

import { mkdir, writeFile, rm } from "node:fs/promises";
import {
  watchLeagues, matchWatchLeague, fetchWatchLeague, watchCategoryItems,
} from "./poewatch.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NINJA = "https://poe.ninja";
const OUT = process.env.DATA_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const HEADERS = { "User-Agent": "scarab-ledger-snapshot/0.2 (github actions; contact via repo issues)" };
const HISTORY_LEAGUES = 2;   // ninja per-scarab history only for the first N leagues (politeness)
const SELF_HISTORY_CAP = 800; // max accumulated self-history points per league
const RATE_HISTORY_CAP = 600; // max points in the emitted chaos-per-divine series
const DELAY_MS = 300;

/* A divine has never been worth less than ~20c or more than a few thousand.
   Every rate that enters the pipeline goes through this, because the shape of
   the source (ratio vs. inverse ratio) is not always knowable up front. */
const rateSane = (v) => typeof v === "number" && isFinite(v) && v >= 20 && v <= 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const todayISO = () => new Date().toISOString().slice(0, 10);

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
async function tryJson(url) { try { return await getJson(url); } catch { return null; } }

function changesFromSparkline(sp) {
  const data = ((sp && sp.data) || []).filter((v) => v != null);
  const last = data.length ? data[data.length - 1] : 0;
  const p24 = data.length > 1 ? data[data.length - 2] : last;
  const p48 = data.length > 2 ? data[data.length - 3] : p24;
  return { change24: last - p24, change48: last - p48 };
}

const median = (arr) => {
  const s = arr.filter((v) => isFinite(v) && v > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/* ---------- leagues ---------- */
async function getLeagues() {
  const current = [];
  const previous = [];
  // Documented: plain array [{id, name}], first = current challenge league
  const a = await tryJson(`${NINJA}/poe1/api/economy/leagues`);
  if (Array.isArray(a) && a.length && a[0].id) {
    console.log("Current leagues via /poe1/api/economy/leagues");
    for (const l of a) current.push({ name: l.name || l.id, params: [l.id, l.name].filter(Boolean), group: "current", start: l.startAt || l.startDate || l.start || null });
  }
  // index-state carries the previous ("old") economy leagues, and doubles as
  // a fallback for the current ones
  const b = await tryJson(`${NINJA}/poe1/api/data/index-state`) || await tryJson(`${NINJA}/api/data/getindexstate`);
  if (b) {
    if (!current.length) {
      for (const l of b.economyLeagues || []) current.push({ name: l.name, params: [l.url, l.name].filter(Boolean), group: "current", start: l.startAt || l.startDate || null });
    }
    for (const l of b.oldEconomyLeagues || []) {
      previous.push({ name: l.name, params: [l.url, l.name].filter(Boolean), group: "previous" });
    }
    if (previous.length) console.log(`Previous leagues via index-state: ${previous.map((l) => l.name).join(", ")}`);
  }
  const seen = new Set();
  const all = [...current, ...previous].filter((l) => (seen.has(l.name) ? false : (seen.add(l.name), true)));
  if (!all.length) throw new Error("Could not fetch league list from any known endpoint");
  return all;
}

/* ---------- extra exchange categories (same features as scarabs) ---------- */
const EXTRA_CATEGORIES = [
  // `watch` narrows which poe.watch categories a name regex may match in;
  // without it /fossil/i would happily pick up a unique with the word in it.
  { key: "astrolabes", type: "Astrolabe", re: /astrolabe/i, watch: ["currency"] },
  { key: "catalysts", type: "Currency", re: /catalyst/i, watch: ["currency"] }, // catalysts live inside Currency
  // The Delve tab could read fossil prices out of prices.json, which already
  // covers the Fossil and Resonator types for the boss tab. It gets its own
  // category anyway because prices.json is a bare name -> price map: no
  // sparkline, no self-history, so no "is this fossil going up?" — which is
  // the whole question a delver is asking.
  { key: "fossils", type: "Fossil", re: /fossil/i, watch: ["fossil"] },
  { key: "resonators", type: "Resonator", re: /resonator/i, watch: ["resonator"] },
];

async function getExchangeCategory(lgParams, type, nameRe, divisor = null) {
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=${encodeURIComponent(type)}`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      const adapted = adaptExchange(j, nameRe, divisor);
      if (adapted.items.length) return adapted;
    }
    await sleep(DELAY_MS);
  }
  return null;
}

/* ---------- prices ---------- */
async function getScarabPrices(lgParams, divisor = null, watch = null) {
  // 0) poe.watch, when it answered for this league. Its scarab category is a
  //    single flat array with listing counts attached, so there is nothing to
  //    calibrate and nothing to disambiguate.
  if (watch?.rows?.length) {
    const items = watchCategoryItems(watch.rows, /scarab/i, watch.rate, ["scarab"]);
    if (items.length) {
      console.log(`  prices via poe.watch (${items.length} scarabs)`);
      return { items, source: "watch", leagueParam: lgParams[0], exchangeDivineRate: watch.rate };
    }
  }
  // 1) legacy itemoverview (kept alive via redirects historically)
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/api/data/itemoverview?league=${encodeURIComponent(p)}&type=Scarab`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      const items = j.lines.filter((l) => l.name).map((l) => ({
        id: l.id, name: l.name,
        chaosValue: l.chaosValue ?? 0,
        divineValue: l.divineValue ?? 0,
        ...changesFromSparkline(l.sparkline || l.sparkLine),
      }));
      if (items.length) {
        console.log(`  prices via legacy itemoverview (league=${p}, ${items.length} items)`);
        return { items, source: "legacy", leagueParam: p };
      }
      console.log(`  legacy itemoverview answered for ${p} but yielded 0 usable items`);
    }
    await sleep(DELAY_MS);
  }
  // 2) documented new home: exchange overview (different shape)
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=Scarab`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      const adapted = adaptExchange(j, /scarab/i, divisor);
      if (adapted.items.length) {
        console.log(`  prices via exchange overview (league=${p}, ${adapted.items.length} items)`);
        return { ...adapted, source: "exchange", leagueParam: p };
      }
      // Nothing matched — dump structure so the workflow log shows what came back
      console.log(`  exchange overview answered for ${p} but 0 items matched. Diagnostics:`);
      console.log(`    lines: ${j.lines.length}, core.items: ${(j.core?.items || []).length}, primary: ${j.core?.primary}, secondary: ${j.core?.secondary}`);
      console.log(`    sample line: ${JSON.stringify(j.lines[0]).slice(0, 400)}`);
      console.log(`    sample core.items[0]: ${JSON.stringify((j.core?.items || [])[0]).slice(0, 400)}`);
    }
    await sleep(DELAY_MS);
  }
  return null;
}

const SMALL_WORDS = new Set(["of", "the", "a", "and", "in"]);
function slugToName(slug) {
  if (!slug || typeof slug !== "string") return null;
  const out = [];
  for (const [i, w] of slug.split("-").entries()) {
    // "the-maven-s-writ" -> "The Maven's Writ": a lone "s" is a possessive
    // that lost its apostrophe on the way into the slug.
    if (w === "s" && out.length) { out[out.length - 1] += "'s"; continue; }
    out.push((i > 0 && SMALL_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
  }
  return out.join(" ");
}

/* Slugs can't round-trip every name — "awakeners-orb" is really
   "Awakener's Orb" and no amount of guessing recovers that apostrophe. The
   stash currency overview does carry real names, so we borrow those as a
   dictionary and match on letters-and-digits only. Names only; its prices
   are not what we quote against. */
const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

async function getNameDictionary(p) {
  const dict = {};
  for (const t of ["Currency", "Fragment"]) {
    const j = await tryJson(`${NINJA}/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(p)}&type=${t}`);
    await sleep(DELAY_MS);
    for (const l of (j?.lines || [])) {
      const n = l.currencyTypeName || l.name;
      if (n) dict[normKey(n)] = n;
    }
  }
  return dict;
}

function adaptExchange(j, nameRe = /scarab/i, divisor = null) {
  const core = j.core || {};
  const coreItems = core.items || [];
  const itemsById = {};
  for (const it of coreItems) {
    if (it.id != null) itemsById[it.id] = it;
    if (it.itemId != null) itemsById[it.itemId] = it;
  }
  const findId = (needle) => {
    for (const it of coreItems) if ((it.name || "").toLowerCase() === needle) return it.id ?? it.itemId;
    return null;
  };
  const chaosId = findId("chaos orb");
  const divineId = findId("divine orb");
  const rates = core.rates || {};

  // rates[x] = units of x per 1 primary. When chaos itself is the primary
  // (observed for PoE1 scarabs), primaryValue is already the chaos price.
  const rChaos = core.primary === chaosId ? (rates[chaosId] ?? 1) : rates[chaosId];

  const raw = j.lines
    .map((l) => {
      const meta = itemsById[l.id] || itemsById[l.itemId] || null;
      // core.items only carries the reference currencies; scarab names live
      // in the line id as a slug (e.g. "divination-scarab-of-pilfering").
      const name = (meta && meta.name) || l.name || slugToName(l.id ?? l.itemId);
      return { line: l, name };
    })
    .filter((x) => x.name && nameRe.test(x.name));
  if (!raw.length) return { items: [] };

  const convert = (mult) => raw.map(({ line }) => Math.max(0, (line.primaryValue ?? 0) * mult));
  let chaosVals;
  if (divisor && divisor > 0) {
    // Explicit calibration from the Currency exchange: primaryValue is quoted
    // in the primary reference currency, so dividing by chaos's own price in
    // that currency yields chaos. Exact, and works whatever the primary is.
    chaosVals = convert(1 / divisor);
  } else if (!rChaos || rChaos === 1) {
    chaosVals = convert(1);
  } else {
    // Last-ditch heuristic for when we could not find Chaos Orb at all. This
    // guesses the direction of core.rates and can be off by rChaos^2, so the
    // calibrated path above is always preferred.
    const a = convert(rChaos);
    const b = convert(1 / rChaos);
    chaosVals = (median(a) >= 0.05 && median(a) <= 50000) ? a : b;
  }

  // Divine rate in chaos. With a calibration divisor this is just divine's
  // own quote converted the same way; otherwise fall back to guessing.
  let divineRate = null;
  if (divisor && divisor > 0 && rates[divineId] != null) {
    const c = rates[divineId] / divisor;
    if (c >= 20 && c <= 20000) divineRate = c;
  }
  if (divineRate == null && rChaos != null && rates[divineId] != null && rates[divineId] !== 0) {
    for (const c of [rChaos / rates[divineId], rates[divineId] / rChaos]) {
      if (c >= 20 && c <= 20000) { divineRate = c; break; }
    }
  }

  const items = raw.map(({ line, name }, i) => ({
    id: line.id ?? line.itemId ?? name,
    name,
    chaosValue: Math.round((chaosVals[i] ?? 0) * 100) / 100,
    divineValue: divineRate ? (chaosVals[i] ?? 0) / divineRate : 0,
    ...changesFromSparkline(line.sparkline || line.sparkLine),
  }));
  return { items, exchangeDivineRate: divineRate ?? undefined };
}

/* ---------- broad price map (boss profitability) ----------
   One name -> price lookup covering everything a boss can drop or cost.

   Two documented endpoint families (https://poe.ninja/docs/api):

     exchange/current/overview   bulk-traded things — currency, FRAGMENTS,
                                 scarabs, astrolabes, omens, embers. Lines
                                 carry `primaryValue`, not chaos.
     stash/current/item/overview uniques, gems, div cards, maps. Lines
                                 carry `chaosValue` directly.

   The exchange endpoint is the one that bites. Its `primaryValue` is
   "price expressed in the primary reference currency", and that currency
   is not always chaos — get the direction wrong and every fragment is off
   by the chaos:primary ratio. The docs don't define the sign of
   `core.rates`, so rather than guess we calibrate on Chaos Orb itself:

       chaos price = primaryValue / primaryValue(Chaos Orb)

   If chaos IS the primary, its own price is 1 and the divisor is a no-op.
   Either way the arithmetic is exact rather than heuristic, and the run
   logs Chaos Orb's computed price as a self-check. */

/* Sources, in priority order. A name found by an earlier source is not
   overwritten by a later one.

   poe.ninja documents three families (https://poe.ninja/docs/api):

     exchange/current/overview        "Currency-exchange pricing for a
                                      category" — the in-game bulk market.
                                      This is the right source for anything
                                      fungible: currency, fragments, scarabs,
                                      astrolabes, omens, essences, oils,
                                      divination cards.
     stash/current/item/overview      "Stash-based item pricing" — things that
                                      aren't fungible and are priced per
                                      listing: uniques, gems, maps.
     stash/current/currency/overview  "Stash-based currency pricing", PoE 1
                                      only. Same goods as the exchange, priced
                                      the older way. Kept purely as gap-fill.

   The exchange type list below is exactly what the docs enumerate for PoE 1 —
   guessing extra ones (Incubator, Vial, Catalyst...) just burns requests, and
   leaving DivinationCard out of it is why cards went unpriced. */
const EXCHANGE_TYPES = [
  "Currency", "Fragment", "Scarab", "Astrolabe", "Omen", "Tattoo",
  "AllflameEmber", "Runegraft", "DjinnCoin", "DivinationCard", "Artifact",
  "Oil", "DeliriumOrb", "Fossil", "Resonator", "Essence",
];
const STASH_ITEM_TYPES = [
  "UniqueWeapon", "UniqueArmour", "UniqueAccessory", "UniqueFlask", "UniqueJewel",
  "SkillGem", "Map", "UniqueMap", "BlightedMap", "BlightRavagedMap",
  // Boss entry costs live here: the Incandescent / Screaming / Polaric /
  // Writhing Invitations are all "Invitation".
  "Invitation", "Vial", "Beast", "UniqueRelic",
];
/* Probed 2026-08 on Allflame and served by nothing, in any family: Incubator,
   Memory, Coffin, Tincture, Catalyst, and both legacy paths. Re-check with
   scripts/probe-price.mjs before adding any of them back. BaseType answers
   with ~18k rows of item bases and is deliberately not fetched. */
/* PoE 1 only, and the same goods the exchange already covers — used solely to
   fill names the exchange didn't return. */
const STASH_CURRENCY_TYPES = ["Currency", "Fragment"];
/* The published type lists have disagreed with reality more than once, so any
   type that comes back empty from its documented family is retried against the
   other one before we give up on it. */
const CROSS_CHECK = ["Invitation", "Vial", "Beast", "UniqueRelic"];
/* Last resort: the pre-migration endpoint. */
/* Both legacy families answered nothing when probed, but the fallback only
   fires for types the documented families left empty, so it costs nothing
   until the new API moves again. */
const LEGACY_TYPES = ["UniqueRelic", "Vial", "Invitation"];

const exchUrl = (p, t) => `${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=${t}`;
const stashItemUrl = (p, t) => `${NINJA}/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(p)}&type=${t}`;
const stashCurrUrl = (p, t) => `${NINJA}/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(p)}&type=${t}`;
const legacyUrl = (p, t) => `${NINJA}/api/data/itemoverview?league=${encodeURIComponent(p)}&type=${t}`;

function isBaseVariant(type, l) {
  if (type === "SkillGem") {
    return !l.corrupted && (l.gemLevel ?? 1) <= 1 && (l.gemQuality ?? 0) === 0;
  }
  return !l.variant && !(l.links > 0);
}

function exchangeNamesById(j) {
  const byId = {};
  for (const it of (j.core?.items || [])) {
    if (it.id != null) byId[it.id] = it.name;
    if (it.itemId != null) byId[it.itemId] = it.name;
  }
  return byId;
}

function exchangeRows(j, dict = null) {
  if (!j || !Array.isArray(j.lines)) return [];
  const byId = exchangeNamesById(j);
  return j.lines
    .map((l) => {
      const id = l.id ?? l.itemId;
      let name = byId[id] || l.name || slugToName(id);
      if (dict && name) name = dict[normKey(name)] || name;
      return { name, primaryValue: l.primaryValue ?? 0 };
    })
    .filter((r) => r.name && r.primaryValue > 0);
}

/* Divide every exchange primaryValue by this to get chaos. */
function chaosDivisor(currencyJson) {
  if (!currencyJson) return null;
  const names = exchangeNamesById(currencyJson);
  const primaryName = names[currencyJson.core?.primary];
  if (primaryName && /^chaos orb$/i.test(primaryName)) return 1;
  const chaos = exchangeRows(currencyJson).find((r) => /^chaos orb$/i.test(r.name));
  if (chaos && chaos.primaryValue > 0) return chaos.primaryValue;
  return null;
}

/* Resolve the league param that answers, and the chaos calibration, once —
   every exchange-shaped fetch for that league then converts identically. */
async function getExchangeContext(lgParams) {
  for (const p of lgParams) {
    const currency = await tryJson(exchUrl(p, "Currency"));
    await sleep(DELAY_MS);
    if (!exchangeRows(currency).length) {
      console.log(`  league param "${p}": Currency exchange returned nothing, trying next`);
      continue;
    }
    const divisor = chaosDivisor(currency);
    if (divisor == null) {
      console.log("  WARNING: Chaos Orb not found in the Currency exchange — falling back to heuristic conversion");
    } else {
      const names = exchangeNamesById(currency);
      console.log(`  exchange primary is ${names[currency.core?.primary] || currency.core?.primary || "?"}; chaos divisor ${divisor}`);
    }
    const dict = await getNameDictionary(p);
    if (Object.keys(dict).length) console.log(`  name dictionary: ${Object.keys(dict).length} currency/fragment names`);
    return { leagueParam: p, divisor, currency, dict };
  }
  return null;
}

/* Source precedence, highest first:
     -1  poe.watch      — the primary. One shape, real listing counts, and it
                          carries items poe.ninja does not list at all.
      0  poe.ninja exchange / stash items
      1  poe.ninja stash currency  (gap-fill only)
      3  the pre-migration legacy endpoint
   poe.ninja is not removed: poe.watch can be down or thin on a category, and
   a filled price beats an empty one. */
async function getPriceMap(lgParams, ctx, watch = null) {
  const p = ctx ? ctx.leagueParam : lgParams[0];
  if (!p) return null;
  const div = (ctx?.divisor) || 1;

  const acc = {};
  const counts = {};
  const missed = [];
  // rank 0 beats rank 1 beats rank 2: a name already priced by a
  // direct-chaos source is never re-priced from a converted one.
  // `variant` is poe.ninja's roll label ("Life", "ES", "1 Prefix, 2 Suffix").
  // Kept per name so a drop line that identifies WHICH variant it is can be
  // priced exactly, instead of falling back to the floor across all of them.
  const add = (rank, name, chaos, preferred, variant = null) => {
    if (!name || !(chaos > 0)) return;
    const e = acc[name];
    if (e && e.rank < rank) return;
    if (!e || e.rank > rank) {
      acc[name] = { rank, all: [chaos], base: preferred ? [chaos] : [], byVariant: {} };
      if (variant) acc[name].byVariant[variant] = chaos;
      return;
    }
    e.all.push(chaos);
    if (preferred) e.base.push(chaos);
    // Same variant listed twice (different links, say): keep the cheaper.
    if (variant && (e.byVariant[variant] == null || chaos < e.byVariant[variant])) e.byVariant[variant] = chaos;
  };
  const tally = (t, n) => { if (n) counts[t] = (counts[t] || 0) + n; else missed.push(t); };

  // 1. exchange — the bulk market, and the documented home for everything
  //    fungible. Needs the chaos calibration.
  for (const t of EXCHANGE_TYPES) {
    const j = (t === "Currency" && ctx?.currency) ? ctx.currency : await tryJson(exchUrl(p, t));
    if (!(t === "Currency" && ctx?.currency)) await sleep(DELAY_MS);
    const rows = exchangeRows(j, ctx?.dict);
    for (const r of rows) add(0, r.name, r.primaryValue / div, true);
    tally(`exch:${t}`, rows.length);
  }

  // 2. stash items — uniques, gems, maps; priced per listing, already chaos
  for (const t of STASH_ITEM_TYPES) {
    const j = await tryJson(stashItemUrl(p, t));
    await sleep(DELAY_MS);
    const lines = (j && Array.isArray(j.lines)) ? j.lines : [];
    let n = 0;
    for (const l of lines) {
      const chaos = l.chaosValue ?? l.chaosEquivalent;
      if (!l.name || !(chaos > 0)) continue;
      add(0, l.name, chaos, isBaseVariant(t, l), l.variant || null);
      // Maps are labelled inconsistently — the tier 17s group under
      // "Nightmare Map" and baseType isn't always the display name.
      if (/Map$/.test(t) && l.baseType && l.baseType !== l.name) add(0, l.baseType, chaos, true);
      n++;
    }
    tally(t, n);
    if (t === "Map" && n) {
      const t17 = lines
        .filter((l) => /citadel|fortress|sanctuary|ziggurat|abomination|nightmare/i.test(`${l.name} ${l.baseType || ""}`))
        .map((l) => `${l.name}${l.baseType && l.baseType !== l.name ? ` [${l.baseType}]` : ""}${l.variant ? ` (${l.variant})` : ""} ${Math.round(l.chaosValue)}c`);
      console.log(`    tier 17 map listings: ${t17.length ? t17.join(", ") : "none matched"}`);
    }
  }

  // 3. stash currency — gap-fill only, for names the exchange didn't carry
  for (const t of STASH_CURRENCY_TYPES) {
    const j = await tryJson(stashCurrUrl(p, t));
    await sleep(DELAY_MS);
    let n = 0, filled = 0;
    for (const l of (j?.lines || [])) {
      const name = l.currencyTypeName || l.name;
      const chaos = l.chaosEquivalent ?? l.chaosValue;
      if (!name || !(chaos > 0)) continue;
      if (!acc[name]) filled++;
      add(1, name, chaos, true);
      n++;
    }
    tally(`stash:${t}`, n);
    if (filled) console.log(`    stash ${t} filled ${filled} name(s) the exchange did not list`);
  }

  // 3b. cross-family retry — a type the docs place in one family sometimes
  //     only answers from the other.
  for (const t of CROSS_CHECK) {
    if (counts[t]) continue;
    const j = await tryJson(exchUrl(p, t));
    await sleep(DELAY_MS);
    const rows = exchangeRows(j, ctx?.dict);
    if (!rows.length) continue;
    for (const r of rows) add(0, r.name, r.primaryValue / div, true);
    counts[`exch:${t}`] = rows.length;
    console.log(`    ${t} answered from the exchange, not the stash item overview`);
  }

  // 4. legacy, for anything the documented families never answered
  for (const t of LEGACY_TYPES) {
    if (counts[t] || counts[`exch:${t}`]) continue;
    const j = await tryJson(legacyUrl(p, t));
    await sleep(DELAY_MS);
    let n = 0;
    for (const l of (j?.lines || [])) {
      if (l.name && l.chaosValue > 0) { add(3, l.name, l.chaosValue, isBaseVariant(t, l)); n++; }
    }
    if (n) counts[`legacy:${t}`] = n;
  }

  // poe.watch runs last but ranks first: add() replaces anything held at a
  // worse rank, so this displaces poe.ninja wherever both know an item.
  //
  // Roll variants are the exception. poe.ninja splits some uniques by roll and
  // poe.watch does not, so those maps are lifted out before the overwrite and
  // put back afterwards — poe.watch's better headline price, poe.ninja's
  // per-variant detail, rather than losing one to gain the other.
  const ninjaVariants = {};
  for (const [name, e] of Object.entries(acc)) {
    if (Object.keys(e.byVariant || {}).length > 1) ninjaVariants[name] = e.byVariant;
  }
  if (watch?.prices) {
    let n = 0;
    for (const [name, e] of Object.entries(watch.prices)) {
      if (!(e.c > 0)) continue;
      add(-1, name, e.c, true);
      n++;
    }
    if (n) counts["poe.watch"] = n;
  }

  if (!Object.keys(acc).length) return null;

  // Lower-middle median: with an even number of listings (a unique with two
  // variants) the shared median() helper returns the dearer one, biasing every
  // EV upward. Cheaper side wins.
  const midLow = (arr) => {
    const a = arr.filter((v) => isFinite(v) && v > 0).sort((x, y) => x - y);
    return a.length ? a[Math.ceil(a.length / 2) - 1] : 0;
  };
  const prices = {};
  for (const [name, e] of Object.entries(acc)) {
    // A poe.watch entry already resolved its own spread and listing count over
    // the full row set; re-deriving them from the single value added above
    // would throw that away.
    const w = (e.rank === -1) ? watch?.prices?.[name] : null;
    if (w) {
      prices[name] = { ...w };
      if (ninjaVariants[name]) {
        const v = {};
        for (const [k, val] of Object.entries(ninjaVariants[name])) v[k] = Math.round(val * 100) / 100;
        prices[name].v = v;
      }
      continue;
    }
    // All three bases must describe the SAME population: the item as a boss
    // drops it. poe.ninja's "variants" mix two unrelated things — genuine roll
    // variants (Atziri's Splendour Armour vs ES/Eva) and post-drop states a
    // boss never hands you (a corrupted 21/20 gem, a 6-linked unique). Spanning
    // e.all let the second kind into lo/hi, which is how a level-1 Pacifism
    // Support worth about a divine showed a "best roll" of 482 divine — that is
    // the corrupted level 21 copy, not the gem that drops.
    // Where base variants exist they ARE the drop; where none do (every listing
    // carries a roll variant) the full spread is the real spread.
    const pick = e.base.length ? e.base : e.all;
    // ...and when every listing is a roll variant, the drop is a RANDOM one, so
    // the floor is the honest quote, not the middle. poe.ninja's variant list
    // isn't weighted by how often each roll occurs, and the dear variants are
    // dear precisely because they are the rare rolls — a median over the list
    // reads as if half your drops hit them. Atziri's Splendour is the case in
    // point: it sells for single-digit chaos, but its list runs from that to
    // several hundred, and the median put it over 40c inside Uber Atziri's
    // pool, where it carries 39% of the loot share.
    const typical = e.base.length ? midLow(pick) : Math.min(...pick);
    prices[name] = {
      c: Math.round(typical * 100) / 100,
      lo: Math.round(Math.min(...pick) * 100) / 100,
      hi: Math.round(Math.max(...pick) * 100) / 100,
      n: pick.length,
    };
    // Only worth carrying when there is a choice to make. One variant is just
    // the base price under another name.
    const vs = Object.keys(e.byVariant || {});
    if (vs.length > 1) {
      const v = {};
      for (const k of vs) v[k] = Math.round(e.byVariant[k] * 100) / 100;
      prices[name].v = v;
    }
  }
  if (!prices["Chaos Orb"]) prices["Chaos Orb"] = { c: 1, lo: 1, hi: 1, n: 1 };

  const chaosCheck = prices["Chaos Orb"].c;
  if (Math.abs(chaosCheck - 1) > 0.02) {
    console.log(`    WARNING: Chaos Orb priced at ${chaosCheck}c — exchange calibration looks wrong`);
  }
  if (missed.length) console.log(`    no data for: ${missed.join(", ")}`);
  console.log(`    sources: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  return { prices, leagueParam: p, divisor: div, categories: Object.keys(counts).length };
}

/* Every item the boss tab references, checked against what we actually got.
   Anything listed here shows "no price" in the UI. For each miss we also
   suggest the closest names that ARE priced, which distinguishes the two
   causes: a spelling that drifted (fixable in bossData.js) versus an item
   poe.ninja genuinely doesn't list (nothing to fix). */
function suggestNames(missing, allNames, k = 3) {
  const tok = (x) => new Set(String(x).toLowerCase().match(/[a-z0-9]+/g) || []);
  const want = tok(missing);
  if (!want.size) return [];
  const scored = [];
  for (const n of allNames) {
    const have = tok(n);
    let shared = 0;
    for (const t of want) if (have.has(t)) shared++;
    if (!shared) continue;
    scored.push([shared / Math.max(want.size, have.size), n]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.filter(([sc]) => sc >= 0.3).slice(0, k).map(([, n]) => n);
}

async function reportUnpricedBossItems(prices, leagueName = "", detailed = true) {
  let mod;
  try {
    mod = {
      data: await import("../src/bossData.js"),
      calc: await import("../src/bossProfit.js"),
      delve: await import("../src/delveData.js"),
    };
  } catch (e) {
    console.log(`    (boss item check skipped: ${e.message})`);
    return;
  }
  const resolve = mod.calc.makeResolver(prices, { divineRate: prices["Divine Orb"]?.c || 0 });
  const missing = new Map();   // item name -> where it appears
  const declared = new Set();  // priced from bossData's fallback, not the API
  const varOk = [];            // drop lines priced on a specific roll variant
  const varMiss = [];          // lines that named a variant nothing matched
  // Every fossil the Delve tab prices. A fossil that stops resolving takes a
  // biome average down with it silently, so it is worth a line in the log —
  // but only one line: fossil names are stable, so a miss is a thin economy,
  // not a spelling that drifted, and the per-item "closest priced name" hints
  // the boss items get would be 20 lines of noise.
  const fossilMisses = mod.delve.FOSSILS
    .filter((f) => !(prices[f.name]?.c > 0))
    .map((f) => f.name);
  for (const b of [...mod.data.BOSSES, ...mod.delve.DELVE_BOSSES]) {
    const c = mod.calc.computeBoss(b, resolve);
    for (const l of c.entryLines) {
      if (l.fallback) declared.add(`${l.item}${l.fallbackAge != null ? ` (${l.fallbackAge}d old)` : ""}`);
      else if (!l.found) missing.set(l.item, `entry: ${b.name}`);
    }
    for (const l of c.dropLines) {
      if (l.variant) varOk.push(`${l.item} [${l.variant}] ${Math.round(l.unit)}c`);
      else if (l.variantMissed) {
        // The item HAS variants and this line claimed one, but the strings
        // didn't line up — so the line is quoting the name-wide price. This is
        // the only way to see that from outside, so print BOTH sides and let
        // the mapping be corrected in bossData.
        const vs = Object.keys(prices[l.item]?.v || {});
        varMiss.push(`${b.name} / "${l.label}" wanted "${mod.calc.variantHint({ label: l.label })}" — ${l.item} has: ${vs.join(" | ")}`);
      }
      if (l.fallback) declared.add(`${l.item}${l.fallbackAge != null ? ` (${l.fallbackAge}d old)` : ""}`);
      else if (!l.found && l.qty > 0 && !missing.has(l.item)) missing.set(l.item, b.name);
    }
  }
  if (declared.size && detailed) {
    console.log(`    ${leagueName ? leagueName + ": " : ""}priced from a declared fallback, not the API (${declared.size}): ${[...declared].sort().join(", ")}`);
  }
  const tag = leagueName ? `${leagueName}: ` : "";
  if (detailed) {
    if (varOk.length) console.log(`    ${tag}priced on a specific roll variant (${varOk.length}): ${varOk.join(", ")}`);
    if (varMiss.length) {
      console.log(`    ${tag}${varMiss.length} drop line(s) name a variant that did NOT match — each is using the name-wide price:`);
      for (const m of varMiss) console.log(`      ${m}`);
    }
    // Any priced item carrying variants is a candidate for splitting a drop
    // line, so list them once: it is the only view of what poe.ninja actually
    // splits on, and guessing those strings blind is how they drift.
    const withVariants = Object.entries(prices)
      .filter(([, e]) => e.v && Object.keys(e.v).length > 1)
      .map(([n, e]) => `${n} (${Object.keys(e.v).length})`);
    if (withVariants.length) {
      console.log(`    ${tag}${withVariants.length} priced item(s) have roll variants: ${withVariants.slice(0, 40).join(", ")}${withVariants.length > 40 ? ", …" : ""}`);
    }
  }
  if (fossilMisses.length) {
    console.log(`    ${tag}${fossilMisses.length}/${mod.delve.FOSSILS.length} delve fossils unpriced: ${fossilMisses.join(", ")}`);
  } else {
    console.log(`    ${tag}delve fossils — all ${mod.delve.FOSSILS.length} priced`);
  }
  if (!missing.size) {
    console.log(`    ${tag}boss items — every referenced name resolved to a price`);
    return;
  }
  // Only the current league gets the full breakdown. Old and hardcore leagues
  // legitimately don't trade half these items, and printing 50 lines each just
  // buries the one list that matters.
  if (!detailed) {
    console.log(`    ${tag}${missing.size} boss item(s) unpriced (expected — thin economy; rerun with the current league for detail)`);
    return;
  }
  const names = Object.keys(prices);
  console.log(`    ${tag}boss items with NO PRICE (${missing.size}) — closest priced names alongside:`);
  for (const [item, where] of [...missing].sort()) {
    const hints = suggestNames(item, names);
    console.log(`      ${item}  [${where}]  ->  ${hints.length ? hints.join(" | ") : "nothing similar is priced"}`);
  }
}

/* ---------- divine rate ---------- */
async function getDivineRate(lgParam, fallback) {
  const urls = [
    `${NINJA}/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(lgParam)}&type=Currency`,
    `${NINJA}/api/data/currencyoverview?league=${encodeURIComponent(lgParam)}&type=Currency`,
  ];
  for (const u of urls) {
    const j = await tryJson(u);
    const div = j && (j.lines || []).find((l) => l.currencyTypeName === "Divine Orb");
    if (div?.chaosEquivalent) return div.chaosEquivalent;
    await sleep(DELAY_MS);
  }
  return fallback ?? 185;
}

/* ---------- ninja per-scarab history (legacy only) ---------- */
async function getNinjaHistory(lgParam, items) {
  const history = {};
  let consecutiveFails = 0;
  let maxAgoAll = 0;   // day 0 of this axis, in days before now — the rate line needs it too
  for (const it of items) {
    const arr = await tryJson(`${NINJA}/api/data/itemhistory?league=${encodeURIComponent(lgParam)}&type=Scarab&itemId=${it.id}`);
    if (Array.isArray(arr) && arr.length) {
      consecutiveFails = 0;
      const maxAgo = Math.max(...arr.map((p) => p.daysAgo), 0);
      if (maxAgo > maxAgoAll) maxAgoAll = maxAgo;
      history[it.name] = arr
        .slice().sort((x, y) => y.daysAgo - x.daysAgo)
        .map((p) => ({ day: maxAgo - p.daysAgo, value: p.value }));
    } else if (++consecutiveFails >= 3 && Object.keys(history).length === 0) {
      console.log("  ninja itemhistory appears dead, skipping");
      return { series: {}, maxAgo: 0 };
    }
    await sleep(DELAY_MS);
  }
  return { series: history, maxAgo: maxAgoAll };
}

/* ---------- self-accumulated history ---------- */
function pagesBaseUrl() {
  if (process.env.PAGES_BASE_URL) return process.env.PAGES_BASE_URL.replace(/\/$/, "");
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  if (!repo) return null;
  const [owner, name] = repo.split("/");
  return `https://${owner}.github.io/${name}`;
}

function normalizePoint(p) {
  // old format: {date: "YYYY-MM-DD"}; new format: {t: ISO timestamp}
  // `rate` (chaos per divine) is newer still — points written before the
  // divine-rate feature simply don't have one, and everything downstream
  // treats a missing rate as "not measurable here" rather than an error.
  const out = { t: p.t || `${p.date}T00:00:00Z`, values: p.values || {} };
  if (rateSane(p.rate)) out.rate = p.rate;
  return out;
}

async function updateSelfHistory(slug, items, prefix = "", rate = null) {
  const base = pagesBaseUrl();
  const reset = process.env.RESET_HISTORY === "true";
  const prev = (base && !reset) ? await tryJson(`${base}/data/${slug}/${prefix}selfhistory.json`) : null;
  const points = ((prev && Array.isArray(prev.points)) ? prev.points : []).map(normalizePoint);
  const values = {};
  for (const it of items) values[it.name] = Math.round(it.chaosValue * 100) / 100;
  const point = { t: new Date().toISOString(), values }; // one point per run
  if (rateSane(rate)) point.rate = Math.round(rate * 100) / 100;
  points.push(point);
  points.sort((a, b) => (a.t < b.t ? -1 : 1));
  while (points.length > SELF_HISTORY_CAP) points.shift();
  return { points };
}

/* Recompute change windows from our own accumulated points when we have data
   old enough; otherwise sparkline-derived values (24h/48h only) stay. The
   15-min tolerance forgives GitHub's cron starting a few minutes late. */
const CHANGE_WINDOWS = [[4, "change4"], [8, "change8"], [12, "change12"], [24, "change24"], [48, "change48"]];
function applySelfChanges(items, self) {
  const pts = (self.points || []).map(normalizePoint);
  if (pts.length < 2) return;
  const last = pts[pts.length - 1];
  const now = Date.parse(last.t);
  const refFor = (hours) => {
    const cutoff = now - (hours * 3600e3 - 15 * 60e3);
    let ref = null;
    for (const p of pts) { if (Date.parse(p.t) <= cutoff) ref = p; else break; }
    return ref;
  };
  for (const [hours, key] of CHANGE_WINDOWS) {
    const ref = refFor(hours);
    if (!ref) continue;
    for (const it of items) {
      const v = ref.values[it.name];
      if (v > 0) it[key] = (it.chaosValue / v - 1) * 100;
      /* Same window, priced in divine instead of chaos: this is the move the
         item made against the rest of the economy rather than against a chaos
         orb that is itself drifting. Only computable once both ends of the
         window know their rate. */
      if (v > 0 && rateSane(ref.rate) && rateSane(last.rate)) {
        it[`${key}R`] = ((it.chaosValue / last.rate) / (v / ref.rate) - 1) * 100;
      }
    }
  }
}

/* Anchor self-history day 0 at league start when we know it and it's sane
   (guards against Standard's 2013 "start" producing day 4700). */
function alignmentBase(self, leagueStart) {
  if (!leagueStart) return null;
  const ms = Date.parse(leagueStart);
  if (!isFinite(ms)) return null;
  const pts = (self.points || []).map(normalizePoint);
  if (!pts.length) return null;
  const diff = Date.parse(pts[0].t) - ms;
  return (diff >= -6 * 3600e3 && diff <= 45 * 86400000) ? ms : null;
}

function selfHistoryToSeries(self, baseMs = null) {
  const out = {};
  const pts = (self.points || []).map(normalizePoint);
  if (!pts.length) return out;
  const t0 = baseMs ?? Date.parse(pts[0].t);
  for (const p of pts) {
    const day = Math.round(((Date.parse(p.t) - t0) / 86400000) * 100) / 100;
    for (const [name, v] of Object.entries(p.values || {})) {
      (out[name] ||= []).push({ day, value: v });
    }
  }
  return out;
}

/* ---------- chaos-per-divine history ----------

   The site can answer "did this scarab gain value, or did chaos just deflate?"
   only if it knows what a divine cost on every past day. Two sources:

     1. backfill — poe.ninja's legacy currency history, when it answers, hands
        over the whole league in one request. Its shape has changed over the
        years and the ratio is sometimes quoted the other way up, so accept
        anything that yields {daysAgo, value} pairs, try both orientations and
        keep whichever produces plausible rates.
     2. accumulation — every snapshot stores its own rate, so the curve keeps
        growing even when (1) is dead, which is the steady state. */
function ratePointsFrom(list) {
  const raw = [];
  for (const e of list || []) {
    const daysAgo = e?.daysAgo ?? e?.DaysAgo;
    const value = e?.value ?? e?.Value;
    if (typeof daysAgo === "number" && typeof value === "number" && value > 0) raw.push({ daysAgo, value });
  }
  if (raw.length < 3) return [];
  // The same series read as chaos-per-divine and as divine-per-chaos; whichever
  // lands inside a believable band is the one poe.ninja meant.
  let best = [];
  for (const invert of [false, true]) {
    const pts = raw
      .map((p) => ({ daysAgo: p.daysAgo, rate: invert ? 1 / p.value : p.value }))
      .filter((p) => rateSane(p.rate));
    if (pts.length > best.length && pts.length >= raw.length * 0.6) best = pts;
  }
  return best;
}

async function getDivineRateBackfill(lgParam) {
  const overview = await tryJson(`${NINJA}/api/data/currencyoverview?league=${encodeURIComponent(lgParam)}&type=Currency`);
  const divine = (overview?.currencyDetails || []).find((d) => d?.name === "Divine Orb");
  if (!divine?.id) return [];
  await sleep(DELAY_MS);
  const j = await tryJson(`${NINJA}/api/data/currencyhistory?league=${encodeURIComponent(lgParam)}&type=Currency&currencyId=${divine.id}`);
  if (!j) return [];
  const candidates = Array.isArray(j)
    ? [j]
    : [j.receiveCurrencyGraphData, j.payCurrencyGraphData, j.lines, j.data];
  let best = [];
  for (const c of candidates) {
    const pts = ratePointsFrom(c);
    if (pts.length > best.length) best = pts;
  }
  return best;
}

/* Merge accumulated + backfilled rates onto whatever day axis the item history
   is already using, so the rate line and the price line share an x. */
function buildRateHistory({ self, backfill = [], axis, nowMs = Date.now() }) {
  const byMs = new Map();
  for (const p of backfill) {
    const ms = nowMs - p.daysAgo * 86400000;
    byMs.set(Math.round(ms / 600e3), { ms, rate: p.rate }); // 10-min buckets
  }
  // Our own snapshots are the more trustworthy source, so they overwrite.
  for (const p of (self.points || []).map(normalizePoint)) {
    if (!rateSane(p.rate)) continue;
    const ms = Date.parse(p.t);
    if (!isFinite(ms)) continue;
    byMs.set(Math.round(ms / 600e3), { ms, rate: p.rate });
  }
  const toDay = axis.mode === "ninja"
    ? (ms) => axis.maxAgo - (nowMs - ms) / 86400000
    : (ms) => (ms - axis.t0Ms) / 86400000;
  let out = [...byMs.values()]
    .sort((a, b) => a.ms - b.ms)
    .map((p) => ({ day: Math.round(toDay(p.ms) * 100) / 100, rate: Math.round(p.rate * 100) / 100 }))
    // Points older than day 0 have no price line to sit next to; dropping them
    // keeps the chart domain identical to the one the price series defines.
    .filter((p) => isFinite(p.day) && p.day >= -0.01)
    .map((p) => ({ day: Math.max(0, p.day), rate: p.rate }));
  if (out.length > RATE_HISTORY_CAP) {
    const step = Math.ceil(out.length / RATE_HISTORY_CAP);
    const thinned = out.filter((_, i) => i % step === 0);
    if (thinned[thinned.length - 1] !== out[out.length - 1]) thinned.push(out[out.length - 1]);
    out = thinned;
  }
  return out;
}

/* ---------- reuse mode: mirror the currently deployed data ---------- */
const LEAGUE_FILES = [
  "scarabs.json", "history.json", "selfhistory.json", "prices.json",
  "astrolabes.json", "astrolabes-history.json", "astrolabes-selfhistory.json",
  "catalysts.json", "catalysts-history.json", "catalysts-selfhistory.json",
  "fossils.json", "fossils-history.json", "fossils-selfhistory.json",
  "resonators.json", "resonators-history.json", "resonators-selfhistory.json",
];

async function tryText(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

async function mirrorExisting() {
  const base = pagesBaseUrl();
  if (!base) return false;
  const idxText = await tryText(`${base}/data/index.json`);
  if (!idxText) return false;
  let idx;
  try { idx = JSON.parse(idxText); } catch { return false; }
  if (!idx.leagues || !idx.leagues.length) return false;

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const kept = [];
  for (const l of idx.leagues) {
    const dir = path.join(OUT, l.slug);
    const main = await tryText(`${base}/data/${l.slug}/scarabs.json`);
    if (!main) { console.log(`- ${l.name}: deployed data missing, dropping`); continue; }
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "scarabs.json"), main);
    for (const f of LEAGUE_FILES.slice(1)) {
      const body = await tryText(`${base}/data/${l.slug}/${f}`);
      if (body != null) await writeFile(path.join(dir, f), body);
    }
    kept.push(l);
    console.log(`- ${l.name}: reused deployed data`);
  }
  if (!kept.length) return false;
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({ ...idx, leagues: kept }));
  return true;
}

/* ---------- main ---------- */
async function main() {
  if ((process.env.DATA_MODE || "fetch") === "reuse") {
    if (await mirrorExisting()) {
      console.log("Code-only deploy: reused deployed data, no new snapshot taken.");
      return;
    }
    console.log("Nothing deployed to reuse — falling back to a full fetch.");
  }
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const leagues = await getLeagues();
  console.log("Leagues:", leagues.map((l) => l.name).join(", "));

  // poe.watch names its leagues independently, so resolve the list once and
  // map each of ours onto it. An empty list here is not fatal: every code path
  // below falls through to poe.ninja.
  const watchLgs = await watchLeagues();
  console.log(watchLgs.length
    ? `poe.watch leagues: ${watchLgs.map((l) => l.name).join(", ")}`
    : "poe.watch unreachable — this run is poe.ninja only");

  const written = [];
  for (const [li, lg] of leagues.entries()) {
    try {
      // One poe.watch pull per league covers every tab: scarabs, the extra
      // categories and the boss price map all read from these same rows.
      const watchName = matchWatchLeague(lg.name, watchLgs);
      const watch = watchName ? await fetchWatchLeague(watchName) : null;
      if (watch) {
        const cats = Object.entries(watch.counts).filter(([, n]) => n).length;
        console.log(`  poe.watch: ${watch.rows.length} rows over ${cats} categories, ${Object.keys(watch.prices).length} names`
          + (watch.failed.length ? `, no data for ${watch.failed.join("/")}` : ""));
        console.log(`  poe.watch divine rate: ${Math.round(watch.rate)}c via ${watch.rateSource}`
          + (watch.direct ? ` (the Divine Orb listing itself says ${Math.round(watch.direct)}c — thin, so not used)` : ""));
      } else if (watchLgs.length) {
        console.log(`  poe.watch: no league matching "${lg.name}" — poe.ninja only for this one`);
      }

      const ctx = await getExchangeContext(lg.params);
      const priced = await getScarabPrices(lg.params, ctx?.divisor, watch);
      if (!priced || !priced.items.length) { console.log(`- ${lg.name}: no usable scarab data, skipping`); continue; }
      const { items, source, leagueParam, exchangeDivineRate } = priced;

      // Divine rate: when prices come from the exchange overview, derive the
      // rate from that same response (live market, consistent with the scarab
      // prices). The stash/legacy currency endpoints can serve stale values.
      const divineRate = (watch?.rate > 0)
        ? watch.rate
        : (source === "exchange" && exchangeDivineRate)
          ? exchangeDivineRate
          : await getDivineRate(leagueParam, exchangeDivineRate);
      // divineValue may be missing/zero from some sources — recompute
      for (const it of items) if (!it.divineValue) it.divineValue = it.chaosValue / divineRate;

      const slug = slugify(lg.name);
      let history = {};
      let ninjaMaxAgo = 0;
      // Only the legacy endpoint serves per-item history. poe.watch has a
      // seven-point daily series, but the site's own snapshots are 4-hourly
      // and already deeper than that, so self-history stays the chart source.
      if (source === "legacy" && lg.group === "current" && li < HISTORY_LEAGUES) {
        const nh = await getNinjaHistory(leagueParam, items);
        history = nh.series;
        ninjaMaxAgo = nh.maxAgo;
      }
      // Self-history only makes sense for running leagues; finished leagues
      // have frozen prices, so a flat fake curve would just mislead.
      let self = { points: [] };
      let historySource = Object.keys(history).length ? "ninja" : "none";
      let historyAxis = "league day";
      let rateAxis = { mode: "ninja", maxAgo: ninjaMaxAgo };
      if (lg.group === "current") {
        self = await updateSelfHistory(slug, items, "", divineRate);
        applySelfChanges(items, self);
        const alignMs = alignmentBase(self, lg.start);
        if (!Object.keys(history).length) {
          history = selfHistoryToSeries(self, alignMs);
          if (Object.keys(history).length) {
            historySource = "self";
            historyAxis = alignMs ? "league day" : "days since first snapshot";
          }
        }
        if (historySource !== "ninja") {
          const firstMs = self.points.length ? Date.parse(self.points[0].t) : Date.now();
          rateAxis = { mode: "self", t0Ms: alignMs ?? firstMs };
        }
      }

      // One backfill attempt per league, and only where there is a chart to
      // put it on. If poe.ninja's history endpoints are dead the rate curve
      // still grows from our own snapshots, so this stays silent on failure.
      let rateBackfill = [];
      if (lg.group === "current" && li < HISTORY_LEAGUES) {
        try { rateBackfill = await getDivineRateBackfill(leagueParam); } catch { /* accumulate instead */ }
      }
      const rateHistory = buildRateHistory({ self, backfill: rateBackfill, axis: rateAxis });
      const rateHistorySource = !rateHistory.length ? "none" : rateBackfill.length ? "ninja+self" : "self";

      const dir = path.join(OUT, slug);
      await mkdir(dir, { recursive: true });
      const generatedAt = new Date().toISOString();
      await writeFile(path.join(dir, "scarabs.json"), JSON.stringify({ generatedAt, divineRate, historySource, historyAxis, rateHistory, rateHistorySource, items }));
      await writeFile(path.join(dir, "history.json"), JSON.stringify(history));
      await writeFile(path.join(dir, "selfhistory.json"), JSON.stringify(self));
      // broad price map for the boss profitability tab
      try {
        const pm = await getPriceMap(lg.params, ctx, watch);
        if (pm) {
          await writeFile(path.join(dir, "prices.json"), JSON.stringify({ generatedAt, divineRate, prices: pm.prices }));
          console.log(`  prices: ${Object.keys(pm.prices).length} names across ${pm.categories} sources (league=${pm.leagueParam})`);
          await reportUnpricedBossItems(pm.prices, lg.name, li === 0);
        } else {
          console.log(`  prices: NO DATA for ${lg.name} — every endpoint family came back empty`);
        }
      } catch (e) {
        console.log(`  prices: FAILED (${e.message})`);
      }

      // extra categories: astrolabes + catalysts, same treatment as scarabs
      for (const cat of EXTRA_CATEGORIES) {
        try {
          let r = null;
          if (watch) {
            const wi = watchCategoryItems(watch.rows, cat.re, watch.rate || divineRate, cat.watch);
            if (wi.length) r = { items: wi, source: "watch" };
          }
          if (!r) r = await getExchangeCategory(lg.params, cat.type, cat.re, ctx?.divisor);
          if (!r || !r.items.length) { console.log(`  ${cat.key}: no data for ${lg.name}`); continue; }
          const rate2 = r.exchangeDivineRate || divineRate;
          for (const it of r.items) if (!it.divineValue) it.divineValue = it.chaosValue / rate2;
          let catHist = {};
          let catSelf = { points: [] };
          let catHistorySource = "none";
          let catHistoryAxis = "days since first snapshot";
          let catRateHistory = [];
          if (lg.group === "current") {
            catSelf = await updateSelfHistory(slug, r.items, `${cat.key}-`, rate2);
            applySelfChanges(r.items, catSelf);
            const catAlign = alignmentBase(catSelf, lg.start);
            catHist = selfHistoryToSeries(catSelf, catAlign);
            if (Object.keys(catHist).length) {
              catHistorySource = "self";
              if (catAlign) catHistoryAxis = "league day";
            }
            // These tabs always plot self-history, so day 0 is whatever this
            // category's own alignment says — reuse the league's backfill on it.
            const firstMs = catSelf.points.length ? Date.parse(catSelf.points[0].t) : Date.now();
            catRateHistory = buildRateHistory({
              self: catSelf, backfill: rateBackfill,
              axis: { mode: "self", t0Ms: catAlign ?? firstMs },
            });
          }
          await writeFile(path.join(dir, `${cat.key}.json`), JSON.stringify({ generatedAt, divineRate: rate2, historySource: catHistorySource, historyAxis: catHistoryAxis, rateHistory: catRateHistory, rateHistorySource: !catRateHistory.length ? "none" : rateBackfill.length ? "ninja+self" : "self", items: r.items }));
          await writeFile(path.join(dir, `${cat.key}-history.json`), JSON.stringify(catHist));
          await writeFile(path.join(dir, `${cat.key}-selfhistory.json`), JSON.stringify(catSelf));
          console.log(`  ${cat.key}: ${r.items.length} items`);
        } catch (e) {
          console.log(`  ${cat.key}: FAILED (${e.message})`);
        }
      }

      written.push({ name: lg.name, slug, group: lg.group || "current" });
      console.log(`- ${lg.name}: ${items.length} scarabs, ${Object.keys(history).length} history series, 1 div = ${Math.round(divineRate)}c, rate history ${rateHistory.length}pt (${rateHistorySource})`);
    } catch (e) {
      console.log(`- ${lg.name}: FAILED (${e.message})`);
    }
  }

  if (!written.length) throw new Error("No league data could be fetched — aborting so the old deployment stays up.");
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), leagues: written }));
  console.log(`Done. Wrote ${written.length} league(s) to ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
