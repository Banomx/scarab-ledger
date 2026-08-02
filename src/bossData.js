/* ================================================================
   BOSS PROFITABILITY DATASET
   ----------------------------------------------------------------
   Every boss is: a cost to open the fight, a pool of things it drops,
   and the time it takes you to do a run. Profit/hr falls out of that.

   Drop entry shapes (pick one per line):
     { item, share }   share of the guaranteed unique pool (shares in a
                       pool should roughly sum to 1). Expected quantity
                       = share * poolRolls.
     { item, chance }  independent chance of dropping, per kill.
     { item, qty }     flat expected quantity per kill.

   `item` is matched against poe.ninja names in prices.json. Names that
   start with "@" are synthetic aggregates resolved in bossProfit.js
   (e.g. "a random awakened gem").

   `rates`:
     "wiki"     — percentages published on poewiki.net (crowdsourced,
                  usually rebalanced every few patches)
     "estimate" — the drop POOL is known but the split is not, so it is
                  spread evenly. Treat these as a starting point.

   Anything here can be overridden in the UI, and overrides persist.
   To add a boss, copy a block and fill it in — no other file needs to
   change.
   ================================================================ */

export const GROUP_ORDER = ["Pinnacle", "Uber pinnacle", "Vaal", "Eldritch", "Breach", "Delve", "Other"];

export const GROUP_TONES = {
  "Pinnacle": "#c9a24b",
  "Uber pinnacle": "#d4705f",
  "Vaal": "#c96a3f",
  "Eldritch": "#8f6ad4",
  "Breach": "#b06ad4",
  "Delve": "#6ac3d4",
  "Other": "#8fb46a",
};

/* Synthetic price keys resolved against the live price map. */
export const SYNTHETIC = {
  "@awakened-common": {
    label: "Awakened support gem (random, non-exceptional)",
    match: (n) => /^Awakened .+ Support$/.test(n) && !/(Enlighten|Empower|Enhance)/.test(n),
  },
  "@awakened-exceptional": {
    label: "Awakened Enlighten / Empower / Enhance",
    match: (n) => /^Awakened (Enlighten|Empower|Enhance) Support$/.test(n),
  },
};

export const BOSSES = [
  /* ---------------- Pinnacle ---------------- */
  {
    id: "shaper",
    name: "The Shaper",
    group: "Pinnacle",
    entry: [
      { item: "Fragment of the Hydra" },
      { item: "Fragment of the Phoenix" },
      { item: "Fragment of the Minotaur" },
      { item: "Fragment of the Chimera" },
    ],
    ttk: 90, overhead: 120, poolRolls: 1, rates: "wiki",
    note: "Rates are preliminary week-1 trade data after the 3.26 drop rebalance.",
    drops: [
      { item: "Shaper's Touch", share: 0.56 },
      { item: "Voidwalker", share: 0.26 },
      { item: "Solstice Vigil", share: 0.15 },
      { item: "Dying Sun", share: 0.03 },
    ],
  },
  {
    id: "elder",
    name: "The Elder",
    group: "Pinnacle",
    entry: [
      { item: "Fragment of Purification" },
      { item: "Fragment of Constriction" },
      { item: "Fragment of Enslavement" },
      { item: "Fragment of Eradication" },
    ],
    ttk: 70, overhead: 120, poolRolls: 1, rates: "estimate",
    note: "The Elder's own unique pool has no published split; the fragments it drops feed Uber Elder.",
    drops: [
      { item: "Watcher's Eye", share: 1 },
      { item: "Fragment of Terror", chance: 0.5 },
      { item: "Fragment of Emptiness", chance: 0.5 },
      { item: "Orb of Dominance", chance: 0.06 },
    ],
  },
  {
    id: "uber-elder",
    name: "Uber Elder",
    group: "Pinnacle",
    entry: [
      { item: "Fragment of Terror" },
      { item: "Fragment of Emptiness" },
      { item: "Fragment of Knowledge" },
      { item: "Fragment of Shape" },
    ],
    ttk: 120, overhead: 120, poolRolls: 1, rates: "estimate",
    note: "Pool split not published — even split across the two headline drops.",
    drops: [
      { item: "Watcher's Eye", share: 0.5 },
      { item: "Impresence", share: 0.5 },
    ],
  },
  {
    id: "sirus",
    name: "Sirus, Awakener of Worlds",
    group: "Pinnacle",
    entry: [
      { item: "Al-Hezmin's Crest" },
      { item: "Baran's Crest" },
      { item: "Drox's Crest" },
      { item: "Veritania's Crest" },
    ],
    ttk: 150, overhead: 150, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "Hands of the High Templar", share: 0.40 },
      { item: "Crown of the Inward Eye", share: 0.35 },
      { item: "The Burden of Truth", share: 0.20 },
      { item: "Thread of Hope", share: 0.05 },
      { item: "Awakener's Orb", chance: 0.20 },
      { item: "Orb of Dominance", chance: 0.05 },
      { item: "Annihilation Support", chance: 0.05 },
      { item: "A Fate Worse Than Death", chance: 0.04 },
    ],
  },
  {
    id: "maven",
    name: "The Maven",
    group: "Pinnacle",
    entry: [{ item: "The Maven's Writ" }],
    ttk: 180, overhead: 150, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "Viridi's Veil", share: 0.52 },
      { item: "Impossible Escape", share: 0.32 },
      { item: "Grace of the Goddess", share: 0.13 },
      { item: "Progenesis", share: 0.03 },
      { item: "@awakened-common", chance: 0.25 },
      { item: "@awakened-exceptional", chance: 0.0025 },
      { item: "Orb of Conflict", chance: 0.35 },
      { item: "Curio of Potential", chance: 0.05 },
      { item: "Shiny Reliquary Key", chance: 0.015 },
    ],
  },
  {
    id: "exarch",
    name: "The Searing Exarch",
    group: "Eldritch",
    entry: [{ item: "Incandescent Invitation" }],
    ttk: 60, overhead: 90, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "Dawnbreaker", share: 0.63 },
      { item: "Dawnstrider", share: 0.35 },
      { item: "Dissolution of the Flesh", share: 0.02 },
      { item: "Eldritch Orb of Annulment", chance: 0.05 },
      { item: "Eldritch Chaos Orb", chance: 0.05 },
      { item: "Eldritch Exalted Orb", chance: 0.05 },
    ],
  },
  {
    id: "eater",
    name: "The Eater of Worlds",
    group: "Eldritch",
    entry: [{ item: "Screaming Invitation" }],
    ttk: 60, overhead: 90, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "Ravenous Passion", share: 0.68 },
      { item: "Ashes of the Stars", share: 0.30 },
      { item: "Nimis", share: 0.02 },
      { item: "Forbidden Flesh", chance: 0.05 },
      { item: "Curio of Consumption", chance: 0.05 },
      { item: "Visceral Reliquary Key", chance: 0.01 },
      { item: "Eldritch Orb of Annulment", chance: 0.05 },
      { item: "Eldritch Chaos Orb", chance: 0.05 },
      { item: "Eldritch Exalted Orb", chance: 0.05 },
    ],
  },
  {
    id: "black-star",
    name: "The Black Star",
    group: "Eldritch",
    entry: [{ item: "Polaric Invitation" }],
    ttk: 45, overhead: 75, poolRolls: 0, rates: "wiki",
    note: "Wiki gives ranges; midpoints used.",
    drops: [
      { item: "Polaric Devastation", chance: 0.04 },
      { item: "Sudden Dawn", chance: 0.04 },
      { item: "The Eternal Struggle", chance: 0.075 },
      { item: "Eldritch Orb of Annulment", chance: 0.075 },
      { item: "Eldritch Chaos Orb", chance: 0.075 },
      { item: "Eldritch Exalted Orb", chance: 0.075 },
      { item: "Grand Eldritch Ember", chance: 0.16 },
      { item: "Greater Eldritch Ember", chance: 0.16 },
    ],
  },
  {
    id: "infinite-hunger",
    name: "The Infinite Hunger",
    group: "Eldritch",
    entry: [{ item: "Writhing Invitation" }],
    ttk: 45, overhead: 75, poolRolls: 1, rates: "estimate",
    drops: [
      { item: "Ceaseless Feast", share: 1 / 3 },
      { item: "Black Zenith", share: 1 / 3 },
      { item: "The Eternal Struggle", share: 1 / 3 },
      { item: "Grand Eldritch Ichor", chance: 0.16 },
      { item: "Greater Eldritch Ichor", chance: 0.16 },
    ],
  },

  /* ---------------- Uber pinnacle ---------------- */
  {
    id: "uber-shaper",
    name: "Uber Shaper",
    group: "Uber pinnacle",
    entry: [{ item: "Cosmic Fragment", qty: 4, verify: true }],
    ttk: 150, overhead: 120, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "Echoes of Creation", share: 0.40 },
      { item: "Entropic Devastation", share: 0.36 },
      { item: "The Tides of Time", share: 0.22 },
      { item: "Starforge", share: 0.02 },
      { item: "Sublime Vision", share: 0.02 },
      { item: "Cosmic Reliquary Key", chance: 0.01 },
    ],
  },
  {
    id: "uber-sirus",
    name: "Uber Sirus",
    group: "Uber pinnacle",
    entry: [{ item: "Awakening Fragment", qty: 4, verify: true }],
    ttk: 200, overhead: 150, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "Thread of Hope", share: 0.55 },
      { item: "The Tempest Rising", share: 0.37 },
      { item: "Oriath's End", share: 0.075 },
      { item: "The Saviour", share: 0.01 },
      { item: "Oubliette Reliquary Key", chance: 0.015 },
    ],
  },
  {
    id: "uber-maven",
    name: "Uber Maven",
    group: "Uber pinnacle",
    entry: [{ item: "Reality Fragment", qty: 5, verify: true }],
    ttk: 260, overhead: 150, poolRolls: 1, rates: "wiki",
    note: "Wiki lists the same pool split as normal Maven; the uber fight drops more of it.",
    drops: [
      { item: "Viridi's Veil", share: 0.52 },
      { item: "Impossible Escape", share: 0.32 },
      { item: "Grace of the Goddess", share: 0.13 },
      { item: "Progenesis", share: 0.03 },
      { item: "@awakened-common", chance: 0.25 },
      { item: "@awakened-exceptional", chance: 0.0025 },
      { item: "Orb of Conflict", chance: 0.35 },
      { item: "Curio of Potential", chance: 0.05 },
      { item: "Shiny Reliquary Key", chance: 0.015 },
    ],
  },
  {
    id: "uber-exarch",
    name: "Uber Searing Exarch",
    group: "Uber pinnacle",
    entry: [{ item: "Blazing Fragment", qty: 4, verify: true }],
    ttk: 130, overhead: 120, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "The Annihilating Light", share: 0.455 },
      { item: "Annihilation's Approach", share: 0.29 },
      { item: "Crystallised Omniscience", share: 0.24 },
      { item: "The Celestial Brace", share: 0.015 },
      { item: "Forbidden Flame", chance: 0.05 },
      { item: "Curio of Absorption", chance: 0.05 },
      { item: "Archive Reliquary Key", chance: 0.015 },
    ],
  },
  {
    id: "uber-eater",
    name: "Uber Eater of Worlds",
    group: "Uber pinnacle",
    entry: [{ item: "Devouring Fragment", qty: 5, verify: true }],
    ttk: 130, overhead: 120, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "Ravenous Passion", share: 0.68 },
      { item: "Ashes of the Stars", share: 0.30 },
      { item: "Nimis", share: 0.02 },
      { item: "Forbidden Flesh", chance: 0.05 },
      { item: "Curio of Consumption", chance: 0.05 },
      { item: "Visceral Reliquary Key", chance: 0.01 },
    ],
  },
  {
    id: "uber-uber-elder",
    name: "Uber Uber Elder",
    group: "Uber pinnacle",
    entry: [{ item: "Decaying Fragment", qty: 5, verify: true }],
    ttk: 240, overhead: 150, poolRolls: 1, rates: "estimate",
    drops: [
      { item: "Watcher's Eye", share: 0.5 },
      { item: "Impresence", share: 0.5 },
    ],
  },

  /* ---------------- Vaal ---------------- */
  {
    id: "atziri",
    name: "Atziri, Queen of the Vaal",
    group: "Vaal",
    entry: [
      { item: "Sacrifice at Dusk" },
      { item: "Sacrifice at Noon" },
      { item: "Sacrifice at Midnight" },
      { item: "Sacrifice at Dawn" },
    ],
    ttk: 90, overhead: 120, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "Atziri's Promise", share: 0.48 },
      { item: "Triumvirate Authority", share: 0.18 },
      { item: "Atziri's Step", share: 0.15 },
      { item: "Doryani's Invitation", share: 0.15 },
      { item: "Doryani's Catalyst", share: 0.03 },
      { item: "Pledge of Hands", share: 0.005 },
      { item: "Mortal Grief", chance: 0.18 },
      { item: "Mortal Rage", chance: 0.08 },
      { item: "Mortal Hope", chance: 0.06 },
      { item: "Mortal Ignorance", chance: 0.03 },
    ],
  },
  {
    id: "uber-atziri",
    name: "Uber Atziri",
    group: "Vaal",
    entry: [
      { item: "Mortal Grief" },
      { item: "Mortal Rage" },
      { item: "Mortal Hope" },
      { item: "Mortal Ignorance" },
    ],
    ttk: 150, overhead: 150, poolRolls: 1, rates: "wiki",
    drops: [
      { item: "Atziri's Splendour", share: 0.42 },
      { item: "The Vertex", share: 0.40 },
      { item: "Atziri's Acuity", share: 0.06 },
      { item: "Triumvirate Authority", share: 0.05 },
      { item: "Atziri's Reflection", share: 0.04 },
      { item: "Atziri's Disfavour", share: 0.02 },
      { item: "Atziri's Rule", share: 0.01 },
      { item: "Sacrificial Garb", chance: 0.15 },
      { item: "Vaal Sacrifice Support", chance: 0.08 },
      { item: "Greater Spell Echo Support", chance: 0.05 },
      { item: "Triskaidekaphobia", chance: 0.20 },
      { item: "The Price of Devotion", chance: 0.001 },
    ],
  },

  /* ---------------- Breach ---------------- */
  {
    id: "chayula",
    name: "Chayula, Who Dreamt",
    group: "Breach",
    entry: [{ item: "Chayula's Breachstone" }],
    ttk: 40, overhead: 60, poolRolls: 0, rates: "wiki",
    drops: [
      { item: "Severed in Sleep", chance: 0.35 },
      { item: "Skin of the Loyal", chance: 0.05 },
      { item: "The Red Dream", chance: 0.05 },
      { item: "The Green Dream", chance: 0.05 },
      { item: "The Blue Dream", chance: 0.05 },
      { item: "Uul-Netol's Vow", chance: 0.02 },
      { item: "Presence of Chayula", chance: 0.01 },
    ],
  },
  {
    id: "chayula-flawless",
    name: "Chayula (Flawless)",
    group: "Breach",
    entry: [{ item: "Chayula's Flawless Breachstone" }],
    ttk: 70, overhead: 60, poolRolls: 0, rates: "wiki",
    drops: [
      { item: "United in Dream", chance: 0.33 },
      { item: "Skin of the Lords", chance: 0.04 },
      { item: "The Red Nightmare", chance: 0.04 },
      { item: "The Blue Nightmare", chance: 0.04 },
      { item: "The Green Nightmare", chance: 0.04 },
      { item: "Presence of Chayula", chance: 0.03 },
    ],
  },

  /* ---------------- Delve ---------------- */
  {
    id: "aul",
    name: "Aul, the Crystal King",
    group: "Delve",
    entry: [],
    ttk: 60, overhead: 900, poolRolls: 1, rates: "wiki",
    note: "No fragment cost — the overhead is the sulphite and delving to depth 130+.",
    drops: [
      { item: "Aul's Uprising", share: 0.61 },
      { item: "Crown of the Tyrant", share: 0.15 },
      { item: "Ahkeli's Meadow", share: 0.08 },
      { item: "Uzaza's Valley", share: 0.08 },
      { item: "Putembo's Mountain", share: 0.08 },
    ],
  },

  /* ---------------- Other ---------------- */
  {
    id: "trialmaster",
    name: "The Trialmaster",
    group: "Other",
    entry: [{ item: "Ultimatum Scarab of Dueling" }],
    ttk: 120, overhead: 180, poolRolls: 1, rates: "wiki",
    note: "Wiki split looks generous on Glimpse of Chaos — worth sanity-checking against trade.",
    drops: [
      { item: "Ixchel's Temptation", share: 0.40 },
      { item: "Glimpse of Chaos", share: 0.40 },
      { item: "Yaomac's Accord", share: 0.095 },
      { item: "Mahuxotl's Machination", share: 0.095 },
      { item: "Hateforge", share: 0.01 },
      { item: "Machinations Support", chance: 0.10 },
      { item: "Vaal Temptation Support", chance: 0.05 },
    ],
  },
  {
    id: "catarina",
    name: "Catarina, Master of Undeath",
    group: "Other",
    entry: [],
    ttk: 90, overhead: 600, poolRolls: 1, rates: "estimate",
    note: "One guaranteed unique from the pool; split not published. Overhead is filling the Betrayal board.",
    drops: [
      { item: "Cinderswallow Urn", share: 0.2 },
      { item: "Bitterbind Point", share: 0.2 },
      { item: "Cane of Kulemak", share: 0.2 },
      { item: "The Queen's Hunger", share: 0.2 },
      { item: "The Devouring Diadem", share: 0.2 },
    ],
  },
  {
    id: "lycia",
    name: "Lycia, Herald of the Scourge",
    group: "Other",
    entry: [{ item: "Forbidden Tome" }],
    ttk: 90, overhead: 900, poolRolls: 0, rates: "estimate",
    note: "Each unique needs its matching relic equipped — set the chance of the one you actually run to 1 and the rest to 0.",
    drops: [
      { item: "The Balance of Terror", chance: 0.2 },
      { item: "Eternal Damnation", chance: 0.2 },
      { item: "Original Sin", chance: 0.2 },
      { item: "Sandstorm Visage", chance: 0.2 },
      { item: "The Winds of Fate", chance: 0.2 },
    ],
  },
  {
    id: "olroth",
    name: "Olroth, Origin of the Fall",
    group: "Other",
    entry: [],
    ttk: 90, overhead: 420, poolRolls: 1, rates: "estimate",
    note: "Knights of the Sun logbook, area level 81+. Overhead is running the logbook.",
    drops: [
      { item: "Olroth's Resolve", share: 1 / 3 },
      { item: "Cadigan's Crown", share: 1 / 3 },
      { item: "Vorana's March", share: 1 / 3 },
    ],
  },
];

export const BOSS_BY_ID = Object.fromEntries(BOSSES.map((b) => [b.id, b]));
