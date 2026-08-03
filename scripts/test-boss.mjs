/* Dataset integrity + EV maths for the boss profitability tab.
   Run: node scripts/test-boss.mjs */

import { BOSSES, SYNTHETIC, GROUP_ORDER } from "../src/bossData.js";
import { makeResolver, computeBoss, profitChance, sanitizeProfile, dropKey } from "../src/bossProfit.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const near = (a, b, eps = 0.005) => Math.abs(a - b) <= eps;

/* ---------------- dataset integrity ---------------- */
const ids = new Set();
for (const b of BOSSES) {
  ok(!ids.has(b.id), `duplicate boss id ${b.id}`); ids.add(b.id);
  ok(GROUP_ORDER.includes(b.group), `${b.id}: unknown content group ${b.group}`);
  ok(b.ttk > 0 && (b.overhead ?? 0) >= 0, `${b.id}: bad timing`);
  ok(Array.isArray(b.groups) && b.groups.length > 0, `${b.id}: no drop groups`);

  const gids = new Set();
  const keys = new Set();
  for (const g of b.groups) {
    ok(!gids.has(g.id), `${b.id}: duplicate group id ${g.id}`); gids.add(g.id);
    ok(["pool", "weighted", "independent"].includes(g.kind), `${b.id}/${g.id}: bad kind ${g.kind}`);
    ok(g.drops.length > 0, `${b.id}/${g.id}: empty group`);

    if (g.kind === "pool") {
      // A pool is one guaranteed drop, so its shares must partition it.
      const sum = g.drops.reduce((s, d) => s + (d.share ?? 0), 0);
      ok(sum >= 0.97 && sum <= 1.03, `${b.id}/${g.id}: shares sum to ${sum.toFixed(4)}, expected ~1`);
      ok((g.rolls ?? 1) > 0, `${b.id}/${g.id}: pool with rolls=${g.rolls}`);
      for (const d of g.drops) ok(d.share != null, `${b.id}/${g.id}/${d.item}: pool line needs share`);
    }
    if (g.kind === "weighted") {
      ok(g.base > 0 && g.base <= 1, `${b.id}/${g.id}: base ${g.base} out of range`);
      ok(g.drops.every((d) => d.weight > 0), `${b.id}/${g.id}: weights must be > 0`);
    }
    if (g.kind === "independent") {
      for (const d of g.drops) {
        ok(d.chance != null, `${b.id}/${g.id}/${d.item}: independent line needs chance`);
        ok(d.chance >= 0 && d.chance <= 1, `${b.id}/${g.id}/${d.item}: chance ${d.chance} out of range`);
      }
    }

    for (const d of g.drops) {
      // Overrides are keyed per line, so keys must be unique across the boss.
      const k = dropKey(d);
      ok(!keys.has(k), `${b.id}: duplicate drop key "${k}" — add an explicit key`);
      keys.add(k);
      if (d.item.startsWith("@")) ok(SYNTHETIC[d.item], `${b.id}: unknown synthetic ${d.item}`);
    }
  }
  for (const e of (b.entry || [])) ok(typeof e.item === "string" && e.item, `${b.id}: bad entry line`);
}
const lineCount = BOSSES.reduce((s, b) => s + b.groups.reduce((t, g) => t + g.drops.length, 0), 0);
console.log(`dataset: ${BOSSES.length} bosses, ${BOSSES.reduce((s,b)=>s+b.groups.length,0)} groups, ${lineCount} drop lines`);
console.log(`  by source: ${["ledger","wiki","estimate"].map(r => `${r} ${BOSSES.filter(b=>b.rates===r).length}`).join(", ")}`);

/* ---------------- EV parity with the reference screenshots ----------------
   Same rates, same prices -> the EV column must match. */
function evOf(bossId, prices, key) {
  const c = computeBoss(BOSSES.find((b) => b.id === bossId), makeResolver(prices));
  return c.dropLines.find((l) => l.key === key);
}
const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { c: v, lo: v, hi: v, n: 1 }]));

// Shaper: pool 55% x 11.0c = 6.05c; guaranteed 50% x 50.9c = 25.4c;
// additional 12% x 130c = 15.6c  (no quantity scaling on Shaper)
ok(near(evOf("shaper", P({ "Shaper's Touch": 11.0 }), "Shaper's Touch").value, 6.05), "shaper pool EV");
ok(near(evOf("shaper", P({ "Fragment of Shape": 50.9 }), "Fragment of Shape").value, 25.45), "shaper guaranteed EV");
ok(near(evOf("shaper", P({ "Shaper's Exalted Orb": 130 }), "Shaper's Exalted Orb").value, 15.6), "shaper additional EV");

// Eater: additional drops are quantity-scaled at 70% -> 0.15 * 32.9 * 1.7 = 8.38c
ok(near(evOf("eater", P({ "Exceptional Eldritch Ichor": 32.9 }), "Exceptional Eldritch Ichor").value, 8.3895, 0.01),
   "eater quantity-scaled EV");
// Uber Eater has no quantity multiplier -> 0.15 * 32.9 = 4.935c
ok(near(evOf("uber-eater", P({ "Exceptional Eldritch Ichor": 32.9 }), "Exceptional Eldritch Ichor").value, 4.935, 0.01),
   "uber eater unscaled EV");
// Black Star at 50% quantity -> 0.05 * 39.7 * 1.5 = 2.9775c
ok(near(evOf("black-star", P({ "Eldritch Orb of Annulment": 39.7 }), "Eldritch Orb of Annulment").value, 2.9775, 0.01),
   "black star quantity-scaled EV");
// Exarch at 70% -> 0.15 * 44.0 * 1.7 = 11.22c
ok(near(evOf("exarch", P({ "Exceptional Eldritch Ember": 44.0 }), "Exceptional Eldritch Ember").value, 11.22, 0.01),
   "exarch quantity-scaled EV");

// Uber Maven awakened gems: 2% base split by equal weights -> 0.02/3 each.
// At 178c/div, Enlighten at 47.0d = 8366c -> 55.8c, matching the reference.
const um = computeBoss(BOSSES.find((b) => b.id === "uber-maven"),
  makeResolver(P({ "Awakened Enlighten Support": 47.0 * 178 })));
const enl = um.dropLines.find((l) => l.key === "Awakened Enlighten Support");
ok(near(enl.pct, 1 / 3, 1e-9), `gem weight share ${enl.pct}`);
ok(near(enl.qty, 0.02 / 3, 1e-9), `gem expected qty ${enl.qty}`);
ok(near(enl.value, 55.8, 0.2), `gem EV ${enl.value.toFixed(2)} != ~55.8`);

// Catarina lists Cinderswallow Urn three times; each variant must be its own
// editable row, all pricing off the same item name.
const cat = computeBoss(BOSSES.find((b) => b.id === "catarina"), makeResolver(P({ "Cinderswallow Urn": 100 })));
const urns = cat.dropLines.filter((l) => l.item === "Cinderswallow Urn");
ok(urns.length === 3, `expected 3 urn rows, got ${urns.length}`);
ok(new Set(urns.map((l) => l.key)).size === 3, "urn rows need distinct keys");
ok(near(urns.reduce((s, l) => s + l.value, 0), 30), "urn rows total 0.30 x 100c");

// T17 fragments are a multi-roll pool, not per-item chances: 2 rolls split
// evenly across the map's fragment types, and the roll count is what area
// quantity moves.
const zig = computeBoss(BOSSES.find((b) => b.id === "t17-ziggurat"),
  makeResolver(P({ "Devouring Fragment": 100, "Blazing Fragment": 100, "Ziggurat Map": 50 })));
const zigFrags = zig.groups.find((g) => g.id === "pool");
ok(zigFrags.rolls === 2, `ziggurat fragment rolls ${zigFrags.rolls} != 2`);
ok(near(zigFrags.subtotal, 200), `2 rolls x 100c should be 200c, got ${zigFrags.subtotal}`);
ok(near(zigFrags.lines[0].qty, 1), "even split of 2 rolls across 2 types = 1 each");
// raising the roll count for higher IIQ scales linearly
const zigHigh = computeBoss(BOSSES.find((b) => b.id === "t17-ziggurat"),
  makeResolver(P({ "Devouring Fragment": 100, "Blazing Fragment": 100, "Ziggurat Map": 50 })),
  { groups: { pool: { rolls: 3 } } });
ok(near(zigHigh.groups.find((g) => g.id === "pool").subtotal, 300), "3 rolls at 250%+ IIQ = 300c");
// Sanctuary splits across three types
const san = computeBoss(BOSSES.find((b) => b.id === "t17-sanctuary"),
  makeResolver(P({ "Lonely Fragment": 90, "Traumatic Fragment": 90, "Reverent Fragment": 90 })));
ok(near(san.groups.find((g) => g.id === "pool").subtotal, 180, 0.2), "3-type map still yields 2 fragments total");

// Name resolution has to survive poe.ninja's inconsistent labelling: the T17
// maps are grouped under "Nightmare Map" and the base type isn't always the
// display name. Exact match wins, then aliases, then a punctuation-insensitive
// match with and without a trailing "Map".
const zigEntry = (prices) => computeBoss(BOSSES.find((b) => b.id === "t17-ziggurat"), makeResolver(prices)).entryLines[0];
// poe.ninja prices the tier 17s as one "Nightmare Map" line
ok(near(zigEntry(P({ "Nightmare Map": 32 })).unit, 32), "nightmare map entry cost");
ok(zigEntry(P({ "Nightmare Map": 32 })).label === "Ziggurat Map", "entry keeps the real map name on screen");
// the per-map names stay as aliases in case they ever get listed separately
ok(near(zigEntry(P({ "Ziggurat Map": 941 })).unit, 941), "per-map alias still wins if listed");
ok(near(zigEntry(P({ "ziggurat map": 941 })).unit, 941), "case-insensitive fallback");
ok(zigEntry(P({ "Citadel Map": 941 })).found === false, "must not match a different map");
ok(near(computeBoss(BOSSES.find((b) => b.id === "maven"),
  makeResolver(P({ "The Maven's Writ": 8.52 }))).entryLines[0].unit, 8.52), "apostrophe name");

/* ---------------- engine behaviour ---------------- */
const prices = P({
  "Fragment of the Hydra": 10, "Fragment of the Phoenix": 10,
  "Fragment of the Chimera": 10, "Fragment of the Minotaur": 10,
  "Shaper's Touch": 100, "Voidwalker": 200, "Solstice Vigil": 300, "Dying Sun": 1000,
});
const r = makeResolver(prices);
const shaper = computeBoss(BOSSES.find((b) => b.id === "shaper"), r);
// .55*100 + .32*200 + .11*300 + .02*1000 = 55+64+33+20 = 172
ok(near(shaper.gross, 172), `shaper gross ${shaper.gross} != 172`);
ok(near(shaper.entryCost, 40), `shaper entry ${shaper.entryCost} != 40`);
ok(near(shaper.net, 132), `shaper net ${shaper.net}`);
ok(near(shaper.runsPerHour, 15), `shaper kph ${shaper.runsPerHour} != 15 (reference shows KPH 15)`);
ok(near(shaper.profitPerHour, 132 * 15), "shaper profit/hr");
console.log(`shaper: gross ${shaper.gross}c, entry ${shaper.entryCost}c, net ${shaper.net}c, ${shaper.runsPerHour} kph`);

// price basis + overrides
ok(computeBoss(BOSSES.find((b) => b.id === "shaper"), makeResolver({ ...prices, "Dying Sun": { c: 1000, lo: 500, hi: 4000, n: 3 } }, { priceBasis: "hi" })).gross > shaper.gross,
   "hi basis should raise gross");
const ov = computeBoss(BOSSES.find((b) => b.id === "shaper"), makeResolver(prices, { priceOverrides: { "Dying Sun": 0 } }));
ok(near(ov.gross, 152), `price override gross ${ov.gross} != 152`);

// per-boss overrides: timing, rates, quantity
const tuned = computeBoss(BOSSES.find((b) => b.id === "shaper"), r,
  { ttk: 30, overhead: 30, drops: { "Dying Sun": { share: 0.5 } }, groups: { pool: { rolls: 2 } } });
ok(tuned.runSeconds === 60 && near(tuned.runsPerHour, 60), "tuned timing");
ok(near(tuned.gross, (0.55 * 100 + 0.32 * 200 + 0.11 * 300 + 0.5 * 1000) * 2 + 0), `tuned pool gross ${tuned.gross}`);
const qUp = computeBoss(BOSSES.find((b) => b.id === "eater"), makeResolver(P({ "Exceptional Eldritch Ichor": 100 })), { quantity: 0 });
ok(near(qUp.gross, 15), `quantity 0 should give 0.15*100 = 15, got ${qUp.gross}`);

// synthetic aggregates still work (nothing uses them today)
const rSyn = makeResolver(P({ "Awakened Fork Support": 40, "Awakened Spell Echo Support": 60, "Awakened Empower Support": 3000 }));
ok(near(rSyn("@awakened-common").chaos, 50), "@awakened-common mean");
ok(near(rSyn("@awakened-exceptional").chaos, 3000), "@awakened-exceptional mean");
ok(rSyn("@nope").found === false, "unknown synthetic resolves to not-found");

// missing prices are flagged, not silently zeroed; chance:0 lines aren't flagged
const blind = computeBoss(BOSSES.find((b) => b.id === "shaper"), makeResolver({}));
ok(blind.gross === 0 && blind.missingPrices === blind.dropLines.length, `blind missing ${blind.missingPrices}`);
ok(blind.entryUnknown === true, "blind entryUnknown");
// A chance:0 line — an item that's documented as dropping but has no published
// rate — must survive into the table so it can be edited, without polluting the
// missing-price count.
const zeroBoss = { id: "z", name: "z", group: "Other", rates: "estimate", entry: [], ttk: 60, overhead: 0,
  groups: [{ id: "additional", kind: "independent", label: "x",
    drops: [{ item: "Voidwalker", chance: 0.5 }, { item: "Unpriced Mystery", chance: 0 }] }] };
const zc = computeBoss(zeroBoss, r);
const zeroLine = zc.dropLines.find((l) => l.item === "Unpriced Mystery");
ok(zeroLine && zeroLine.qty === 0 && zeroLine.value === 0, "chance:0 line present and contributes nothing");
ok(zc.missingPrices === 0, `chance:0 line must not count as a missing price (got ${zc.missingPrices})`);

// A declared fallback fills in only where poe.ninja returns nothing, is quoted
// in divine so it tracks the rate, and is flagged so the UI can say so.
const domLine = (prices, opts) => computeBoss(BOSSES.find((b) => b.id === "shaper"), makeResolver(prices, opts))
  .dropLines.find((l) => l.item === "Orb of Dominance");
const fb = domLine(P({}), { divineRate: 200 });
ok(fb.found && fb.fallback === true, "fallback should price the line and be flagged");
ok(near(fb.unit, 740), `3.7 divine at 200c/div should be 740c, got ${fb.unit}`);
ok(near(domLine(P({}), { divineRate: 100 }).unit, 370), "fallback tracks the divine rate");
// a real listing always beats the declared number
const real = domLine(P({ "Orb of Dominance": 12 }), { divineRate: 200 });
ok(near(real.unit, 12) && !real.fallback, `a live price must win, got ${real.unit}`);
// and with no divine rate to convert against, it stays honestly unpriced
ok(domLine(P({}), { divineRate: 0 }).found === false, "no divine rate means no fallback price");
// declared prices carry their age so the UI can flag a stale one
ok(fb.fallbackAge != null && fb.fallbackAge >= 0, `fallback should report its age, got ${fb.fallbackAge}`);
const undated = computeBoss(
  { id: "u", name: "u", group: "Other", rates: "ledger", entry: [], ttk: 60, overhead: 0,
    groups: [{ id: "additional", kind: "independent", label: "x", drops: [{ item: "Nope", chance: 1, fallback: { chaos: 5 } }] }] },
  makeResolver(P({}), { divineRate: 200 })).dropLines[0];
ok(undated.fallback && undated.fallbackAge === null, "an undated fallback still prices, with no age");

/* ---------------- chance of profit ---------------- */
// A guaranteed, always-profitable boss must read ~100%; a boss whose value
// sits entirely in a rare drop must read well under it despite being +EV.
const sureThing = { id: "sure", name: "sure", group: "Other", rates: "ledger", entry: [{ item: "cheap" }], ttk: 60, overhead: 0,
  groups: [{ id: "additional", kind: "independent", label: "x", drops: [{ item: "always", chance: 1 }] }] };
const lottery = { id: "lotto", name: "lotto", group: "Other", rates: "ledger", entry: [{ item: "cheap" }], ttk: 60, overhead: 0,
  groups: [{ id: "additional", kind: "independent", label: "x", drops: [{ item: "jackpot", chance: 0.01 }] }] };
const rc = makeResolver(P({ cheap: 10, always: 50, jackpot: 5000 }));
const cSure = profitChance(computeBoss(sureThing, rc), 10, 3000);
const cLotto = profitChance(computeBoss(lottery, rc), 10, 3000);
ok(cSure === 1, `guaranteed-profit boss should be 1.0, got ${cSure}`);
ok(cLotto > 0.05 && cLotto < 0.75, `lottery boss should be uncertain, got ${cLotto}`);
ok(computeBoss(lottery, rc).net > 0, "lottery boss is +EV despite low win rate");
ok(profitChance(computeBoss(lottery, rc), 10, 3000) === cLotto, "profitChance must be deterministic");
// More runs pull a +EV boss toward certainty — that's the whole point of
// letting the run count be configured.
const lottoComputed = computeBoss(lottery, rc);
const c1 = profitChance(lottoComputed, 1, 3000);
const c50 = profitChance(lottoComputed, 50, 3000);
ok(c50 > c1, `50 runs (${c50}) should be safer than 1 run (${c1}) for a +EV boss`);
ok(c1 >= 0 && c50 <= 1, "chance stays a probability");
console.log(`profit chance: guaranteed ${(cSure*100).toFixed(0)}%, lottery ${(cLotto*100).toFixed(0)}% over 10 runs -> ${(c1*100).toFixed(0)}% over 1, ${(c50*100).toFixed(0)}% over 50`);

/* ---------------- profile sanitising ---------------- */
const dirty = sanitizeProfile({
  name: "  X  ",
  bosses: {
    shaper: {
      ttk: "abc", overhead: 45, quantity: 30,
      groups: { pool: { rolls: 2, base: "no" }, junk: "str" },
      drops: { "Dying Sun": { share: "x", chance: 0.5 }, bad: 7 },
      entry: { a: "nope", b: 3 },
    },
    broken: "str",
  },
  priceOverrides: { A: -5, B: 12, C: "no" },
  evil: () => {},
}, "fallback");
ok(dirty.name === "X", "name trimmed");
ok(dirty.bosses.shaper.ttk === undefined && dirty.bosses.shaper.overhead === 45 && dirty.bosses.shaper.quantity === 30, "numeric filter");
ok(dirty.bosses.shaper.groups.pool.rolls === 2 && dirty.bosses.shaper.groups.pool.base === undefined, "group filter");
ok(dirty.bosses.shaper.groups.junk === undefined, "non-object group dropped");
ok(dirty.bosses.shaper.drops["Dying Sun"].chance === 0.5 && dirty.bosses.shaper.drops["Dying Sun"].share === undefined, "drop filter");
ok(dirty.bosses.shaper.drops.bad === undefined, "non-object drop dropped");
ok(dirty.bosses.shaper.entry.b === 3 && dirty.bosses.shaper.entry.a === undefined, "entry filter");
ok(dirty.bosses.broken === undefined, "non-object boss dropped");
ok(dirty.priceOverrides.B === 12 && dirty.priceOverrides.A === undefined && dirty.priceOverrides.C === undefined, "price override filter");
ok(dirty.evil === undefined, "unknown keys dropped");
ok(sanitizeProfile(null, "fallback").name === "fallback", "null profile falls back");

/* ---------------- every boss computes cleanly ---------------- */
for (const b of BOSSES) {
  const c = computeBoss(b, r);
  ok(isFinite(c.profitPerHour) && isFinite(c.gross) && isFinite(c.net), `${b.id}: non-finite result`);
  ok(c.dropLines.length === b.groups.reduce((s, g) => s + g.drops.length, 0), `${b.id}: dropped a line`);
}

console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
