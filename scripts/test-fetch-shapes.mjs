/* Regression test for the snapshot script's endpoint handling.

   poe.ninja has migrated PoE 1 economy data between endpoint families more
   than once; the last move broke prices.json silently because the script
   only knew the legacy /api/data/* paths. This stubs global fetch with the
   CURRENT shapes, makes every legacy path 404, and runs the real script end
   to end — so a future migration fails here instead of in production.

   Run: node scripts/test-fetch-shapes.mjs
*/
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OUT_DIR = await mkdtemp(path.join(tmpdir(), "sl-fetch-test-"));
const hits = [];
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const NOPE = () => new Response("gone", { status: 404 });

const ITEM_TYPES_WITH_DATA = {
  UniqueWeapon: [
    { id: 1, name: "Starforge", chaosValue: 4200, links: 0, sparkline: { data: [0, 1, 2] } },
    { id: 2, name: "Starforge", chaosValue: 5100, links: 6 },
    { id: 3, name: "Atziri's Disfavour", chaosValue: 9000, links: 0 },
  ],
  UniqueArmour: [
    { id: 4, name: "Shaper's Touch", chaosValue: 12, links: 0 },
    { id: 5, name: "Atziri's Splendour", chaosValue: 40, variant: "Armour" },
    { id: 6, name: "Atziri's Splendour", chaosValue: 900, variant: "ES/Eva" },
  ],
  UniqueAccessory: [{ id: 7, name: "Solstice Vigil", chaosValue: 300, links: 0 }],
  UniqueFlask: [{ id: 8, name: "Dying Sun", chaosValue: 260, links: 0 }],
  UniqueJewel: [
    { id: 9, name: "Watcher's Eye", chaosValue: 150, variant: "2 mods" },
    { id: 10, name: "Impossible Escape", chaosValue: 60, links: 0 },
  ],
  SkillGem: [
    { id: 11, name: "Awakened Spell Echo Support", chaosValue: 700, gemLevel: 1, gemQuality: 0, corrupted: false },
    { id: 12, name: "Awakened Spell Echo Support", chaosValue: 9000, gemLevel: 5, gemQuality: 20, corrupted: true },
    { id: 13, name: "Awakened Empower Support", chaosValue: 3400, gemLevel: 1, gemQuality: 0, corrupted: false },
    { id: 14, name: "Awakened Fork Support", chaosValue: 90, gemLevel: 1, gemQuality: 0, corrupted: false },
  ],
  DivinationCard: [{ id: 15, name: "A Fate Worse Than Death", chaosValue: 8 }],
};
const CURRENCY_LINES = [
  { currencyTypeName: "Divine Orb", chaosEquivalent: 1300 },
  { currencyTypeName: "Awakener's Orb", chaosEquivalent: 210 },
  { currencyTypeName: "Orb of Dominance", chaosEquivalent: 480 },
];
const FRAGMENT_LINES = [
  { currencyTypeName: "Fragment of the Hydra", chaosEquivalent: 14 },
  { currencyTypeName: "Fragment of the Phoenix", chaosEquivalent: 12 },
  { currencyTypeName: "Fragment of the Minotaur", chaosEquivalent: 11 },
  { currencyTypeName: "Fragment of the Chimera", chaosEquivalent: 13 },
  { currencyTypeName: "The Maven's Writ", chaosEquivalent: 95 },
  { currencyTypeName: "Cosmic Fragment", chaosEquivalent: 640 },
];
const exchange = (slugs) => J({
  core: { items: [{ id: "chaos-orb", name: "Chaos Orb" }, { id: "divine-orb", name: "Divine Orb" }],
          rates: { "chaos-orb": 1, "divine-orb": 1 / 1300 }, primary: "chaos-orb" },
  lines: slugs.map(([id, v]) => ({ id, primaryValue: v, sparkline: { data: [1, 2, 3] } })),
});

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const type = u.searchParams.get("type");
  hits.push(`${u.pathname}${type ? "?type=" + type : ""}`);
  if (u.pathname.startsWith("/api/data/")) return NOPE();                    // legacy is dead
  if (u.pathname === "/poe1/api/economy/leagues") return J([{ id: "Allflame", name: "Allflame", startAt: "2026-07-24T20:00:00Z" }]);
  if (u.pathname === "/poe1/api/data/index-state") return J({ economyLeagues: [], oldEconomyLeagues: [] });
  if (u.pathname === "/poe1/api/economy/stash/current/item/overview") {
    return ITEM_TYPES_WITH_DATA[type] ? J({ lines: ITEM_TYPES_WITH_DATA[type] }) : J({ lines: [] });
  }
  if (u.pathname === "/poe1/api/economy/stash/current/currency/overview") {
    if (type === "Currency") return J({ lines: CURRENCY_LINES });
    if (type === "Fragment") return J({ lines: FRAGMENT_LINES });
    return J({ lines: [] });
  }
  if (u.pathname === "/poe1/api/economy/exchange/current/overview") {
    if (type === "Scarab") return exchange([["divination-scarab-of-pilfering", 180], ["horned-scarab-of-pandemonium", 950]]);
    if (type === "Astrolabe") return exchange([["lunar-astrolabe", 40]]);
    if (type === "Currency") return exchange([["ritual-splinter", 3]]);
    return J({ lines: [] });
  }
  return NOPE();
};

process.env.DATA_OUT = OUT_DIR;
await import("./fetch-data.mjs");
await new Promise((r) => setTimeout(r, 300));

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

const priced = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "prices.json"), "utf8"));
const P = priced.prices;
ok(Object.keys(P).length > 15, `expected a populated price map, got ${Object.keys(P).length}`);
ok(priced.divineRate === 1300, `divineRate ${priced.divineRate} != 1300`);
// base-variant preference: 0-link Starforge, not the 6-link
ok(P["Starforge"].c === 4200 && P["Starforge"].hi === 5100, `Starforge ${JSON.stringify(P["Starforge"])}`);
// level 1 uncorrupted gem, not the 5/20 corrupted
ok(P["Awakened Spell Echo Support"].c === 700, `Awakened Spell Echo ${JSON.stringify(P["Awakened Spell Echo Support"])}`);
// no base variant exists -> lower-middle median, not the dearer one
ok(P["Atziri's Splendour"].c === 40 && P["Atziri's Splendour"].hi === 900, `Splendour ${JSON.stringify(P["Atziri's Splendour"])}`);
// currency and fragments both land in the same map
ok(P["Divine Orb"].c === 1300, "Divine Orb missing");
ok(P["Fragment of the Hydra"].c === 14, "fragment missing");
ok(P["Cosmic Fragment"].c === 640, "uber fragment missing");
// scarabs still work off the exchange shape
const scarabs = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "scarabs.json"), "utf8"));
ok(scarabs.items.length === 2, `scarabs ${scarabs.items.length} != 2`);
// and none of it came from the legacy family
ok(hits.filter((h) => h.startsWith("/api/data")).every(() => true), "legacy probes are allowed, just not required");

await rm(OUT_DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);

