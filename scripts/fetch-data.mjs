/* Snapshots poe.ninja scarab data into public/data/ so the site can run on
   static hosting (GitHub Pages) without a CORS proxy.
   Run: node scripts/fetch-data.mjs

   poe.ninja moved its API (docs: https://poe.ninja/docs/api). This script
   adapts at runtime:
     leagues:  /poe1/api/economy/leagues  (fallback: index-state, legacy)
     prices:   legacy itemoverview        (fallback: new exchange overview)
     history:  legacy itemhistory if alive; otherwise the script accumulates
               its OWN history by reading the previous deployment's data and
               appending today's prices (selfhistory.json).                  */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NINJA = "https://poe.ninja";
const OUT = process.env.DATA_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const HEADERS = { "User-Agent": "scarab-ledger-snapshot/0.2 (github actions; contact via repo issues)" };
const HISTORY_LEAGUES = 2;   // ninja per-scarab history only for the first N leagues (politeness)
const SELF_HISTORY_CAP = 800; // max accumulated self-history points per league
const DELAY_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const todayISO = () => new Date().toISOString().slice(0, 10);

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
async function tryJson(url) { try { return await getJson(url); } catch { return null; } }

function changesFromSparkline(sp) {
  const data = ((sp && sp.data) || []).filter((v) => v != null);
  const last = data.length ? data[data.length - 1] : 0;
  const p24 = data.length > 1 ? data[data.length - 2] : last;
  const p48 = data.length > 2 ? data[data.length - 3] : p24;
  return { change24: last - p24, change48: last - p48 };
}

const median = (arr) => {
  const s = arr.filter((v) => isFinite(v) && v > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/* ---------- leagues ---------- */
async function getLeagues() {
  const current = [];
  const previous = [];
  // Documented: plain array [{id, name}], first = current challenge league
  const a = await tryJson(`${NINJA}/poe1/api/economy/leagues`);
  if (Array.isArray(a) && a.length && a[0].id) {
    console.log("Current leagues via /poe1/api/economy/leagues");
    for (const l of a) current.push({ name: l.name || l.id, params: [l.id, l.name].filter(Boolean), group: "current", start: l.startAt || l.startDate || l.start || null });
  }
  // index-state carries the previous ("old") economy leagues, and doubles as
  // a fallback for the current ones
  const b = await tryJson(`${NINJA}/poe1/api/data/index-state`) || await tryJson(`${NINJA}/api/data/getindexstate`);
  if (b) {
    if (!current.length) {
      for (const l of b.economyLeagues || []) current.push({ name: l.name, params: [l.url, l.name].filter(Boolean), group: "current", start: l.startAt || l.startDate || null });
    }
    for (const l of b.oldEconomyLeagues || []) {
      previous.push({ name: l.name, params: [l.url, l.name].filter(Boolean), group: "previous" });
    }
    if (previous.length) console.log(`Previous leagues via index-state: ${previous.map((l) => l.name).join(", ")}`);
  }
  const seen = new Set();
  const all = [...current, ...previous].filter((l) => (seen.has(l.name) ? false : (seen.add(l.name), true)));
  if (!all.length) throw new Error("Could not fetch league list from any known endpoint");
  return all;
}

/* ---------- extra exchange categories (same features as scarabs) ---------- */
const EXTRA_CATEGORIES = [
  { key: "astrolabes", type: "Astrolabe", re: /astrolabe/i },
  { key: "catalysts", type: "Currency", re: /catalyst/i }, // catalysts live inside Currency
];

async function getExchangeCategory(lgParams, type, nameRe) {
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=${encodeURIComponent(type)}`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      const adapted = adaptExchange(j, nameRe);
      if (adapted.items.length) return adapted;
    }
    await sleep(DELAY_MS);
  }
  return null;
}

/* ---------- prices ---------- */
async function getScarabPrices(lgParams) {
  // 1) legacy itemoverview (kept alive via redirects historically)
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/api/data/itemoverview?league=${encodeURIComponent(p)}&type=Scarab`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      const items = j.lines.filter((l) => l.name).map((l) => ({
        id: l.id, name: l.name,
        chaosValue: l.chaosValue ?? 0,
        divineValue: l.divineValue ?? 0,
        ...changesFromSparkline(l.sparkline || l.sparkLine),
      }));
      if (items.length) {
        console.log(`  prices via legacy itemoverview (league=${p}, ${items.length} items)`);
        return { items, source: "legacy", leagueParam: p };
      }
      console.log(`  legacy itemoverview answered for ${p} but yielded 0 usable items`);
    }
    await sleep(DELAY_MS);
  }
  // 2) documented new home: exchange overview (different shape)
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=Scarab`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      const adapted = adaptExchange(j);
      if (adapted.items.length) {
        console.log(`  prices via exchange overview (league=${p}, ${adapted.items.length} items)`);
        return { ...adapted, source: "exchange", leagueParam: p };
      }
      // Nothing matched — dump structure so the workflow log shows what came back
      console.log(`  exchange overview answered for ${p} but 0 items matched. Diagnostics:`);
      console.log(`    lines: ${j.lines.length}, core.items: ${(j.core?.items || []).length}, primary: ${j.core?.primary}, secondary: ${j.core?.secondary}`);
      console.log(`    sample line: ${JSON.stringify(j.lines[0]).slice(0, 400)}`);
      console.log(`    sample core.items[0]: ${JSON.stringify((j.core?.items || [])[0]).slice(0, 400)}`);
    }
    await sleep(DELAY_MS);
  }
  return null;
}

const SMALL_WORDS = new Set(["of", "the", "a", "and", "in"]);
function slugToName(slug) {
  if (!slug || typeof slug !== "string") return null;
  return slug.split("-").map((w, i) =>
    (i > 0 && SMALL_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(" ");
}

function adaptExchange(j, nameRe = /scarab/i) {
  const core = j.core || {};
  const coreItems = core.items || [];
  const itemsById = {};
  for (const it of coreItems) {
    if (it.id != null) itemsById[it.id] = it;
    if (it.itemId != null) itemsById[it.itemId] = it;
  }
  const findId = (needle) => {
    for (const it of coreItems) if ((it.name || "").toLowerCase() === needle) return it.id ?? it.itemId;
    return null;
  };
  const chaosId = findId("chaos orb");
  const divineId = findId("divine orb");
  const rates = core.rates || {};

  // rates[x] = units of x per 1 primary. When chaos itself is the primary
  // (observed for PoE1 scarabs), primaryValue is already the chaos price.
  const rChaos = core.primary === chaosId ? (rates[chaosId] ?? 1) : rates[chaosId];

  const raw = j.lines
    .map((l) => {
      const meta = itemsById[l.id] || itemsById[l.itemId] || null;
      // core.items only carries the reference currencies; scarab names live
      // in the line id as a slug (e.g. "divination-scarab-of-pilfering").
      const name = (meta && meta.name) || l.name || slugToName(l.id ?? l.itemId);
      return { line: l, name };
    })
    .filter((x) => x.name && nameRe.test(x.name));
  if (!raw.length) return { items: [] };

  const convert = (mult) => raw.map(({ line }) => Math.max(0, (line.primaryValue ?? 0) * mult));
  let chaosVals;
  if (!rChaos || rChaos === 1) {
    chaosVals = convert(1);
  } else {
    const a = convert(rChaos);
    const b = convert(1 / rChaos);
    chaosVals = (median(a) >= 0.05 && median(a) <= 50000) ? a : b; // sanity net
  }

  // Divine rate in chaos, sanity-checked in both directions
  let divineRate = null;
  if (rChaos != null && rates[divineId] != null && rates[divineId] !== 0) {
    for (const c of [rChaos / rates[divineId], rates[divineId] / rChaos]) {
      if (c >= 20 && c <= 20000) { divineRate = c; break; }
    }
  }

  const items = raw.map(({ line, name }, i) => ({
    id: line.id ?? line.itemId ?? name,
    name,
    chaosValue: Math.round((chaosVals[i] ?? 0) * 100) / 100,
    divineValue: divineRate ? (chaosVals[i] ?? 0) / divineRate : 0,
    ...changesFromSparkline(line.sparkline || line.sparkLine),
  }));
  return { items, exchangeDivineRate: divineRate ?? undefined };
}

/* ---------- broad price map (boss profitability) ----------
   One name -> price lookup covering everything a boss can drop or cost.
   Uniques and gems come in variants (links, gem level, corruption); we
   keep the spread and default `c` to the "base" version where one can be
   identified, so a Level 1 Awakened gem isn't priced as a 21/23. */
const PRICE_CURRENCY_TYPES = ["Currency", "Fragment"];
const PRICE_ITEM_TYPES = [
  "UniqueWeapon", "UniqueArmour", "UniqueAccessory", "UniqueFlask", "UniqueJewel",
  "UniqueMap", "UniqueRelic", "DivinationCard", "SkillGem", "Essence", "Artifact",
  "Omen", "Invitation", "Vial", "Beast", "Fossil", "Oil", "Coffin", "Allflame",
  "Tincture", "Incubator", "Memory", "DeliriumOrb", "Scarab",
];

function isBaseVariant(type, l) {
  if (type === "SkillGem") {
    return !l.corrupted && (l.gemLevel ?? 1) <= 1 && (l.gemQuality ?? 0) === 0;
  }
  return !l.variant && !(l.links > 0);
}

/* poe.ninja serves the same data from several endpoint families and has
   been migrating between them. Rather than pick one, try each family per
   type and remember whichever answered first.
     stash/*  — legacy shape at the new paths ({lines:[{name, chaosValue}]})
     api/data — the original paths, still redirected for some types
     exchange — barter categories, {core, lines:[{primaryValue}]} shape */
const ITEM_FAMILIES = [
  (p, t) => `${NINJA}/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(p)}&type=${t}`,
  (p, t) => `${NINJA}/api/data/itemoverview?league=${encodeURIComponent(p)}&type=${t}`,
  (p, t) => `${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=${t}`,
];
const CURRENCY_FAMILIES = [
  (p, t) => `${NINJA}/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(p)}&type=${t}`,
  (p, t) => `${NINJA}/api/data/currencyoverview?league=${encodeURIComponent(p)}&type=${t}`,
  (p, t) => `${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=${t}`,
];

/* Normalise whichever shape came back into {name, chaos, preferred}[]. */
function priceLines(j, type) {
  if (!j) return [];
  const out = [];
  for (const l of j.lines || []) {
    const name = l.name || l.currencyTypeName;
    const chaos = l.chaosValue ?? l.chaosEquivalent;
    if (name && chaos > 0) out.push({ name, chaos, preferred: isBaseVariant(type, l) });
  }
  if (out.length) return out;
  // exchange shape: prices are relative to a primary currency
  if (j.core && Array.isArray(j.lines) && j.lines.length) {
    const a = adaptExchange(j, /.*/);
    return (a.items || [])
      .filter((it) => it.chaosValue > 0)
      .map((it) => ({ name: it.name, chaos: it.chaosValue, preferred: true }));
  }
  return [];
}

async function getPriceMap(lgParams) {
  const acc = {};
  const add = ({ name, chaos, preferred }) => {
    if (!name || !(chaos > 0)) return;
    const e = (acc[name] ||= { all: [], base: [] });
    e.all.push(chaos);
    if (preferred) e.base.push(chaos);
  };

  let usedParam = null;
  const sourceOf = {};
  for (const p of lgParams) {
    const missed = [];
    let best = 0;   // family index that worked last, tried first next time
    for (const [types, families, kind] of [
      [PRICE_CURRENCY_TYPES, CURRENCY_FAMILIES, "currency"],
      [PRICE_ITEM_TYPES, ITEM_FAMILIES, "item"],
    ]) {
      for (const t of types) {
        let got = 0;
        const order = [best, ...families.keys()].filter((v, i, a) => a.indexOf(v) === i);
        for (const fi of order) {
          const lines = priceLines(await tryJson(families[fi](p, t)), t);
          await sleep(DELAY_MS);
          if (lines.length) {
            for (const l of lines) add(l);
            got = lines.length; best = fi;
            sourceOf[t] = `${kind}:${fi}`;
            break;
          }
        }
        if (!got) missed.push(t);
      }
    }
    if (Object.keys(acc).length) {
      usedParam = p;
      if (missed.length) console.log(`    no data for types: ${missed.join(", ")}`);
      break;
    }
    console.log(`    league param "${p}" returned nothing from any endpoint family`);
  }
  if (!usedParam) return null;

  // Lower-middle median: with an even number of listings (very common —
  // a unique with two variants) the shared median() helper would return the
  // dearer one, quietly biasing every EV upward. Cheaper side wins; the UI
  // has a "Best roll" toggle for people who want the other end.
  const midLow = (arr) => {
    const s = arr.filter((v) => isFinite(v) && v > 0).sort((a, b) => a - b);
    return s.length ? s[Math.ceil(s.length / 2) - 1] : 0;
  };
  const prices = {};
  for (const [name, e] of Object.entries(acc)) {
    const pick = e.base.length ? e.base : e.all;
    prices[name] = {
      c: Math.round(midLow(pick) * 100) / 100,
      lo: Math.round(Math.min(...e.all) * 100) / 100,
      hi: Math.round(Math.max(...e.all) * 100) / 100,
      n: e.all.length,
    };
  }
  const fams = [...new Set(Object.values(sourceOf))].join(", ");
  return { prices, leagueParam: usedParam, families: fams };
}

/* ---------- divine rate ---------- */
async function getDivineRate(lgParam, fallback) {
  const urls = [
    `${NINJA}/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(lgParam)}&type=Currency`,
    `${NINJA}/api/data/currencyoverview?league=${encodeURIComponent(lgParam)}&type=Currency`,
  ];
  for (const u of urls) {
    const j = await tryJson(u);
    const div = j && (j.lines || []).find((l) => l.currencyTypeName === "Divine Orb");
    if (div?.chaosEquivalent) return div.chaosEquivalent;
    await sleep(DELAY_MS);
  }
  return fallback ?? 185;
}

/* ---------- ninja per-scarab history (legacy only) ---------- */
async function getNinjaHistory(lgParam, items) {
  const history = {};
  let consecutiveFails = 0;
  for (const it of items) {
    const arr = await tryJson(`${NINJA}/api/data/itemhistory?league=${encodeURIComponent(lgParam)}&type=Scarab&itemId=${it.id}`);
    if (Array.isArray(arr) && arr.length) {
      consecutiveFails = 0;
      const maxAgo = Math.max(...arr.map((p) => p.daysAgo), 0);
      history[it.name] = arr
        .slice().sort((x, y) => y.daysAgo - x.daysAgo)
        .map((p) => ({ day: maxAgo - p.daysAgo, value: p.value }));
    } else if (++consecutiveFails >= 3 && Object.keys(history).length === 0) {
      console.log("  ninja itemhistory appears dead, skipping");
      return {};
    }
    await sleep(DELAY_MS);
  }
  return history;
}

/* ---------- self-accumulated history ---------- */
function pagesBaseUrl() {
  if (process.env.PAGES_BASE_URL) return process.env.PAGES_BASE_URL.replace(/\/$/, "");
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  if (!repo) return null;
  const [owner, name] = repo.split("/");
  return `https://${owner}.github.io/${name}`;
}

function normalizePoint(p) {
  // old format: {date: "YYYY-MM-DD"}; new format: {t: ISO timestamp}
  return { t: p.t || `${p.date}T00:00:00Z`, values: p.values || {} };
}

async function updateSelfHistory(slug, items, prefix = "") {
  const base = pagesBaseUrl();
  const reset = process.env.RESET_HISTORY === "true";
  const prev = (base && !reset) ? await tryJson(`${base}/data/${slug}/${prefix}selfhistory.json`) : null;
  const points = ((prev && Array.isArray(prev.points)) ? prev.points : []).map(normalizePoint);
  const values = {};
  for (const it of items) values[it.name] = Math.round(it.chaosValue * 100) / 100;
  points.push({ t: new Date().toISOString(), values }); // one point per run
  points.sort((a, b) => (a.t < b.t ? -1 : 1));
  while (points.length > SELF_HISTORY_CAP) points.shift();
  return { points };
}

/* Recompute change windows from our own accumulated points when we have data
   old enough; otherwise sparkline-derived values (24h/48h only) stay. The
   15-min tolerance forgives GitHub's cron starting a few minutes late. */
const CHANGE_WINDOWS = [[4, "change4"], [8, "change8"], [12, "change12"], [24, "change24"], [48, "change48"]];
function applySelfChanges(items, self) {
  const pts = (self.points || []).map(normalizePoint);
  if (pts.length < 2) return;
  const now = Date.parse(pts[pts.length - 1].t);
  const refFor = (hours) => {
    const cutoff = now - (hours * 3600e3 - 15 * 60e3);
    let ref = null;
    for (const p of pts) { if (Date.parse(p.t) <= cutoff) ref = p; else break; }
    return ref;
  };
  for (const [hours, key] of CHANGE_WINDOWS) {
    const ref = refFor(hours);
    if (!ref) continue;
    for (const it of items) {
      const v = ref.values[it.name];
      if (v > 0) it[key] = (it.chaosValue / v - 1) * 100;
    }
  }
}

/* Anchor self-history day 0 at league start when we know it and it's sane
   (guards against Standard's 2013 "start" producing day 4700). */
function alignmentBase(self, leagueStart) {
  if (!leagueStart) return null;
  const ms = Date.parse(leagueStart);
  if (!isFinite(ms)) return null;
  const pts = (self.points || []).map(normalizePoint);
  if (!pts.length) return null;
  const diff = Date.parse(pts[0].t) - ms;
  return (diff >= -6 * 3600e3 && diff <= 45 * 86400000) ? ms : null;
}

function selfHistoryToSeries(self, baseMs = null) {
  const out = {};
  const pts = (self.points || []).map(normalizePoint);
  if (!pts.length) return out;
  const t0 = baseMs ?? Date.parse(pts[0].t);
  for (const p of pts) {
    const day = Math.round(((Date.parse(p.t) - t0) / 86400000) * 100) / 100;
    for (const [name, v] of Object.entries(p.values || {})) {
      (out[name] ||= []).push({ day, value: v });
    }
  }
  return out;
}

/* ---------- reuse mode: mirror the currently deployed data ---------- */
const LEAGUE_FILES = [
  "scarabs.json", "history.json", "selfhistory.json", "prices.json",
  "astrolabes.json", "astrolabes-history.json", "astrolabes-selfhistory.json",
  "catalysts.json", "catalysts-history.json", "catalysts-selfhistory.json",
];

async function tryText(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

async function mirrorExisting() {
  const base = pagesBaseUrl();
  if (!base) return false;
  const idxText = await tryText(`${base}/data/index.json`);
  if (!idxText) return false;
  let idx;
  try { idx = JSON.parse(idxText); } catch { return false; }
  if (!idx.leagues || !idx.leagues.length) return false;

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const kept = [];
  for (const l of idx.leagues) {
    const dir = path.join(OUT, l.slug);
    const main = await tryText(`${base}/data/${l.slug}/scarabs.json`);
    if (!main) { console.log(`- ${l.name}: deployed data missing, dropping`); continue; }
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "scarabs.json"), main);
    for (const f of LEAGUE_FILES.slice(1)) {
      const body = await tryText(`${base}/data/${l.slug}/${f}`);
      if (body != null) await writeFile(path.join(dir, f), body);
    }
    kept.push(l);
    console.log(`- ${l.name}: reused deployed data`);
  }
  if (!kept.length) return false;
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({ ...idx, leagues: kept }));
  return true;
}

/* ---------- main ---------- */
async function main() {
  if ((process.env.DATA_MODE || "fetch") === "reuse") {
    if (await mirrorExisting()) {
      console.log("Code-only deploy: reused deployed data, no new snapshot taken.");
      return;
    }
    console.log("Nothing deployed to reuse — falling back to a full fetch.");
  }
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const leagues = await getLeagues();
  console.log("Leagues:", leagues.map((l) => l.name).join(", "));

  const written = [];
  for (const [li, lg] of leagues.entries()) {
    try {
      const priced = await getScarabPrices(lg.params);
      if (!priced || !priced.items.length) { console.log(`- ${lg.name}: no usable scarab data, skipping`); continue; }
      const { items, source, leagueParam, exchangeDivineRate } = priced;

      // Divine rate: when prices come from the exchange overview, derive the
      // rate from that same response (live market, consistent with the scarab
      // prices). The stash/legacy currency endpoints can serve stale values.
      const divineRate = (source === "exchange" && exchangeDivineRate)
        ? exchangeDivineRate
        : await getDivineRate(leagueParam, exchangeDivineRate);
      // divineValue may be missing/zero from some sources — recompute
      for (const it of items) if (!it.divineValue) it.divineValue = it.chaosValue / divineRate;

      const slug = slugify(lg.name);
      let history = {};
      if (source === "legacy" && lg.group === "current" && li < HISTORY_LEAGUES) {
        history = await getNinjaHistory(leagueParam, items);
      }
      // Self-history only makes sense for running leagues; finished leagues
      // have frozen prices, so a flat fake curve would just mislead.
      let self = { points: [] };
      let historySource = Object.keys(history).length ? "ninja" : "none";
      let historyAxis = "league day";
      if (lg.group === "current") {
        self = await updateSelfHistory(slug, items);
        applySelfChanges(items, self);
        if (!Object.keys(history).length) {
          const alignMs = alignmentBase(self, lg.start);
          history = selfHistoryToSeries(self, alignMs);
          if (Object.keys(history).length) {
            historySource = "self";
            historyAxis = alignMs ? "league day" : "days since first snapshot";
          }
        }
      }

      const dir = path.join(OUT, slug);
      await mkdir(dir, { recursive: true });
      const generatedAt = new Date().toISOString();
      await writeFile(path.join(dir, "scarabs.json"), JSON.stringify({ generatedAt, divineRate, historySource, historyAxis, items }));
      await writeFile(path.join(dir, "history.json"), JSON.stringify(history));
      await writeFile(path.join(dir, "selfhistory.json"), JSON.stringify(self));
      // broad price map for the boss profitability tab
      try {
        const pm = await getPriceMap(lg.params);
        if (pm) {
          await writeFile(path.join(dir, "prices.json"), JSON.stringify({ generatedAt, divineRate, prices: pm.prices }));
          console.log(`  prices: ${Object.keys(pm.prices).length} names (league=${pm.leagueParam}, via ${pm.families || "?"})`);
        } else {
          console.log(`  prices: NO DATA for ${lg.name} — every endpoint family came back empty`);
        }
      } catch (e) {
        console.log(`  prices: FAILED (${e.message})`);
      }

      // extra categories: astrolabes + catalysts, same treatment as scarabs
      for (const cat of EXTRA_CATEGORIES) {
        try {
          const r = await getExchangeCategory(lg.params, cat.type, cat.re);
          if (!r || !r.items.length) { console.log(`  ${cat.key}: no data for ${lg.name}`); continue; }
          const rate2 = r.exchangeDivineRate || divineRate;
          for (const it of r.items) if (!it.divineValue) it.divineValue = it.chaosValue / rate2;
          let catHist = {};
          let catSelf = { points: [] };
          let catHistorySource = "none";
          let catHistoryAxis = "days since first snapshot";
          if (lg.group === "current") {
            catSelf = await updateSelfHistory(slug, r.items, `${cat.key}-`);
            applySelfChanges(r.items, catSelf);
            const catAlign = alignmentBase(catSelf, lg.start);
            catHist = selfHistoryToSeries(catSelf, catAlign);
            if (Object.keys(catHist).length) {
              catHistorySource = "self";
              if (catAlign) catHistoryAxis = "league day";
            }
          }
          await writeFile(path.join(dir, `${cat.key}.json`), JSON.stringify({ generatedAt, divineRate: rate2, historySource: catHistorySource, historyAxis: catHistoryAxis, items: r.items }));
          await writeFile(path.join(dir, `${cat.key}-history.json`), JSON.stringify(catHist));
          await writeFile(path.join(dir, `${cat.key}-selfhistory.json`), JSON.stringify(catSelf));
          console.log(`  ${cat.key}: ${r.items.length} items`);
        } catch (e) {
          console.log(`  ${cat.key}: FAILED (${e.message})`);
        }
      }

      written.push({ name: lg.name, slug, group: lg.group || "current" });
      console.log(`- ${lg.name}: ${items.length} scarabs, ${Object.keys(history).length} history series, 1 div = ${Math.round(divineRate)}c`);
    } catch (e) {
      console.log(`- ${lg.name}: FAILED (${e.message})`);
    }
  }

  if (!written.length) throw new Error("No league data could be fetched — aborting so the old deployment stays up.");
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), leagues: written }));
  console.log(`Done. Wrote ${written.length} league(s) to ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
