/* Delve dataset + engine tests. Node only, no DOM:
     node scripts/test-delve.mjs

   Two jobs. Integrity — the dataset can't reference a fossil no biome
   lists, a biome whose depth ramp runs backwards, or a boss whose drop
   table doesn't match the wiki figures. And arithmetic — hand-checked
   fixtures for the biome value, the depth weighting, and the boss EV,
   so a refactor that changes a number has to change a number here too. */

import assert from "node:assert/strict";
import {
  BIOMES, FOSSILS, DELVE_BOSSES, DEFAULTS, TUNABLES, NODES, FALLBACKS,
} from "../src/delveData.js";
import {
  weightAt, weightExact, biomeShares, makePriceOf, fossilRows,
  computeBiome, computeBiomes, computeDelveBosses, killDistribution, sanitizeSettings,
  biomeValueSeries,
} from "../src/delve.js";
import { makeResolver } from "../src/bossProfit.js";

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

console.log("delve dataset");

test("every biome has a sane depth ramp", () => {
  for (const b of BIOMES) {
    assert.ok(b.weight.lo.depth < b.weight.hi.depth, `${b.name}: ramp ends before it starts`);
    assert.ok(b.weight.lo.weight >= 0 && b.weight.hi.weight >= 0, `${b.name}: negative weight`);
    assert.notEqual(b.weight.lo.weight, b.weight.hi.weight, `${b.name}: ramp goes nowhere`);
  }
});

test("city biomes have a boss and no fossil pool; the others are the reverse", () => {
  for (const b of BIOMES) {
    if (b.city) {
      assert.equal(b.pool.length, 0, `${b.name}: city biome with a fossil pool`);
      assert.ok(b.boss && DELVE_BOSSES.some((x) => x.id === b.boss), `${b.name}: no boss`);
    } else {
      assert.ok(!b.boss, `${b.name}: non-city biome with a boss`);
    }
  }
});

test("the six exclusive fossils each belong to exactly one biome", () => {
  const excl = FOSSILS.filter((f) => f.exclusive);
  assert.equal(excl.length, 6, `expected 6 exclusive fossils, got ${excl.length}`);
  for (const f of excl) assert.equal(f.biomes.length, 1, `${f.name} is exclusive but in ${f.biomes.length} biomes`);
});

test("every fossil sits in at least one biome, and every pool name is a known fossil", () => {
  const names = new Set(FOSSILS.map((f) => f.name));
  for (const f of FOSSILS) assert.ok(f.biomes.length > 0, `${f.name} has no biome`);
  for (const b of BIOMES) for (const n of b.pool) assert.ok(names.has(n), `${b.name}: unknown fossil ${n}`);
});

test("every exclusive node in NODES matches its biome's declared node", () => {
  for (const n of NODES.filter((x) => x.kind === "exclusive")) {
    const b = BIOMES.find((x) => x.id === n.biome);
    assert.ok(b, `${n.name}: unknown biome ${n.biome}`);
    assert.equal(b.exclusive.node, n.name, `${n.name}: biome says ${b.exclusive.node}`);
    assert.equal(b.exclusive.fossil, n.fossil, `${n.name}: biome says ${b.exclusive.fossil}`);
  }
});

test("every tunable names a real default", () => {
  for (const t of TUNABLES) assert.ok(t.key in DEFAULTS, `tunable ${t.key} has no default`);
});

test("boss drop rates are the poewiki 3.25 n=100 figures", () => {
  const rate = (id, key) => {
    const b = DELVE_BOSSES.find((x) => x.id === id);
    const d = b.groups[0].drops.find((x) => (x.key || x.item) === key);
    assert.ok(d, `${id}: no drop line ${key}`);
    return d.chance;
  };
  near(rate("ahuatotli", "Cerberus Limb"), 0.60, 1e-9, "Cerberus Limb");
  near(rate("ahuatotli", "Curiosity"), 0.40, 1e-9, "Curiosity");
  near(rate("ahuatotli", "Doryani's Machinarium"), 0.16, 1e-9, "Machinarium");
  near(rate("kurgal", "hale-1"), 0.40, 1e-9, "Hale Negator 1s");
  near(rate("kurgal", "misery"), 0.20, 1e-9, "Misery in Darkness");
  near(rate("aul", "Aul's Uprising"), 0.61, 1e-9, "Aul's Uprising");
  near(rate("aul", "Crown of the Tyrant"), 0.15, 1e-9, "Crown of the Tyrant");
});

test("unrated drop lines contribute nothing rather than an invented rate", () => {
  for (const b of DELVE_BOSSES) {
    for (const d of b.groups[0].drops) {
      if (d.unrated) assert.equal(d.chance, 0, `${b.name}: ${d.item} is unrated but carries a rate`);
      assert.ok(d.chance >= 0 && d.chance <= 1, `${b.name}: ${d.item} rate out of range`);
    }
  }
});

test("no declared price is stale or undated", () => {
  for (const [name, fb] of Object.entries(FALLBACKS)) {
    assert.ok(fb.asOf, `${name}: declared price with no asOf`);
    assert.ok(fb.chaos > 0 || fb.divine > 0, `${name}: declared price with no value`);
  }
});

console.log("depth -> weight");

test("weights are exact at both ends of the ramp", () => {
  const frozen = BIOMES.find((b) => b.id === "frozen");
  assert.equal(weightAt(frozen, 10), 0);
  assert.equal(weightAt(frozen, 15), 0);
  assert.equal(weightAt(frozen, 30), 100);
  assert.equal(weightAt(frozen, 900), 100);
  assert.equal(weightExact(frozen, 30), true);
  assert.equal(weightExact(frozen, 22), false);
});

test("Mines ramps down, not up", () => {
  const mines = BIOMES.find((b) => b.id === "mines");
  assert.equal(weightAt(mines, 10), 100);
  assert.equal(weightAt(mines, 60), 0);
  assert.ok(weightAt(mines, 40) < 100 && weightAt(mines, 40) > 0, "mid-ramp should be between the ends");
});

test("the ramp is monotonic", () => {
  for (const b of BIOMES) {
    const up = b.weight.hi.weight > b.weight.lo.weight;
    let prev = weightAt(b, 0);
    for (let d = 1; d <= 600; d += 1) {
      const w = weightAt(b, d);
      assert.ok(up ? w >= prev - 1e-9 : w <= prev + 1e-9, `${b.name} is not monotonic at depth ${d}`);
      prev = w;
    }
  }
});

test("shares sum to 1 and the deep-mine city shares match the wiki weights", () => {
  const { rows } = biomeShares(600);
  const total = rows.reduce((s, r) => s + r.share, 0);
  near(total, 1, 1e-9, "shares");
  // At depth 600 every ramp is finished: six 100-weight biomes plus
  // 23 + 23 + 17 for the cities. Mines is 0 by then.
  const denom = 6 * 100 + 23 + 23 + 17;
  near(rows.find((r) => r.biome.id === "vaal").share, 23 / denom, 1e-9, "Vaal Outpost");
  near(rows.find((r) => r.biome.id === "primeval").share, 17 / denom, 1e-9, "Primeval Ruins");
  near(rows.find((r) => r.biome.id === "mines").share, 0, 1e-9, "Mines");
});

console.log("biome value");

/* A price list simple enough to check the arithmetic by hand: every
   Abyssal Depths pool fossil at 10c, Hollow Fossil at 300c. */
const PRICES = {
  "Aberrant Fossil": { c: 10 }, "Bound Fossil": { c: 10 },
  "Gilded Fossil": { c: 10 }, "Lucent Fossil": { c: 10 },
  "Hollow Fossil": { c: 300 },
};
const priceOf = makePriceOf([PRICES]);

test("pool average, node value and per-delve value are the declared formula", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const s = { ...DEFAULTS, exclusiveQty: 3, exclusiveExtra: 2, genericQty: 3, cacheQty: 5,
    exclusivePerDelve: 0.35, genericPerDelve: 1.2, cachePerDelve: 0.4 };
  const r = computeBiome(abyssal, priceOf, s);
  near(r.poolAvg, 10, 1e-9, "pool average");
  //  3 x 300 + 2 x 10
  near(r.exclusive.nodeValue, 920, 1e-9, "Crystal Spire");
  near(r.genericNode, 30, 1e-9, "generic node");
  near(r.cacheNode, 50, 1e-9, "cache");
  //  0.35*920 + 1.2*30 + 0.4*50
  near(r.perDelve, 0.35 * 920 + 1.2 * 30 + 0.4 * 50, 1e-9, "per delve");
});

test("turning off fractured walls drops the wall-locked fossils from the pool", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const withWalls = computeBiome(abyssal, makePriceOf([{ ...PRICES, "Lucent Fossil": { c: 100 } }]), DEFAULTS);
  const without = computeBiome(abyssal, makePriceOf([{ ...PRICES, "Lucent Fossil": { c: 100 } }]), { ...DEFAULTS, openWalls: false });
  assert.ok(without.poolAvg < withWalls.poolAvg, "dropping a dear wall-locked fossil should lower the average");
  assert.ok(!without.poolNames.includes("Lucent Fossil"), "Lucent should be gone");
  assert.ok(!without.poolNames.includes("Gilded Fossil"), "Gilded should be gone");
});

test("the exclusive node is most of a biome's value, which is the point of the tab", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const r = computeBiome(abyssal, priceOf, DEFAULTS);
  assert.ok(r.parts.exclusive > r.parts.generic + r.parts.cache,
    "with a 300c exclusive fossil the node should dominate the pool nodes");
});

test("an unpriced fossil is excluded from the average, not counted as zero", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const partial = makePriceOf([{ "Aberrant Fossil": { c: 10 }, "Bound Fossil": { c: 30 } }]);
  const r = computeBiome(abyssal, partial, DEFAULTS);
  near(r.poolAvg, 20, 1e-9, "average over what is priced");
  near(r.poolCoverage, 0.5, 1e-9, "coverage");
});

test("mine average is the share-weighted sum of the biome values", () => {
  const all = computeBiomes(priceOf, { ...DEFAULTS, depth: 600 });
  const manual = all.rows.reduce((s, r) => s + r.share * r.perDelve, 0);
  near(all.mineAverage, manual, 1e-9, "mine average");
  assert.ok(all.mineAverage > 0, "should be positive with priced fossils");
});

test("a biome's value curve re-prices the whole formula on each day", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const hist = {
    "Hollow Fossil": [{ day: 0, value: 150 }, { day: 1, value: 300 }],
    "Aberrant Fossil": [{ day: 0, value: 5 }, { day: 1, value: 10 }],
    "Bound Fossil": [{ day: 0, value: 5 }, { day: 1, value: 10 }],
    "Gilded Fossil": [{ day: 0, value: 5 }, { day: 1, value: 10 }],
    "Lucent Fossil": [{ day: 0, value: 5 }, { day: 1, value: 10 }],
  };
  const s = biomeValueSeries(abyssal, hist, DEFAULTS);
  assert.equal(s.length, 2);
  // every price doubled, so the value per delve doubles too
  near(s[1].value, s[0].value * 2, 1e-6, "doubling every price");
  // and day 1 must equal what computeBiome says about day 1's prices
  const direct = computeBiome(abyssal, makePriceOf([{
    "Hollow Fossil": { c: 300 }, "Aberrant Fossil": { c: 10 },
    "Bound Fossil": { c: 10 }, "Gilded Fossil": { c: 10 }, "Lucent Fossil": { c: 10 },
  }]), DEFAULTS);
  near(s[1].value, direct.perDelve, 1e-6, "curve endpoint vs the live number");
});

test("a city biome gets no curve rather than a flat lie", () => {
  const vaal = BIOMES.find((b) => b.id === "vaal");
  assert.deepEqual(biomeValueSeries(vaal, { "Hollow Fossil": [{ day: 0, value: 1 }] }, DEFAULTS, 500), []);
});

test("one data point is not a curve", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  assert.deepEqual(biomeValueSeries(abyssal, { "Hollow Fossil": [{ day: 0, value: 100 }] }, DEFAULTS), []);
});

console.log("bosses");

const BOSS_PRICES = {
  "Cerberus Limb": { c: 100 }, "Curiosity": { c: 50 },
  "Doryani's Machinarium": { c: 1000 },
  "Ahkeli's Mountain": { c: 10 }, "Uzaza's Meadow": { c: 10 }, "Putembo's Valley": { c: 10 },
};
const bossResolve = makeResolver(BOSS_PRICES, {});

test("Ahuatotli's EV is the sum of chance x price", () => {
  const rows = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600 });
  const a = rows.find((r) => r.delve.id === "ahuatotli");
  const want = 0.60 * 100 + 0.40 * 50 + 0.16 * 1000 + 3 * (0.08 * 10);
  near(a.gross, want, 1e-6, "Ahuatotli gross");
});

test("a per-line rate override moves the EV", () => {
  const base = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600 })
    .find((r) => r.delve.id === "ahuatotli").gross;
  const bumped = computeDelveBosses(bossResolve, {
    ...DEFAULTS, depth: 600,
    bosses: { ahuatotli: { drops: { "Doryani's Machinarium": { chance: 0.32 } } } },
  }).find((r) => r.delve.id === "ahuatotli").gross;
  near(bumped - base, 0.16 * 1000, 1e-6, "doubling the Machinarium rate");
});

test("encounter rate is the city's share times the boss-node assumption", () => {
  const rows = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600, bossPerCity: 0.5 });
  const a = rows.find((r) => r.delve.id === "ahuatotli");
  const denom = 6 * 100 + 23 + 23 + 17;
  near(a.encountersPer100, (23 / denom) * 0.5 * 100, 1e-9, "per 100 delves");
});

test("minimum depth gates availability", () => {
  const shallow = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 60 });
  assert.equal(shallow.find((r) => r.delve.id === "ahuatotli").available, true);   // 50
  assert.equal(shallow.find((r) => r.delve.id === "kurgal").available, false);     // 90
  assert.equal(shallow.find((r) => r.delve.id === "aul").available, false);        // 130
});

test("a single kill's median sits below the mean when one line carries the EV", () => {
  const a = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600 })
    .find((r) => r.delve.id === "ahuatotli");
  const d = killDistribution(a, 20000, 7);
  // 16% of 1000c is 160 of the 260c mean, so most kills must come in under it
  near(d.mean, a.gross, a.gross * 0.05, "simulated mean should track the EV");
  assert.ok(d.median < d.mean, `median ${d.median} should sit below mean ${d.mean}`);
  assert.ok(d.p90 > d.median, "p90 should sit above the median");
});

test("the simulation is seeded, so it doesn't flicker between renders", () => {
  const a = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600 })
    .find((r) => r.delve.id === "ahuatotli");
  assert.deepEqual(killDistribution(a, 500), killDistribution(a, 500));
});

test("a rate above 100% pays out more than one copy", () => {
  const fake = {
    quantity: 0,
    groups: [{
      kind: "independent", rolls: 1, base: 0, totalWeight: 0, scaled: false,
      lines: [{ rate: 2.5, unit: 100, qty: 2.5 }],
    }],
  };
  const d = killDistribution(fake, 20000, 3);
  near(d.mean, 250, 6, "2.5 copies at 100c");
  assert.ok(d.median >= 200, "at least two copies every kill");
});

console.log("settings");

test("sanitize clamps depth and drops junk", () => {
  assert.equal(sanitizeSettings({ depth: -5 }).depth, 1);
  assert.equal(sanitizeSettings({ depth: 1e9 }).depth, 65535);
  assert.equal(sanitizeSettings({ depth: "abc" }).depth, DEFAULTS.depth);
  assert.equal(sanitizeSettings({ openWalls: "yes" }).openWalls, DEFAULTS.openWalls);
  assert.equal(sanitizeSettings({ exclusiveQty: -3 }).exclusiveQty, 0);
  assert.deepEqual(sanitizeSettings({ bosses: { nope: {} } }).bosses, {});
});

test("price overrides survive a round trip and win over the snapshot", () => {
  const s = sanitizeSettings({ priceOverrides: { "Hollow Fossil": 500, junk: "x" } });
  assert.equal(s.priceOverrides["Hollow Fossil"], 500);
  assert.ok(!("junk" in s.priceOverrides));
  const p = makePriceOf([PRICES], { overrides: s.priceOverrides });
  assert.equal(p("Hollow Fossil").chaos, 500);
  assert.equal(p("Hollow Fossil").overridden, true);
});

test("fossil rows come back priced and sorted", () => {
  const rows = fossilRows(priceOf);
  assert.equal(rows[0].name, "Hollow Fossil");
  assert.ok(rows.some((r) => !r.found), "unpriced fossils should still be listed");
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].chaos >= rows[i].chaos, "not sorted");
});

console.log(failed ? `\n${failed} test(s) failed` : "\nall delve tests passed");
process.exit(failed ? 1 : 0);
