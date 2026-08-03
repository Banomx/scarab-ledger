/* Regression test for the snapshot script's endpoint handling.

   Two things have bitten this script before:

   1. poe.ninja moves PoE 1 economy data between endpoint families. Fragments
      and astrolabes live under exchange/current/overview; reading them from
      anywhere else gives wrong numbers or nothing at all.
   2. The exchange endpoint quotes `primaryValue` in a *primary reference
      currency* that is not necessarily chaos. Guessing the conversion
      direction scales every bulk item by the chaos:primary ratio — which is
      exactly how Reverent Fragment ended up at 7.5c instead of 79c.
   3. Coverage. The docs enumerate exactly which `type` values the exchange
      accepts for PoE 1, and DivinationCard is one of them — omitting it there
      is why cards went unpriced. The stash currency overview covers the same
      goods the older way and is kept only to fill names the exchange misses.

   So this stub deliberately uses a NON-chaos primary (Exalted Orb, with chaos
   at 0.1 exalted), makes every legacy /api/data/* path 404, and runs the real
   script end to end. If the calibration regresses, the numbers below move.

   Run: node scripts/test-fetch-shapes.mjs
*/

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OUT_DIR = await mkdtemp(path.join(tmpdir(), "sl-fetch-test-"));
const hits = [];
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const NOPE = () => new Response("gone", { status: 404 });

/* chaos costs 0.1 exalted -> divisor 0.1 -> every quote is x10 to reach chaos */
const CHAOS_IN_PRIMARY = 0.1;
const CORE = {
  primary: "exalted-orb",
  secondary: "divine-orb",
  items: [
    { id: "chaos-orb", name: "Chaos Orb" },
    { id: "divine-orb", name: "Divine Orb" },
    { id: "exalted-orb", name: "Exalted Orb" },
  ],
  rates: { "chaos-orb": CHAOS_IN_PRIMARY, "divine-orb": 130, "exalted-orb": 1 },
};
const exchange = (lines) => J({
  core: CORE,
  lines: lines.map(([id, v]) => ({ id, primaryValue: v, sparkline: { data: [1, 2, 3] } })),
});

/* Names for these come from the line id slug, not core.items — that path
   needs covering too, since it is how every fragment and scarab is named. */
const EXCHANGE_DATA = {
  // Same names as the stash currency overview but different numbers: the
  // direct-chaos source must win, and exchange-only names must still land.
  Currency: [["chaos-orb", CHAOS_IN_PRIMARY], ["divine-orb", 130], ["awakeners-orb", 21],
             ["orb-of-intention", 26.4], ["orb-of-remembrance", 6.3]],
  Fragment: [["reverent-fragment", 7.9], ["lonely-fragment", 5.0], ["traumatic-fragment", 1.86],
             ["cosmic-fragment", 7.43], ["the-maven-s-writ", 0.852]],
  DivinationCard: [["a-fate-worse-than-death", 0.8]],
  Astrolabe: [["templar-astrolabe", 7.7], ["grasping-astrolabe", 8.63], ["fruiting-astrolabe", 14.7]],
  Scarab: [["divination-scarab-of-pilfering", 18.0], ["horned-scarab-of-pandemonium", 95.0]],
  Omen: [["omen-of-amelioration", 4.2]],
};

const STASH_ITEMS = {
  UniqueWeapon: [
    { id: 1, name: "Starforge", chaosValue: 4200, links: 0 },
    { id: 2, name: "Starforge", chaosValue: 5100, links: 6 },
  ],
  UniqueArmour: [
    { id: 4, name: "Shaper's Touch", chaosValue: 12, links: 0 },
    { id: 5, name: "Atziri's Splendour", chaosValue: 40, variant: "Armour" },
    { id: 6, name: "Atziri's Splendour", chaosValue: 900, variant: "ES/Eva" },
  ],
  SkillGem: [
    { id: 11, name: "Awakened Spell Echo Support", chaosValue: 700, gemLevel: 1, gemQuality: 0, corrupted: false },
    { id: 12, name: "Awakened Spell Echo Support", chaosValue: 9000, gemLevel: 5, gemQuality: 20, corrupted: true },
  ],
  // poe.ninja lists one "Nightmare Map" line for all five tier 17s
  Map: [{ id: 20, name: "Nightmare Map", chaosValue: 32 }],
  // Boss entry costs — these were unpriced because the type was never fetched
  Invitation: [
    { id: 30, name: "Polaric Invitation", chaosValue: 21.7 },
    { id: 31, name: "Writhing Invitation", chaosValue: 5 },
    { id: 32, name: "Incandescent Invitation", chaosValue: 103 },
    { id: 33, name: "Screaming Invitation", chaosValue: 106 },
  ],
};

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const type = u.searchParams.get("type");
  hits.push(`${u.pathname}${type ? "?type=" + type : ""}`);
  if (u.pathname.startsWith("/api/data/")) return NOPE();                    // legacy is dead
  if (u.pathname === "/poe1/api/economy/leagues") return J([{ id: "Allflame", name: "Allflame", startAt: "2026-07-24T20:00:00Z" }]);
  if (u.pathname === "/poe1/api/data/index-state") return J({ economyLeagues: [], oldEconomyLeagues: [] });
  if (u.pathname === "/poe1/api/economy/exchange/current/overview") {
    return EXCHANGE_DATA[type] ? exchange(EXCHANGE_DATA[type]) : J({ core: CORE, lines: [] });
  }
  if (u.pathname === "/poe1/api/economy/stash/current/item/overview") {
    return STASH_ITEMS[type] ? J({ lines: STASH_ITEMS[type] }) : J({ lines: [] });
  }
  if (u.pathname === "/poe1/api/economy/stash/current/currency/overview") {
    // The site's Currency and Fragment tabs: full list, already in chaos.
    // Note Orb of Intention and the curio appear ONLY here, never in the
    // exchange — that is the case that used to go unpriced.
    // Same goods, priced the older way. 999 marks names the exchange also
    // carries — those must lose. Echo of Trauma and Curio of Potential appear
    // only here, so they must still land.
    if (type === "Fragment") return J({ lines: [
      { currencyTypeName: "Reverent Fragment", chaosEquivalent: 999 },
      { currencyTypeName: "Echo of Trauma", chaosEquivalent: 126 },
    ] });
    return J({ lines: [
      { currencyTypeName: "Chaos Orb", chaosEquivalent: 999 },
      { currencyTypeName: "Orb of Intention", chaosEquivalent: 999 },
      // Also the dictionary's only source of the real apostrophe spelling —
      // the exchange knows this one as the slug "awakeners-orb".
      { currencyTypeName: "Awakener's Orb", chaosEquivalent: 999 },
      { currencyTypeName: "Curio of Potential", chaosEquivalent: 8 },
    ] });
  }
  return NOPE();
};

process.env.DATA_OUT = OUT_DIR;
await import("./fetch-data.mjs");

/* fetch-data.mjs kicks off main() without awaiting it, so importing the
   module returns long before the snapshot is on disk. index.json is written
   last — poll for it. */
await (async () => {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { await readFile(path.join(OUT_DIR, "index.json"), "utf8"); return; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error("snapshot did not finish within 120s");
    await new Promise((r) => setTimeout(r, 200));
  }
})();

/* ---- assertions ---- */
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const near = (a, b, eps = 0.01) => a != null && Math.abs(a - b) <= eps;

const priced = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "prices.json"), "utf8"));
const P = priced.prices;

// The headline bug: a fragment quoted at 7.9 in a primary worth 10 chaos is
// 79c, not 7.9c and not 0.79c.
// The exchange is the source of record for everything fungible, converted
// through the chaos calibration.
ok(near(P["Reverent Fragment"]?.c, 79), `Reverent Fragment ${P["Reverent Fragment"]?.c} != 79`);
ok(near(P["Lonely Fragment"]?.c, 50), `Lonely Fragment ${P["Lonely Fragment"]?.c} != 50`);
ok(near(P["Traumatic Fragment"]?.c, 18.6), `Traumatic Fragment ${P["Traumatic Fragment"]?.c} != 18.6`);
ok(near(P["Cosmic Fragment"]?.c, 74.3), `Cosmic Fragment ${P["Cosmic Fragment"]?.c} != 74.3`);
ok(near(P["The Maven's Writ"]?.c, 8.52), `The Maven's Writ ${P["The Maven's Writ"]?.c} != 8.52`);
ok(near(P["Awakener's Orb"]?.c, 210), `Awakener's Orb ${P["Awakener's Orb"]?.c} != 210`);
ok(near(P["Divine Orb"]?.c, 1300), `Divine Orb ${P["Divine Orb"]?.c} != 1300`);
ok(near(P["Orb of Intention"]?.c, 264), `Orb of Intention ${P["Orb of Intention"]?.c} != 264`);
ok(near(P["Orb of Remembrance"]?.c, 63), `Orb of Remembrance ${P["Orb of Remembrance"]?.c} != 63`);

// DivinationCard is a documented exchange type — leaving it out is what made
// cards read as unpriced.
ok(near(P["A Fate Worse Than Death"]?.c, 8), `div card ${P["A Fate Worse Than Death"]?.c} != 8`);

// Invitations are the entry cost for four bosses and live under the stash
// item overview, which the type list used to omit entirely.
for (const [n, v] of [["Polaric Invitation", 21.7], ["Writhing Invitation", 5],
                      ["Incandescent Invitation", 103], ["Screaming Invitation", 106]]) {
  ok(near(P[n]?.c, v), `${n} ${P[n]?.c} != ${v}`);
}

// Stash currency only fills gaps; it must never overwrite the exchange.
ok(near(P["Curio of Potential"]?.c, 8), `Curio of Potential ${P["Curio of Potential"]?.c} != 8 (gap-fill failed)`);
ok(near(P["Echo of Trauma"]?.c, 126), `Echo of Trauma ${P["Echo of Trauma"]?.c} != 126 (gap-fill failed)`);
const sentinels = Object.entries(P).filter(([, v]) => v.c === 999).map(([k]) => k);
ok(sentinels.length === 0, `stash currency overwrote exchange prices for: ${sentinels.join(", ")}`);

// Astrolabes must be in the price map at all — they were absent entirely.
ok(near(P["Templar Astrolabe"]?.c, 77), `Templar Astrolabe ${P["Templar Astrolabe"]?.c} != 77`);
ok(near(P["Fruiting Astrolabe"]?.c, 147), `Fruiting Astrolabe ${P["Fruiting Astrolabe"]?.c} != 147`);

// chaos is the unit, so it must price at exactly 1
ok(near(P["Chaos Orb"]?.c, 1), `Chaos Orb ${P["Chaos Orb"]?.c} != 1`);
ok(near(P["Divine Orb"]?.c, 1300), `Divine Orb ${P["Divine Orb"]?.c} != 1300`);
ok(near(P["Awakener's Orb"]?.c, 210), `Awakener's Orb ${P["Awakener's Orb"]?.c} != 210`);
ok(near(P["Omen of Amelioration"]?.c, 42), `Omen ${P["Omen of Amelioration"]?.c} != 42`);

// stash items are already chaos and must NOT be divided
ok(near(P["Starforge"]?.c, 4200) && near(P["Starforge"]?.hi, 5100), `Starforge ${JSON.stringify(P["Starforge"])}`);
ok(near(P["Awakened Spell Echo Support"]?.c, 700), `gem base variant ${P["Awakened Spell Echo Support"]?.c}`);
ok(near(P["Atziri's Splendour"]?.c, 40), `two-variant unique should take the cheaper: ${P["Atziri's Splendour"]?.c}`);
ok(near(P["Nightmare Map"]?.c, 32), `T17 map entry cost ${P["Nightmare Map"]?.c}`);

// the scarab tab shares the calibration, so it must survive a non-chaos primary too
const scarabs = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "scarabs.json"), "utf8"));
const pilfering = scarabs.items.find((i) => /Pilfering/i.test(i.name));
ok(near(pilfering?.chaosValue, 180), `Divination Scarab of Pilfering ${pilfering?.chaosValue} != 180`);
ok(near(scarabs.divineRate, 1300, 1), `scarab divineRate ${scarabs.divineRate} != 1300`);

const astro = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "astrolabes.json"), "utf8"));
ok(near(astro.items.find((i) => /Templar/.test(i.name))?.chaosValue, 77), "astrolabe tab conversion");

// and the documented endpoints are the ones actually used
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=Fragment"), "fragments come from the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=DivinationCard"), "divination cards come from the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=Astrolabe"), "astrolabes come from the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/stash/current/currency/overview?type=Currency"), "stash currency is still consulted for gap-fill");
ok(hits.some((h) => h === "/poe1/api/economy/stash/current/item/overview?type=Invitation"), "invitations must be fetched");
// A type that answers from its documented family should not also be retried
// against the other one — the cross-check is a fallback, not a second request.
ok(!hits.includes("/poe1/api/economy/exchange/current/overview?type=Invitation"),
   "Invitation answered from stash, so it should not have been retried on the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=Astrolabe"), "astrolabes must be fetched");
ok(hits.some((h) => h === "/poe1/api/economy/stash/current/item/overview?type=UniqueWeapon"), "uniques must come from the stash endpoint");

console.log(`\nprice map: ${Object.keys(P).length} names, chaos=${P["Chaos Orb"]?.c}, divine=${P["Divine Orb"]?.c}c`);
await rm(OUT_DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
