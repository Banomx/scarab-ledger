import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BIOMES, NODES, TUNABLES, DEFAULTS, DELVE_BOSSES, RESONATOR_ORDER, RESONATOR_SOCKETS,
} from "./delveData.js";
import {
  makePriceOf, fossilRows, computeBiomes, computeDelveBosses, killDistribution,
  loadSettings, saveSettings, sanitizeSettings,
} from "./delve.js";
import { makeResolver } from "./bossProfit.js";

/* ================================================================
   DELVE
   What a delve level is worth, and where to point it.

   Three views, in the order you actually ask the questions:

     Biomes    which biome do I want at this depth, and how much of the
               mine is it? Value comes from the fossil pool plus the
               biome's exclusive fossil node — the node is usually most
               of it, which is the whole reason biome choice matters.
     Fossils   the price list the biome numbers are built from, so you
               can see what moved.
     Bosses    a delve boss is a handful of kills a league, not a farm.
               So the tab leads with the spread of a SINGLE kill, and
               keeps the mean next to it rather than instead of it.

   Everything the wiki does not publish — fossils per node, nodes per
   delve, how often a city carries its boss — is an editable assumption,
   badged as one. See the header comment in delveData.js.
   ================================================================ */

const num = (v, d) => (v == null || !isFinite(Number(v)) ? d : Number(v));
const pct = (v) => (v >= 0.1 ? `${(v * 100).toFixed(0)}%` : v >= 0.001 ? `${(v * 100).toFixed(1)}%` : v > 0 ? "<0.1%" : "—");

function PctBadge({ v }) {
  if (v == null || !isFinite(v)) return null;
  const cls = v > 0.5 ? "up" : v < -0.5 ? "down" : "flat";
  const arrow = v > 0.5 ? "▲" : v < -0.5 ? "▼" : "•";
  return <span className={`st-pct ${cls}`}>{arrow} {Math.abs(v).toFixed(1)}%</span>;
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

export default function Delve({ league, staticBase, currency, divineRate, fmtPrice, fmtChaos, unitFor }) {
  const [view, setView] = useState("biomes");
  const [settings, setSettings] = useState(() => loadSettings());
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [openBiome, setOpenBiome] = useState(null);
  const [openBoss, setOpenBoss] = useState(DELVE_BOSSES[0].id);
  const [rankBy, setRankBy] = useState("value");        // value | expected
  const [fossilData, setFossilData] = useState(null);   // {items, generatedAt} | "missing"
  const [resoData, setResoData] = useState(null);
  const [priceMap, setPriceMap] = useState(null);       // prices.json | "missing"
  const [generatedAt, setGeneratedAt] = useState(null);

  useEffect(() => { saveSettings(settings); }, [settings]);

  const patch = useCallback((p) => setSettings((s) => sanitizeSettings({ ...s, ...p })), []);

  /* ---- data ----
     Three snapshots, all optional in different ways:
       fossils.json / resonators.json  price + trend for the two lists.
       prices.json                     the broad name->price map the boss
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
    setFossilData(null); setResoData(null); setPriceMap(null);
    grab("fossils.json", (j) => { setFossilData(j); if (j.generatedAt) setGeneratedAt(j.generatedAt); });
    grab("resonators.json", setResoData);
    grab("prices.json", (j) => {
      if (j === "missing") { setPriceMap("missing"); return; }
      setPriceMap(j.prices || {});
      setGeneratedAt((g) => g || j.generatedAt || null);
    });
    return () => { cancelled = true; };
  }, [staticBase]);

  /* fossils.json carries trend data; prices.json does not. Prefer the
     first for anything it knows and let the second fill the rest, so a
     league whose snapshot predates fossils.json still gets numbers. */
  const fossilItems = fossilData && fossilData !== "missing" ? fossilData.items || [] : [];
  const resoItems = resoData && resoData !== "missing" ? resoData.items || [] : [];
  const trendBy = useMemo(() => {
    const m = {};
    for (const it of [...fossilItems, ...resoItems]) m[it.name] = it;
    return m;
  }, [fossilData, resoData]);

  const priceOf = useMemo(() => {
    const fromCategory = {};
    for (const it of [...fossilItems, ...resoItems]) if (it.chaosValue > 0) fromCategory[it.name] = { c: it.chaosValue, n: 1 };
    const map = priceMap && priceMap !== "missing" ? priceMap : null;
    return makePriceOf([fromCategory, map], { overrides: settings.priceOverrides || {}, divineRate });
  }, [fossilData, resoData, priceMap, settings.priceOverrides, divineRate]);

  const havePrices = (fossilItems.length > 0) || (priceMap && priceMap !== "missing");

  /* The boss engine wants prices.json's { name: {c,lo,hi,n} } shape. */
  const resolve = useMemo(
    () => makeResolver(priceMap && priceMap !== "missing" ? priceMap : null, {
      priceOverrides: settings.priceOverrides || {}, divineRate,
    }),
    [priceMap, settings.priceOverrides, divineRate]
  );

  const bosses = useMemo(() => computeDelveBosses(resolve, settings), [resolve, settings]);
  const bossValues = useMemo(
    () => Object.fromEntries(bosses.map((b) => [b.delve.id, b.gross])),
    [bosses]
  );
  const dists = useMemo(() => {
    const out = {};
    for (const b of bosses) out[b.delve.id] = killDistribution(b, 4000);
    return out;
  }, [bosses]);

  const biomes = useMemo(() => computeBiomes(priceOf, settings, bossValues), [priceOf, settings, bossValues]);
  const fossils = useMemo(() => fossilRows(priceOf), [priceOf]);

  const ranked = useMemo(() => {
    const rows = [...biomes.rows];
    rows.sort((a, b) => (rankBy === "expected" ? b.expected - a.expected : b.perDelve - a.perDelve));
    return rows;
  }, [biomes, rankBy]);

  const money = (c) => (c > 0 ? fmtPrice(c, currency, divineRate) : "—");

  const reset = () => setSettings(sanitizeSettings({ ...DEFAULTS, depth: settings.depth }));

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
        <div className="dl-headline">
          <strong>{money(biomes.mineAverage)}</strong>
          <em>average per delve at depth {settings.depth}</em>
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
            fossils a node drops, how many nodes a delve level has, or how often a city biome carries its boss —
            so those are yours to set. Everything below feeds the per-delve numbers; the fossil prices and the
            boss drop rates do not depend on any of it.
          </p>
          {["Per node", "Per delve", "Bosses"].map((group) => (
            <div key={group} className="dl-assume-group">
              <h4>{group}</h4>
              {TUNABLES.filter((t) => t.group === group).map((t) => (
                <label key={t.key} className="dl-assume-row" title={t.help}>
                  <span>{t.label}</span>
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
          {" · "}1 Divine ≈ {Math.round(divineRate)} Chaos
          {fossilData === "missing" && priceMap && priceMap !== "missing" ? " · fossil trends appear after the next refresh" : ""}
        </div>
      )}

      <div className="dl-views">
        <button className={view === "biomes" ? "on" : ""} onClick={() => setView("biomes")}>Biomes</button>
        <button className={view === "fossils" ? "on" : ""} onClick={() => setView("fossils")}>Fossils &amp; resonators</button>
        <button className={view === "bosses" ? "on" : ""} onClick={() => setView("bosses")}>Bosses</button>
      </div>

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
            {biomes.anyInterpolated && (
              <span className="dl-hint">
                Depth {settings.depth} sits inside at least one biome's weight ramp — the wiki gives both ends
                and says the middle scales non-linearly without giving the curve, so those shares are eased
                between the two and are approximate.
              </span>
            )}
          </div>

          <div className="dl-biomes">
            {ranked.map((r) => {
              const b = r.biome;
              const open = openBiome === b.id;
              const dead = r.weight <= 0;
              const headline = rankBy === "expected" ? r.expected : r.perDelve;
              return (
                <article key={b.id} className={`dl-biome${dead ? " dead" : ""}${open ? " open" : ""}`} style={{ "--tone": b.tone }}>
                  <button className="dl-biome-head" onClick={() => setOpenBiome(open ? null : b.id)} aria-expanded={open}>
                    <span className="dl-dot" />
                    <span className="dl-biome-name">
                      {b.name}
                      {b.city && <em className="dl-flag">city</em>}
                      {dead && <em className="dl-flag warn">not at this depth</em>}
                    </span>
                    <span className="dl-biome-val">{money(headline)}<em>/delve</em></span>
                  </button>

                  <div className="dl-share" title={`Spawn weight ${Math.round(r.weight)} — ${pct(r.share)} of the mine at depth ${settings.depth}`}>
                    {!dead && <i style={{ width: `${Math.min(100, r.share * 100 * 3)}%` }} />}
                    <span>
                      {dead
                        ? `Doesn't spawn at depth ${settings.depth}`
                        : `${pct(r.share)} of the mine${!r.exact ? " (approx)" : ""}`}
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
                  {b.city && (
                    <div className="dl-excl">
                      {b.boss
                        ? <><strong>{BOSS_NAME[b.boss]}</strong> from depth {DELVE_BOSSES.find((x) => x.id === b.boss).minDepth} · {money(bossValues[b.boss] || 0)} a kill</>
                        : "No fossil pool."}
                    </div>
                  )}

                  {open && (
                    <div className="dl-biome-body">
                      {!!r.poolNames.length && (
                        <>
                          <h5>Common pool · average {money(r.poolAvg)}</h5>
                          <ul className="dl-chips">
                            {r.poolPrices.map((p) => (
                              <li key={p.name} className={p.found ? "" : "unpriced"}>
                                {p.name.replace(/ Fossil$/, "")}
                                <b>{p.found ? money(p.chaos) : "—"}</b>
                              </li>
                            ))}
                          </ul>
                          {r.poolCoverage < 1 && (
                            <p className="dl-note">
                              {Math.round((1 - r.poolCoverage) * 100)}% of this pool has no price — the average is
                              over what is priced, so it reads high if the missing ones are the cheap ones.
                            </p>
                          )}
                        </>
                      )}
                      <h5>Per delve level</h5>
                      <table className="dl-parts">
                        <tbody>
                          {r.exclusive && <tr><td>{settings.exclusivePerDelve}× {r.exclusive.node}</td><td>{money(r.parts.exclusive)}</td></tr>}
                          {!!r.poolNames.length && <tr><td>{settings.genericPerDelve}× generic fossil node</td><td>{money(r.parts.generic)}</td></tr>}
                          {!!r.poolNames.length && <tr><td>{settings.cachePerDelve}× smuggler's cache</td><td>{money(r.parts.cache)}</td></tr>}
                          {b.city && <tr><td>{settings.bossPerCity}× boss node</td><td>{money(r.parts.boss)}</td></tr>}
                          <tr className="dl-parts-total"><td>Total</td><td>{money(r.perDelve)}</td></tr>
                        </tbody>
                      </table>
                      {!!b.themed.length && (
                        <>
                          <h5>Other nodes here</h5>
                          <p className="dl-note">{b.themed.join(" · ")}</p>
                        </>
                      )}
                      <p className="dl-note">
                        Spawn weight {b.weight.lo.weight} at depth ≤{b.weight.lo.depth}, {b.weight.hi.weight} at
                        depth ≥{b.weight.hi.depth}.{b.note ? ` ${b.note}` : ""}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {/* ================= FOSSILS ================= */}
      {view === "fossils" && (
        <>
          <div className="dl-table-wrap">
            <table className="dl-table">
              <thead>
                <tr><th>Fossil</th><th className="r">Price</th><th className="r">24h</th><th>Where</th></tr>
              </thead>
              <tbody>
                {fossils.map((f) => {
                  const t = trendBy[f.name];
                  return (
                    <tr key={f.name} className={f.found ? "" : "unpriced"}>
                      <td>
                        {f.name.replace(/ Fossil$/, "")}
                        {f.exclusive && <em className="dl-flag">node</em>}
                        {f.wall && <em className="dl-flag" title="Behind a fractured wall">wall</em>}
                      </td>
                      <td className="r num">{f.found ? money(f.chaos) : "—"}</td>
                      <td className="r"><PctBadge v={t?.change24} /></td>
                      <td className="dl-where">
                        {f.exclusive
                          ? <><b>{f.exclusive.node}</b> · {BIOME_NAME[f.exclusive.biome]}</>
                          : f.biomes.map((id) => BIOME_NAME[id]).join(", ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h4 className="dl-h">Resonators</h4>
          {resoItems.length ? (
            <div className="dl-table-wrap">
              <table className="dl-table">
                <thead><tr><th>Resonator</th><th className="r">Sockets</th><th className="r">Price</th><th className="r">24h</th></tr></thead>
                <tbody>
                  {[...resoItems]
                    .sort((a, b) => b.chaosValue - a.chaosValue)
                    .map((it) => {
                      const tier = RESONATOR_ORDER.find((t) => it.name.startsWith(t));
                      return (
                        <tr key={it.name}>
                          <td>{it.name.replace(/ Resonator$/, "")}</td>
                          <td className="r num">{tier ? RESONATOR_SOCKETS[tier] : "—"}</td>
                          <td className="r num">{money(it.chaosValue)}</td>
                          <td className="r"><PctBadge v={it.change24} /></td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="dl-note">
              No resonator snapshot yet — <code>resonators.json</code> appears after the next data refresh.
            </p>
          )}

          <h4 className="dl-h">What a node is worth</h4>
          <p className="dl-note">
            Priced against the biome you are standing in, using the assumptions above. A biome node is
            worth its own fossil; everything else is worth that biome's pool average.
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

                  {/* p10 — median — p90, against the mean */}
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
                        100% because a kill can hand you several.
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

const BIOME_NAME = Object.fromEntries(BIOMES.map((b) => [b.id, b.name]));
const BOSS_NAME = Object.fromEntries(DELVE_BOSSES.map((b) => [b.id, b.name]));
