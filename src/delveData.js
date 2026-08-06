/* ================================================================
   DELVE DATASET
   ----------------------------------------------------------------
   Three questions the Delve tab answers, and the data each needs:

     "what are fossils worth?"     -> FOSSILS (names + which biome
                                      pool they sit in). Prices come
                                      from poe.ninja at runtime.
     "which biome do I want?"      -> BIOMES: the common fossil pool,
                                      the exclusive fossil node, and
                                      the depth thresholds that decide
                                      whether the biome spawns at all.
     "what is a delve boss worth?" -> DELVE_BOSSES, in the same drop
                                      group shape src/bossData.js uses,
                                      so src/bossProfit.js prices them
                                      without a second engine.

   Sources
   -------
   Biome fossil pools, depth/weight thresholds, biome-specific nodes and
   the boss minimum depths are poewiki's Delve page (the Biomes, Nodes
   and Major Bosses tables). Boss drop rates are poewiki's per-monster
   "Estimated drop rates in version 3.25.0, n=100" lists — real sampled
   numbers, not guesses, which is why `rates: "wiki"` here means the same
   confidence `rates: "ledger"` means in bossData.js.

   What is NOT published anywhere, and is therefore a knob in the UI
   rather than a number in this file:
     - how many fossils a node actually drops
     - how often a city biome carries its boss node

   There used to be a third: how many fossil nodes a delve level contains.
   That one was unknowable AND load-bearing — it multiplied every biome
   figure — so the tab stopped quoting biomes per delve and now quotes them
   per node, and the knob is gone with the unit.
   Every one of those lives in DEFAULTS below, is editable, and is
   badged in the UI as an assumption. Nothing here silently invents a
   drop rate.
   ================================================================ */

/* ---------------- biomes ----------------

   `weight` is poewiki's spawn weight for the biome, expressed as the two
   ends of its depth ramp: at `lo.depth` and shallower the weight is
   `lo.weight`, at `hi.depth` and deeper it is `hi.weight`. The wiki says
   depths between the two "scale non-linearly" without giving the curve,
   so the engine smoothsteps it and the UI says so.

   Mines is the one biome that ramps DOWN (100 early, 0 by depth 52).

   `pool` is the biome's common fossil drop pool. `wall: true` fossils in
   FOSSILS are the ones the wiki flags as sitting behind fractured walls —
   in the pool, but you need to blast for them.

   `exclusive` is the biome-only fossil node: the whole reason to steer
   toward a biome rather than take whatever the mine gives you. */

export const BIOMES = [
  {
    id: "mines", name: "Mines", tone: "#8b7d63", city: false,
    pool: ["Metallic Fossil", "Serrated Fossil", "Pristine Fossil", "Aetheric Fossil"],
    weight: { lo: { depth: 30, weight: 100 }, hi: { depth: 52, weight: 0 } },
    exclusive: null,
    themed: [],
    note: "The starting biome. Gone by depth 52 — nothing to plan around.",
  },
  {
    id: "fungal", name: "Fungal Caverns", tone: "#7fa650", city: false,
    pool: ["Dense Fossil", "Aberrant Fossil", "Opulent Fossil", "Corroded Fossil", "Gilded Fossil"],
    weight: { lo: { depth: 4, weight: 0 }, hi: { depth: 20, weight: 100 } },
    exclusive: { node: "Haunted Tomb", fossil: "Tangled Fossil" },
    themed: ["Echoing Lair (beasts)", "Renegade Camp (chaos)", "Restless Rubble (chaos)", "Beast Burrow (minion/aura)", "Necromancer's Excavation (minion/aura)"],
  },
  {
    id: "petrified", name: "Petrified Forest", tone: "#a67f4a", city: false,
    pool: ["Bound Fossil", "Jagged Fossil", "Corroded Fossil", "Sanctified Fossil"],
    weight: { lo: { depth: 4, weight: 0 }, hi: { depth: 20, weight: 100 } },
    exclusive: { node: "Stonewood Hollow", fossil: "Bloodstained Fossil" },
    themed: ["Ritual Grounds (talismans)", "Nesting Grounds (physical)", "Grim Copse (minion/aura)"],
  },
  {
    id: "abyssal", name: "Abyssal Depths", tone: "#5f7fb0", city: false,
    pool: ["Aberrant Fossil", "Bound Fossil", "Gilded Fossil", "Lucent Fossil"],
    weight: { lo: { depth: 10, weight: 0 }, hi: { depth: 25, weight: 100 } },
    exclusive: { node: "Crystal Spire", fossil: "Hollow Fossil" },
    themed: ["Haunted Remains (abyss)", "Unspeakable Shrine (abyss)", "Haunted Remains (mana/curse)", "Necromancer's Excavation (minion/aura)"],
  },
  {
    id: "frozen", name: "Frozen Hollow", tone: "#6fb4c9", city: false,
    pool: ["Frigid Fossil", "Serrated Fossil", "Prismatic Fossil", "Sanctified Fossil", "Shuddering Fossil"],
    weight: { lo: { depth: 15, weight: 0 }, hi: { depth: 30, weight: 100 } },
    exclusive: { node: "Time-Lost Cavern", fossil: "Glyphic Fossil" },
    themed: ["Frigid Recess (essences)", "Mutewind Base (cold)", "Restless Rubble (cold)"],
  },
  {
    id: "magma", name: "Magma Fissure", tone: "#c25f3f", city: false,
    pool: ["Scorched Fossil", "Prismatic Fossil", "Pristine Fossil", "Deft Fossil", "Fundamental Fossil"],
    weight: { lo: { depth: 20, weight: 0 }, hi: { depth: 40, weight: 100 } },
    exclusive: { node: "Molten Cavity", fossil: "Faceted Fossil" },
    themed: ["Redblade Base (fire)", "Sweltering Burrow (fire)", "Restless Rubble (fire)"],
  },
  {
    id: "sulphur", name: "Sulphur Vents", tone: "#c9a24b", city: false,
    pool: ["Metallic Fossil", "Opulent Fossil", "Aetheric Fossil", "Fundamental Fossil"],
    weight: { lo: { depth: 35, weight: 0 }, hi: { depth: 55, weight: 100 } },
    exclusive: { node: "Humid Fissure", fossil: "Fractured Fossil" },
    themed: ["Brinerot Base (lightning)", "Restless Rubble (lightning)"],
  },
  {
    id: "vaal", name: "Vaal Outpost", tone: "#c96a3f", city: true,
    pool: [],
    weight: { lo: { depth: 32, weight: 0 }, hi: { depth: 200, weight: 23 } },
    exclusive: null,
    themed: ["Ruined Chamber (multiple loot containers)", "The Grand Architect's Temple (Ahuatotli)"],
    boss: "ahuatotli",
    note: "City biome: better loot, more and harder monsters, no fossil pool of its own.",
  },
  {
    id: "abyssal-city", name: "Abyssal City", tone: "#7f6ad4", city: true,
    pool: [],
    weight: { lo: { depth: 70, weight: 0 }, hi: { depth: 350, weight: 23 } },
    exclusive: null,
    themed: ["Abyssal Chamber (multiple loot containers)", "The Lich's Tomb (Kurgal)"],
    boss: "kurgal",
    note: "City biome: better loot, more and harder monsters, no fossil pool of its own.",
  },
  {
    id: "primeval", name: "Primeval Ruins", tone: "#b06ad4", city: true,
    pool: [],
    weight: { lo: { depth: 110, weight: 0 }, hi: { depth: 500, weight: 17 } },
    exclusive: null,
    themed: ["Primeval Chamber (multiple loot containers)", "The Crystal King's Throne (Aul)"],
    boss: "aul",
    note: "City biome: better loot, more and harder monsters, no fossil pool of its own.",
  },
];

export const BIOME_BY_ID = Object.fromEntries(BIOMES.map((b) => [b.id, b]));

/* ---------------- fossils ----------------

   Derived from the biome pools above plus the six exclusive nodes, so a
   fossil can never appear here with a biome the biome table disagrees
   with. `wall` marks the three the wiki flags as behind fractured walls:
   they are in the pool, but only if you blow the wall open. */

const WALL_LOCKED = new Set(["Gilded Fossil", "Lucent Fossil", "Sanctified Fossil"]);

function buildFossils() {
  const map = new Map();
  const touch = (name) => {
    if (!map.has(name)) map.set(name, { name, biomes: [], exclusive: null, wall: WALL_LOCKED.has(name) });
    return map.get(name);
  };
  for (const b of BIOMES) {
    for (const f of b.pool) touch(f).biomes.push(b.id);
    if (b.exclusive) {
      const f = touch(b.exclusive.fossil);
      f.biomes.push(b.id);
      f.exclusive = { biome: b.id, node: b.exclusive.node };
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const FOSSILS = buildFossils();
export const FOSSIL_BY_NAME = Object.fromEntries(FOSSILS.map((f) => [f.name, f]));

/* Fossils poe.ninja prices that this dataset does not place in a biome —
   drop sources outside the biome tables (Niko, league content, removed
   biomes). Listed so the price table can still show them instead of
   pretending they don't exist. */
export const UNPLACED_NOTE = "not in any biome pool on the wiki's Delve page";

/* ---------------- nodes ----------------

   `yields` is what the node hands you, in one of two forms:
     { fossil, qty }  a named fossil
     { pool: true, qty } that many draws from the biome's common pool,
                         priced at the pool average
   Quantities reference DEFAULTS so one knob moves every node of a kind. */

export const NODE_KINDS = {
  exclusive: { label: "Biome fossil node", tone: "#c9a24b" },
  generic: { label: "Generic fossil node", tone: "#8fb46a" },
  cache: { label: "Smuggler's cache", tone: "#6fb4c9" },
  chamber: { label: "City chamber", tone: "#b06ad4" },
};

export const NODES = [
  { id: "crystal-spire", name: "Crystal Spire", kind: "exclusive", biome: "abyssal", fossil: "Hollow Fossil" },
  { id: "humid-fissure", name: "Humid Fissure", kind: "exclusive", biome: "sulphur", fossil: "Fractured Fossil" },
  { id: "molten-cavity", name: "Molten Cavity", kind: "exclusive", biome: "magma", fossil: "Faceted Fossil" },
  { id: "time-lost-cavern", name: "Time-Lost Cavern", kind: "exclusive", biome: "frozen", fossil: "Glyphic Fossil" },
  { id: "stonewood-hollow", name: "Stonewood Hollow", kind: "exclusive", biome: "petrified", fossil: "Bloodstained Fossil" },
  { id: "haunted-tomb", name: "Haunted Tomb", kind: "exclusive", biome: "fungal", fossil: "Tangled Fossil" },
  { id: "fossil-node", name: "Fossil node (generic)", kind: "generic", biome: null,
    note: "The unnamed “Contains Fossils” nodes — priced against whichever biome you are standing in." },
  { id: "smugglers-cache", name: "Smuggler's cache", kind: "cache", biome: null,
    note: "Drops a cluster rather than a single fossil, which is what makes it worth the detour." },
];

/* ---------------- tunables ----------------

   Everything the wiki does not publish. Defaults are deliberately
   conservative and every one is editable in the UI. */

export const DEFAULTS = {
  depth: 300,
  /* fossils per node */
  exclusiveQty: 3,        // special fossils from the biome's own node
  exclusiveExtra: 2,      // common-pool fossils alongside them
  genericQty: 3,          // common-pool fossils from an unnamed fossil node
  cacheQty: 5,            // common-pool fossils from a smuggler's cache
  /* How often a city biome actually carries its boss node. Only the Bosses
     view uses this — it converts "this city is 3.5% of the mine" into "you
     will meet Ahuatotli about twice per 100 delves". The biome ranking is
     quoted per node and does not touch it. */
  bossPerCity: 0.5,
  /* wall-locked fossils only count if you blast for them */
  openWalls: true,
};

export const TUNABLES = [
  { key: "exclusiveQty", label: "Special fossils per biome node", group: "Per node", step: 0.5,
    help: "Crystal Spire, Humid Fissure and friends. Community figure is about three." },
  { key: "exclusiveExtra", label: "Common fossils alongside", group: "Per node", step: 0.5 },
  { key: "genericQty", label: "Fossils per generic fossil node", group: "Per node", step: 0.5 },
  { key: "cacheQty", label: "Fossils per smuggler's cache", group: "Per node", step: 0.5 },
  { key: "bossPerCity", label: "Boss node per city biome", group: "Bosses", step: 0.05,
    help: "A city biome may carry its boss. Nothing published — this is the guess the encounter rate rides on. Affects the Bosses view only." },
];

/* ---------------- resonators ---------------- */

export const RESONATOR_ORDER = ["Primitive", "Potent", "Powerful", "Prime"];
export const RESONATOR_SOCKETS = { Primitive: 1, Potent: 2, Powerful: 3, Prime: 4 };

/* ---------------- delve bosses ----------------

   Same shape as src/bossData.js so src/bossProfit.js prices them: groups
   of drop lines, `kind: "independent"` because these tables are sampled
   per-kill chances that sum well past 100% (Ahuatotli's six lines total
   140%), i.e. every line rolls on its own.

   Rates are poewiki's "Estimated drop rates in version 3.25.0, n=100"
   lists. Lines the wiki names as drops but leaves out of the rate list
   carry `chance: 0` and `unrated: true` — they show up greyed with a
   prompt to set your own rather than being handed an invented number
   that would quietly inflate the EV.

   No `entry` cost: you don't buy your way into a delve boss, you find
   one. `ttk` is only here because computeBoss wants it; the tab reports
   value per kill and per 100 delves, not profit/hour, because you cannot
   queue these back to back. */

const indep = (drops) => ({ id: "drops", kind: "independent", label: "Drop table", drops });

export const DELVE_BOSSES = [
  {
    id: "ahuatotli", name: "Ahuatotli, the Blind", biome: "vaal", minDepth: 50,
    node: "The Grand Architect's Temple", rates: "wiki", sample: "3.25.0, n=100",
    ttk: 60, overhead: 0,
    groups: [
      indep([
        { item: "Cerberus Limb", chance: 0.60 },
        { item: "Curiosity", chance: 0.40 },
        { item: "Doryani's Machinarium", chance: 0.16 },
        { item: "Ahkeli's Mountain", chance: 0.08 },
        { item: "Uzaza's Meadow", chance: 0.08 },
        { item: "Putembo's Valley", chance: 0.08 },
      ]),
    ],
  },
  {
    id: "kurgal", name: "Kurgal, the Blackblooded", biome: "abyssal-city", minDepth: 90,
    node: "The Lich's Tomb", rates: "wiki", sample: "3.25.0, n=100",
    ttk: 75, overhead: 0,
    groups: [
      indep([
        { key: "hale-1", item: "Hale Negator", label: "Hale Negator (1 socket)", chance: 0.40 },
        { key: "misery", item: "Misery in Darkness", chance: 0.20 },
        { key: "command-1", item: "Command of the Pit", label: "Command of the Pit (1 socket)", chance: 0.15 },
        { key: "hale-2", item: "Hale Negator", label: "Hale Negator (2 socket)", chance: 0.10 },
        { key: "ahkeli", item: "Ahkeli's Valley", chance: 0.10 },
        { key: "uzaza", item: "Uzaza's Mountain", chance: 0.10 },
        { key: "putembo", item: "Putembo's Meadow", chance: 0.10 },
        { key: "command-2", item: "Command of the Pit", label: "Command of the Pit (2 socket)", chance: 0.05 },
        { key: "zorath", item: "Zorath's Eye of the Inevitable", chance: 0.50, preliminary: true },
      ]),
    ],
  },
  {
    id: "aul", name: "Aul, the Crystal King", biome: "primeval", minDepth: 130,
    node: "The Crystal King's Throne", rates: "wiki", sample: "3.25.0, n=100",
    ttk: 90, overhead: 0,
    groups: [
      indep([
        { item: "Aul's Uprising", chance: 0.61 },
        { item: "Luminous Trove", chance: 0.16 },
        { item: "Crown of the Tyrant", chance: 0.15 },
        { item: "Ahkeli's Meadow", chance: 0.08 },
        { item: "Uzaza's Valley", chance: 0.08 },
        { item: "Putembo's Mountain", chance: 0.08 },
        // A divination card, so poe.ninja prices it like any other (the
        // DivinationCard type is already in the price map). What's missing is
        // the RATE: the wiki lists it in Aul's drop table but leaves it out of
        // the n=100 rate list, which most likely means it didn't drop once in
        // that sample. Zero of 100 is not "no information" — by the rule of
        // three it puts a 95% ceiling of about 3% on it, and the UI offers
        // that ceiling as a one-click value rather than baking a guess in.
        { item: "Desecrated Virtue", chance: 0, unrated: true, sampleZero: 100 },
      ]),
    ],
  },
];

export const DELVE_BOSS_BY_ID = Object.fromEntries(DELVE_BOSSES.map((b) => [b.id, b]));

/* Declared prices for names poe.ninja doesn't carry, in the same shape
   bossData.js uses: { "Item": { divine: N, asOf: "YYYY-MM-DD" } }, quoted
   in divine so they track the rate instead of going stale when chaos moves.

   Empty on purpose. Every fossil and every boss drop here is something
   poe.ninja lists, with one exception — Zorath's Eye of the Inevitable,
   whose rate the wiki itself calls preliminary and whose price I have not
   checked. A made-up number for it would land straight in Kurgal's EV, so
   it stays unpriced and visibly contributes nothing. Add one here once you
   know what it sells for. */
export const FALLBACKS = {};
