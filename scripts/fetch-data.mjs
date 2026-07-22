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
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
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
  // Documented: plain array [{id, name}], first = current challenge league
  const a = await tryJson(`${NINJA}/poe1/api/economy/leagues`);
  if (Array.isArray(a) && a.length && a[0].id) {
    console.log("Leagues via /poe1/api/economy/leagues");
    return a.map((l) => ({ name: l.name || l.id, params: [l.id, l.name].filter(Boolean) }));
  }
  const b = await tryJson(`${NINJA}/poe1/api/data/index-state`) || await tryJson(`${NINJA}/api/data/getindexstate`);
  const eco = (b && b.economyLeagues) || [];
  if (eco.length) {
    console.log("Leagues via index-state");
    return eco.map((l) => ({ name: l.name, params: [l.url, l.name].filter(Boolean) }));
  }
  throw new Error("Could not fetch league list from any known endpoint");
}

/* ---------- prices ---------- */
async function getScarabPrices(lgParams) {
  // 1) legacy itemoverview (kept alive via redirects historically)
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/api/data/itemoverview?league=${encodeURIComponent(p)}&type=Scarab`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      console.log(`  prices via legacy itemoverview (league=${p})`);
      const items = j.lines.map((l) => ({
        id: l.id, name: l.name,
        chaosValue: l.chaosValue ?? 0,
        divineValue: l.divineValue ?? 0,
        ...changesFromSparkline(l.sparkline || l.sparkLine),
      }));
      return { items, source: "legacy", leagueParam: p };
    }
    await sleep(DELAY_MS);
  }
  // 2) documented new home: exchange overview (different shape)
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=Scarab`);
    if (j && Array.isArray(j.lines) && j.lines.length && j.core) {
      console.log(`  prices via exchange overview (league=${p})`);
      return { ...adaptExchange(j), source: "exchange", leagueParam: p };
    }
    await sleep(DELAY_MS);
  }
  return null;
}

function adaptExchange(j) {
  const itemsById = {};
  for (const it of j.core.items || []) itemsById[it.id] = it;
  const findId = (needle) => {
    for (const it of j.core.items || []) if ((it.name || "").toLowerCase() === needle) return it.id;
    return null;
  };
  const chaosId = findId("chaos orb");
  const divineId = findId("divine orb");
  const rates = j.core.rates || {};
  const rChaos = j.core.primary === chaosId ? 1 : rates[chaosId];

  // Rate direction is undocumented — pick whichever puts the median scarab
  // price in a sane chaos range.
  const raw = j.lines
    .map((l) => ({ line: l, meta: itemsById[l.id] }))
    .filter((x) => x.meta && /scarab/i.test(x.meta.name));
  const mk = (mode) => raw.map(({ line }) => {
    const v = line.primaryValue ?? 0;
    if (!rChaos || rChaos === 1) return v;
    return mode === "div" ? v / rChaos : v * rChaos;
  });
  const a = mk("div"), b = mk("mul");
  const chaosVals = (median(a) >= 0.05 && median(a) <= 50000) ? a : b;

  // Divine rate in chaos, sanity-checked into a plausible band
  let divineRate = 185;
  if (chaosId && divineId && rates[divineId] != null && rChaos) {
    const cand = [rates[divineId] / rChaos, rChaos / rates[divineId]];
    for (const c of cand) if (c >= 20 && c <= 20000) { divineRate = c; break; }
  }

  const items = raw.map(({ line, meta }, i) => ({
    id: line.id, name: meta.name,
    chaosValue: Math.max(0, chaosVals[i] ?? 0),
    divineValue: Math.max(0, (chaosVals[i] ?? 0) / divineRate),
    ...changesFromSparkline(line.sparkline || line.sparkLine),
  }));
  return { items, exchangeDivineRate: divineRate };
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

async function updateSelfHistory(slug, items) {
  const base = pagesBaseUrl();
  let prev = base ? await tryJson(`${base}/data/${slug}/selfhistory.json`) : null;
  const points = (prev && Array.isArray(prev.points)) ? prev.points : [];
  const today = todayISO();
  const values = {};
  for (const it of items) values[it.name] = Math.round(it.chaosValue * 100) / 100;
  const existing = points.findIndex((p) => p.date === today);
  if (existing >= 0) points[existing] = { date: today, values };
  else points.push({ date: today, values });
  points.sort((a, b) => (a.date < b.date ? -1 : 1));
  while (points.length > SELF_HISTORY_CAP) points.shift();
  return { points };
}

function selfHistoryToSeries(self) {
  const out = {};
  const pts = self.points || [];
  if (!pts.length) return out;
  const day0 = new Date(pts[0].date + "T00:00:00Z").getTime();
  for (const p of pts) {
    const day = Math.round((new Date(p.date + "T00:00:00Z").getTime() - day0) / 86400000);
    for (const [name, v] of Object.entries(p.values || {})) {
      (out[name] ||= []).push({ day, value: v });
    }
  }
  return out;
}

/* ---------- main ---------- */
async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const leagues = await getLeagues();
  console.log("Leagues:", leagues.map((l) => l.name).join(", "));

  const written = [];
  for (const [li, lg] of leagues.entries()) {
    try {
      const priced = await getScarabPrices(lg.params);
      if (!priced) { console.log(`- ${lg.name}: no scarab data, skipping`); continue; }
      const { items, source, leagueParam, exchangeDivineRate } = priced;

      const divineRate = await getDivineRate(leagueParam, exchangeDivineRate);
      // divineValue may be missing/zero from some sources — recompute
      for (const it of items) if (!it.divineValue) it.divineValue = it.chaosValue / divineRate;

      const slug = slugify(lg.name);
      let history = {};
      if (source === "legacy" && li < HISTORY_LEAGUES) {
        history = await getNinjaHistory(leagueParam, items);
      }
      const self = await updateSelfHistory(slug, items);
      if (!Object.keys(history).length) history = selfHistoryToSeries(self);

      const dir = path.join(OUT, slug);
      await mkdir(dir, { recursive: true });
      const generatedAt = new Date().toISOString();
      await writeFile(path.join(dir, "scarabs.json"), JSON.stringify({ generatedAt, divineRate, items }));
      await writeFile(path.join(dir, "history.json"), JSON.stringify(history));
      await writeFile(path.join(dir, "selfhistory.json"), JSON.stringify(self));
      written.push({ name: lg.name, slug });
      console.log(`- ${lg.name}: ${items.length} scarabs, ${Object.keys(history).length} history series, 1 div = ${Math.round(divineRate)}c`);
    } catch (e) {
      console.log(`- ${lg.name}: FAILED (${e.message})`);
    }
  }

  if (!written.length) throw new Error("No league data could be fetched — aborting so the old deployment stays up.");
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), leagues: written }));
  console.log(`Done. Wrote ${written.length} league(s) to public/data/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
