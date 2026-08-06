/* Pure calculation layer for the Delve tab. No React, so the maths is
   testable on its own (scripts/test-delve.mjs).

   Three things are computed here:

     biome value   what a delve level of that biome is worth, from its
                   fossil pool, its exclusive fossil node, and — for city
                   biomes, which have no pool — its boss.
     biome share   how much of the mine that biome occupies at a given
                   depth, from poewiki's spawn weights.
     boss value    expected chaos per kill, and the SHAPE of that: a
                   16% Doryani's Machinarium makes the mean a number you
                   will rarely see on any single kill, and you get a
                   handful of these a league, not thirty in a row.

   The boss drop maths is deliberately not reimplemented — delve bosses
   are declared in bossData.js's group shape and priced by its
   computeBoss(), so there is exactly one drop engine in the codebase. */

import { computeBoss } from "./bossProfit.js";
import { BIOMES, BIOME_BY_ID, DELVE_BOSSES, DELVE_BOSS_BY_ID, DEFAULTS, FALLBACKS, FOSSILS } from "./delveData.js";

export const SETTINGS_KEY = "sl.delve.settings.v1";

const num = (v, d) => (v == null || !isFinite(Number(v)) ? d : Number(v));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/* ---------------- depth -> spawn weight ----------------

   poewiki gives two ends of the ramp and says the middle "scales
   non-linearly" without naming the curve. Smoothstep is the honest
   stand-in: it matches both endpoints exactly, is monotonic, and eases
   at each end the way the wiki's own chart looks. Anything between the
   thresholds is therefore approximate, and the UI says so rather than
   presenting an interpolated share as fact. */
export function weightAt(biome, depth) {
  const { lo, hi } = biome.weight;
  const d = num(depth, 0);
  if (d <= lo.depth) return lo.weight;
  if (d >= hi.depth) return hi.weight;
  const t = (d - lo.depth) / (hi.depth - lo.depth);
  const s = t * t * (3 - 2 * t);
  return lo.weight + (hi.weight - lo.weight) * s;
}

/* Is this depth inside the ramp (interpolated) or past it (exact)? */
export function weightExact(biome, depth) {
  const d = num(depth, 0);
  return d <= biome.weight.lo.depth || d >= biome.weight.hi.depth;
}

/* Share of the mine each biome occupies at `depth`. Weights are relative,
   so the share is a biome's weight over the total of all of them. */
export function biomeShares(depth) {
  const rows = BIOMES.map((b) => ({ biome: b, weight: weightAt(b, depth), exact: weightExact(b, depth) }));
  const total = rows.reduce((s, r) => s + r.weight, 0);
  for (const r of rows) r.share = total > 0 ? r.weight / total : 0;
  return { rows, total };
}

/* ---------------- prices ----------------

   `priceOf(name)` is supplied by the caller so the same engine works off
   the fossils.json snapshot (which carries trend data) or the broader
   prices.json map (which does not), without knowing which it got. */

export function makePriceOf(sources = [], { overrides = {}, divineRate = 0 } = {}) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const index = new Map();
  for (const src of sources) {
    if (!src) continue;
    for (const [name, entry] of Object.entries(src)) {
      const k = norm(name);
      if (!index.has(k)) index.set(k, { name, entry });
    }
  }
  return function priceOf(name) {
    if (overrides[name] != null && isFinite(Number(overrides[name]))) {
      return { chaos: Number(overrides[name]), found: true, overridden: true, entry: null };
    }
    const hit = index.get(norm(name));
    if (hit && hit.entry && hit.entry.c > 0) {
      return { chaos: hit.entry.c, found: true, overridden: false, entry: hit.entry };
    }
    const fb = FALLBACKS[name];
    if (fb) {
      const c = fb.chaos > 0 ? fb.chaos : fb.divine > 0 && divineRate > 0 ? fb.divine * divineRate : 0;
      if (c > 0) return { chaos: c, found: true, overridden: false, fallback: fb, entry: null };
    }
    return { chaos: 0, found: false, overridden: false, entry: null };
  };
}

/* ---------------- fossils ---------------- */

export function fossilRows(priceOf) {
  return FOSSILS.map((f) => {
    const p = priceOf(f.name);
    return { ...f, chaos: p.chaos, found: p.found, overridden: p.overridden, entry: p.entry };
  }).sort((a, b) => b.chaos - a.chaos);
}

/* ---------------- biomes ----------------

   A biome is worth what its nodes hand you:

     exclusive node = exclusiveQty x its own fossil + exclusiveExtra x pool
     generic node   = genericQty x pool
     cache          = cacheQty x pool

   "x pool" means the average price across the biome's common fossils —
   a node rolls one of them, and nothing published says which is likelier,
   so an unweighted mean is the only claim the data supports.

   City biomes have no pool. Their value is their boss, discounted by how
   often a city actually carries the boss node (`bossPerCity`). */

export function computeBiome(biome, priceOf, settings = {}, bossValue = null) {
  const s = { ...DEFAULTS, ...settings };
  const poolNames = biome.pool.filter((n) => {
    if (s.openWalls) return true;
    const f = FOSSILS.find((x) => x.name === n);
    return !(f && f.wall);
  });
  const poolPrices = poolNames.map((n) => ({ name: n, ...priceOf(n) }));
  const priced = poolPrices.filter((p) => p.found).map((p) => p.chaos);
  const poolAvg = mean(priced);
  const poolCoverage = poolNames.length ? priced.length / poolNames.length : 1;

  let exclusive = null;
  if (biome.exclusive) {
    const p = priceOf(biome.exclusive.fossil);
    const nodeValue = s.exclusiveQty * p.chaos + s.exclusiveExtra * poolAvg;
    exclusive = { ...biome.exclusive, chaos: p.chaos, found: p.found, nodeValue };
  }

  const genericNode = s.genericQty * poolAvg;
  const cacheNode = s.cacheQty * poolAvg;

  const fromExclusive = exclusive ? s.exclusivePerDelve * exclusive.nodeValue : 0;
  const fromGeneric = s.genericPerDelve * genericNode;
  const fromCache = s.cachePerDelve * cacheNode;
  const fromBoss = biome.city && bossValue != null ? s.bossPerCity * bossValue : 0;

  return {
    biome, poolNames, poolPrices, poolAvg, poolCoverage,
    exclusive, genericNode, cacheNode,
    parts: { exclusive: fromExclusive, generic: fromGeneric, cache: fromCache, boss: fromBoss },
    perDelve: fromExclusive + fromGeneric + fromCache + fromBoss,
  };
}

/* Every biome, ranked, plus what the mine as a whole is worth per delve
   at this depth once availability is folded in. */
export function computeBiomes(priceOf, settings = {}, bossValues = {}) {
  const s = { ...DEFAULTS, ...settings };
  const { rows } = biomeShares(s.depth);
  const shareBy = Object.fromEntries(rows.map((r) => [r.biome.id, r]));
  const out = BIOMES.map((b) => {
    const c = computeBiome(b, priceOf, s, b.boss ? bossValues[b.boss] ?? null : null);
    const sh = shareBy[b.id];
    return { ...c, weight: sh.weight, share: sh.share, exact: sh.exact, expected: sh.share * c.perDelve };
  });
  const mineAverage = out.reduce((sum, r) => sum + r.expected, 0);
  const anyInterpolated = out.some((r) => !r.exact && r.weight > 0);
  return { rows: out, mineAverage, anyInterpolated, depth: s.depth };
}

/* ---------------- bosses ---------------- */

export function computeDelveBosses(resolve, settings = {}) {
  const s = { ...DEFAULTS, ...settings };
  const bossOv = settings.bosses || {};
  const { rows } = biomeShares(s.depth);
  return DELVE_BOSSES.map((b) => {
    const computed = computeBoss(b, resolve, bossOv[b.id] || {});
    const biome = BIOME_BY_ID[b.biome];
    const sh = biome ? weightAt(biome, s.depth) : 0;
    const share = rows.find((r) => r.biome.id === b.biome)?.share ?? 0;
    // Encounters per 100 delve levels: how much of the mine is that city,
    // times how often a city carries its boss node.
    const per100 = share * s.bossPerCity * 100;
    return {
      ...computed, delve: b, biome, weight: sh, share,
      encountersPer100: per100,
      available: s.depth >= b.minDepth,
      perDelveContribution: share * s.bossPerCity * computed.gross,
    };
  });
}

/* ---------------- one kill, not thirty ----------------

   Expected value is a long-run average, and nobody delves a boss long-run.
   This rolls a single kill `trials` times and reports the distribution, so
   the tab can say "the mean is 400c, but half your kills come in under
   180c" instead of quoting the mean alone and letting it read as typical.

   Seeded, so the numbers don't flicker while you edit a rate. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function killDistribution(computed, trials = 4000, seed = 0xd317e) {
  const rnd = mulberry32(seed);
  const pools = [], weighted = [], indep = [];
  for (const g of computed.groups) {
    const lines = g.lines.map((l) => ({ p: l.rate, v: l.unit, qty: l.qty }));
    if (g.kind === "pool") pools.push({ rolls: g.rolls, lines });
    else if (g.kind === "weighted") weighted.push({ base: g.base, total: g.totalWeight, lines });
    else indep.push({ lines, scale: g.scaled ? 1 + computed.quantity / 100 : 1 });
  }
  const vals = new Array(trials);
  for (let t = 0; t < trials; t++) {
    let v = 0;
    for (const g of pools) {
      for (let r = 0; r < g.rolls; r++) {
        let x = rnd(), acc = 0;
        for (const l of g.lines) { acc += l.p; if (x <= acc) { v += l.v; break; } }
      }
    }
    for (const g of weighted) {
      if (rnd() < g.base && g.total > 0) {
        let x = rnd() * g.total, acc = 0;
        for (const l of g.lines) { acc += l.p; if (x <= acc) { v += l.v; break; } }
      }
    }
    for (const g of indep) {
      for (const l of g.lines) {
        // A rate above 100% is "one guaranteed copy plus a chance at
        // another" — split it rather than clamping, which would quietly
        // cap the drop at one and undercount the boss.
        const rate = l.p * g.scale;
        const whole = Math.floor(rate);
        if (whole > 0) v += l.v * whole;
        if (rnd() < rate - whole) v += l.v;
      }
    }
    vals[t] = v;
  }
  vals.sort((a, b) => a - b);
  const q = (f) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(f * vals.length)))];
  return {
    mean: mean(vals),
    median: q(0.5),
    p10: q(0.10),
    p25: q(0.25),
    p75: q(0.75),
    p90: q(0.90),
    // "how often does a kill land under half the mean" — the number that
    // tells you whether the average is a lie for any single fight
    blank: vals.filter((v) => v === 0).length / vals.length,
    trials,
  };
}

/* ---------------- settings persistence ---------------- */

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return sanitizeSettings(JSON.parse(raw));
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function sanitizeSettings(raw) {
  const out = { ...DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof DEFAULTS[k] === "boolean") { if (typeof raw[k] === "boolean") out[k] = raw[k]; }
      else if (isFinite(Number(raw[k])) && raw[k] !== null && raw[k] !== "") out[k] = Math.max(0, Number(raw[k]));
    }
    if (raw.priceOverrides && typeof raw.priceOverrides === "object") {
      out.priceOverrides = {};
      for (const [k, v] of Object.entries(raw.priceOverrides)) if (isFinite(Number(v))) out.priceOverrides[k] = Number(v);
    }
    if (raw.bosses && typeof raw.bosses === "object") {
      out.bosses = {};
      for (const [id, b] of Object.entries(raw.bosses)) if (DELVE_BOSS_BY_ID[id] && b && typeof b === "object") out.bosses[id] = b;
    }
  }
  out.depth = Math.min(65535, Math.max(1, Math.round(out.depth)));
  return out;
}
