/* Pure calculation layer for the boss profitability tab.
   No React in here so the maths stays testable on its own. */

import { BOSSES, SYNTHETIC } from "./bossData.js";

export const PROFILE_KEY = "sl.boss.profiles.v1";
export const ACTIVE_KEY = "sl.boss.activeProfile.v1";

/* ---------- price resolution ---------- */

/* prices.json shape: { "Item Name": { c, lo, hi, n } } */
export function makeResolver(priceMap, { priceOverrides = {}, priceBasis = "c" } = {}) {
  const synthCache = {};

  function synthetic(key) {
    if (synthCache[key] !== undefined) return synthCache[key];
    const spec = SYNTHETIC[key];
    if (!spec || !priceMap) return (synthCache[key] = null);
    const vals = [];
    for (const [name, e] of Object.entries(priceMap)) {
      if (spec.match(name) && e && e.c > 0) vals.push(e.c);
    }
    if (!vals.length) return (synthCache[key] = null);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return (synthCache[key] = { c: mean, lo: Math.min(...vals), hi: Math.max(...vals), n: vals.length, synthetic: true });
  }

  return function resolve(item) {
    if (priceOverrides[item] != null && isFinite(priceOverrides[item])) {
      return { chaos: Number(priceOverrides[item]), overridden: true, found: true, entry: null };
    }
    const entry = item.startsWith("@") ? synthetic(item) : (priceMap ? priceMap[item] : null);
    if (!entry) return { chaos: 0, found: false, overridden: false, entry: null };
    const chaos = entry[priceBasis] ?? entry.c ?? 0;
    return { chaos, found: chaos > 0, overridden: false, entry };
  };
}

/* ---------- per-boss maths ---------- */

/* Expected quantity per kill for one drop line. */
export function expectedQty(drop, poolRolls) {
  if (drop.qty != null) return drop.qty;
  if (drop.chance != null) return drop.chance;
  if (drop.share != null) return drop.share * poolRolls;
  return 0;
}

/* settings: { ttk, overhead, poolRolls, drops: { [item]: {share|chance|qty} }, entry: { [item]: qty } } */
export function computeBoss(boss, resolve, settings = {}) {
  const ttk = num(settings.ttk, boss.ttk);
  const overhead = num(settings.overhead, boss.overhead);
  const poolRolls = num(settings.poolRolls, boss.poolRolls ?? 1);
  const dropOv = settings.drops || {};
  const entryOv = settings.entry || {};

  const entryLines = boss.entry.map((e) => {
    const qty = num(entryOv[e.item], e.qty ?? 1);
    const p = resolve(e.item);
    return { ...e, qty, unit: p.chaos, total: p.chaos * qty, found: p.found, overridden: p.overridden };
  });
  const entryCost = entryLines.reduce((s, l) => s + l.total, 0);
  const entryUnknown = entryLines.some((l) => !l.found && l.qty > 0);

  const dropLines = boss.drops.map((d) => {
    const merged = { ...d, ...(dropOv[d.item] || {}) };
    const qty = expectedQty(merged, poolRolls);
    const p = resolve(d.item);
    const label = d.item.startsWith("@") ? (SYNTHETIC[d.item]?.label || d.item) : d.item;
    return {
      item: d.item, label, qty, unit: p.chaos, value: p.chaos * qty,
      found: p.found, overridden: p.overridden, priceEntry: p.entry,
      kind: merged.share != null ? "pool" : merged.chance != null ? "chance" : "qty",
      raw: merged.share ?? merged.chance ?? merged.qty ?? 0,
    };
  });
  dropLines.sort((a, b) => b.value - a.value);

  const gross = dropLines.reduce((s, l) => s + l.value, 0);
  const missingPrices = dropLines.filter((l) => !l.found && l.qty > 0).length;
  const net = gross - entryCost;
  const runSeconds = Math.max(1, ttk + overhead);
  const runsPerHour = 3600 / runSeconds;

  return {
    boss, ttk, overhead, poolRolls, runSeconds, runsPerHour,
    entryLines, entryCost, entryUnknown,
    dropLines, gross, net,
    profitPerHour: net * runsPerHour,
    grossPerHour: gross * runsPerHour,
    missingPrices,
    // share of pool that resolved to a price — a rough confidence signal
    coverage: dropLines.length ? 1 - missingPrices / dropLines.length : 1,
  };
}

export function computeAll(resolve, profile) {
  return BOSSES.map((b) => computeBoss(b, resolve, (profile && profile.bosses && profile.bosses[b.id]) || {}));
}

function num(v, fallback) {
  const n = Number(v);
  return isFinite(n) && v !== "" && v != null ? n : fallback;
}

/* ---------- profiles ---------- */

export function defaultProfile(name = "Default") {
  return { name, bosses: {}, priceOverrides: {}, createdAt: new Date().toISOString() };
}

export function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed.map(sanitizeProfile);
  } catch { /* corrupt storage — start fresh */ }
  return [defaultProfile()];
}

export function saveProfiles(profiles) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles)); } catch { /* quota / private mode */ }
}

export function loadActive(profiles) {
  try {
    const n = localStorage.getItem(ACTIVE_KEY);
    if (n && profiles.some((p) => p.name === n)) return n;
  } catch { /* ignore */ }
  return profiles[0]?.name || "Default";
}

export function saveActive(name) {
  try { localStorage.setItem(ACTIVE_KEY, name); } catch { /* ignore */ }
}

/* Accepts anything shaped roughly right; drops the rest. Import is a
   user-pasted blob, so never trust its shape. */
export function sanitizeProfile(p, fallbackName = "Imported") {
  const out = defaultProfile(typeof p?.name === "string" && p.name.trim() ? p.name.trim() : fallbackName);
  if (p && typeof p === "object") {
    if (p.bosses && typeof p.bosses === "object") {
      for (const [id, s] of Object.entries(p.bosses)) {
        if (!s || typeof s !== "object") continue;
        const clean = {};
        for (const k of ["ttk", "overhead", "poolRolls"]) {
          if (isFinite(Number(s[k]))) clean[k] = Number(s[k]);
        }
        if (s.drops && typeof s.drops === "object") {
          clean.drops = {};
          for (const [item, d] of Object.entries(s.drops)) {
            if (!d || typeof d !== "object") continue;
            const cd = {};
            for (const k of ["share", "chance", "qty"]) if (isFinite(Number(d[k]))) cd[k] = Number(d[k]);
            if (Object.keys(cd).length) clean.drops[item] = cd;
          }
        }
        if (s.entry && typeof s.entry === "object") {
          clean.entry = {};
          for (const [item, q] of Object.entries(s.entry)) if (isFinite(Number(q))) clean.entry[item] = Number(q);
        }
        if (Object.keys(clean).length) out.bosses[id] = clean;
      }
    }
    if (p.priceOverrides && typeof p.priceOverrides === "object") {
      for (const [item, v] of Object.entries(p.priceOverrides)) {
        if (isFinite(Number(v)) && Number(v) >= 0) out.priceOverrides[item] = Number(v);
      }
    }
  }
  return out;
}

export function uniqueName(profiles, base) {
  if (!profiles.some((p) => p.name === base)) return base;
  let i = 2;
  while (profiles.some((p) => p.name === `${base} ${i}`)) i++;
  return `${base} ${i}`;
}
