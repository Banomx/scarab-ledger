/* ================================================================
   BOSS PROFITABILITY DATASET
   ----------------------------------------------------------------
   A boss is: what it costs to open, what it drops, and how long a run
   takes. Profit/hr falls out of that.

   Drops are split into GROUPS because they don't all roll the same way:

     kind: "pool"        one guaranteed drop picked from the group.
                         Each line has a `share` (they sum to ~1).
                         Covers both the unique pool and the guaranteed
                         fragment / astrolabe tables.
     kind: "weighted"    the group has a `base` chance to drop at all;
                         if it does, one line is picked by `weight`.
     kind: "independent" each line rolls on its own `chance`. Set
                         `quantityScaled: true` and these get multiplied
                         by (1 + quantity/100) — area item quantity.

   Line fields: { item, share|chance|weight, label?, key? }
     item   name used for the poe.ninja price lookup
     label  what to show, when it differs (variants, unidentified)
     key    override identity, needed only when one boss lists the same
            item more than once (Catarina's three Cinderswallow Urns)

   `rates`:
     "ledger"   — from the drop tables Marcel supplied (2026-08 league
                  data, matches the numbers he's running against).
     "wiki"     — poewiki.net, for bosses the ledger set doesn't cover.
     "estimate" — pool known, split not published; spread evenly.

   `ttk` from the ledger set is the WHOLE cycle (their KPH = 3600/ttk),
   so those bosses carry overhead 0. Bosses where I estimated the time
   myself split it into ttk + overhead.

   Everything here is editable in the UI and the edits persist.
   ================================================================ */

export const GROUP_ORDER = [
  "Pinnacle", "Eldritch", "Incarnation", "Vaal", "Breach",
  "Synthesis", "Harvest", "Delve", "Other",
];

export const GROUP_TONES = {
  "Pinnacle": "#c9a24b",
  "Eldritch": "#8f6ad4",
  "Incarnation": "#6a8cd4",
  "Vaal": "#c96a3f",
  "Breach": "#b06ad4",
  "Synthesis": "#7f8fd4",
  "Harvest": "#5fc9b0",
  "Delve": "#6ac3d4",
  "Other": "#8fb46a",
};

/* Available for any boss that drops "a random X"; nothing uses them
   right now because the ledger data names the individual gems. */
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

/* ---- shared tables ---- */

const pool = (drops, label = "Unique pool") => ({ id: "pool", kind: "pool", label, rolls: 1, drops });
const guaranteed = (drops, label = "Guaranteed") => ({ id: "guaranteed", kind: "pool", label, rolls: 1, drops });
const extra = (drops, quantityScaled = false) =>
  ({ id: "additional", kind: "independent", label: "Additional drops", quantityScaled, drops });

/* The Incarnation fights all drop the same astrolabe table. */
const ASTROLABES = guaranteed([
  { item: "Templar Astrolabe", share: 0.33 },
  { item: "Grasping Astrolabe", share: 0.0744 },
  { item: "Runic Astrolabe", share: 0.0744 },
  { item: "Chaotic Astrolabe", share: 0.0744 },
  { item: "Fungal Astrolabe", share: 0.0744 },
  { item: "Nameless Astrolabe", share: 0.0744 },
  { item: "Timeless Astrolabe", share: 0.0744 },
  { item: "Deceptive Astrolabe", share: 0.0744 },
  { item: "Lightless Astrolabe", share: 0.0744 },
  { item: "Fruiting Astrolabe", share: 0.0744 },
], "Guaranteed astrolabe");

const SHAPER_FRAGS = guaranteed([
  { item: "Fragment of Shape", share: 0.5 },
  { item: "Fragment of Knowledge", share: 0.5 },
]);
const SHAPER_EXTRA = [
  { item: "Shaper's Exalted Orb", chance: 0.12 },
  { item: "Orb of Dominance", chance: 0.03 },
  { item: "Voidstorm", chance: 0.02 },
];
const SIRUS_EXTRA = [
  { item: "Awakener's Orb", chance: 0.20 },
  { item: "Orb of Dominance", chance: 0.10 },
  { item: "A Fate Worse Than Death", chance: 0.04 },
  { item: "Annihilation Support", chance: 0.02 },
];
const MAVEN_EXTRA = [
  { item: "Orb of Conflict", chance: 0.35 },
  { item: "Invert the Rules Support", chance: 0.10 },
];
const ELDRITCH_ORBS = [
  { item: "Eldritch Orb of Annulment", chance: 0.05 },
  { item: "Eldritch Chaos Orb", chance: 0.05 },
  { item: "Eldritch Exalted Orb", chance: 0.05 },
];

export const BOSSES = [
  /* ================= Pinnacle ================= */
  {
    id: "shaper", name: "The Shaper", group: "Pinnacle", rates: "ledger",
    entry: [
      { item: "Fragment of the Hydra" }, { item: "Fragment of the Phoenix" },
      { item: "Fragment of the Chimera" }, { item: "Fragment of the Minotaur" },
    ],
    ttk: 240, overhead: 0,
    groups: [
      pool([
        { item: "Shaper's Touch", share: 0.55 },
        { item: "Voidwalker", share: 0.32 },
        { item: "Solstice Vigil", share: 0.11 },
        { item: "Dying Sun", share: 0.02 },
      ]),
      SHAPER_FRAGS,
      extra(SHAPER_EXTRA),
    ],
  },
  {
    id: "uber-shaper", name: "Uber Shaper", group: "Pinnacle", uber: true, rates: "ledger",
    entry: [{ item: "Cosmic Fragment", qty: 4 }],
    ttk: 300, overhead: 0,
    groups: [
      pool([
        { item: "Echoes of Creation", share: 0.40 },
        { item: "Entropic Devastation", share: 0.36 },
        { item: "The Tides of Time", share: 0.22 },
        { item: "Starforge", share: 0.02 },
      ]),
      SHAPER_FRAGS,
      extra([
        { item: "Sublime Vision", label: "Unid Sublime Vision", chance: 0.02 },
        { item: "Cosmic Reliquary Key", chance: 0.01 },
        ...SHAPER_EXTRA,
      ]),
    ],
  },
  {
    id: "elder", name: "The Elder", group: "Pinnacle", rates: "ledger",
    entry: [
      { item: "Fragment of Purification" }, { item: "Fragment of Constriction" },
      { item: "Fragment of Enslavement" }, { item: "Fragment of Eradication" },
    ],
    ttk: 110, overhead: 0,
    groups: [
      pool([
        { item: "Cyclopean Coil", share: 0.30 },
        { item: "Blasphemer's Grasp", share: 0.30 },
        { item: "Nebuloch", share: 0.10 },
        { item: "Hopeshredder", share: 0.10 },
        { item: "Shimmeron", share: 0.10 },
        { item: "Impresence", share: 0.10 },
      ]),
      guaranteed([
        { item: "Fragment of Terror", share: 0.5 },
        { item: "Fragment of Emptiness", share: 0.5 },
      ]),
      extra([
        { item: "Watcher's Eye", label: "Unid Watcher's Eye (2-mod)", chance: 0.40 },
        { item: "Elder's Exalted Orb", chance: 0.10 },
        { item: "Orb of Dominance", chance: 0.02 },
        { item: "Eldritch Blasphemy Support", chance: 0.02 },
        { item: "Void of the Elements", chance: 0.01 },
      ]),
    ],
  },
  {
    id: "uber-elder", name: "Uber Elder", group: "Pinnacle", rates: "ledger",
    entry: [
      { item: "Fragment of Knowledge" }, { item: "Fragment of Shape" },
      { item: "Fragment of Terror" }, { item: "Fragment of Emptiness" },
    ],
    ttk: 180, overhead: 0,
    groups: [
      pool([
        { item: "Mark of the Shaper", share: 0.35 },
        { item: "Mark of the Elder", share: 0.35 },
        { item: "Voidfletcher", share: 0.15 },
        { item: "Indigon", share: 0.12 },
        { item: "Disintegrator", share: 0.03 },
      ]),
      extra([
        { item: "Watcher's Eye", label: "Unid Watcher's Eye (3-mod)", chance: 0.30 },
        { item: "Shaper's Exalted Orb", chance: 0.15 },
        { item: "Elder's Exalted Orb", chance: 0.10 },
        { item: "Void Shockwave", chance: 0.10 },
        { item: "Orb of Dominance", chance: 0.05 },
        { item: "Void of the Elements", chance: 0.01 },
        { item: "Auspicious Ambitions", chance: 0.01 },
      ]),
    ],
  },
  {
    id: "uber-uber-elder", name: "Uber Uber Elder", group: "Pinnacle", uber: true, rates: "ledger",
    entry: [{ item: "Decaying Fragment", qty: 4 }],
    ttk: 240, overhead: 0,
    groups: [
      pool([
        { item: "Call of the Void", share: 0.40 },
        { item: "The Devourer of Minds", share: 0.30 },
        { item: "Soul Ascension", share: 0.10 },
        { item: "Impresence", share: 0.10 },
        { item: "The Eternity Shroud", share: 0.06 },
        { item: "Voidforge", share: 0.04 },
      ]),
      extra([
        { item: "Watcher's Eye", label: "Unid Watcher's Eye (3-mod)", chance: 0.30 },
        { item: "Shaper's Exalted Orb", chance: 0.20 },
        { item: "Elder's Exalted Orb", chance: 0.15 },
        { item: "Void Shockwave", chance: 0.10 },
        { item: "Orb of Dominance", chance: 0.08 },
        { item: "Curio of Decay", chance: 0.05 },
        { item: "Sublime Vision", label: "Unid Sublime Vision", chance: 0.02 },
        { item: "Decaying Reliquary Key", chance: 0.015 },
        { item: "Void of the Elements", chance: 0.01 },
        { item: "Auspicious Ambitions", chance: 0.01 },
      ]),
    ],
  },
  {
    id: "sirus", name: "Sirus, Awakener of Worlds", group: "Pinnacle", rates: "ledger",
    entry: [
      { item: "Al-Hezmin's Crest" }, { item: "Baran's Crest" },
      { item: "Drox's Crest" }, { item: "Veritania's Crest" },
    ],
    ttk: 210, overhead: 0,
    groups: [
      pool([
        { item: "Hands of the High Templar", share: 0.40 },
        { item: "Crown of the Inward Eye", share: 0.35 },
        { item: "The Burden of Truth", share: 0.20 },
        { item: "Thread of Hope", label: "Unid Thread of Hope", share: 0.05 },
      ]),
      extra(SIRUS_EXTRA),
    ],
  },
  {
    id: "uber-sirus", name: "Uber Sirus", group: "Pinnacle", uber: true, rates: "ledger",
    entry: [{ item: "Awakening Fragment", qty: 4 }],
    ttk: 270, overhead: 0,
    groups: [
      pool([
        { item: "Thread of Hope", label: "Unid Thread of Hope (Massive)", share: 0.55 },
        { item: "The Tempest Rising", share: 0.37 },
        { item: "Oriath's End", share: 0.075 },
        { item: "The Saviour", share: 0.005 },
      ]),
      extra([{ item: "Oubliette Reliquary Key", chance: 0.015 }, ...SIRUS_EXTRA]),
    ],
  },
  {
    id: "maven", name: "The Maven", group: "Pinnacle", rates: "ledger",
    entry: [{ item: "The Maven's Writ" }],
    ttk: 240, overhead: 0,
    groups: [
      pool([
        { item: "Legacy of Fury", share: 0.44 },
        { item: "Graven's Secret", share: 0.16 },
        { item: "Arn's Anguish", share: 0.16 },
        { item: "Olesya's Delight", share: 0.16 },
        { item: "Doppelgänger Guise", share: 0.07 },
        { item: "Echoforge", share: 0.01 },
      ]),
      extra(MAVEN_EXTRA),
    ],
  },
  {
    id: "uber-maven", name: "Uber Maven", group: "Pinnacle", uber: true, rates: "ledger",
    entry: [{ item: "Reality Fragment", qty: 4 }],
    ttk: 300, overhead: 0,
    groups: [
      pool([
        { item: "Viridi's Veil", share: 0.52 },
        { item: "Impossible Escape", label: "Unid Impossible Escape", share: 0.33 },
        { item: "Grace of the Goddess", share: 0.13 },
        { item: "Progenesis", share: 0.02 },
      ]),
      {
        id: "gems", kind: "weighted", label: "Awakened gems", base: 0.02,
        drops: [
          { item: "Awakened Empower Support", weight: 1 },
          { item: "Awakened Enhance Support", weight: 1 },
          { item: "Awakened Enlighten Support", weight: 1 },
        ],
      },
      extra([
        { item: "Orb of Conflict", chance: 0.30 },
        { item: "Invert the Rules Support", chance: 0.10 },
        { item: "Curio of Potential", chance: 0.05 },
        { item: "Eclipse Support", chance: 0.02 },
        { item: "Shiny Reliquary Key", chance: 0.015 },
      ]),
    ],
  },

  /* ================= Eldritch ================= */
  {
    id: "exarch", name: "The Searing Exarch", group: "Eldritch", rates: "ledger",
    entry: [{ item: "Incandescent Invitation" }],
    ttk: 90, overhead: 0, quantity: 70,
    groups: [
      pool([
        { item: "Dawnbreaker", share: 0.63 },
        { item: "Dawnstrider", share: 0.35 },
        { item: "Dissolution of the Flesh", share: 0.02 },
      ]),
      extra([
        { item: "Forbidden Flame", label: "Unid Forbidden Flame (ilvl 86-)", chance: 0.05 },
        { item: "Exceptional Eldritch Ember", chance: 0.15 },
        ...ELDRITCH_ORBS,
        { item: "Overheat Support", chance: 0.05 },
      ], true),
    ],
  },
  {
    id: "uber-exarch", name: "Uber Searing Exarch", group: "Eldritch", uber: true, rates: "ledger",
    entry: [{ item: "Blazing Fragment", qty: 4 }],
    ttk: 180, overhead: 0,
    groups: [
      pool([
        { item: "The Annihilating Light", share: 0.455 },
        { item: "Annihilation's Approach", share: 0.29 },
        { item: "Crystallised Omniscience", share: 0.24 },
        { item: "The Celestial Brace", share: 0.015 },
      ]),
      extra([
        { item: "Forbidden Flame", label: "Unid Forbidden Flame (ilvl 87+)", chance: 0.05 },
        { item: "Exceptional Eldritch Ember", chance: 0.15 },
        ...ELDRITCH_ORBS,
        { item: "Curio of Absorption", chance: 0.05 },
        { item: "Archive Reliquary Key", chance: 0.015 },
      ]),
    ],
  },
  {
    id: "eater", name: "The Eater of Worlds", group: "Eldritch", rates: "ledger",
    entry: [{ item: "Screaming Invitation" }],
    ttk: 45, overhead: 0, quantity: 70,
    groups: [
      pool([
        { item: "Inextricable Fate", share: 0.55 },
        { item: "The Gluttonous Tide", share: 0.43 },
        { item: "Melding of the Flesh", share: 0.02 },
      ]),
      extra([
        { item: "Forbidden Flesh", label: "Unid Forbidden Flesh (ilvl 86-)", chance: 0.05 },
        { item: "Exceptional Eldritch Ichor", chance: 0.15 },
        ...ELDRITCH_ORBS,
        { item: "Gluttony Support", chance: 0.02 },
      ], true),
    ],
  },
  {
    id: "uber-eater", name: "Uber Eater of Worlds", group: "Eldritch", uber: true, rates: "ledger",
    entry: [{ item: "Devouring Fragment", qty: 4 }],
    ttk: 150, overhead: 0,
    groups: [
      pool([
        { item: "Ravenous Passion", share: 0.68 },
        { item: "Ashes of the Stars", share: 0.30 },
        { item: "Nimis", share: 0.02 },
      ]),
      extra([
        { item: "Forbidden Flesh", label: "Unid Forbidden Flesh (ilvl 87+)", chance: 0.05 },
        { item: "Exceptional Eldritch Ichor", chance: 0.15 },
        ...ELDRITCH_ORBS,
        { item: "Curio of Consumption", chance: 0.05 },
        { item: "Visceral Reliquary Key", chance: 0.01 },
        { item: "Gluttony Support", chance: 0.02 },
      ]),
    ],
  },
  {
    id: "black-star", name: "The Black Star", group: "Eldritch", rates: "ledger",
    entry: [{ item: "Polaric Invitation" }],
    ttk: 30, overhead: 0, quantity: 50,
    groups: [
      extra([
        { item: "Grand Eldritch Ember", chance: 0.12 },
        { item: "Greater Eldritch Ember", chance: 0.12 },
        { item: "The Eternal Struggle", chance: 0.05 },
        ...ELDRITCH_ORBS,
        { item: "Polaric Devastation", chance: 0.03 },
        { item: "Sudden Dawn", chance: 0.03 },
      ], true),
    ],
  },
  {
    id: "infinite-hunger", name: "The Infinite Hunger", group: "Eldritch", rates: "ledger",
    entry: [{ item: "Writhing Invitation" }],
    ttk: 30, overhead: 0, quantity: 50,
    groups: [
      extra([
        { item: "Grand Eldritch Ichor", chance: 0.12 },
        { item: "Greater Eldritch Ichor", chance: 0.12 },
        { item: "The Eternal Struggle", chance: 0.05 },
        ...ELDRITCH_ORBS,
        { item: "Ceaseless Feast", chance: 0.03 },
        { item: "Black Zenith", chance: 0.03 },
        { item: "Choking Guilt", chance: 0.005 },
      ], true),
    ],
  },

  /* ================= Incarnation ================= */
  {
    id: "incarnation-neglect", name: "Incarnation of Neglect", group: "Incarnation", rates: "ledger",
    entry: [{ item: "Echo of Loneliness" }],
    ttk: 60, overhead: 0,
    groups: [
      pool([
        { item: "Betrayal's Sting", share: 0.50 },
        { item: "The Arkhon's Tools", share: 0.38 },
        { item: "Venarius' Astrolabe", share: 0.10 },
        { item: "Legacy of the Rose", share: 0.02 },
      ]),
      ASTROLABES,
      extra([
        { item: "Orb of Remembrance", chance: 0.33 },
        { item: "Bound by Destiny", label: "Unid Bound by Destiny", chance: 0.10 },
        { item: "Frostmage Support", chance: 0.05 },
        { item: "Monochrome", chance: 0.03 },
      ]),
    ],
  },
  {
    id: "uber-incarnation-neglect", name: "Uber Incarnation of Neglect", group: "Incarnation", uber: true, rates: "ledger",
    entry: [{ item: "Lonely Fragment", qty: 4 }],
    ttk: 120, overhead: 0,
    groups: [
      pool([
        { item: "Refuge in Isolation", share: 0.55 },
        { item: "Bitter Instinct", share: 0.30 },
        { item: "Haunting Memories", share: 0.13 },
        { item: "Festering Resentment", share: 0.02 },
      ]),
      ASTROLABES,
      extra([
        { item: "Orb of Remembrance", chance: 0.33 },
        { item: "Bound by Destiny", label: "Unid Bound by Destiny", chance: 0.10 },
        { item: "Frostmage Support", chance: 0.05 },
        { item: "Monochrome", chance: 0.03 },
        { item: "Lonely Reliquary Key", chance: 0.01 },
      ]),
    ],
  },
  {
    id: "incarnation-dread", name: "Incarnation of Dread", group: "Incarnation", rates: "ledger",
    entry: [{ item: "Echo of Reverence" }],
    ttk: 200, overhead: 0,
    groups: [
      pool([
        { item: "Bonemeld", share: 0.55 },
        { item: "The Dark Monarch", share: 0.35 },
        { item: "Seven Teachings", share: 0.08 },
        { item: "Wine of the Prophet", share: 0.02 },
      ]),
      ASTROLABES,
      extra([
        { item: "Orb of Unravelling", chance: 0.33 },
        { item: "Bound by Destiny", label: "Unid Bound by Destiny", chance: 0.10 },
        { item: "Congregation Support", chance: 0.02 },
      ]),
    ],
  },
  {
    id: "uber-incarnation-dread", name: "Uber Incarnation of Dread", group: "Incarnation", uber: true, rates: "ledger",
    entry: [{ item: "Reverent Fragment", qty: 4 }],
    ttk: 270, overhead: 0,
    groups: [
      pool([
        { item: "The Hallowed Monarch", share: 0.54 },
        { item: "Whispers of Infinity", share: 0.30 },
        { item: "Wellwater Phylactery", share: 0.14 },
        { item: "The Golden Charlatan", share: 0.02 },
      ]),
      ASTROLABES,
      extra([
        { item: "Orb of Unravelling", chance: 0.33 },
        { item: "Bound by Destiny", label: "Unid Bound by Destiny", chance: 0.10 },
        { item: "Congregation Support", chance: 0.02 },
        { item: "Reverent Reliquary Key", chance: 0.01 },
      ]),
    ],
  },
  {
    id: "incarnation-fear", name: "Incarnation of Fear", group: "Incarnation", rates: "ledger",
    entry: [{ item: "Echo of Trauma" }],
    ttk: 60, overhead: 0,
    groups: [
      pool([
        { item: "Servant of Decay", share: 0.50 },
        { item: "The Unseen Hue", share: 0.40 },
        { item: "Enmity's Embrace", share: 0.08 },
        { item: "Starcaller", share: 0.02 },
      ]),
      ASTROLABES,
      extra([
        { item: "Orb of Intention", chance: 0.50 },
        { item: "Bound by Destiny", label: "Unid Bound by Destiny", chance: 0.10 },
        { item: "Greater Devour Support", chance: 0.05 },
      ]),
    ],
  },
  {
    id: "uber-incarnation-fear", name: "Uber Incarnation of Fear", group: "Incarnation", uber: true, rates: "ledger",
    entry: [{ item: "Traumatic Fragment", qty: 4 }],
    ttk: 120, overhead: 0,
    groups: [
      pool([
        { item: "The Caged Mammoth", share: 0.60 },
        { item: "Coiling Whisper", share: 0.32 },
        { item: "Wing of the Wyvern", share: 0.04 },
        { item: "Woespike", share: 0.03 },
      ]),
      ASTROLABES,
      extra([
        { item: "Orb of Intention", chance: 0.50 },
        { item: "Bound by Destiny", label: "Unid Bound by Destiny", chance: 0.10 },
        { item: "Greater Devour Support", chance: 0.06 },
        { item: "Traumatic Reliquary Key", chance: 0.01 },
      ]),
    ],
  },

  /* ================= Vaal ================= */
  {
    id: "atziri", name: "Atziri, Queen of the Vaal", group: "Vaal", rates: "wiki",
    entry: [
      { item: "Sacrifice at Dusk" }, { item: "Sacrifice at Noon" },
      { item: "Sacrifice at Midnight" }, { item: "Sacrifice at Dawn" },
    ],
    ttk: 90, overhead: 120,
    note: "Not in the ledger drop tables — rates are poewiki crowdsourced 3.28, n=424.",
    groups: [
      pool([
        { item: "Atziri's Promise", share: 0.48 },
        { item: "Triumvirate Authority", share: 0.18 },
        { item: "Atziri's Step", share: 0.15 },
        { item: "Doryani's Invitation", share: 0.15 },
        { item: "Doryani's Catalyst", share: 0.03 },
        { item: "Pledge of Hands", share: 0.005 },
      ]),
      extra([
        { item: "Mortal Grief", chance: 0.18 },
        { item: "Mortal Rage", chance: 0.08 },
        { item: "Mortal Hope", chance: 0.06 },
        { item: "Mortal Ignorance", chance: 0.03 },
      ]),
    ],
  },
  {
    id: "uber-atziri", name: "Uber Atziri", group: "Vaal", uber: true, rates: "ledger",
    entry: [
      { item: "Mortal Grief" }, { item: "Mortal Ignorance" },
      { item: "Mortal Rage" }, { item: "Mortal Hope" },
    ],
    ttk: 150, overhead: 0,
    groups: [
      pool([
        { item: "The Vertex", share: 0.42 },
        { item: "Atziri's Splendour", share: 0.39 },
        { item: "Triumvirate Authority", share: 0.06 },
        { item: "Atziri's Acuity", share: 0.06 },
        { item: "Atziri's Reflection", share: 0.03 },
        { item: "Atziri's Rule", share: 0.03 },
        { item: "Atziri's Disfavour", share: 0.01 },
      ]),
      extra([
        { item: "Beauty", chance: 0.125 },
        { item: "Vaal Sacrifice Support", chance: 0.10 },
        { item: "Greater Spell Echo Support", chance: 0.05 },
      ]),
    ],
  },

  /* ================= Breach ================= */
  {
    id: "esh-tul", name: "Esh-Tul", group: "Breach", rates: "ledger",
    entry: [{ item: "Hivebrain Gland" }],
    ttk: 180, overhead: 0,
    groups: [
      pool([
        { item: "Hand of the Lords", share: 0.30 },
        { item: "The Will of Xoph", share: 0.17 },
        { item: "The Will of Tul", share: 0.17 },
        { item: "The Will of Esh", share: 0.17 },
        { item: "The Will of Uul-Netol", share: 0.10 },
        { item: "The Grey Wind", share: 0.05 },
        { item: "The Sundered Will", share: 0.03 },
        { item: "Uul-Netol's Vow", share: 0.01 },
      ]),
      extra([
        { item: "Flesh of Xesht", chance: 0.20 },
        { item: "Something Dark", chance: 0.10 },
        { item: "Foulgrasp", chance: 0.10 },
        { item: "The Escape", chance: 0.06 },
        { item: "Summon Hiveborn", chance: 0.05 },
      ]),
    ],
  },
  {
    id: "chayula", name: "Chayula, Who Dreamt", group: "Breach", rates: "wiki",
    entry: [{ item: "Chayula's Breachstone" }],
    ttk: 40, overhead: 60,
    note: "Not in the ledger drop tables — rates are poewiki crowdsourced 3.25, n=200.",
    groups: [
      extra([
        { item: "Severed in Sleep", chance: 0.35 },
        { item: "Blessing of Chayula", chance: 0.10 },
        { item: "Skin of the Loyal", chance: 0.05 },
        { item: "The Red Dream", chance: 0.05 },
        { item: "The Green Dream", chance: 0.05 },
        { item: "The Blue Dream", chance: 0.05 },
        { item: "The Escape", chance: 0.05 },
        { item: "Something Dark", chance: 0.05 },
        { item: "The Undisputed", chance: 0.05 },
      ]),
    ],
  },
  {
    id: "chayula-flawless", name: "Chayula (Flawless)", group: "Breach", rates: "wiki",
    entry: [{ item: "Chayula's Flawless Breachstone" }],
    ttk: 70, overhead: 60,
    note: "Not in the ledger drop tables — poewiki crowdsourced 3.25, n=562. Presence of Chayula's rate is printed as \"?\", so it sits at 0 for you to fill in.",
    groups: [
      extra([
        { item: "United in Dream", chance: 0.33 },
        { item: "Grasping Mail", chance: 0.13 },
        { item: "Vaal Breach", chance: 0.085 },
        { item: "Skin of the Lords", chance: 0.04 },
        { item: "The Red Nightmare", chance: 0.04 },
        { item: "The Blue Nightmare", chance: 0.04 },
        { item: "The Green Nightmare", chance: 0.04 },
        { item: "Uul-Netol's Vow", chance: 0.02 },
        { item: "Presence of Chayula", chance: 0 },
      ]),
    ],
  },

  /* ================= Synthesis ================= */
  {
    id: "cortex", name: "Venarius (Cortex)", group: "Synthesis", rates: "ledger",
    entry: [{ item: "Cortex" }],
    ttk: 150, overhead: 0,
    groups: [
      pool([
        { item: "Offering to the Serpent", share: 0.45 },
        { item: "Perepiteia", share: 0.35 },
        { item: "Garb of the Ephemeral", share: 0.15 },
        { item: "Bottled Faith", share: 0.05 },
      ]),
      extra([{ item: "Greater Kinetic Instability Support", chance: 0.02 }]),
    ],
  },
  {
    id: "uber-cortex", name: "Uber Venarius", group: "Synthesis", uber: true, rates: "ledger",
    entry: [{ item: "Synthesising Fragment", qty: 4 }],
    ttk: 210, overhead: 0,
    groups: [
      pool([
        { item: "Nebulis", share: 0.40 },
        { item: "Mask of the Tribunal", share: 0.30 },
        { item: "The Apostate", share: 0.15 },
        { item: "Circle of Ambition", share: 0.10 },
        { item: "Rational Doctrine", share: 0.05 },
      ]),
      extra([
        { item: "Forgotten Reliquary Key", chance: 0.015 },
        { item: "Greater Kinetic Instability Support", chance: 0.02 },
      ]),
    ],
  },

  /* ================= Harvest ================= */
  {
    id: "oshabi", name: "Oshabi, Avatar of the Grove", group: "Harvest", rates: "ledger",
    entry: [{ item: "Sacred Blossom" }],
    ttk: 60, overhead: 0,
    groups: [
      pool([
        { item: "Forbidden Shako", label: "Unid Forbidden Shako", share: 0.52 },
        { item: "Law of the Wilds", share: 0.20 },
        { item: "Witchhunter's Judgment", share: 0.16 },
        { item: "Abhorrent Interrogation", share: 0.12 },
      ]),
      extra([
        { item: "Sacred Crystallised Lifeforce", chance: 1.00 },
        { item: "Pacifism Support", chance: 0.12 },
        { item: "The Aspirant", chance: 0.10 },
        { item: "Greater Unleash Support", chance: 0.04 },
      ]),
    ],
  },

  /* ================= Delve ================= */
  {
    id: "aul", name: "Aul, the Crystal King", group: "Delve", rates: "wiki",
    entry: [],
    ttk: 60, overhead: 900,
    note: "Not in the ledger drop tables — poewiki crowdsourced 3.25, n=100. No fragment cost; the overhead is the sulphite and delving to depth 130+.",
    groups: [
      pool([
        { item: "Aul's Uprising", share: 0.61 },
        { item: "Crown of the Tyrant", share: 0.15 },
        { item: "Ahkeli's Meadow", share: 0.08 },
        { item: "Uzaza's Valley", share: 0.08 },
        { item: "Putembo's Mountain", share: 0.08 },
      ]),
      extra([{ item: "Luminous Trove", chance: 0.16 }]),
    ],
  },

  /* ================= Other ================= */
  {
    id: "catarina", name: "Catarina, Master of Undeath", group: "Other", rates: "ledger",
    entry: [{ item: "Syndicate Medallion" }],
    ttk: 120, overhead: 0,
    groups: [
      pool([
        { key: "spinehail", item: "Spinehail", label: "Veiled Spinehail", share: 0.20 },
        { key: "diadem", item: "The Devouring Diadem", label: "Veiled Devouring Diadem", share: 0.16 },
        { key: "urn-life", item: "Cinderswallow Urn", label: "Veiled Cinderswallow Urn (Life)", share: 0.10 },
        { key: "urn-es", item: "Cinderswallow Urn", label: "Veiled Cinderswallow Urn (ES)", share: 0.10 },
        { key: "urn-mana", item: "Cinderswallow Urn", label: "Veiled Cinderswallow Urn (Mana)", share: 0.10 },
        { key: "bitterbind", item: "Bitterbind Point", label: "Veiled Bitterbind Point", share: 0.10 },
        { key: "kulemak-1p2s", item: "Cane of Kulemak", label: "Veiled Cane of Kulemak (1P2S)", share: 0.07 },
        { key: "kulemak-2p1s", item: "Cane of Kulemak", label: "Veiled Cane of Kulemak (2P1S)", share: 0.07 },
        { key: "hunger", item: "The Queen's Hunger", label: "Veiled Queen's Hunger", share: 0.06 },
        { key: "kulemak-4mod", item: "Cane of Kulemak", label: "Veiled Cane of Kulemak (4 mod)", share: 0.04 },
      ]),
      extra([
        { item: "Allflame Ember of Resplendence", chance: 0.60 },
        { item: "Allflame Ember of Kulemak", chance: 0.30 },
        { item: "Allflame Ember of Propagation", chance: 0.30 },
        { item: "Veiled Exalted Orb", chance: 0.25 },
        { item: "Communion Support", chance: 0.08 },
        { item: "Nook's Crown", chance: 0.005 },
      ]),
    ],
  },
  {
    id: "king-in-the-mists", name: "King in the Mists", group: "Other", rates: "ledger",
    entry: [{ item: "An Audience with the King" }],
    ttk: 45, overhead: 0,
    groups: [
      pool([
        { item: "The Untouched Soul", share: 0.40 },
        { item: "Pragmatism", share: 0.35 },
        { item: "The Light of Meaning", label: "Unid The Light of Meaning", share: 0.20 },
        { item: "The Burden of Shadows", share: 0.05 },
      ]),
      extra([
        { item: "Bursting Toad", chance: 0.10 },
        { item: "Hexpass Support", chance: 0.10 },
      ]),
    ],
  },
  {
    id: "saresh", name: "Saresh", group: "Other", rates: "ledger",
    entry: [{ item: "The Black Barya" }],
    ttk: 60, overhead: 0,
    groups: [
      pool([
        { item: "Screams of the Desiccated", label: "Unid Screams of the Desiccated", share: 0.55 },
        { item: "The Broken Elegy", share: 0.40 },
        { item: "The Sands of Time", share: 0.05 },
      ]),
      extra([
        { item: "Mirage Map", chance: 1.00 },
        { item: "Transfusion Support", chance: 0.10 },
      ]),
    ],
  },
  {
    id: "trialmaster", name: "The Trialmaster", group: "Other", rates: "wiki",
    entry: [{ item: "Ultimatum Scarab of Dueling" }],
    ttk: 120, overhead: 180,
    note: "Not in the ledger drop tables — poewiki crowdsourced 3.24–3.26, n=300. The shares are of the one unique he drops on defeat; he only appears in ~8% of maps unaided, which the scarab fixes.",
    groups: [
      pool([
        { item: "Ixchel's Temptation", share: 0.40 },
        { item: "Glimpse of Chaos", share: 0.40 },
        { item: "Yaomac's Accord", share: 0.095 },
        { item: "Mahuxotl's Machination", share: 0.095 },
        { item: "Hateforge", share: 0.01 },
      ]),
      extra([
        { item: "Machinations Support", chance: 0.10 },
        { item: "Vaal Temptation Support", chance: 0.05 },
      ]),
    ],
  },
  {
    id: "lycia", name: "Lycia, Herald of the Scourge", group: "Other", rates: "estimate",
    entry: [{ item: "Forbidden Tome" }],
    ttk: 90, overhead: 900,
    note: "Not in the ledger drop tables, and poewiki prints no rates. Her uniques aren't random — each drops when its matching relic is on the altar (Original Sin needs a level 83 Tome, Eternal Damnation 80+, Sandstorm Visage 75+, The Winds of Fate 83). Set the one you run to 1 and the rest to 0.",
    groups: [
      extra([
        { item: "The Balance of Terror", chance: 0.2 },
        { item: "Eternal Damnation", chance: 0.2 },
        { item: "Original Sin", chance: 0.2 },
        { item: "Sandstorm Visage", chance: 0.2 },
        { item: "The Winds of Fate", chance: 0.2 },
      ]),
    ],
  },
  {
    id: "olroth", name: "Olroth, Origin of the Fall", group: "Other", rates: "estimate",
    entry: [],
    ttk: 90, overhead: 420,
    note: "Not in the ledger drop tables and poewiki prints no rates — the even split is a placeholder. Knights of the Sun logbook, area level 81+.",
    groups: [
      pool([
        { item: "Olroth's Resolve", share: 1 / 3 },
        { item: "Cadigan's Crown", share: 1 / 3 },
        { item: "Vorana's March", share: 1 / 3 },
      ]),
    ],
  },
];

export const BOSS_BY_ID = Object.fromEntries(BOSSES.map((b) => [b.id, b]));
