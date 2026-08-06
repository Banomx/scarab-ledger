import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BIOMES, NODES, TUNABLES, DEFAULTS, SOURCES, DELVE_BOSSES, RESONATOR_ORDER, RESONATOR_SOCKETS,
} from "./delveData.js";
import {
  makePriceOf, fossilRows, computeBiomes, computeDelveBosses, killDistribution,
  biomeValueSeries, loadSettings, saveSettings, sanitizeSettings,
} from "./delve.js";
import { makeResolver } from "./bossProfit.js";
import PriceChart, { PctBadge, rateAt } from "./PriceChart.jsx";
import { unitForSeries } from "./money.js";

/* ================================================================
   DELVE
   What a delve level is worth, and where to point it.

   Three views, in the order you actually ask the questions:

     Fossils   what's a fossil worth and what moved. Same shape as the
               astrolabe/catalyst tabs — toolbar, one chart, one grid —
               because it is the same question about different items.
     Biomes    which biome do I want at this depth? A biome is quoted at
               the value of the node you steer into it for — its Crystal
               Spire, its Humid Fissure, its boss — never per delve or per
               hour, because that needs a node frequency nobody publishes.
               Opening one gives it the mechanic panel treatment: that node
               charted over the league, the biome's fossils beside it, and
               what every other node there pays.
     Bosses    a delve boss is a handful of kills a league, not a farm.
               So the tab leads with the spread of a SINGLE kill, and
               keeps the mean next to it rather than instead of it.

   Everything the wiki does not publish — fossils per node, nodes per
   delve, how often a city carries its boss — is an editable assumption,
   badged as one. See the header comment in delveData.js.
   ================================================================ */

const num = (v, d) => (v == null || !isFinite(Number(v)) ? d : Number(v));
const pctText = (v) => (v >= 0.1 ? `${(v * 100).toFixed(0)}%` : v >= 0.001 ? `${(v * 100).toFixed(1)}%` : v > 0 ? "<0.1%" : "—");

const CHG_KEYS = { "4h": "change4", "8h": "change8", "12h": "change12", "24h": "change24", "48h": "change48" };
const BIOME_NAME = Object.fromEntries(BIOMES.map((b) => [b.id, b.name]));
const BIOME_TONE = Object.fromEntries(BIOMES.map((b) => [b.id, b.tone]));
const BOSS_NAME = Object.fromEntries(DELVE_BOSSES.map((b) => [b.id, b.name]));

/* A fossil reads as a shard: hexagonal, tinted by the biome it comes from,
   with a brighter core for the six that only drop from their own node. */
function FossilIcon({ tone = "#c9a24b", exclusive = false, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M12 2.6 L19.6 7 L19.6 17 L12 21.4 L4.4 17 L4.4 7 Z"
        fill={tone} fillOpacity={exclusive ? 0.9 : 0.55} stroke="#1b150c" strokeWidth="1.1" />
      <path d="M12 7 L15.8 9.2 L15.8 14.8 L12 17 L8.2 14.8 L8.2 9.2 Z"
        fill={exclusive ? "#f0dfa8" : "#1b150c"} fillOpacity={exclusive ? 0.75 : 0.25} />
    </svg>
  );
}

function ResonatorIcon({ sockets = 1, size = 20 }) {
  const pts = [[12, 6.4], [16.4, 12], [12, 17.6], [7.6, 12]];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="4" y="4" width="16" height="16" rx="3" fill="#3a332a" stroke="#6b5730" strokeWidth="1.1" />
      {pts.slice(0, sockets).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill="#c9a24b" stroke="#1b150c" strokeWidth="0.8" />
      ))}
    </svg>
  );
}

/* Controlled number input that lets you clear the field while typing.
   Same behaviour as the boss tab's, kept local so neither tab can break
   the other by tweaking it. */
function NumInput({ value, onCommit, step = 1, min = 0, width = 62, suffix, title }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value ?? "")); }, [value]);
  return (
    <span className="dl-num" title={title}>
      <input
        type="number" step={step} min={min} value={draft} style={{ width }}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          focused.current = false;
          const n = Number(e.target.value);
          if (e.target.value === "" || !isFinite(n)) { setDraft(String(value ?? "")); return; }
          onCommit(n);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

const DEPTH_PRESETS = [100, 250, 500, 1000];
const VIEWS = [["fossils", "Fossils & resonators"], ["biomes", "Biomes"], ["bosses", "Bosses"]];

export default function Delve({ league, staticBase, currency, divineRate, fmtPrice, fmtChaos, unitFor }) {
  const [view, setView] = useState("fossils");
  const [settings, setSettings] = useState(() => loadSettings());
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [openBiome, setOpenBiome] = useState(null);
  const [openBoss, setOpenBoss] = useState(DELVE_BOSSES[0].id);
  const [rankBy, setRankBy] = useState("value");        // value | expected
  const [sortDir, setSortDir] = useState("desc");
  const [chgWindow, setChgWindow] = useState("24h");
  const [filter, setFilter] = useState("");
  const [selFossil, setSelFossil] = useState(null);     // charted on the Fossils view
  const [focusFossil, setFocusFossil] = useState(null); // overlaid on a biome's curve
  const [dragSel, setDragSel] = useState(null);
  const [realMode, setRealMode] = useState(false);      // read every % in divine terms
  const [fossilData, setFossilData] = useState(null);   // {items, generatedAt} | "missing"
  const [resoData, setResoData] = useState(null);
  const [hist, setHist] = useState({});                 // name -> [{day, value}]
  const [priceMap, setPriceMap] = useState(null);       // prices.json | "missing"
  const [generatedAt, setGeneratedAt] = useState(null);

  useEffect(() => { saveSettings(settings); }, [settings]);

  const patch = useCallback((p) => setSettings((s) => sanitizeSettings({ ...s, ...p })), []);

  /* ---- data ----
     Four snapshots, all optional in different ways:
       fossils.json / resonators.json    price + trend for the two lists
       *-history.json                    the curves
       prices.json                       the broad name->price map the boss
                                         EV needs. Fossils are in it too, so
                                         it doubles as the fallback for a
                                         snapshot taken before this feature
                                         started writing fossils.json. */
  useEffect(() => {
    let cancelled = false;
    const grab = async (file, set) => {
      try {
        const res = await fetch(`${staticBase}/${file}`);
        if (res.ok) { const j = await res.json(); if (!cancelled) set(j); return; }
      } catch { /* fall through */ }
      if (!cancelled) set("missing");
    };
    setFossilData(null); setResoData(null); setPriceMap(null); setHist({});
    grab("fossils.json", (j) => { setFossilData(j); if (j !== "missing" && j.generatedAt) setGeneratedAt(j.generatedAt); });
    grab("resonators.json", setResoData);
    grab("fossils-history.json", (j) => { if (j !== "missing") setHist((h) => ({ ...h, ...j })); });
    grab("resonators-history.json", (j) => { if (j !== "missing") setHist((h) => ({ ...h, ...j })); });
    grab("prices.json", (j) => {
      if (j === "missing") { setPriceMap("missing"); return; }
      setPriceMap(j.prices || {});
      setGeneratedAt((g) => g || j.generatedAt || null);
    });
    return () => { cancelled = true; };
  }, [staticBase]);

  const fossilItems = fossilData && fossilData !== "missing" ? fossilData.items || [] : [];
  const resoItems = resoData && resoData !== "missing" ? resoData.items || [] : [];
  const rate = (fossilData && fossilData !== "missing" && fossilData.divineRate) || divineRate;
  const axisLabel = (fossilData && fossilData !== "missing" && fossilData.historyAxis) || "days since first snapshot";

  /* Divine-adjusted needs two things, and they go missing independently:
     the rate CURVE (for the dashed line and the drag readout) and the
     per-item change*R fields (for the badges). A snapshot taken before the
     rate feature existed has prices but no rate, so it has neither; one
     taken since has both. Checked separately so the banner can say which
     case you are in instead of the toggle silently doing nothing. */
  const rateHistory = useMemo(() => {
    const fromFossils = fossilData && fossilData !== "missing" ? fossilData.rateHistory : null;
    const fromReso = resoData && resoData !== "missing" ? resoData.rateHistory : null;
    return (Array.isArray(fromFossils) && fromFossils.length ? fromFossils : fromReso) || [];
  }, [fossilData, resoData]);
  const rateReady = rateHistory.length > 1;
  const realBadges = useMemo(
    () => [...fossilItems, ...resoItems].some((it) => isFinite(it.change24R) || isFinite(it.change48R)),
    [fossilData, resoData]
  );
  const useReal = realMode && rateReady;

  const trendBy = useMemo(() => {
    const m = {};
    for (const it of [...fossilItems, ...resoItems]) m[it.name] = it;
    return m;
  }, [fossilData, resoData]);

  /* fossils.json carries trend data; prices.json does not. Prefer the first
     for anything it knows and let the second fill the rest, so a league whose
     snapshot predates fossils.json still gets numbers. */
  const priceOf = useMemo(() => {
    const fromCategory = {};
    for (const it of [...fossilItems, ...resoItems]) if (it.chaosValue > 0) fromCategory[it.name] = { c: it.chaosValue, n: 1 };
    const map = priceMap && priceMap !== "missing" ? priceMap : null;
    return makePriceOf([fromCategory, map], { overrides: settings.priceOverrides || {}, divineRate: rate });
  }, [fossilData, resoData, priceMap, settings.priceOverrides, rate]);

  const havePrices = (fossilItems.length > 0) || (priceMap && priceMap !== "missing");

  /* The boss engine wants prices.json's { name: {c,lo,hi,n} } shape. */
  const resolve = useMemo(
    () => makeResolver(priceMap && priceMap !== "missing" ? priceMap : null, {
      priceOverrides: settings.priceOverrides || {}, divineRate: rate,
    }),
    [priceMap, settings.priceOverrides, rate]
  );

  const bosses = useMemo(() => computeDelveBosses(resolve, settings), [resolve, settings]);
  const bossValues = useMemo(() => Object.fromEntries(bosses.map((b) => [b.delve.id, b.gross])), [bosses]);
  const dists = useMemo(() => {
    const out = {};
    for (const b of bosses) out[b.delve.id] = killDistribution(b, 4000);
    return out;
  }, [bosses]);

  const biomes = useMemo(() => computeBiomes(priceOf, settings, bossValues), [priceOf, settings, bossValues]);
  const fossils = useMemo(() => fossilRows(priceOf), [priceOf]);

  const ranked = useMemo(() => {
    const rows = [...biomes.rows];
    rows.sort((a, b) => (rankBy === "expected" ? b.expected - a.expected : b.headline - a.headline));
    return rows;
  }, [biomes, rankBy]);

  /* What the divine itself did over the same window the badges use. Without
     this the toggle is a black box: you see every fossil turn red and cannot
     tell whether fossils fell or the divine ran away from them. */
  const rateDrift = useMemo(() => {
    if (!rateReady) return null;
    const hours = parseInt(chgWindow, 10);
    const last = rateHistory[rateHistory.length - 1];
    const wantDay = last.day - hours / 24;
    const then = rateHistory.reduce((best, p) => (Math.abs(p.day - wantDay) < Math.abs(best.day - wantDay) ? p : best), rateHistory[0]);
    if (!(then.rate > 0) || !(last.rate > 0)) return null;
    return { pct: (last.rate / then.rate - 1) * 100, now: last.rate };
  }, [rateHistory, rateReady, chgWindow]);

  const money = (c) => (c > 0 ? fmtPrice(c, currency, rate) : "—");
  const chgKey = CHG_KEYS[chgWindow] || "change24";
  const chgOf = (name) => {
    const it = trendBy[name];
    if (!it) return undefined;
    return (useReal && realBadges) ? it[`${chgKey}R`] : it[chgKey];
  };

  const reset = () => setSettings(sanitizeSettings({ ...DEFAULTS, depth: settings.depth }));

  /* ---- fossils view: list + chart ---- */
  const fossilList = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = fossils.filter((f) => f.found || !havePrices);
    if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
    return list.sort((a, b) => (sortDir === "desc" ? b.chaos - a.chaos : a.chaos - b.chaos));
  }, [fossils, filter, sortDir, havePrices]);

  /* Resonators share the chart but not the grid: one graph, two lists, and
     sorting or filtering one never reorders the other. */
  const resoList = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = resoItems.filter((it) => !q || it.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => (sortDir === "desc" ? b.chaosValue - a.chaosValue : a.chaosValue - b.chaosValue));
  }, [resoItems, filter, sortDir]);

  const selectable = useMemo(
    () => new Set([...fossilList.map((f) => f.name), ...resoList.map((r) => r.name)]),
    [fossilList, resoList]
  );
  const selName = (selFossil && selectable.has(selFossil)) ? selFossil : fossilList[0]?.name || resoList[0]?.name;
  const fossilChart = useMemo(() => {
    const s = hist[selName] || [];
    const cur = unitForSeries(s.map((p) => p.value), currency, rate);
    const div = cur === "divine" ? rate : 1;
    return {
      cur,
      rows: s.map((p) => ({
        day: p.day, chaos: p.value, rate: rateAt(rateHistory, p.day),
        value: Math.round((p.value / div) * 100) / 100,
      })),
    };
  }, [hist, selName, currency, rate, rateHistory]);

  /* ---- biome panel ---- */
  const openRow = openBiome ? biomes.rows.find((r) => r.biome.id === openBiome) : null;
  const biomeChart = useMemo(() => {
    if (!openRow) return { rows: [], cur: "chaos" };
    const base = biomeValueSeries(openRow.biome, hist, settings, bossValues[openRow.biome.boss] ?? null);
    const cur = unitForSeries(base.map((p) => p.value), currency, rate);
    const div = cur === "divine" ? rate : 1;
    const overlay = focusFossil ? (hist[focusFossil] || []) : null;
    const at = (h, d) => (h.find((p) => p.day === d)
      ?? h.reduce((best, p) => (Math.abs(p.day - d) < Math.abs(best.day - d) ? p : best), h[0]));
    return {
      cur,
      rows: base.map((p) => ({
        day: p.day, chaos: p.value, rate: rateAt(rateHistory, p.day),
        value: Math.round((p.value / div) * 100) / 100,
        overlay: overlay && overlay.length ? Math.round((at(overlay, p.day).value / div) * 100) / 100 : null,
      })),
    };
  }, [openRow, hist, settings, bossValues, currency, rate, focusFossil, rateHistory]);

  return (
    <section className="dl-wrap">
      {/* ---------- bar ---------- */}
      <div className="dl-bar">
        <label className="dl-field">
          <span>Depth</span>
          <NumInput value={settings.depth} step={10} min={1} width={82}
            onCommit={(n) => patch({ depth: n })} title="Biome spawn weights, and which bosses exist, both key off depth" />
        </label>
        <div className="dl-presets">
          {DEPTH_PRESETS.map((d) => (
            <button key={d} className={settings.depth === d ? "on" : ""} onClick={() => patch({ depth: d })}>{d}</button>
          ))}
        </div>
        <div className="dl-headline"
          title="What an ordinary 'Contains Fossils' node pays at this depth, averaged over the biomes that spawn here and weighted by how common each is. A biome's own node — Crystal Spire and friends — is worth much more; see the Biomes view.">
          <strong>{money(biomes.avgFossilNode)}</strong>
          <em>an ordinary fossil node at depth {settings.depth}</em>
        </div>
        <button className="dl-assume-btn" onClick={() => setShowAssumptions((v) => !v)}>
          {showAssumptions ? "Hide" : "Assumptions"}
        </button>
        <button className="dl-reset" onClick={reset}>Reset</button>
      </div>

      {showAssumptions && (
        <div className="dl-assume">
          <p className="dl-assume-lead">
            The wiki publishes biome pools, spawn weights and boss drop rates. It does not publish how many
            fossils a node drops, so that is yours to set. Two of these have someone's counted figure behind
            them and are badged <em className="dl-src ok">seen</em>; the rest are badged{" "}
            <em className="dl-src warn">guess</em> and are set low on purpose, so the tab understates a biome
            rather than talking you into one. Hover any row for where its number came from. Fossil prices and
            boss drop rates depend on none of it.
          </p>
          {[...new Set(TUNABLES.map((t) => t.group))].map((group) => (
            <div key={group} className="dl-assume-group">
              <h4>{group}</h4>
              {TUNABLES.filter((t) => t.group === group).map((t) => (
                <label key={t.key} className="dl-assume-row" title={t.help}>
                  <span>
                    {t.label}
                    {/* A number somebody counted should not sit next to one I
                        picked out of the air looking equally solid. */}
                    <em className={`dl-src ${SOURCES[t.source]?.tone || ""}`}>{SOURCES[t.source]?.tag}</em>
                  </span>
                  <NumInput value={num(settings[t.key], DEFAULTS[t.key])} step={t.step}
                    onCommit={(n) => patch({ [t.key]: n })} />
                </label>
              ))}
            </div>
          ))}
          <div className="dl-assume-group">
            <h4>Fractured walls</h4>
            <label className="st-check">
              <input type="checkbox" checked={settings.openWalls !== false}
                onChange={(e) => patch({ openWalls: e.target.checked })} />
              <span>Count wall-locked fossils (Gilded, Lucent, Sanctified)</span>
            </label>
            <p className="dl-assume-note">
              Those three sit behind fractured walls. If you don't carry the dynamite budget to open them,
              turn this off and the pool averages drop them.
            </p>
          </div>
        </div>
      )}

      {/* The tab used to quote biomes "per delve", which multiplied every
          figure by a node frequency nobody publishes and I had guessed 3x
          too high. The unit is one NODE now: price x count, both checkable.
          Said out loud, because a unit you have to infer is the bug. */}
      <p className="dl-define">
        A biome is quoted at <strong>the value of the node you steer into it for</strong> — its Crystal
        Spire, its Humid Fissure, its boss — in <strong>fossils only</strong>. Per node, never per delve or
        per hour: those need how often a node turns up, which is published nowhere. How many fossils a node
        drops is still an{" "}
        <button className="dl-inline-link" onClick={() => setShowAssumptions(true)}>assumption you set</button>.
      </p>

      {!havePrices && (
        <div className="st-banner">
          No price snapshot for {league} yet. Fossil and boss values need <code>fossils.json</code> or{" "}
          <code>prices.json</code>, which the data workflow writes alongside the scarab data — they appear
          after the next refresh. Biome structure, depth thresholds and drop rates are shown regardless.
        </div>
      )}
      {havePrices && (
        <div className="st-banner st-quiet">
          Prices via poe.ninja · {league}
          {generatedAt ? ` · updated ${new Date(generatedAt).toLocaleString()}` : ""}
          {" · "}1 Divine ≈ {Math.round(rate)} Chaos
          {fossilData === "missing" && priceMap && priceMap !== "missing" ? " · fossil trends appear after the next refresh" : ""}
          {useReal && rateDrift && (
            <span className="st-banner-real">
              {" "}· divine {rateDrift.pct >= 0 ? "+" : "−"}{Math.abs(rateDrift.pct).toFixed(1)}% in {chgWindow}
              {realBadges
                ? ", so every % here is divine-adjusted"
                : " — these snapshots predate the stored rate, so the % badges stay in chaos"}
            </span>
          )}
        </div>
      )}

      <div className="dl-views">
        {VIEWS.map(([k, label]) => (
          <button key={k} className={view === k ? "on" : ""}
            onClick={() => { setView(k); setDragSel(null); }}>{label}</button>
        ))}
      </div>

      {/* ================= FOSSILS ================= */}
      {view === "fossils" && (
        <>
          <div className="st-tools">
            <div className="st-ctl">
              <span>Sort by price</span>
              <div className="st-seg">
                <button className={sortDir === "desc" ? "on" : ""} onClick={() => setSortDir("desc")}>High → Low</button>
                <button className={sortDir === "asc" ? "on" : ""} onClick={() => setSortDir("asc")}>Low → High</button>
              </div>
            </div>
            <div className="st-ctl">
              <span>Price change</span>
              <div className="st-seg">
                {["4h", "8h", "12h", "24h", "48h"].map((w) => (
                  <button key={w} className={chgWindow === w ? "on" : ""} onClick={() => setChgWindow(w)}>{w}</button>
                ))}
              </div>
            </div>
            <div className="st-ctl st-checks">
              <span>Divine drift</span>
              <div className="st-checks-row">
                <label className={`st-check ${rateReady ? "" : "st-check-off"}`}
                  title={rateReady
                    ? "Price everything in divine instead of chaos: a fossil only counts as up if it beat the divine rate."
                    : "Needs at least two snapshots with a stored divine rate — it builds up over the next few data refreshes."}>
                  <input type="checkbox" checked={useReal} disabled={!rateReady}
                    onChange={(e) => setRealMode(e.target.checked)} />
                  <span>Divine-adjusted</span>
                </label>
              </div>
            </div>
            <label className="st-ctl">
              <span>Filter</span>
              <input className="st-tool-filter" type="text" placeholder="Filter fossils & resonators"
                value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          </div>

          <section className="st-cat-wrap">
            <PriceChart
              rows={fossilChart.rows}
              cur={fossilChart.cur}
              height={fossilChart.rows.length > 1 ? 220 : 64}
              axisLabel={axisLabel}
              label={selName ? <>Price history: <em>{selName}</em></> : "Select a fossil"}
              seriesName={selName}
              dragSel={dragSel} setDragSel={setDragSel}
              realMode={realMode} rateReady={rateReady}
            />
            <div className="st-cat-grid">
              {fossilList.map((f) => (
                <button key={f.name}
                  className={`st-row ${selName === f.name ? "focused" : ""}`}
                  onClick={() => { setSelFossil(f.name); setDragSel(null); }}
                  title={f.exclusive ? `${f.exclusive.node} · ${BIOME_NAME[f.exclusive.biome]}` : f.biomes.map((b) => BIOME_NAME[b]).join(", ")}>
                  <span className="st-row-name">
                    <FossilIcon tone={BIOME_TONE[f.biomes[0]] || "#c9a24b"} exclusive={!!f.exclusive} />
                    {f.name}
                    {f.exclusive && <em className="dl-flag">node</em>}
                    {f.wall && <em className="dl-flag" title="Behind a fractured wall">wall</em>}
                  </span>
                  <span className="st-row-price"><PctBadge v={chgOf(f.name)} real={useReal && realBadges} /> {money(f.chaos)}</span>
                </button>
              ))}
              {!fossilList.length && <div className="st-cat-note">No fossil matches that filter.</div>}
            </div>

            <div className="dl-sub-head">
              Resonators
              <em>same graph, own list — sorting these never reorders the fossils</em>
            </div>
            {resoList.length ? (
              <div className="st-cat-grid">
                {resoList.map((it) => {
                  const tier = RESONATOR_ORDER.find((t) => it.name.startsWith(t));
                  return (
                    <button key={it.name}
                      className={`st-row ${selName === it.name ? "focused" : ""}`}
                      onClick={() => { setSelFossil(it.name); setDragSel(null); }}
                      title="Show price history">
                      <span className="st-row-name">
                        <ResonatorIcon sockets={tier ? RESONATOR_SOCKETS[tier] : 1} />
                        {it.name.replace(/ Resonator$/, "")}
                        {tier && <em className="dl-flag" title={`${RESONATOR_SOCKETS[tier]} sockets`}>{RESONATOR_SOCKETS[tier]}s</em>}
                      </span>
                      <span className="st-row-price"><PctBadge v={chgOf(it.name)} real={useReal && realBadges} /> {money(it.chaosValue)}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="st-cat-note">
                {resoItems.length
                  ? "No resonator matches that filter."
                  : <>No resonator snapshot yet — <code>resonators.json</code> appears after the next data refresh.</>}
              </div>
            )}
          </section>

          <h4 className="dl-h">What a node is worth</h4>
          <p className="dl-note">
            One node, not one delve — priced against the biome you are standing in. A biome node is worth
            its own fossil; everything else is worth that biome's pool average. Multiply by how often you
            actually find one to get a per-delve figure, which is what the Biomes view does.
          </p>
          <div className="dl-table-wrap">
            <table className="dl-table">
              <thead><tr><th>Node</th><th>Biome</th><th className="r">Value</th></tr></thead>
              <tbody>
                {NODES.filter((n) => n.kind === "exclusive").map((n) => {
                  const row = biomes.rows.find((r) => r.biome.id === n.biome);
                  return (
                    <tr key={n.id}>
                      <td>{n.name}<em className="dl-flag">{n.fossil.replace(/ Fossil$/, "")}</em></td>
                      <td>{BIOME_NAME[n.biome]}</td>
                      <td className="r num">{money(row?.exclusive?.nodeValue || 0)}</td>
                    </tr>
                  );
                })}
                <tr className="dl-sep"><td colSpan={3}>Generic, priced per biome</td></tr>
                {biomes.rows.filter((r) => r.poolNames.length).map((r) => (
                  <tr key={`g-${r.biome.id}`}>
                    <td>Fossil node / smuggler's cache</td>
                    <td>{r.biome.name}</td>
                    <td className="r num">{money(r.genericNode)} / {money(r.cacheNode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ================= BIOMES ================= */}
      {view === "biomes" && (
        <>
          <div className="dl-subbar">
            <div className="st-seg">
              <button className={rankBy === "value" ? "on" : ""} onClick={() => setRankBy("value")}
                title="What a delve level of this biome is worth if you steer into it">Worth steering to</button>
              <button className={rankBy === "expected" ? "on" : ""} onClick={() => setRankBy("expected")}
                title="That value times how much of the mine the biome occupies at this depth">Weighted by how common</button>
            </div>
            <span className="dl-mode-note">
              {rankBy === "expected"
                ? <>Each biome's worth <strong>thinned by how rarely it spawns</strong> at depth {settings.depth}. Answers "which biome am I likely to actually get value out of", not "which is best".</>
                : <>What a biome is worth is <strong>the node you steer into it for</strong> — its Crystal Spire, its Humid Fissure, its boss. Rarity is not in these numbers: Primeval Ruins tops the list on Aul alone and still shows up in about 1 biome in 40.</>}
            </span>
            {biomes.anyInterpolated && (
              <span className="dl-hint">
                Depth {settings.depth} sits inside at least one biome's weight ramp — the wiki gives both ends
                and says the middle scales non-linearly without giving the curve, so those shares are
                eased between the two and are approximate.
              </span>
            )}
          </div>

          {/* expanded biome — same shape as the mechanic panel on Scarabs */}
          {openRow && (
            <section className="st-panel">
              <div className="st-panel-head">
                <div className="st-panel-title">
                  <FossilIcon size={26} tone={openRow.biome.tone} exclusive />
                  <h2>{openRow.biome.name}</h2>
                  <span className="st-panel-total" title={`One ${openRow.headlineLabel}. Not a per-delve or per-hour figure — this tab does not claim to know how often you find one.`}>
                    {money(openRow.headline)} · {openRow.headlineLabel}
                  </span>
                  <span className="st-panel-total">{pctText(openRow.share)} of the mine</span>
                  {openRow.biome.city && <em className="st-tag st-tag-panel">city biome</em>}
                </div>
                <button className="st-close" onClick={() => { setOpenBiome(null); setFocusFossil(null); setDragSel(null); }}>Close</button>
              </div>

              <div className="st-panel-body">
                <div>
                  <PriceChart
                    rows={biomeChart.rows}
                    cur={biomeChart.cur}
                    height={biomeChart.rows.length > 1 ? 260 : 64}
                    axisLabel={axisLabel}
                    label={focusFossil ? <><>{openRow.headlineLabel}</> <em>and</em> {focusFossil}</> : `${openRow.headlineLabel} across the league`}
                    seriesName={openRow.headlineLabel}
                    overlayName={focusFossil}
                    overlayTone={openRow.biome.tone}
                    dragSel={dragSel} setDragSel={setDragSel}
                    empty={openRow.biome.city
                      ? "City biomes have no fossil pool — their value is their boss, and a drop table has no price history."
                      : "History builds up with each data refresh — check back after a couple of runs."}
                  />
                  <div className="dl-panel-detail">
                    {openRow.exclusive && (
                      <p className="dl-excl">
                        <strong>{openRow.exclusive.node}</strong> → {settings.exclusiveQty}× {openRow.exclusive.fossil}
                        {openRow.exclusive.found
                          ? <> @ {money(openRow.exclusive.chaos)} = <b>{money(openRow.exclusive.nodeValue)}</b> a node</>
                          : <em className="dl-flag warn">no price</em>}
                      </p>
                    )}
                    {openRow.biome.city && openRow.biome.boss && (
                      <p className="dl-excl">
                        <strong>{BOSS_NAME[openRow.biome.boss]}</strong> from depth{" "}
                        {DELVE_BOSSES.find((x) => x.id === openRow.biome.boss).minDepth} ·{" "}
                        {money(bossValues[openRow.biome.boss] || 0)} a kill
                      </p>
                    )}
                    <h5>What each node here pays</h5>
                    <table className="dl-parts">
                      <tbody>
                        {openRow.exclusive && (
                          <tr className="dl-parts-total">
                            <td>{openRow.exclusive.node} <em className="dl-implied">{settings.exclusiveQty}× {openRow.exclusive.fossil.replace(/ Fossil$/, "")} + {openRow.exclusiveExtra ?? settings.exclusiveExtra} pool</em></td>
                            <td>{money(openRow.exclusive.nodeValue)}</td>
                          </tr>
                        )}
                        {openRow.bossNode && (
                          <tr className="dl-parts-total">
                            <td>{openRow.bossNode.name} <em className="dl-implied">one kill</em></td>
                            <td>{money(openRow.bossNode.value)}</td>
                          </tr>
                        )}
                        {!!openRow.poolNames.length && <tr><td>Generic fossil node <em className="dl-implied">{settings.genericQty}× pool</em></td><td>{money(openRow.genericNode)}</td></tr>}
                        {!!openRow.poolNames.length && <tr><td>Smuggler's cache <em className="dl-implied">{settings.cacheQty}× pool</em></td><td>{money(openRow.cacheNode)}</td></tr>}
                      </tbody>
                    </table>
                    {!!openRow.biome.themed.length && (
                      <>
                        <h5>Other nodes here</h5>
                        <p className="dl-note">{openRow.biome.themed.join(" · ")}</p>
                      </>
                    )}
                    <p className="dl-note">
                      Spawn weight {openRow.biome.weight.lo.weight} at depth ≤{openRow.biome.weight.lo.depth},{" "}
                      {openRow.biome.weight.hi.weight} at depth ≥{openRow.biome.weight.hi.depth}.
                      {openRow.biome.note ? ` ${openRow.biome.note}` : ""}
                      {openRow.poolCoverage < 1 && ` ${Math.round((1 - openRow.poolCoverage) * 100)}% of the pool has no price, so the average is over what is priced.`}
                    </p>
                  </div>
                </div>

                <div className="st-breakdown">
                  <div className="st-breakdown-head"><span>Fossil</span><span>Price</span></div>
                  {openRow.exclusive && (
                    <button className={`st-row ${focusFossil === openRow.exclusive.fossil ? "focused" : ""}`}
                      onClick={() => setFocusFossil(focusFossil === openRow.exclusive.fossil ? null : openRow.exclusive.fossil)}
                      title="Show this fossil on the chart">
                      <span className="st-row-name">
                        <FossilIcon size={18} tone={openRow.biome.tone} exclusive />
                        {openRow.exclusive.fossil}<em className="dl-flag">node</em>
                      </span>
                      <span className="st-row-price"><PctBadge v={chgOf(openRow.exclusive.fossil)} real={useReal && realBadges} /> {money(openRow.exclusive.chaos)}</span>
                    </button>
                  )}
                  {openRow.poolPrices.map((p) => (
                    <button key={p.name} className={`st-row ${focusFossil === p.name ? "focused" : ""}`}
                      onClick={() => setFocusFossil(focusFossil === p.name ? null : p.name)}
                      title="Show this fossil on the chart">
                      <span className="st-row-name">
                        <FossilIcon size={18} tone={openRow.biome.tone} />
                        {p.name}
                      </span>
                      <span className="st-row-price"><PctBadge v={chgOf(p.name)} real={useReal && realBadges} /> {money(p.chaos)}</span>
                    </button>
                  ))}
                  {!openRow.poolNames.length && !openRow.exclusive && (
                    <div className="dl-note" style={{ padding: "12px 14px" }}>
                      No fossil pool — a city biome's value is its boss.
                    </div>
                  )}
                  {!!openRow.poolNames.length && (
                    <div className="st-breakdown-hint">
                      Pool average {money(openRow.poolAvg)} · tap a fossil to overlay it on the graph.
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          <div className="dl-biomes">
            {ranked.map((r) => {
              const b = r.biome;
              const dead = r.weight <= 0;
              const headline = rankBy === "expected" ? r.expected : r.headline;
              return (
                <article key={b.id} className={`dl-biome${dead ? " dead" : ""}${openBiome === b.id ? " open" : ""}`} style={{ "--tone": b.tone }}>
                  <button className="dl-biome-head"
                    onClick={() => { setOpenBiome(openBiome === b.id ? null : b.id); setFocusFossil(null); setDragSel(null); }}
                    aria-expanded={openBiome === b.id}>
                    <span className="dl-dot" />
                    <span className="dl-biome-name">
                      {b.name}
                      {b.city && <em className="dl-flag">city</em>}
                      {dead && <em className="dl-flag warn">not at this depth</em>}
                    </span>
                    <span className="dl-biome-val"
                      title={rankBy === "expected"
                        ? `What this biome is worth — its ${r.headlineLabel} — thinned by the ${pctText(r.share)} of the mine it occupies at depth ${settings.depth}.`
                        : `What this biome is worth: one ${r.headlineLabel}, the node you steer into it for. Says nothing about how often you find one.`}>
                      {money(headline)}
                      <em>{rankBy === "expected" ? "/biome, weighted" : "/biome"}</em>
                    </span>
                  </button>

                  <div className="dl-share" title={`Spawn weight ${Math.round(r.weight)} — ${pctText(r.share)} of the mine at depth ${settings.depth}`}>
                    {!dead && <i style={{ width: `${Math.min(100, r.share * 100 * 3)}%` }} />}
                    <span>
                      {dead
                        ? `Doesn't spawn at depth ${settings.depth}`
                        : `${pctText(r.share)} of the mine${!r.exact ? " (approx)" : ""}`}
                    </span>
                  </div>

                  {r.exclusive && (
                    <div className="dl-excl">
                      <strong>{r.exclusive.node}</strong> → {settings.exclusiveQty}× {r.exclusive.fossil}
                      {r.exclusive.found
                        ? <> @ {money(r.exclusive.chaos)} = <b>{money(r.exclusive.nodeValue)}</b> a node</>
                        : <em className="dl-flag warn">no price</em>}
                    </div>
                  )}
                  {b.city && b.boss && (
                    <div className="dl-excl">
                      <strong>{BOSS_NAME[b.boss]}</strong> from depth {DELVE_BOSSES.find((x) => x.id === b.boss).minDepth} ·{" "}
                      {money(bossValues[b.boss] || 0)} a kill
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {/* ================= BOSSES ================= */}
      {view === "bosses" && (
        <>
          <p className="dl-lead">
            You get a handful of these a league, not thirty in a row — so the mean is the wrong number to
            plan a night around. Each card leads with what a <em>single</em> kill actually pays, and keeps
            the mean beside it.
          </p>
          <div className="dl-bosses">
            {bosses.map((b) => {
              const d = dists[b.delve.id];
              const open = openBoss === b.delve.id;
              const top = Math.max(d.p90, d.mean, 1);
              return (
                <article key={b.delve.id} className={`dl-boss${open ? " open" : ""}`}>
                  <button className="dl-boss-head" onClick={() => setOpenBoss(open ? null : b.delve.id)} aria-expanded={open}>
                    <span className="dl-boss-name">
                      {b.delve.name}
                      {!b.available && <em className="dl-flag warn">needs depth {b.delve.minDepth}</em>}
                    </span>
                    <span className="dl-boss-val">{money(d.median)}<em>typical kill</em></span>
                  </button>
                  <div className="dl-boss-meta">
                    {b.biome.name} · {b.delve.node} · depth {b.delve.minDepth}+
                    {" · "}about {b.encountersPer100.toFixed(1)} per 100 delves at depth {settings.depth}
                  </div>

                  <div className="dl-spread" title="10th to 90th percentile of one kill, with the median marked and the mean as a line">
                    <i className="band" style={{ left: `${(d.p10 / top) * 100}%`, width: `${((d.p90 - d.p10) / top) * 100}%` }} />
                    <i className="med" style={{ left: `${(d.median / top) * 100}%` }} />
                    <i className="mean" style={{ left: `${(d.mean / top) * 100}%` }} />
                  </div>
                  <div className="dl-spread-key">
                    <span>p10 {d.p10 > 0 ? money(d.p10) : "nothing"}</span>
                    <span className="med">median {money(d.median)}</span>
                    <span>p90 {money(d.p90)}</span>
                    <span className="mean">mean {money(d.mean)}</span>
                  </div>
                  {d.mean > d.median * 1.35 && (
                    <p className="dl-note warn">
                      The mean is {Math.round((d.mean / Math.max(d.median, 0.01) - 1) * 100)}% above the median —
                      it is carried by the rare line. Half your kills come in under {money(d.median)}
                      {d.blank > 0.02 && `, and ${Math.round(d.blank * 100)}% drop nothing off this table at all`}.
                    </p>
                  )}

                  {open && (
                    <div className="dl-boss-body">
                      <table className="dl-table">
                        <thead><tr><th>Drop</th><th className="r">Chance</th><th className="r">Price</th><th className="r">EV</th></tr></thead>
                        <tbody>
                          {b.dropLines.map((l) => {
                            const src = b.delve.groups[0].drops.find((x) => (x.key || x.item) === l.key) || {};
                            return (
                              <tr key={l.key} className={l.found ? "" : "unpriced"}>
                                <td>
                                  {l.label}
                                  {src.unrated && <em className="dl-flag warn" title="Listed as a drop, no published rate">unrated</em>}
                                  {src.preliminary && <em className="dl-flag" title="Wiki calls this a preliminary estimate">prelim</em>}
                                  {/* Zero sightings in a sample is a ceiling, not a blank:
                                      the rule of three puts 95% confidence under 3/n. */}
                                  {src.unrated && src.sampleZero > 0 && l.rate === 0 && (
                                    <button className="dl-apply"
                                      title={`Absent from the ${src.sampleZero}-kill rate list, so it likely dropped 0 times. Rule of three: 95% confident it is under ${(300 / src.sampleZero).toFixed(0)}%. Click to use that ceiling.`}
                                      onClick={() => setSettings((st) => sanitizeSettings({
                                        ...st,
                                        bosses: {
                                          ...(st.bosses || {}),
                                          [b.delve.id]: {
                                            ...((st.bosses || {})[b.delve.id] || {}),
                                            drops: { ...(((st.bosses || {})[b.delve.id] || {}).drops || {}), [l.key]: { chance: 3 / src.sampleZero } },
                                          },
                                        },
                                      }))}>
                                      use ≤{(300 / src.sampleZero).toFixed(0)}%
                                    </button>
                                  )}
                                </td>
                                <td className="r">
                                  <NumInput value={Math.round(l.rate * 1000) / 10} step={1} width={54} suffix="%"
                                    onCommit={(n) => setSettings((s) => sanitizeSettings({
                                      ...s,
                                      bosses: {
                                        ...(s.bosses || {}),
                                        [b.delve.id]: {
                                          ...((s.bosses || {})[b.delve.id] || {}),
                                          drops: { ...(((s.bosses || {})[b.delve.id] || {}).drops || {}), [l.key]: { chance: n / 100 } },
                                        },
                                      },
                                    }))} />
                                </td>
                                <td className="r num">{l.found ? money(l.unit) : "—"}</td>
                                <td className="r num">{l.found ? money(l.value) : "—"}</td>
                              </tr>
                            );
                          })}
                          <tr className="dl-parts-total"><td colSpan={3}>Expected per kill</td><td className="r num">{money(b.gross)}</td></tr>
                        </tbody>
                      </table>
                      <p className="dl-note">
                        Rates: poewiki, {b.delve.sample}. Lines roll independently — Ahuatotli's six sum past
                        100% because a kill can hand you several. Prices are poe.ninja's, including the
                        divination cards.
                        {b.missingPrices > 0 && ` ${b.missingPrices} line${b.missingPrices > 1 ? "s have" : " has"} no poe.ninja price and contribute nothing.`}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <p className="dl-note">
            Encounter rate rides on one unpublished number — how often a city biome carries its boss node,
            set to {settings.bossPerCity} in the assumptions. The city's share of the mine is the wiki's own
            spawn weight, so that half is solid.
          </p>
        </>
      )}
    </section>
  );
}
