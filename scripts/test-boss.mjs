import { BOSSES, SYNTHETIC, GROUP_ORDER } from "../src/bossData.js";
import { makeResolver, computeBoss, sanitizeProfile, expectedQty } from "../src/bossProfit.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };

// --- dataset integrity ---
const ids = new Set();
for (const b of BOSSES) {
  ok(!ids.has(b.id), `duplicate id ${b.id}`); ids.add(b.id);
  ok(GROUP_ORDER.includes(b.group), `${b.id}: unknown group ${b.group}`);
  ok(b.ttk > 0 && b.overhead >= 0, `${b.id}: bad timing`);
  ok(b.drops.length > 0, `${b.id}: no drops`);
  const poolSum = b.drops.filter(d => d.share != null).reduce((s,d)=>s+d.share, 0);
  if (poolSum > 0) ok(Math.abs(poolSum - 1) < 0.03, `${b.id}: pool shares sum to ${poolSum.toFixed(3)}, expected ~1`);
  if (poolSum > 0) ok((b.poolRolls ?? 1) > 0, `${b.id}: has pool shares but poolRolls=${b.poolRolls}`);
  if (poolSum === 0) ok((b.poolRolls ?? 1) === 0, `${b.id}: no pool shares but poolRolls=${b.poolRolls}`);
  for (const d of b.drops) {
    const kinds = ["share","chance","qty"].filter(k => d[k] != null);
    ok(kinds.length === 1, `${b.id}/${d.item}: expected exactly one of share|chance|qty, got ${kinds}`);
    if (d.item.startsWith("@")) ok(SYNTHETIC[d.item], `${b.id}: unknown synthetic ${d.item}`);
  }
  for (const e of b.entry) ok(typeof e.item === "string" && e.item, `${b.id}: bad entry line`);
}
console.log(`dataset: ${BOSSES.length} bosses, ${BOSSES.reduce((s,b)=>s+b.drops.length,0)} drop lines`);

// --- maths on a hand-checkable fixture ---
const prices = {
  "Fragment of the Hydra": { c: 10, lo: 10, hi: 10, n: 1 },
  "Fragment of the Phoenix": { c: 10, lo: 10, hi: 10, n: 1 },
  "Fragment of the Minotaur": { c: 10, lo: 10, hi: 10, n: 1 },
  "Fragment of the Chimera": { c: 10, lo: 10, hi: 10, n: 1 },
  "Shaper's Touch": { c: 100, lo: 50, hi: 200, n: 3 },
  "Voidwalker": { c: 200, lo: 200, hi: 200, n: 1 },
  "Solstice Vigil": { c: 300, lo: 300, hi: 300, n: 1 },
  "Dying Sun": { c: 1000, lo: 1000, hi: 1000, n: 1 },
  "Awakened Fork Support": { c: 40, lo: 40, hi: 40, n: 1 },
  "Awakened Spell Echo Support": { c: 60, lo: 60, hi: 60, n: 1 },
  "Awakened Empower Support": { c: 3000, lo: 3000, hi: 3000, n: 1 },
};
const r = makeResolver(prices);
const shaper = computeBoss(BOSSES.find(b=>b.id==="shaper"), r);
// EV = .56*100 + .26*200 + .15*300 + .03*1000 = 56+52+45+30 = 183
ok(Math.abs(shaper.gross - 183) < 1e-6, `shaper gross ${shaper.gross} != 183`);
ok(Math.abs(shaper.entryCost - 40) < 1e-6, `shaper entry ${shaper.entryCost} != 40`);
ok(Math.abs(shaper.net - 143) < 1e-6, `shaper net ${shaper.net} != 143`);
// runs: 90+120 = 210s -> 3600/210 = 17.142857/hr -> 143 * that = 2451.43
ok(Math.abs(shaper.profitPerHour - 143*3600/210) < 1e-6, "shaper profit/hr");
console.log(`shaper: gross ${shaper.gross}c, entry ${shaper.entryCost}c, net ${shaper.net}c, /hr ${shaper.profitPerHour.toFixed(1)}c`);

// synthetic awakened gem: mean of the two non-exceptional = 50
const maven = computeBoss(BOSSES.find(b=>b.id==="maven"), r);
const awk = maven.dropLines.find(l=>l.item==="@awakened-common");
ok(Math.abs(awk.unit - 50) < 1e-6, `awakened-common unit ${awk.unit} != 50`);
ok(Math.abs(awk.value - 0.25*50) < 1e-6, `awakened-common EV ${awk.value} != 12.5`);
const exc = maven.dropLines.find(l=>l.item==="@awakened-exceptional");
ok(Math.abs(exc.unit - 3000) < 1e-6, `awakened-exceptional unit ${exc.unit} != 3000`);

// price basis switches
const rHi = makeResolver(prices, { priceBasis: "hi" });
const shaperHi = computeBoss(BOSSES.find(b=>b.id==="shaper"), rHi);
ok(shaperHi.gross > shaper.gross, "hi basis should raise gross");

// overrides
const rOv = makeResolver(prices, { priceOverrides: { "Dying Sun": 0 } });
const shaperOv = computeBoss(BOSSES.find(b=>b.id==="shaper"), rOv);
ok(Math.abs(shaperOv.gross - 153) < 1e-6, `override gross ${shaperOv.gross} != 153`);

// per-boss settings override
const tuned = computeBoss(BOSSES.find(b=>b.id==="shaper"), r, { ttk: 30, overhead: 30, drops: { "Dying Sun": { share: 0.5 } } });
ok(tuned.runSeconds === 60 && Math.abs(tuned.runsPerHour - 60) < 1e-9, "tuned timing");
ok(Math.abs(tuned.gross - (56+52+45+500)) < 1e-6, `tuned gross ${tuned.gross}`);

// missing prices flagged, not silently zero-summed into confidence
const rEmpty = makeResolver({});
const blind = computeBoss(BOSSES.find(b=>b.id==="shaper"), rEmpty);
ok(blind.gross === 0 && blind.missingPrices === 4, `blind: gross ${blind.gross}, missing ${blind.missingPrices}`);
ok(blind.entryUnknown === true, "blind entryUnknown");

// sanitizeProfile must reject junk
const dirty = sanitizeProfile({ name: "  X  ", bosses: { shaper: { ttk: "abc", overhead: 45, drops: { "Dying Sun": { share: "x", chance: 0.5 } }, entry: { a: "nope", b: 3 } }, bad: "str" }, priceOverrides: { A: -5, B: 12, C: "no" }, evil: () => {} });
ok(dirty.name === "X", "trim name");
ok(dirty.bosses.shaper.ttk === undefined && dirty.bosses.shaper.overhead === 45, "numeric filter");
ok(dirty.bosses.shaper.drops["Dying Sun"].chance === 0.5 && dirty.bosses.shaper.drops["Dying Sun"].share === undefined, "drop filter");
ok(dirty.bosses.shaper.entry.b === 3 && dirty.bosses.shaper.entry.a === undefined, "entry filter");
ok(dirty.bosses.bad === undefined, "non-object boss dropped");
ok(dirty.priceOverrides.B === 12 && dirty.priceOverrides.A === undefined && dirty.priceOverrides.C === undefined, "price override filter");
ok(dirty.evil === undefined, "unknown keys dropped");

// every boss computes without throwing and produces finite numbers
for (const b of BOSSES) {
  const c = computeBoss(b, r);
  ok(isFinite(c.profitPerHour) && isFinite(c.gross) && isFinite(c.net), `${b.id}: non-finite result`);
}

console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
