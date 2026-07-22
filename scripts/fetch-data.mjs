/* Snapshots poe.ninja scarab data into public/data/ so the site can run on
   static hosting (GitHub Pages) without a CORS proxy.
   Run: node scripts/fetch-data.mjs                                        */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API_BASES = [
  "https://poe.ninja/poe1/api/data", // current PoE 1 API location
  "https://poe.ninja/api/data",      // legacy location, kept as fallback
];
const INDEX_PATHS = ["/index-state", "/getindexstate"];
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const HEADERS = { "User-Agent": "scarab-ledger-snapshot/0.1 (github actions data fetch)" };
const HISTORY_LEAGUES = 2; // full per-scarab history only for the first N leagues (politeness)
const DELAY_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function changesFromSparkline(sparkline) {
  const sp = ((sparkline && sparkline.data) || []).filter((v) => v != null);
  const last = sp.length ? sp[sp.length - 1] : 0;
  const p24 = sp.length > 1 ? sp[sp.length - 2] : last;
  const p48 = sp.length > 2 ? sp[sp.length - 3] : p24;
  return { change24: last - p24, change48: last - p48 };
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Find a working API base + index endpoint (poe.ninja moved PoE1 to /poe1/)
  let API = null, idx = null;
  outer: for (const base of API_BASES) {
    for (const p of INDEX_PATHS) {
      try {
        idx = await getJson(`${base}${p}`);
        API = base;
        console.log(`Using API base: ${base}${p}`);
        break outer;
      } catch { /* try next */ }
    }
  }
  if (!API) throw new Error("No working poe.ninja API base found (tried /poe1/api/data and /api/data)");

  const leagueNames = (idx.economyLeagues || []).map((l) => l.name);
  console.log("Leagues:", leagueNames.join(", ") || "(none)");

  const written = [];
  for (const [li, name] of leagueNames.entries()) {
    try {
      const ov = await getJson(`${API}/itemoverview?league=${encodeURIComponent(name)}&type=Scarab`);
      await sleep(DELAY_MS);
      const lines = ov.lines || [];
      if (!lines.length) { console.log(`- ${name}: no scarab data, skipping`); continue; }

      let divineRate = 185;
      try {
        const cur = await getJson(`${API}/currencyoverview?league=${encodeURIComponent(name)}&type=Currency`);
        const div = (cur.lines || []).find((l) => l.currencyTypeName === "Divine Orb");
        if (div?.chaosEquivalent) divineRate = div.chaosEquivalent;
      } catch { /* keep fallback */ }
      await sleep(DELAY_MS);

      const items = lines.map((l) => ({
        id: l.id,
        name: l.name,
        chaosValue: l.chaosValue ?? 0,
        divineValue: l.divineValue ?? (l.chaosValue ?? 0) / divineRate,
        ...changesFromSparkline(l.sparkline),
      }));

      const history = {};
      if (li < HISTORY_LEAGUES) {
        for (const l of lines) {
          try {
            const arr = await getJson(`${API}/itemhistory?league=${encodeURIComponent(name)}&type=Scarab&itemId=${l.id}`);
            if (Array.isArray(arr) && arr.length) {
              const maxAgo = Math.max(...arr.map((p) => p.daysAgo), 0);
              history[l.name] = arr
                .slice().sort((a, b) => b.daysAgo - a.daysAgo)
                .map((p) => ({ day: maxAgo - p.daysAgo, value: p.value }));
            }
          } catch (e) { console.log(`  history failed for ${l.name}: ${e.message}`); }
          await sleep(DELAY_MS);
        }
      }

      const slug = slugify(name);
      const dir = path.join(OUT, slug);
      await mkdir(dir, { recursive: true });
      const generatedAt = new Date().toISOString();
      await writeFile(path.join(dir, "scarabs.json"), JSON.stringify({ generatedAt, divineRate, items }));
      await writeFile(path.join(dir, "history.json"), JSON.stringify(history));
      written.push({ name, slug, hasHistory: li < HISTORY_LEAGUES });
      console.log(`- ${name}: ${items.length} scarabs, ${Object.keys(history).length} histories`);
    } catch (e) {
      console.log(`- ${name}: FAILED (${e.message})`);
    }
  }

  if (!written.length) throw new Error("No league data could be fetched — aborting so the old deployment stays up.");
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), leagues: written }));
  console.log(`Done. Wrote ${written.length} league(s) to public/data/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
