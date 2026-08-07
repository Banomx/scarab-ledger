/* poe.watch as the primary price source.

   The API cannot be reached from CI, so this stubs it and runs the real
   snapshot script end to end, the same way test-fetch-shapes does for
   poe.ninja. What it pins down:

     1. Precedence. poe.watch wins wherever both sources know an item, and
        poe.ninja still fills what poe.watch doesn't carry. Getting this
        backwards would be invisible — every price would still look plausible.
     2. The unit. poe.watch quotes chaos in `mean`, but has no Chaos Orb row
        and reports an Exalted Orb at 1, so the divine rate has to come from
        Divine Orb's own price and NOT from the per-row `divine` field, which
        implies a different rate.
     3. Base variants. A corrupted 21/20 gem and a 6-link are not what drops.
     4. Unidentified items. "Unidentified Cinderswallow Urn" is a distinct,
        far dearer item, and veiled drop lines must find it.
     5. Falling back. If poe.watch is down the run must still produce a
        snapshot rather than an empty one.

   Run: node scripts/test-poewatch.mjs
*/

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OUT_DIR = await mkdtemp(path.join(tmpdir(), "sl-watch-test-"));
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const NOPE = () => new Response("gone", { status: 404 });

/* The two candidate rates, deliberately far apart so a mix-up cannot pass.
   EXCHANGE is what mean/divine recovers on every row; LISTING is what the
   Divine Orb item row claims. Live, these really are ~222 and ~173. */
const EXCHANGE = 222;
const LISTING = 173;
const WATCH = {
  currency: [
    // Thin and lowConfidence, exactly as live — few people list divines for
    // chaos as an item, so this row must not set the rate.
    { id: 1, name: "Divine Orb", mean: LISTING, min: LISTING, max: 179.5, daily: 89, lowConfidence: true, divine: 0.76 },
    { id: 2, name: "Exalted Orb", mean: 1, min: 1, max: 1, daily: 40, lowConfidence: true, divine: 0 },
    { id: 3, name: "Deceptive Astrolabe", mean: 90, min: 88, max: 95, daily: 300, lowConfidence: false, divine: 0.39 },
    { id: 4, name: "Abrasive Catalyst", mean: 7, min: 7, max: 8, daily: 900, lowConfidence: false, divine: 0 },
    // poe.ninja prices this one far lower; poe.watch must win.
    { id: 5, name: "Orb of Intention", mean: 300, min: 290, max: 310, daily: 500, lowConfidence: false, divine: 300 / EXCHANGE },
  ],
  scarab: [
    { id: 10, name: "Horned Scarab of Pandemonium", mean: 95, min: 90, max: 99, daily: 400, lowConfidence: false, divine: 95 / EXCHANGE },
    { id: 11, name: "Divination Scarab of Pilfering", mean: 18, min: 17, max: 20, daily: 250, lowConfidence: false, divine: 0.08 },
  ],
  flask: [
    { id: 20, name: "Cinderswallow Urn", mean: 120, min: 120, max: 120, daily: 6623, lowConfidence: false, divine: 0.54 },
    { id: 21, name: "Unidentified Cinderswallow Urn", mean: 1110, min: 840, max: 1175.75, daily: 992, lowConfidence: false, divine: 1110 / EXCHANGE },
  ],
  gem: [
    { id: 30, name: "Pacifism Support", mean: 1050, min: 1000, max: 1100, daily: 30, lowConfidence: false, gemLevel: 1, gemQuality: 0, gemIsCorrupted: false, divine: 1050 / EXCHANGE },
    { id: 31, name: "Pacifism Support", mean: 626600, min: 626600, max: 626600, daily: 4, lowConfidence: true, gemLevel: 21, gemQuality: 20, gemIsCorrupted: true, divine: 2823 },
  ],
  armour: [
    { id: 40, name: "Shaper's Touch", mean: 12, min: 12, max: 14, daily: 100, lowConfidence: false, linkCount: 0, divine: 0.05 },
    { id: 41, name: "Shaper's Touch", mean: 5100, min: 5100, max: 5100, daily: 3, lowConfidence: true, linkCount: 6, divine: 23 },
  ],
  fossil: [{ id: 50, name: "Hollow Fossil", mean: 13, min: 12, max: 14, daily: 200, lowConfidence: false, divine: 0.06 }],
  resonator: [{ id: 60, name: "Prime Chaotic Resonator", mean: 9.6, min: 9, max: 10, daily: 150, lowConfidence: false, divine: 0.04 }],
};

/* poe.ninja carries one name poe.watch does not, and disagrees on a name it
   does — so both directions of the precedence rule get exercised. */
const CORE = {
  primary: "chaos-orb", secondary: "divine-orb",
  items: [{ id: "chaos-orb", name: "Chaos Orb" }, { id: "divine-orb", name: "Divine Orb" }],
  rates: { "chaos-orb": 1, "divine-orb": LISTING },
};
const NINJA_EXCHANGE = {
  Currency: [["chaos-orb", 1], ["divine-orb", LISTING], ["orb-of-intention", 26.4], ["awakeners-orb", 210],
             ["deceptive-astrolabe", 88], ["abrasive-catalyst", 6]],
  Fragment: [["reverent-fragment", 79]],
  // Deliberately cheaper than poe.watch's figures for the same scarabs: if
  // precedence ever flips, these numbers surface instead.
  Scarab: [["horned-scarab-of-pandemonium", 80], ["divination-scarab-of-pilfering", 15]],
  Astrolabe: [["deceptive-astrolabe", 88]],
  Fossil: [["hollow-fossil", 11]],
  Resonator: [["prime-chaotic-resonator", 8]],
};

let watchDown = process.env.WATCH_DOWN === "1";
const hits = [];

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  hits.push(u.host + u.pathname);

  if (u.host === "api.poe.watch") {
    if (watchDown) return new Response("down", { status: 503 });
    if (u.pathname === "/leagues") return J([{ name: "Allflame", start_date: "2026-07-24T20:00:00Z" }]);
    if (u.pathname === "/get") {
      const cat = u.searchParams.get("category");
      return J(WATCH[cat] || []);
    }
    return NOPE();
  }

  const type = u.searchParams.get("type");
  if (u.pathname.startsWith("/api/data/")) return NOPE();
  if (u.pathname === "/poe1/api/economy/leagues") return J([{ id: "Allflame", name: "Allflame", startAt: "2026-07-24T20:00:00Z" }]);
  if (u.pathname === "/poe1/api/data/index-state") return J({ economyLeagues: [], oldEconomyLeagues: [] });
  if (u.pathname === "/poe1/api/economy/exchange/current/overview") {
    const lines = NINJA_EXCHANGE[type];
    return J({ core: CORE, lines: (lines || []).map(([id, v]) => ({ id, primaryValue: v, sparkline: { data: [1, 2, 3] } })) });
  }
  if (u.pathname === "/poe1/api/economy/stash/current/item/overview") return J({ lines: [] });
  if (u.pathname === "/poe1/api/economy/stash/current/currency/overview") {
    // The exchange knows this one only as the slug "awakeners-orb", which
    // loses the apostrophe; the stash currency list is where the real spelling
    // comes from. Keeping it here exercises the name dictionary as well as the
    // gap-fill, both of which still matter under poe.watch.
    return J({ lines: [{ currencyTypeName: "Awakener's Orb", chaosEquivalent: 999 }] });
  }
  return NOPE();
};

process.env.DATA_OUT = OUT_DIR;
await import("./fetch-data.mjs");

await (async () => {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { await readFile(path.join(OUT_DIR, "index.json"), "utf8"); return; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error("snapshot did not finish within 120s");
    await new Promise((r) => setTimeout(r, 200));
  }
})();

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const near = (a, b, eps = 0.01) => a != null && Math.abs(a - b) <= eps;

const priced = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "prices.json"), "utf8"));
const P = priced.prices;

/* ---- the divine rate ----
   The rate is the currency exchange one, recovered from mean/divine on every
   row. Divine Orb's own item listing is thin and reads ~50c lower; taking it
   would misprice every divine figure on the site by a quarter. */
ok(near(priced.divineRate, EXCHANGE, 1),
   `rate must come from the exchange ratio (${EXCHANGE}), not the Divine Orb listing (${LISTING}): ${priced.divineRate}`);
ok(!near(priced.divineRate, LISTING, 5), "the thin Divine Orb listing must not set the rate");

/* ---- precedence ---- */
ok(near(P["Orb of Intention"]?.c, 300),
   `poe.watch must beat poe.ninja where both know an item: ${P["Orb of Intention"]?.c} (ninja says 26.4)`);
ok(near(P["Awakener's Orb"]?.c, 210),
   `poe.ninja must still fill what poe.watch lacks: ${P["Awakener's Orb"]?.c}`);
ok(P["Awakener's Orb"]?.c !== 999, "stash currency stays gap-fill only and must not outrank the exchange");
ok(near(P["Reverent Fragment"]?.c, 79), `ninja-only fragment survived: ${P["Reverent Fragment"]?.c}`);

/* ---- listing counts ride along, so a thin price can be flagged ---- */
ok(P["Horned Scarab of Pandemonium"]?.daily === 400, `daily listing count kept: ${JSON.stringify(P["Horned Scarab of Pandemonium"])}`);
ok(P["Divine Orb"]?.thin === true, "a low-confidence poe.watch price is marked thin");
ok(P["Abrasive Catalyst"]?.thin === undefined, "a liquid price is not marked thin");

/* ---- base variants ---- */
ok(near(P["Pacifism Support"]?.c, 1050),
   `the level-1 gem is the drop, not the corrupted 21/20: ${P["Pacifism Support"]?.c}`);
ok(near(P["Shaper's Touch"]?.c, 12), `the unlinked item is the drop, not the 6L: ${P["Shaper's Touch"]?.c}`);

/* ---- unidentified ---- */
ok(near(P["Unidentified Cinderswallow Urn"]?.c, 1110), "the unidentified item is in the map at its own price");
ok(near(P["Cinderswallow Urn"]?.c, 120), "and does not overwrite the identified one");
{
  const { makeResolver, isUnidentified } = await import("../src/bossProfit.js");
  const r = makeResolver(P);
  ok(near(r("Cinderswallow Urn", [], null, "Life", isUnidentified({ label: "Veiled Cinderswallow Urn (Life)" })).chaos, 1110),
     "a veiled drop line resolves to the unidentified price");
  ok(near(r("Cinderswallow Urn", [], null, null, false).chaos, 120),
     "a plain line still gets the identified price");
}

/* ---- every tab ---- */
const scarabs = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "scarabs.json"), "utf8"));
ok(near(scarabs.items.find((i) => /Pandemonium/.test(i.name))?.chaosValue, 95),
   `scarab tab must read poe.watch (95), not poe.ninja (80): ${scarabs.items.find((i) => /Pandemonium/.test(i.name))?.chaosValue}`);
ok(near(scarabs.divineRate, EXCHANGE, 1), `scarab tab divine rate: ${scarabs.divineRate}`);
for (const [file, name, value] of [
  ["astrolabes", "Deceptive Astrolabe", 90],
  ["catalysts", "Abrasive Catalyst", 7],
  ["fossils", "Hollow Fossil", 13],
  ["resonators", "Prime Chaotic Resonator", 9.6],
]) {
  const j = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", `${file}.json`), "utf8"));
  ok(near(j.items.find((i) => i.name === name)?.chaosValue, value), `${file} tab reads poe.watch: ${JSON.stringify(j.items[0])}`);
}

/* A category regex must not reach across categories — /catalyst/i and
   /astrolabe/i both run over the currency rows, and only their own rows. */
{
  const cat = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "catalysts.json"), "utf8"));
  ok(!cat.items.some((i) => /Astrolabe|Orb/.test(i.name)), `catalyst tab pulled in neighbours: ${cat.items.map((i) => i.name).join(", ")}`);
}

ok(hits.some((h) => h === "api.poe.watch/leagues"), "poe.watch leagues must be consulted");
ok(hits.filter((h) => h === "api.poe.watch/get").length >= 5, "every mapped category must be fetched");

/* ---- poe.watch down ----
   Re-runs the whole snapshot against a 503ing poe.watch. The point is not that
   it survives but that it degrades to exactly what the site had before: this
   is the difference between "prices look stale" and "the boss tab is empty". */
{
  watchDown = true;
  const DIR2 = await mkdtemp(path.join(tmpdir(), "sl-watch-down-"));
  process.env.DATA_OUT = DIR2;
  const fresh = await import(`./fetch-data.mjs?down=${Date.now()}`);
  void fresh;
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { await readFile(path.join(DIR2, "index.json"), "utf8"); break; } catch { /* not yet */ }
    if (Date.now() > deadline) { ok(false, "fallback run did not finish"); break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    const p2 = JSON.parse(await readFile(path.join(DIR2, "Allflame", "prices.json"), "utf8"));
    ok(near(p2.prices["Orb of Intention"]?.c, 26.4),
       `with poe.watch down the poe.ninja price must take over: ${p2.prices["Orb of Intention"]?.c}`);
    ok(near(p2.divineRate, LISTING, 1), `with poe.watch down the rate falls back to poe.ninja: ${p2.divineRate}`);
    ok(p2.prices["Unidentified Cinderswallow Urn"] === undefined,
       "and poe.watch-only items are simply absent, not zero-priced");
    const s2 = JSON.parse(await readFile(path.join(DIR2, "Allflame", "scarabs.json"), "utf8"));
    ok(s2.items.length > 0, "the scarab tab still has data from poe.ninja alone");
  } catch (e) {
    ok(false, `fallback run produced nothing usable: ${e.message}`);
  }
  await rm(DIR2, { recursive: true, force: true });
}

console.log(`\nprice map: ${Object.keys(P).length} names, divine ${priced.divineRate}c`);
await rm(OUT_DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
