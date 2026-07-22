import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceDot, ResponsiveContainer,
} from "recharts";

/* ================================================================
   POE 1 SCARAB PRICE TRACKER
   - Tries live poe.ninja data on load (works when self-hosted).
   - Falls back to a deterministic demo snapshot inside Claude,
     where outbound requests to poe.ninja are blocked.
   Live endpoints used when reachable:
     GET /api/data/getindexstate                      -> league list
     GET /api/data/itemoverview?league=X&type=Scarab  -> prices
     GET /api/data/currencyoverview?league=X&type=Currency -> divine rate
     GET /api/data/itemhistory?league=X&type=Scarab&itemId=N -> history
   ================================================================ */

/* Proxy path first (vite dev server / nginx rewrites /ninja -> poe.ninja,
   dodging CORS), direct URL as fallback. */
const API_BASES = ["/ninja/api/data", "https://poe.ninja/api/data"];
const DEMO_LEAGUE_DAYS = 92;
const DEMO_DIVINE_RATE = 185;

async function ninjaFetch(path, opts) {
  let lastErr;
  for (const base of API_BASES) {
    try {
      const res = await fetch(base + path, opts);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} from ${base}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("poe.ninja unreachable");
}

/* Pre-built JSON snapshots (written by scripts/fetch-data.mjs, deployed by
   the GitHub Actions workflow). Tried before the live API — this is what
   makes static hosting like GitHub Pages work without a CORS proxy. */
const STATIC_BASE = `${import.meta.env.BASE_URL}data`;

/* ---------------- scarab catalogue (from the stash tab) -------- */

const GROUPS = {
  Breach: ["Breach Scarab of the Hive", "Breach Scarab of the Dreamer", "Breach Scarab of Instability", "Breach Scarab of the Marshal", "Breach Scarab of the Incensed Swarm", "Breach Scarab of Resonant Cascade"],
  Kalguuran: ["Kalguuran Scarab", "Kalguuran Scarab of Guarded Riches", "Kalguuran Scarab of Refinement", "Kalguuran Scarab of Enriching"],
  Cartography: ["Cartography Scarab of Escalation", "Cartography Scarab of Risk", "Cartography Scarab of the Multitude", "Cartography Scarab of Corruption", "Cartography Scarab of Singularity"],
  Titanic: ["Titanic Scarab", "Titanic Scarab of Treasures", "Titanic Scarab of Legend"],
  Bestiary: ["Bestiary Scarab", "Bestiary Scarab of Duplicating", "Bestiary Scarab of the Herd", "Bestiary Scarab of the Shadowed Crow"],
  Influence: ["Influencing Scarab of the Shaper", "Influencing Scarab of the Elder", "Influencing Scarab of Interference", "Influencing Scarab of Hordes"],
  Sulphite: ["Sulphite Scarab", "Sulphite Scarab of Greed", "Sulphite Scarab of Fumes"],
  Divination: ["Divination Scarab of The Cloister", "Divination Scarab of Pilfering", "Divination Scarab of Plenty"],
  Torment: ["Torment Scarab", "Torment Scarab of Peculiarity", "Torment Scarab of Release", "Torment Scarab of Possession"],
  Ambush: ["Ambush Scarab", "Ambush Scarab of Hidden Compartments", "Ambush Scarab of Potency", "Ambush Scarab of Containment", "Ambush Scarab of Discernment"],
  Expedition: ["Expedition Scarab", "Expedition Scarab of Runefinding", "Expedition Scarab of Verisium Powder", "Expedition Scarab of Archaeology", "Expedition Scarab of Infusion"],
  Legion: ["Legion Scarab", "Legion Scarab of Officers", "Legion Scarab of Treasures", "Legion Scarab of The Sekhema", "Legion Scarab of Eternal Conflict"],
  Abyss: ["Abyss Scarab", "Abyss Scarab of Multitudes", "Abyss Scarab of Edifice", "Abyss Scarab of Descending", "Abyss Scarab of Profound Depth"],
  Anarchy: ["Anarchy Scarab", "Anarchy Scarab of Gigantification", "Anarchy Scarab of Partnership", "Anarchy Scarab of the Exceptional"],
  Essence: ["Essence Scarab", "Essence Scarab of Ascent", "Essence Scarab of Calcification", "Essence Scarab of Stability", "Essence Scarab of Adaptation"],
  Domination: ["Domination Scarab", "Domination Scarab of Apparitions", "Domination Scarab of Evolution", "Domination Scarab of Terrors"],
  Ritual: ["Ritual Scarab of Selectiveness", "Ritual Scarab of Wisps", "Ritual Scarab of Abundance", "Ritual Scarab of Corpses"],
  Harvest: ["Harvest Scarab", "Harvest Scarab of Cornucopia", "Harvest Scarab of Doubling"],
  Incursion: ["Incursion Scarab", "Incursion Scarab of Invasion", "Incursion Scarab of Timelines", "Incursion Scarab of Champions"],
  Betrayal: ["Betrayal Scarab", "Betrayal Scarab of the Allflame", "Betrayal Scarab of Unbreaking", "Betrayal Scarab of Reinforcements"],
  Beyond: ["Beyond Scarab", "Beyond Scarab of Corruption", "Beyond Scarab of Haemophilia", "Beyond Scarab of the Invasion", "Beyond Scarab of Resurgence"],
  Ultimatum: ["Ultimatum Scarab", "Ultimatum Scarab of Bribing", "Ultimatum Scarab of Dueling", "Ultimatum Scarab of Catalysing", "Ultimatum Scarab of Inscription"],
  Delirium: ["Delirium Scarab", "Delirium Scarab of Mania", "Delirium Scarab of Paranoia", "Delirium Scarab of Neuroses", "Delirium Scarab of Delusions"],
  Blight: ["Blight Scarab", "Blight Scarab of Bounty", "Blight Scarab of the Blightheart", "Blight Scarab of Blooming", "Blight Scarab of Invigoration"],
  Horned: ["Horned Scarab of Bloodlines", "Horned Scarab of Nemeses", "Horned Scarab of Preservation", "Horned Scarab of Awakening", "Horned Scarab of Tradition", "Horned Scarab of Glittering", "Horned Scarab of Pandemonium"],
  Universal: ["Scarab of Monstrous Lineage", "Scarab of Adversaries", "Scarab of Divinity", "Scarab of Hunted Traitors", "Scarab of Stability", "Scarab of Wisps", "Scarab of the Sinistral", "Scarab of the Dextral", "Scarab of Radiant Storms"],
};

/* Assign any scarab name (incl. ones poe.ninja adds later) to a group. */
function groupForName(name) {
  for (const [g, list] of Object.entries(GROUPS)) if (list.includes(name)) return g;
  if (/^Horned Scarab/.test(name)) return "Horned";
  if (/^Scarab of/.test(name)) return "Universal";
  if (/^Influencing Scarab/.test(name)) return "Influence";
  const m = name.match(/^(\w+) Scarab/);
  return m ? m[1] : "Universal";
}

/* ---------------- demo snapshot (deterministic) ---------------- */

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_PRICE_OVERRIDES = {
  "Horned Scarab of Pandemonium": 950, "Horned Scarab of Awakening": 700, "Horned Scarab of Bloodlines": 320,
  "Horned Scarab of Tradition": 260, "Horned Scarab of Nemeses": 180, "Horned Scarab of Glittering": 140,
  "Horned Scarab of Preservation": 90,
  "Divination Scarab of The Cloister": 180, "Divination Scarab of Plenty": 25,
  "Breach Scarab of the Dreamer": 120, "Breach Scarab of Resonant Cascade": 35, "Breach Scarab of the Incensed Swarm": 15,
  "Harvest Scarab of Doubling": 150, "Harvest Scarab of Cornucopia": 30, "Harvest Scarab": 12,
  "Bestiary Scarab of Duplicating": 110, "Bestiary Scarab of the Shadowed Crow": 18,
  "Titanic Scarab of Legend": 95, "Titanic Scarab of Treasures": 30,
  "Scarab of Divinity": 90, "Scarab of Monstrous Lineage": 40, "Scarab of Radiant Storms": 25,
  "Domination Scarab of Terrors": 70, "Delirium Scarab of Delusions": 60, "Legion Scarab of Eternal Conflict": 55,
  "Ultimatum Scarab of Catalysing": 45, "Beyond Scarab of Resurgence": 40, "Essence Scarab of Adaptation": 35,
  "Cartography Scarab of Risk": 30, "Delirium Scarab of Neuroses": 30, "Ritual Scarab of Abundance": 30,
  "Kalguuran Scarab of Enriching": 25, "Ultimatum Scarab of Inscription": 25, "Beyond Scarab of Haemophilia": 25,
  "Cartography Scarab of Singularity": 20, "Legion Scarab of The Sekhema": 20, "Ritual Scarab of Corpses": 20,
  "Expedition Scarab of Verisium Powder": 18, "Ultimatum Scarab of Bribing": 15,
  "Cartography Scarab of Corruption": 12, "Kalguuran Scarab of Refinement": 12, "Delirium Scarab of Paranoia": 12,
  "Domination Scarab of Evolution": 12, "Essence Scarab of Stability": 10,
};

function demoBasePrice(name) {
  if (DEMO_PRICE_OVERRIDES[name] != null) return DEMO_PRICE_OVERRIDES[name];
  const r = mulberry32(hashStr(name))();
  return Math.round((0.5 + r * 8) * 10) / 10; // 0.5c – 8.5c filler tier
}

/* Full-league price curve with visible highs/lows: drift + one event
   spike + end-of-league selloff, all seeded by the scarab name. */
function demoHistory(name, base) {
  const rnd = mulberry32(hashStr(name + "|hist"));
  const start = base * (0.45 + rnd() * 0.5);
  const drift = (rnd() - 0.35) * 0.012;
  const spikeDay = 10 + Math.floor(rnd() * 60);
  const spikeMag = 1.25 + rnd() * 1.1;
  const spikeLen = 4 + Math.floor(rnd() * 6);
  const pts = [];
  let noise = 0;
  for (let d = 0; d <= DEMO_LEAGUE_DAYS; d++) {
    noise = noise * 0.82 + (rnd() - 0.5) * 0.09;
    let v = start * (1 + drift * d) * (1 + noise);
    const sd = d - spikeDay;
    if (sd >= 0 && sd < spikeLen) v *= 1 + (spikeMag - 1) * Math.sin((sd / spikeLen) * Math.PI);
    if (d > DEMO_LEAGUE_DAYS - 15) v *= 1 - 0.4 * ((d - (DEMO_LEAGUE_DAYS - 15)) / 15);
    // pull the curve toward "today's" snapshot price near the end
    const w = d / DEMO_LEAGUE_DAYS;
    v = v * (1 - w * 0.35) + base * (w * 0.35);
    pts.push({ day: d, value: Math.max(0.2, Math.round(v * 10) / 10) });
  }
  return pts;
}

function buildDemoData() {
  const items = [];
  let id = 1;
  for (const [group, names] of Object.entries(GROUPS)) {
    for (const name of names) {
      const chaos = demoBasePrice(name);
      const h = demoHistory(name, chaos);
      const last = h[h.length - 1].value, d1 = h[h.length - 2].value, d2 = h[h.length - 3].value;
      items.push({
        id: id++, name, group, chaosValue: chaos, divineValue: chaos / DEMO_DIVINE_RATE,
        change24: (last / d1 - 1) * 100, change48: (last / d2 - 1) * 100,
      });
    }
  }
  return items;
}

/* ---------------- shared helpers ------------------------------- */

function fmtChaos(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return Math.round(v).toString();
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(1);
}
function fmtDiv(v) { return v >= 10 ? v.toFixed(1) : v.toFixed(2); }
function fmtPrice(chaos, currency, rate) {
  return currency === "chaos" ? `${fmtChaos(chaos)}c` : `${fmtDiv(chaos / rate)} div`;
}

function PctBadge({ v }) {
  if (v == null || !isFinite(v)) return <span className="st-pct flat">—</span>;
  const cls = v > 0.5 ? "up" : v < -0.5 ? "down" : "flat";
  const arrow = v > 0.5 ? "▲" : v < -0.5 ? "▼" : "•";
  return <span className={`st-pct ${cls}`}>{arrow} {Math.abs(v).toFixed(1)}%</span>;
}

function ScarabIcon({ size = 22, tone = "#c9a24b" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <ellipse cx="12" cy="13.5" rx="6.4" ry="7.2" fill={tone} opacity="0.9" />
      <ellipse cx="12" cy="13.5" rx="6.4" ry="7.2" fill="none" stroke="#1b150c" strokeWidth="1.1" />
      <line x1="12" y1="6.5" x2="12" y2="20.6" stroke="#1b150c" strokeWidth="1.1" />
      <path d="M6 10 Q12 12.6 18 10" fill="none" stroke="#1b150c" strokeWidth="1.1" />
      <circle cx="12" cy="4.6" r="2.1" fill={tone} stroke="#1b150c" strokeWidth="1.1" />
      <path d="M9.6 3.4 L7.4 1.6 M14.4 3.4 L16.6 1.6" stroke={tone} strokeWidth="1.3" fill="none" />
      <path d="M6.2 9 L3.4 7.4 M6 14 L3 14 M6.6 18 L4 19.8 M17.8 9 L20.6 7.4 M18 14 L21 14 M17.4 18 L20 19.8" stroke={tone} strokeWidth="1.2" />
    </svg>
  );
}

const GROUP_TONES = {
  Breach: "#b06ad4", Legion: "#8f6ad4", Delirium: "#9fb6c9", Blight: "#9fc96a", Harvest: "#5fc9b0",
  Abyss: "#7fd46a", Beyond: "#d46a6a", Betrayal: "#d4a06a", Incursion: "#6ad4c3", Ultimatum: "#d46a94",
  Essence: "#6a9fd4", Ritual: "#d46a6a", Domination: "#d4d16a", Anarchy: "#d48c6a", Expedition: "#6ad48c",
  Ambush: "#c9c46a", Torment: "#8c8f96", Divination: "#6ac3d4", Sulphite: "#d4c46a", Influence: "#8f9fd4",
  Bestiary: "#c96a3f", Titanic: "#d4886a", Cartography: "#6a8cd4", Kalguuran: "#d4b06a",
  Horned: "#e05f5f", Universal: "#b8b3a6", Breachstone: "#b06ad4",
};

/* ================================================================ */

export default function ScarabTracker() {
  const [mode, setMode] = useState("connecting");        // connecting | live | demo
  const [leagues, setLeagues] = useState([]);
  const [league, setLeague] = useState("");
  const [items, setItems] = useState([]);                 // {id,name,group,chaosValue,divineValue}
  const [divineRate, setDivineRate] = useState(DEMO_DIVINE_RATE);
  const [currency, setCurrency] = useState("chaos");      // chaos | divine
  const [sortDir, setSortDir] = useState("desc");         // desc | asc
  const [showUniversal, setShowUniversal] = useState(true);
  const [showHorned, setShowHorned] = useState(true);
  const [chgWindow, setChgWindow] = useState("24h");      // 24h | 48h
  const [tab, setTab] = useState("prices");               // prices | farms
  const [openGroup, setOpenGroup] = useState(null);
  const [focusScarab, setFocusScarab] = useState(null);
  const [histories, setHistories] = useState({});         // name -> [{day,value}]
  const [histLoading, setHistLoading] = useState(false);
  const [dataSource, setDataSource] = useState(null);     // "static" | "api" | null
  const staticSlugsRef = useRef({});                      // league name -> folder slug
  const [staticInfo, setStaticInfo] = useState(null);     // { generatedAt }
  const staticHistFetched = useRef(new Set());            // leagues whose history.json was loaded

  /* ---- static snapshots (GitHub Pages etc.) ---- */
  const loadStaticLeague = useCallback(async (name, slugsArg) => {
    const slugs = slugsArg || staticSlugsRef.current;
    const slug = slugs[name];
    if (!slug) throw new Error("unknown league in snapshot index");
    const res = await fetch(`${STATIC_BASE}/${slug}/scarabs.json`);
    if (!res.ok) throw new Error("snapshot missing");
    const j = await res.json();
    setItems((j.items || []).map((it) => ({ ...it, group: groupForName(it.name) })));
    setDivineRate(j.divineRate || DEMO_DIVINE_RATE);
    setStaticInfo({ generatedAt: j.generatedAt });
    setMode("live"); setDataSource("static");
    staticHistFetched.current.delete(name);
    setHistories({}); setOpenGroup(null); setFocusScarab(null);
  }, []);

  /* ---- data loading: try live, fall back to demo ---- */
  const loadLeague = useCallback(async (lg) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const scarabRes = await ninjaFetch(`/itemoverview?league=${encodeURIComponent(lg)}&type=Scarab`, { signal: ctl.signal });
      const scarabJson = await scarabRes.json();
      let rate = DEMO_DIVINE_RATE;
      try {
        const curRes = await ninjaFetch(`/currencyoverview?league=${encodeURIComponent(lg)}&type=Currency`, { signal: ctl.signal });
        const curJson = await curRes.json();
        const div = (curJson.lines || []).find((l) => l.currencyTypeName === "Divine Orb");
        if (div?.chaosEquivalent) rate = div.chaosEquivalent;
      } catch { /* keep fallback rate */ }
      const mapped = (scarabJson.lines || []).map((l) => {
        // sparkline.data = cumulative % change vs 7 days ago, one point per day
        const sp = ((l.sparkline && l.sparkline.data) || []).filter((v) => v != null);
        const last = sp.length ? sp[sp.length - 1] : 0;
        const p24 = sp.length > 1 ? sp[sp.length - 2] : last;
        const p48 = sp.length > 2 ? sp[sp.length - 3] : p24;
        return {
          id: l.id, name: l.name, group: groupForName(l.name),
          chaosValue: l.chaosValue ?? 0,
          divineValue: l.divineValue ?? (l.chaosValue ?? 0) / rate,
          change24: last - p24, change48: last - p48,
          icon: l.icon,
        };
      });
      if (!mapped.length) throw new Error("empty");
      setItems(mapped); setDivineRate(rate); setMode("live"); setDataSource("api");
      setHistories({}); setOpenGroup(null); setFocusScarab(null);
    } finally { clearTimeout(t); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) pre-built snapshots (GitHub Pages / any static host)
      try {
        const res = await fetch(`${STATIC_BASE}/index.json`);
        if (res.ok) {
          const idx = await res.json();
          const lgs = idx.leagues || [];
          if (lgs.length) {
            if (cancelled) return;
            const slugs = {};
            for (const l of lgs) slugs[l.name] = l.slug;
            staticSlugsRef.current = slugs;
            setLeagues(lgs.map((l) => l.name));
            setLeague(lgs[0].name);
            await loadStaticLeague(lgs[0].name, slugs);
            return;
          }
        }
      } catch { /* fall through to live API */ }
      // 2) live poe.ninja API (dev proxy or direct)
      try {
        const res = await ninjaFetch(`/getindexstate`);
        const idx = await res.json();
        const lgs = (idx.economyLeagues || []).map((l) => l.name);
        if (cancelled) return;
        const first = lgs[0] || "Standard";
        setLeagues(lgs.length ? lgs : ["Standard"]);
        setLeague(first);
        await loadLeague(first);
      } catch {
        if (cancelled) return;
        setItems(buildDemoData());
        setLeagues(["Demo snapshot"]);
        setLeague("Demo snapshot");
        setMode("demo");
      }
    })();
    return () => { cancelled = true; };
  }, [loadLeague, loadStaticLeague]);

  /* ---- histories for the open group (lazy) ---- */
  useEffect(() => {
    if (!openGroup) return;
    const members = items.filter((i) => i.group === openGroup);
    const missing = members.filter((m) => !histories[m.name]);
    if (!missing.length) return;

    if (mode === "demo") {
      const add = {};
      for (const m of missing) add[m.name] = demoHistory(m.name, m.chaosValue);
      setHistories((h) => ({ ...h, ...add }));
      return;
    }
    if (dataSource === "static") {
      if (staticHistFetched.current.has(league)) return; // file already merged; anything missing has no data
      staticHistFetched.current.add(league);
      let cancelled = false;
      setHistLoading(true);
      (async () => {
        try {
          const slug = staticSlugsRef.current[league];
          const res = await fetch(`${STATIC_BASE}/${slug}/history.json`);
          if (res.ok) {
            const all = await res.json();
            if (!cancelled) setHistories((h) => ({ ...all, ...h }));
          }
        } catch { /* group panel will show "no history" */ }
        if (!cancelled) setHistLoading(false);
      })();
      return () => { cancelled = true; };
    }
    if (mode !== "live") return;
    let cancelled = false;
    setHistLoading(true);
    (async () => {
      const add = {};
      for (const m of missing) {
        try {
          const res = await ninjaFetch(`/itemhistory?league=${encodeURIComponent(league)}&type=Scarab&itemId=${m.id}`);
          const arr = await res.json();
          if (!Array.isArray(arr) || !arr.length) continue;
          // API returns [{count, value, daysAgo}] — normalise to league days ascending
          const maxAgo = Math.max(...arr.map((p) => p.daysAgo), 0);
          add[m.name] = arr
            .slice().sort((a, b) => b.daysAgo - a.daysAgo)
            .map((p) => ({ day: maxAgo - p.daysAgo, value: p.value }));
        } catch { /* keep going */ }
      }
      if (!cancelled) { setHistories((h) => ({ ...h, ...add })); setHistLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [openGroup, items, mode, league, histories, dataSource]);

  /* ---- derived ---- */
  const groups = useMemo(() => {
    const byGroup = {};
    for (const it of items) { if (!byGroup[it.group]) byGroup[it.group] = []; byGroup[it.group].push(it); }
    const wchg = (members, key) => {
      let now = 0, prev = 0;
      for (const m of members) {
        const c = m[key] ?? 0;
        now += m.chaosValue;
        prev += m.chaosValue / Math.max(0.05, 1 + c / 100);
      }
      return prev > 0 ? (now / prev - 1) * 100 : 0;
    };
    let arr = Object.entries(byGroup).map(([name, members]) => ({
      name, members: members.slice().sort((a, b) => b.chaosValue - a.chaosValue),
      total: members.reduce((s, m) => s + m.chaosValue, 0),
      change24: wchg(members, "change24"), change48: wchg(members, "change48"),
    }));
    if (!showUniversal) arr = arr.filter((g) => g.name !== "Universal");
    if (!showHorned) arr = arr.filter((g) => g.name !== "Horned");
    arr.sort((a, b) => (sortDir === "desc" ? b.total - a.total : a.total - b.total));
    return arr;
  }, [items, sortDir, showUniversal, showHorned]);

  const openGroupData = openGroup ? groups.find((g) => g.name === openGroup) : null;

  const chartData = useMemo(() => {
    if (!openGroupData) return [];
    const memberHists = openGroupData.members.map((m) => histories[m.name]).filter((h) => h && h.length);
    if (!memberHists.length) return [];
    const maxDay = Math.max(...memberHists.map((h) => h[h.length - 1]?.day ?? 0));
    const div = currency === "divine" ? divineRate : 1;
    const rows = [];
    for (let d = 0; d <= maxDay; d++) {
      let total = 0, focus = null;
      for (const m of openGroupData.members) {
        const h = histories[m.name];
        if (!h || !h.length) continue;
        const pt = h.find((p) => p.day === d) ?? h.reduce((best, p) => (Math.abs(p.day - d) < Math.abs(best.day - d) ? p : best), h[0]);
        total += pt.value;
        if (focusScarab === m.name) focus = pt.value / div;
      }
      rows.push({ day: d, total: Math.round((total / div) * 100) / 100, focus });
    }
    return rows;
  }, [openGroupData, histories, currency, divineRate, focusScarab]);

  const extremes = useMemo(() => {
    if (chartData.length < 2) return null;
    let hi = chartData[0], lo = chartData[0];
    for (const r of chartData) { if (r.total > hi.total) hi = r; if (r.total < lo.total) lo = r; }
    return { hi, lo };
  }, [chartData]);

  const unit = currency === "chaos" ? "c" : "div";
  const chgKey = chgWindow === "24h" ? "change24" : "change48";

  const movers = useMemo(() => {
    const rising = groups.filter((g) => g[chgKey] > 0.5).sort((a, b) => b[chgKey] - a[chgKey]).slice(0, 8);
    const falling = groups.filter((g) => g[chgKey] < -0.5).sort((a, b) => a[chgKey] - b[chgKey]).slice(0, 8);
    const maxAbs = Math.max(1, ...rising.map((g) => Math.abs(g[chgKey])), ...falling.map((g) => Math.abs(g[chgKey])));
    const pool = groups.flatMap((g) => g.members);
    const topScarabs = pool
      .filter((m) => m.chaosValue >= 1 && isFinite(m[chgKey]))
      .sort((a, b) => Math.abs(b[chgKey]) - Math.abs(a[chgKey]))
      .slice(0, 12);
    return { rising, falling, maxAbs, topScarabs };
  }, [groups, chgKey]);

  /* ---- render ---- */
  return (
    <div className="st-root">
      <style>{css}</style>

      <header className="st-head">
        <div className="st-title-block">
          <h1>Scarab Ledger</h1>
          <p className="st-sub">Path of Exile · scarab prices by league mechanic</p>
        </div>
        <div className="st-controls">
          <label className="st-ctl">
            <span>League</span>
            <select value={league} disabled={mode !== "live"} onChange={(e) => { const v = e.target.value; setLeague(v); (dataSource === "static" ? loadStaticLeague(v) : loadLeague(v)).catch(() => {}); }}>
              {leagues.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <div className="st-ctl">
            <span>Currency</span>
            <div className="st-seg">
              <button className={currency === "chaos" ? "on" : ""} onClick={() => setCurrency("chaos")}>Chaos</button>
              <button className={currency === "divine" ? "on" : ""} onClick={() => setCurrency("divine")}>Divine</button>
            </div>
          </div>
          <div className="st-ctl">
            <span>Sort by set value</span>
            <div className="st-seg">
              <button className={sortDir === "desc" ? "on" : ""} onClick={() => setSortDir("desc")}>High → Low</button>
              <button className={sortDir === "asc" ? "on" : ""} onClick={() => setSortDir("asc")}>Low → High</button>
            </div>
          </div>
          <div className="st-ctl">
            <span>Price change</span>
            <div className="st-seg">
              <button className={chgWindow === "24h" ? "on" : ""} onClick={() => setChgWindow("24h")}>24h</button>
              <button className={chgWindow === "48h" ? "on" : ""} onClick={() => setChgWindow("48h")}>48h</button>
            </div>
          </div>
          <label className="st-ctl st-check">
            <input type="checkbox" checked={showUniversal} onChange={(e) => setShowUniversal(e.target.checked)} />
            <span>Universal scarabs</span>
          </label>
          <label className="st-ctl st-check">
            <input type="checkbox" checked={showHorned} onChange={(e) => setShowHorned(e.target.checked)} />
            <span>Horned scarabs</span>
          </label>
        </div>
      </header>

      <nav className="st-tabs" aria-label="Views">
        <button className={tab === "prices" ? "on" : ""} onClick={() => setTab("prices")}>Prices</button>
        <button className={tab === "farms" ? "on" : ""} onClick={() => setTab("farms")}>Popular farms</button>
      </nav>

      {mode === "demo" && (
        <div className="st-banner">
          Demo snapshot — poe.ninja isn't reachable right now, so prices and history are generated
          sample data. Check your connection or the /ninja proxy config; the page switches to live
          data automatically once poe.ninja responds (reload to retry).
        </div>
      )}
      {mode === "connecting" && <div className="st-banner st-quiet">Connecting to poe.ninja…</div>}
      {mode === "live" && (
        <div className="st-banner st-quiet">
          {dataSource === "static"
            ? `Snapshot data · ${league} · updated ${staticInfo?.generatedAt ? new Date(staticInfo.generatedAt).toLocaleString() : "recently"}`
            : `Live data · ${league}`} · 1 Divine ≈ {Math.round(divineRate)} Chaos
        </div>
      )}

      {/* ---------- expanded mechanic panel ---------- */}
      {tab === "prices" && openGroupData && (
        <section className="st-panel">
          <div className="st-panel-head">
            <div className="st-panel-title">
              <ScarabIcon size={26} tone={GROUP_TONES[openGroupData.name] || "#c9a24b"} />
              <h2>{openGroupData.name} scarabs</h2>
              <span className="st-panel-total">
                Set total {fmtPrice(openGroupData.total, currency, divineRate)}
              </span>
            </div>
            <button className="st-close" onClick={() => { setOpenGroup(null); setFocusScarab(null); }}>Close</button>
          </div>

          <div className="st-panel-body">
            <div className="st-chart">
              <div className="st-chart-label">
                {focusScarab ? <>Set total <em>and</em> {focusScarab}</> : "Set total across the league"}
                {histLoading && <span className="st-loading"> · loading history…</span>}
              </div>
              {chartData.length > 1 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={chartData} margin={{ top: 18, right: 18, bottom: 4, left: 0 }}>
                    <defs>
                      <linearGradient id="stFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#c9a24b" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#c9a24b" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#3a332a" strokeDasharray="2 5" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "#8d8371", fontSize: 11 }} stroke="#4a4234"
                      label={{ value: "league day", position: "insideBottomRight", fill: "#6f6656", fontSize: 11, dy: 2 }} />
                    <YAxis tick={{ fill: "#8d8371", fontSize: 11 }} stroke="#4a4234" width={52}
                      tickFormatter={(v) => (currency === "chaos" ? fmtChaos(v) : fmtDiv(v))} />
                    <Tooltip
                      contentStyle={{ background: "#211c15", border: "1px solid #5a4d33", borderRadius: 6, fontSize: 12 }}
                      labelStyle={{ color: "#c9bfa8" }} itemStyle={{ color: "#e5d9b8" }}
                      formatter={(v, n) => [`${currency === "chaos" ? fmtChaos(v) : fmtDiv(v)} ${unit}`, n === "total" ? "Set total" : focusScarab]}
                      labelFormatter={(d) => `Day ${d}`} />
                    <Area type="monotone" dataKey="total" stroke="#d8b355" strokeWidth={2} fill="url(#stFill)" name="total" isAnimationActive={false} />
                    {focusScarab && <Line type="monotone" dataKey="focus" stroke={GROUP_TONES[openGroupData.name] || "#7fb4d4"} strokeWidth={1.8} dot={false} isAnimationActive={false} />}
                    {extremes && <ReferenceDot x={extremes.hi.day} y={extremes.hi.total} r={4} fill="#8fd47f" stroke="#1b150c"
                      label={{ value: `High ${currency === "chaos" ? fmtChaos(extremes.hi.total) : fmtDiv(extremes.hi.total)}${unit} · d${extremes.hi.day}`, fill: "#8fd47f", fontSize: 11, position: "top" }} />}
                    {extremes && <ReferenceDot x={extremes.lo.day} y={extremes.lo.total} r={4} fill="#d47f7f" stroke="#1b150c"
                      label={{ value: `Low ${currency === "chaos" ? fmtChaos(extremes.lo.total) : fmtDiv(extremes.lo.total)}${unit} · d${extremes.lo.day}`, fill: "#d47f7f", fontSize: 11, position: "bottom" }} />}
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="st-chart-empty">{histLoading ? "Loading price history…" : "No history available."}</div>
              )}
            </div>

            <div className="st-breakdown">
              <div className="st-breakdown-head">
                <span>Scarab</span><span>Price</span>
              </div>
              {openGroupData.members.map((m) => (
                <button key={m.name}
                  className={`st-row ${focusScarab === m.name ? "focused" : ""}`}
                  onClick={() => setFocusScarab(focusScarab === m.name ? null : m.name)}
                  title="Show this scarab on the chart">
                  <span className="st-row-name">
                    <ScarabIcon size={18} tone={GROUP_TONES[openGroupData.name] || "#c9a24b"} />
                    {m.name}
                  </span>
                  <span className="st-row-price"><PctBadge v={m[chgKey]} /> {fmtPrice(m.chaosValue, currency, divineRate)}</span>
                </button>
              ))}
              <div className="st-breakdown-hint">Tap a scarab to overlay it on the graph.</div>
            </div>
          </div>
        </section>
      )}

      {/* ---------- mechanic grid ---------- */}
      {tab === "prices" && (
      <main className="st-grid">
        {groups.map((g, i) => {
          const tone = GROUP_TONES[g.name] || "#c9a24b";
          const top = g.members[0];
          return (
            <button key={g.name}
              className={`st-card ${openGroup === g.name ? "open" : ""}`}
              style={{ "--tone": tone }}
              onClick={() => { setOpenGroup(openGroup === g.name ? null : g.name); setFocusScarab(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
              <div className="st-card-rank">{sortDir === "desc" ? i + 1 : groups.length - i}</div>
              <div className="st-card-main">
                <div className="st-card-name">
                  <ScarabIcon size={20} tone={tone} />
                  <span>{g.name}</span>
                  {g.name === "Universal" && <em className="st-tag">not tied to a mechanic</em>}
                </div>
                <div className="st-card-meta">{g.members.length} scarabs · top: {top?.name.replace(/^.*Scarab( of)? ?/, "") || "—"}</div>
              </div>
              <div className="st-card-total">
                <div className="st-card-total-num"><PctBadge v={g[chgKey]} /> {fmtPrice(g.total, currency, divineRate)}</div>
                <div className="st-card-total-lbl">full set · {chgWindow}</div>
              </div>
            </button>
          );
        })}
      </main>
      )}

      {/* ---------- popular farms tab ---------- */}
      {tab === "farms" && (
        <section className="st-farms">
          <p className="st-farms-intro">
            Scarab prices react fast when the player base changes farming strategies. Rising set
            prices mean players are buying in — a strat is getting popular. Falling prices mean the
            market is being flooded or a strat is dying off. Based on the last {chgWindow}
            {mode === "demo" ? " (sample data in this preview)" : ""}.
          </p>
          <div className="st-farms-cols">
            <div className="st-farms-col">
              <h3 className="st-farms-h up-h">Heating up</h3>
              {movers.rising.length === 0 && <div className="st-farms-empty">No mechanic is climbing right now.</div>}
              {movers.rising.map((g) => (
                <button key={g.name} className="st-mover" onClick={() => { setTab("prices"); setOpenGroup(g.name); setFocusScarab(null); }}>
                  <span className="st-mover-name"><ScarabIcon size={16} tone={GROUP_TONES[g.name] || "#c9a24b"} />{g.name}</span>
                  <span className="st-mover-bar"><i className="up" style={{ width: `${Math.min(100, (Math.abs(g[chgKey]) / movers.maxAbs) * 100)}%` }} /></span>
                  <PctBadge v={g[chgKey]} />
                </button>
              ))}
            </div>
            <div className="st-farms-col">
              <h3 className="st-farms-h down-h">Cooling off</h3>
              {movers.falling.length === 0 && <div className="st-farms-empty">No mechanic is dropping right now.</div>}
              {movers.falling.map((g) => (
                <button key={g.name} className="st-mover" onClick={() => { setTab("prices"); setOpenGroup(g.name); setFocusScarab(null); }}>
                  <span className="st-mover-name"><ScarabIcon size={16} tone={GROUP_TONES[g.name] || "#c9a24b"} />{g.name}</span>
                  <span className="st-mover-bar"><i className="down" style={{ width: `${Math.min(100, (Math.abs(g[chgKey]) / movers.maxAbs) * 100)}%` }} /></span>
                  <PctBadge v={g[chgKey]} />
                </button>
              ))}
            </div>
          </div>
          <h3 className="st-farms-h">Biggest single-scarab moves ({chgWindow})</h3>
          <div className="st-farms-scarabs">
            {movers.topScarabs.map((m) => (
              <button key={m.name} className="st-mover st-mover-scarab" onClick={() => { setTab("prices"); setOpenGroup(m.group); setFocusScarab(m.name); }}>
                <span className="st-mover-name"><ScarabIcon size={16} tone={GROUP_TONES[m.group] || "#c9a24b"} />{m.name}</span>
                <span className="st-mover-price">{fmtPrice(m.chaosValue, currency, divineRate)}</span>
                <PctBadge v={m[chgKey]} />
              </button>
            ))}
          </div>
          <p className="st-farms-note">Tap anything to jump to its price breakdown and league graph.</p>
        </section>
      )}

      <footer className="st-foot">
        Prices via poe.ninja · one of each scarab per set · Scarab Ledger is a fan tool, not affiliated with GGG.
      </footer>
    </div>
  );
}

/* ---------------- styles ---------------- */
const css = `
.st-root {
  min-height: 100vh;
  background:
    radial-gradient(1100px 500px at 50% -150px, #2b241a 0%, transparent 70%),
    #17130e;
  color: #d9cfb4;
  font-family: Georgia, 'Palatino Linotype', 'Times New Roman', serif;
  padding: 22px clamp(12px, 4vw, 44px) 40px;
}
.st-head { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-end; justify-content: space-between; margin-bottom: 14px; }
.st-title-block h1 {
  margin: 0; font-size: clamp(26px, 4vw, 36px); font-weight: 600; letter-spacing: 0.12em;
  color: #e8d9ae; text-transform: uppercase;
  text-shadow: 0 1px 0 #000, 0 0 22px rgba(201,162,75,0.25);
}
.st-sub { margin: 3px 0 0; font-size: 13px; color: #8d8371; letter-spacing: 0.04em; }
.st-controls { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
.st-ctl { display: flex; flex-direction: column; gap: 5px; font-size: 11px; }
.st-ctl > span { color: #8d8371; text-transform: uppercase; letter-spacing: 0.14em; }
.st-ctl select {
  background: #211c15; color: #d9cfb4; border: 1px solid #5a4d33; border-radius: 5px;
  padding: 7px 10px; font-family: inherit; font-size: 13px;
}
.st-ctl select:disabled { opacity: 0.55; }
.st-seg { display: flex; border: 1px solid #5a4d33; border-radius: 5px; overflow: hidden; }
.st-seg button {
  background: #211c15; color: #a99c7f; border: none; padding: 7px 12px; cursor: pointer;
  font-family: inherit; font-size: 13px; border-right: 1px solid #3a332a;
}
.st-seg button:last-child { border-right: none; }
.st-seg button.on { background: #4a3c20; color: #f0e2b6; }
.st-seg button:focus-visible, .st-ctl select:focus-visible, .st-card:focus-visible, .st-row:focus-visible, .st-close:focus-visible {
  outline: 2px solid #d8b355; outline-offset: 2px;
}
.st-check { flex-direction: row; align-items: center; gap: 8px; padding-bottom: 8px; cursor: pointer; }
.st-check input { accent-color: #c9a24b; width: 15px; height: 15px; }
.st-check span { text-transform: none; letter-spacing: 0.02em; font-size: 13px; color: #c4b795; }
.st-banner {
  border: 1px solid #6b5730; background: #2a2214; color: #d9c48a; font-size: 13px;
  padding: 9px 14px; border-radius: 6px; margin: 6px 0 16px; line-height: 1.45;
}
.st-banner.st-quiet { background: #1d1912; border-color: #3a332a; color: #8d8371; }
.st-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 10px; }
.st-card {
  display: flex; align-items: center; gap: 12px; text-align: left; cursor: pointer;
  background: linear-gradient(180deg, #231d15 0%, #1c1710 100%);
  border: 1px solid #4a4234; border-radius: 7px; padding: 12px 14px;
  color: inherit; font-family: inherit;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.5);
  transition: border-color 120ms ease, transform 120ms ease;
}
.st-card:hover { border-color: var(--tone); transform: translateY(-1px); }
.st-card.open { border-color: var(--tone); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.5), 0 0 14px -6px var(--tone); }
@media (prefers-reduced-motion: reduce) { .st-card, .st-card:hover { transition: none; transform: none; } }
.st-card-rank { font-size: 12px; color: #6f6656; min-width: 20px; text-align: right; font-variant-numeric: tabular-nums; }
.st-card-main { flex: 1; min-width: 0; }
.st-card-name { display: flex; align-items: center; gap: 8px; font-size: 16px; color: #ead9a8; letter-spacing: 0.03em; }
.st-tag { font-size: 10.5px; color: #8d8371; font-style: italic; }
.st-card-meta { font-size: 11.5px; color: #8d8371; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-card-total { text-align: right; }
.st-card-total-num { font-size: 17px; color: #f0dfa8; font-variant-numeric: tabular-nums; }
.st-card-total-lbl { font-size: 10px; color: #6f6656; text-transform: uppercase; letter-spacing: 0.12em; }
.st-panel {
  border: 1px solid #6b5730; border-radius: 8px; background: #1d1811; margin-bottom: 16px;
  box-shadow: 0 8px 30px -18px #000;
}
.st-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #3a332a; flex-wrap: wrap; }
.st-panel-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.st-panel-title h2 { margin: 0; font-size: 19px; color: #ead9a8; letter-spacing: 0.06em; text-transform: capitalize; }
.st-panel-total { font-size: 13.5px; color: #c4b795; border: 1px solid #5a4d33; border-radius: 999px; padding: 3px 11px; font-variant-numeric: tabular-nums; }
.st-close {
  background: none; border: 1px solid #5a4d33; color: #a99c7f; border-radius: 5px;
  padding: 5px 12px; cursor: pointer; font-family: inherit; font-size: 12.5px;
}
.st-close:hover { color: #ead9a8; border-color: #8d7442; }
.st-panel-body { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr); gap: 0; }
@media (max-width: 860px) { .st-panel-body { grid-template-columns: 1fr; } }
.st-chart { padding: 12px 8px 8px 4px; min-width: 0; }
.st-chart-label { font-size: 12px; color: #8d8371; padding: 0 0 6px 14px; }
.st-chart-label em { color: #c4b795; }
.st-loading { color: #6f6656; }
.st-chart-empty { height: 260px; display: grid; place-items: center; color: #6f6656; font-size: 13px; }
.st-breakdown { border-left: 1px solid #3a332a; max-height: 340px; overflow-y: auto; }
@media (max-width: 860px) { .st-breakdown { border-left: none; border-top: 1px solid #3a332a; } }
.st-breakdown-head {
  display: flex; justify-content: space-between; padding: 9px 14px; font-size: 10.5px;
  color: #6f6656; text-transform: uppercase; letter-spacing: 0.14em;
  position: sticky; top: 0; background: #1d1811; border-bottom: 1px solid #2c261d;
}
.st-row {
  display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%;
  background: none; border: none; border-bottom: 1px solid #26211a; padding: 8px 14px;
  color: #cfc3a2; font-family: inherit; font-size: 13.5px; cursor: pointer; text-align: left;
}
.st-row:hover { background: #241e15; }
.st-row.focused { background: #2c2414; color: #f0dfa8; }
.st-row-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.st-row-price { font-variant-numeric: tabular-nums; color: #e5d49c; white-space: nowrap; }
.st-breakdown-hint { padding: 8px 14px 12px; font-size: 11px; color: #6f6656; }
.st-foot { margin-top: 26px; font-size: 11.5px; color: #6f6656; text-align: center; letter-spacing: 0.03em; }
.st-pct { font-size: 11px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; margin-right: 6px; white-space: nowrap; }
.st-pct.up { color: #8fd47f; }
.st-pct.down { color: #d47f7f; }
.st-pct.flat { color: #6f6656; }
.st-tabs { display: flex; gap: 4px; border-bottom: 1px solid #3a332a; margin: 4px 0 12px; }
.st-tabs button {
  background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer;
  color: #8d8371; font-family: inherit; font-size: 14px; letter-spacing: 0.08em;
  text-transform: uppercase; padding: 8px 14px 10px;
}
.st-tabs button.on { color: #ead9a8; border-bottom-color: #c9a24b; }
.st-tabs button:hover { color: #c4b795; }
.st-tabs button:focus-visible { outline: 2px solid #d8b355; outline-offset: -2px; }
.st-farms-intro { max-width: 720px; font-size: 13.5px; line-height: 1.55; color: #b3a888; margin: 2px 0 18px; }
.st-farms-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-bottom: 24px; }
@media (max-width: 760px) { .st-farms-cols { grid-template-columns: 1fr; } }
.st-farms-h { font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; color: #8d8371; margin: 0 0 8px; }
.st-farms-h.up-h { color: #8fd47f; }
.st-farms-h.down-h { color: #d47f7f; }
.st-farms-empty { font-size: 13px; color: #6f6656; padding: 8px 2px; }
.st-mover {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(60px, 130px) auto; align-items: center;
  gap: 10px; width: 100%; background: #1d1811; border: 1px solid #2c261d; border-radius: 6px;
  padding: 8px 12px; margin-bottom: 6px; cursor: pointer; color: #cfc3a2;
  font-family: inherit; font-size: 13.5px; text-align: left;
}
.st-mover:hover { border-color: #5a4d33; }
.st-mover:focus-visible { outline: 2px solid #d8b355; outline-offset: 2px; }
.st-mover-name { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-mover-bar { height: 7px; background: #26211a; border-radius: 999px; overflow: hidden; }
.st-mover-bar i { display: block; height: 100%; border-radius: 999px; }
.st-mover-bar i.up { background: linear-gradient(90deg, #4e7a45, #8fd47f); }
.st-mover-bar i.down { background: linear-gradient(90deg, #7a4545, #d47f7f); }
.st-mover .st-pct { margin-right: 0; }
.st-farms-scarabs { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 6px 12px; }
.st-mover-scarab { grid-template-columns: minmax(0, 1fr) auto auto; margin-bottom: 0; }
.st-mover-price { font-variant-numeric: tabular-nums; color: #e5d49c; white-space: nowrap; font-size: 12.5px; }
.st-farms-note { font-size: 11.5px; color: #6f6656; margin-top: 14px; }
`;
