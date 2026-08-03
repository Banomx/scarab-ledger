import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { BOSSES, GROUP_ORDER, GROUP_TONES } from "./bossData.js";
import {
  makeResolver, computeBoss, profitChance, loadProfiles, saveProfiles, loadActive, saveActive,
  defaultProfile, sanitizeProfile, uniqueName,
} from "./bossProfit.js";

/* ================================================================
   BOSS PROFITABILITY
   Expected value per kill from the drop groups, minus what it costs to
   open the fight, over how long a run takes you.
   ================================================================ */

const PRICE_BASIS = {
  c: { label: "Typical", hint: "median listed price across variants" },
  lo: { label: "Cheapest", hint: "lowest-priced variant — pessimistic" },
  hi: { label: "Best roll", hint: "highest-priced variant — optimistic" },
};

const RATE_BADGE = {
  ledger: null,
  wiki: { text: "wiki", title: "Rates from poewiki, not the ledger drop tables" },
  estimate: { text: "est", title: "Drop split is a placeholder — no published rates" },
};

function fmtTime(sec) {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r}s`;
  return r ? `${m}:${String(r).padStart(2, "0")}` : `${m}:00`;
}

function pctText(v) {
  if (v == null || !isFinite(v)) return "—";
  if (v >= 0.1) return `${(v * 100).toFixed(0)}%`;
  if (v >= 0.01) return `${(v * 100).toFixed(1)}%`;
  if (v > 0) return `${(v * 100).toFixed(2)}%`;
  return "—";
}

/* Controlled number input that lets you clear the field while typing. */
function NumInput({ value, onCommit, step = 1, min = 0, width = 66, suffix, title }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value ?? "")); }, [value]);
  return (
    <span className="bp-num" title={title}>
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

export default function BossProfit({ league, staticBase, currency, divineRate, fmtPrice, fmtChaos, fmtDiv }) {
  const [priceMap, setPriceMap] = useState(null);   // null = loading, "missing" = no snapshot
  const [generatedAt, setGeneratedAt] = useState(null);
  const [profiles, setProfiles] = useState(() => loadProfiles());
  const [activeName, setActiveName] = useState(() => loadActive(loadProfiles()));
  const [selected, setSelected] = useState(BOSSES[0].id);
  const [basis, setBasis] = useState("c");
  const [sortKey, setSortKey] = useState("profitPerHour");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [uberFilter, setUberFilter] = useState("all");

  const profile = profiles.find((p) => p.name === activeName) || profiles[0];

  useEffect(() => { saveProfiles(profiles); }, [profiles]);
  useEffect(() => { saveActive(activeName); }, [activeName]);

  /* ---- prices ---- */
  useEffect(() => {
    let cancelled = false;
    setPriceMap(null);
    (async () => {
      try {
        const res = await fetch(`${staticBase}/prices.json`);
        if (res.ok) {
          const j = await res.json();
          if (cancelled) return;
          setPriceMap(j.prices || {});
          setGeneratedAt(j.generatedAt || null);
          return;
        }
      } catch { /* fall through */ }
      if (!cancelled) setPriceMap("missing");
    })();
    return () => { cancelled = true; };
  }, [staticBase]);

  const resolve = useMemo(
    () => makeResolver(priceMap && priceMap !== "missing" ? priceMap : null, {
      priceOverrides: profile?.priceOverrides || {},
      priceBasis: basis,
    }),
    [priceMap, profile, basis]
  );

  const rows = useMemo(
    () => BOSSES.map((b) => computeBoss(b, resolve, (profile?.bosses || {})[b.id] || {})),
    [resolve, profile]
  );

  const visible = useMemo(() => {
    let list = rows;
    if (groupFilter !== "all") list = list.filter((r) => r.boss.group === groupFilter);
    if (uberFilter !== "all") list = list.filter((r) => !!r.boss.uber === (uberFilter === "uber"));
    return list.slice().sort((a, b) => {
      if (sortKey === "name") return a.boss.name.localeCompare(b.boss.name);
      if (sortKey === "group") {
        const d = GROUP_ORDER.indexOf(a.boss.group) - GROUP_ORDER.indexOf(b.boss.group);
        return d || b.profitPerHour - a.profitPerHour;
      }
      return b[sortKey] - a[sortKey];
    });
  }, [rows, sortKey, groupFilter, uberFilter]);

  const maxProfit = Math.max(1, ...rows.map((r) => Math.abs(r.profitPerHour)));
  const current = rows.find((r) => r.boss.id === selected) || rows[0];

  /* Variance matters as much as EV — a boss can be +EV entirely on a 1%
     drop and still lose money most nights. Only the open boss is simulated. */
  const chance = useMemo(
    () => (current && current.gross > 0 ? profitChance(current, 10, 4000) : null),
    [current]
  );

  /* ---- profile mutation ---- */
  const mutate = useCallback((fn) => {
    setProfiles((ps) => ps.map((p) => (p.name === activeName ? fn({ ...p }) : p)));
  }, [activeName]);

  const setBossField = useCallback((bossId, field, value) => {
    mutate((p) => {
      p.bosses = { ...p.bosses, [bossId]: { ...(p.bosses[bossId] || {}), [field]: value } };
      return p;
    });
  }, [mutate]);

  const setGroupField = useCallback((bossId, groupId, field, value) => {
    mutate((p) => {
      const b = { ...(p.bosses[bossId] || {}) };
      b.groups = { ...(b.groups || {}), [groupId]: { ...((b.groups || {})[groupId] || {}), [field]: value } };
      p.bosses = { ...p.bosses, [bossId]: b };
      return p;
    });
  }, [mutate]);

  const setDropRate = useCallback((bossId, key, kind, value) => {
    const field = kind === "pool" ? "share" : kind === "weighted" ? "weight" : "chance";
    mutate((p) => {
      const b = { ...(p.bosses[bossId] || {}) };
      b.drops = { ...(b.drops || {}), [key]: { [field]: value } };
      p.bosses = { ...p.bosses, [bossId]: b };
      return p;
    });
  }, [mutate]);

  const setEntryQty = useCallback((bossId, item, qty) => {
    mutate((p) => {
      const b = { ...(p.bosses[bossId] || {}) };
      b.entry = { ...(b.entry || {}), [item]: qty };
      p.bosses = { ...p.bosses, [bossId]: b };
      return p;
    });
  }, [mutate]);

  const setPriceOverride = useCallback((item, chaos) => {
    mutate((p) => {
      p.priceOverrides = { ...p.priceOverrides };
      if (chaos == null) delete p.priceOverrides[item];
      else p.priceOverrides[item] = chaos;
      return p;
    });
  }, [mutate]);

  const resetBoss = useCallback((bossId) => {
    mutate((p) => {
      const next = { ...p.bosses };
      delete next[bossId];
      p.bosses = next;
      return p;
    });
  }, [mutate]);

  const resetAll = useCallback(() => mutate((p) => ({ ...p, bosses: {}, priceOverrides: {} })), [mutate]);

  /* ---- profile management ---- */
  const addProfile = (seed) => {
    const name = uniqueName(profiles, seed ? `${seed.name} copy` : "New profile");
    const p = seed ? { ...sanitizeProfile(seed), name } : defaultProfile(name);
    setProfiles((ps) => [...ps, p]);
    setActiveName(name);
  };
  const renameProfile = () => {
    const next = window.prompt("Rename profile", activeName);
    if (!next || !next.trim() || next.trim() === activeName) return;
    const name = uniqueName(profiles, next.trim());
    setProfiles((ps) => ps.map((p) => (p.name === activeName ? { ...p, name } : p)));
    setActiveName(name);
  };
  const deleteProfile = () => {
    if (profiles.length <= 1) { resetAll(); return; }
    setProfiles((ps) => {
      const next = ps.filter((p) => p.name !== activeName);
      setActiveName(next[0].name);
      return next;
    });
  };
  const exportProfile = async () => {
    const text = JSON.stringify(profile, null, 2);
    setImportText(text); setImportOpen(true);
    try { await navigator.clipboard.writeText(text); setImportMsg("Copied to clipboard."); }
    catch { setImportMsg("Copy this JSON."); }
  };
  const doImport = () => {
    let parsed;
    try { parsed = JSON.parse(importText); }
    catch { setImportMsg("That isn't valid JSON."); return; }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const cleaned = list.map((p, i) => {
      const c = sanitizeProfile(p, `Imported ${i + 1}`);
      c.name = uniqueName(profiles, c.name);
      return c;
    });
    setProfiles((ps) => [...ps, ...cleaned]);
    setActiveName(cleaned[0].name);
    setImportOpen(false); setImportText(""); setImportMsg("");
  };

  const money = (chaos) => fmtPrice(chaos, currency, divineRate);
  const unit = currency === "chaos" ? "c" : "div";
  const signed = (chaos) => {
    const v = currency === "chaos" ? chaos : chaos / divineRate;
    const f = currency === "chaos" ? fmtChaos : fmtDiv;
    return `${v < 0 ? "−" : ""}${f(Math.abs(v))}${unit}`;
  };

  const groupsPresent = useMemo(() => GROUP_ORDER.filter((g) => BOSSES.some((b) => b.group === g)), []);

  return (
    <section className="bp-wrap">
      {priceMap === null && <div className="st-banner st-quiet">Loading prices…</div>}
      {priceMap === "missing" && (
        <div className="st-banner">
          No price snapshot for {league} yet. Boss values need <code>prices.json</code>, which the
          data workflow writes alongside the scarab data — it appears after the next refresh.
          You can still edit drop rates and times; prices will fill in.
        </div>
      )}
      {priceMap && priceMap !== "missing" && (
        <div className="st-banner st-quiet">
          Prices via poe.ninja · {league}
          {generatedAt ? ` · updated ${new Date(generatedAt).toLocaleString()}` : ""}
          {" · "}1 Divine ≈ {Math.round(divineRate)} Chaos
        </div>
      )}

      {/* ---------- toolbar ---------- */}
      <div className="bp-bar">
        <label className="st-ctl">
          <span>TTK profile</span>
          <select value={activeName} onChange={(e) => setActiveName(e.target.value)}>
            {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </label>
        <div className="bp-btns">
          <button onClick={() => addProfile(null)}>New</button>
          <button onClick={() => addProfile(profile)}>Duplicate</button>
          <button onClick={renameProfile}>Rename</button>
          <button onClick={exportProfile}>Export</button>
          <button onClick={() => { setImportOpen(true); setImportText(""); setImportMsg(""); }}>Import</button>
          <button onClick={deleteProfile}>{profiles.length <= 1 ? "Reset" : "Delete"}</button>
        </div>
        <div className="st-ctl">
          <span>Price basis</span>
          <div className="st-seg">
            {Object.entries(PRICE_BASIS).map(([k, v]) => (
              <button key={k} className={basis === k ? "on" : ""} title={v.hint} onClick={() => setBasis(k)}>{v.label}</button>
            ))}
          </div>
        </div>
        <div className="st-ctl">
          <span>Variant</span>
          <div className="st-seg">
            <button className={uberFilter === "all" ? "on" : ""} onClick={() => setUberFilter("all")}>All</button>
            <button className={uberFilter === "normal" ? "on" : ""} onClick={() => setUberFilter("normal")}>Normal</button>
            <button className={uberFilter === "uber" ? "on" : ""} onClick={() => setUberFilter("uber")}>Uber</button>
          </div>
        </div>
        <label className="st-ctl">
          <span>Content</span>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="all">All</option>
            {groupsPresent.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="st-ctl">
          <span>Sort by</span>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="profitPerHour">Profit / hour</option>
            <option value="net">Profit / kill</option>
            <option value="gross">Drop value / kill</option>
            <option value="entryCost">Entry cost</option>
            <option value="group">Content</option>
            <option value="name">Name</option>
          </select>
        </label>
        <button className="bp-reset" onClick={resetAll} title="Clear every override in this profile">Reset overrides</button>
      </div>

      {importOpen && (
        <div className="bp-import">
          <div className="bp-import-head">
            <strong>Profile JSON</strong>
            <button className="st-close" onClick={() => setImportOpen(false)}>Close</button>
          </div>
          <textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportMsg(""); }}
            spellCheck="false" placeholder='{"name":"My TTK","bosses":{"maven":{"ttk":180}}}' />
          {importMsg && <div className="bp-import-err">{importMsg}</div>}
          <button className="bp-import-go" onClick={doImport}>Import as new profile</button>
        </div>
      )}

      <div className="bp-body">
        {/* ---------- ranked list ---------- */}
        <div className="bp-list">
          <div className="bp-list-head"><span>Boss</span><span>Profit / hr</span></div>
          {visible.map((r) => {
            const tone = GROUP_TONES[r.boss.group] || "#c9a24b";
            const w = Math.min(100, (Math.abs(r.profitPerHour) / maxProfit) * 100);
            const badge = RATE_BADGE[r.boss.rates];
            return (
              <button key={r.boss.id}
                className={`bp-item ${selected === r.boss.id ? "on" : ""}`}
                style={{ "--tone": tone }}
                onClick={() => setSelected(r.boss.id)}>
                <span className="bp-item-main">
                  <span className="bp-item-name">
                    <i className="bp-dot" />{r.boss.name}
                    {badge && <em className="bp-flag" title={badge.title}>{badge.text}</em>}
                    {r.missingPrices > 0 && <em className="bp-flag warn" title={`${r.missingPrices} drop(s) have no price`}>?</em>}
                  </span>
                  <span className="bp-item-meta">
                    {r.boss.group} · {fmtTime(r.runSeconds)}/run · {r.runsPerHour.toFixed(1)} kph
                  </span>
                  <span className="bp-meter"><i className={r.profitPerHour >= 0 ? "up" : "down"} style={{ width: `${w}%` }} /></span>
                </span>
                <span className={`bp-item-val ${r.profitPerHour >= 0 ? "pos" : "neg"}`}>{signed(r.profitPerHour)}</span>
              </button>
            );
          })}
          {!visible.length && <div className="st-cat-note">Nothing matches those filters.</div>}
        </div>

        {/* ---------- detail ---------- */}
        {current && (
          <div className="bp-detail">
            <div className="bp-detail-head" style={{ "--tone": GROUP_TONES[current.boss.group] || "#c9a24b" }}>
              <div>
                <h3>{current.boss.name}</h3>
                <div className="bp-detail-sub">
                  {current.boss.group}
                  {current.boss.uber ? " · uber" : ""}
                  {current.boss.rates === "ledger" ? " · ledger drop tables"
                    : current.boss.rates === "wiki" ? " · rates from poewiki"
                    : " · rates are a placeholder"}
                </div>
              </div>
              <button className="st-close" onClick={() => resetBoss(current.boss.id)}>Reset this boss</button>
            </div>

            {current.boss.note && <p className="bp-note">{current.boss.note}</p>}

            <div className="bp-stats">
              <Stat label="Entry" value={current.entryCost ? money(current.entryCost) : "free"} />
              <Stat label="EV / kill" value={signed(current.net)} tone={current.net >= 0 ? "pos" : "neg"} />
              <Stat label="Profit / hour" value={signed(current.profitPerHour)} tone={current.profitPerHour >= 0 ? "pos" : "neg"} big />
              <Stat label="Profit in 10 runs"
                value={chance == null ? "—" : `${Math.round(chance * 100)}%`}
                tone={chance == null ? null : chance >= 0.5 ? "pos" : "warn"}
                title="Simulated: how often 10 consecutive runs finish in the black. EV alone hides the variance." />
            </div>

            <div className="bp-timing">
              <label>Kill time <NumInput value={current.ttk} suffix="s" onCommit={(v) => setBossField(current.boss.id, "ttk", v)} /></label>
              <label>Setup / travel <NumInput value={current.overhead} suffix="s" onCommit={(v) => setBossField(current.boss.id, "overhead", v)} /></label>
              {current.groups.some((g) => g.scaled) && (
                <label title="Area item quantity — multiplies the quantity-scaled additional drops">
                  Quantity <NumInput value={current.quantity} suffix="%" width={60} onCommit={(v) => setBossField(current.boss.id, "quantity", v)} />
                </label>
              )}
              <span className="bp-timing-out">{fmtTime(current.runSeconds)} per run · {current.runsPerHour.toFixed(1)} kph</span>
            </div>

            {current.entryLines.length > 0 && (
              <div className="bp-entry">
                <span className="bp-entry-lbl">Entry</span>
                {current.entryLines.map((l) => (
                  <span key={l.item} className={`bp-entry-item ${!l.found ? "unknown" : ""}`}>
                    {l.item}
                    <PriceCell item={l.item} chaos={l.unit} overridden={l.overridden} onSet={setPriceOverride} money={money} />
                    {(l.qty !== 1 || l.qty > 1) && (
                      <NumInput value={l.qty} width={44} title="Quantity" onCommit={(v) => setEntryQty(current.boss.id, l.item, v)} />
                    )}
                    {!l.found && <em className="bp-flag warn" title="No poe.ninja price under this name">no price</em>}
                  </span>
                ))}
                <span className="bp-entry-total">= {money(current.entryCost)}</span>
              </div>
            )}

            <div className="bp-groups">
              {current.groups.map((g) => (
                <div className="bp-group" key={g.id}>
                  <div className="bp-group-head">
                    <span className="bp-group-title">
                      {g.label}
                      {g.kind === "pool" && <em>(1 of {g.lines.length})</em>}
                      {g.kind === "weighted" && <em>({pctText(g.base)} base)</em>}
                      {g.kind === "independent" && <em>{g.scaled ? "(independent · quantity)" : "(independent)"}</em>}
                    </span>
                    <span className="bp-group-sub">{money(g.subtotal)}</span>
                  </div>
                  <div className="bp-table">
                    <div className="bp-tr bp-th">
                      <span>Item</span><span>{g.kind === "weighted" ? "Weight" : "Rate"}</span><span>Value</span><span>EV</span>
                    </div>
                    {g.lines.map((l) => (
                      <div key={l.key} className={`bp-tr ${!l.found && l.qty > 0 ? "unknown" : ""}`}>
                        <span className="bp-cell-name" title={l.item !== l.label ? `Priced as: ${l.item}` : undefined}>
                          {l.label}
                          {!l.found && l.qty > 0 && <em className="bp-flag warn" title="No poe.ninja price under this name — set one manually">no price</em>}
                        </span>
                        <span className="bp-cell-rate">
                          <NumInput
                            value={g.kind === "weighted" ? l.rate : round4(l.rate * 100)}
                            step={g.kind === "weighted" ? 1 : 0.5} width={g.kind === "weighted" ? 40 : 46}
                            suffix={g.kind === "weighted" ? undefined : "%"}
                            onCommit={(v) => setDropRate(current.boss.id, l.key, g.kind, g.kind === "weighted" ? v : v / 100)} />
                          {g.kind === "weighted" && <em>{pctText(l.pct)}</em>}
                        </span>
                        <span className="bp-cell-price">
                          <PriceCell item={l.item} chaos={l.unit} overridden={l.overridden} entry={l.priceEntry}
                            onSet={setPriceOverride} money={money} />
                        </span>
                        <span className="bp-cell-val">{money(l.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="bp-foot">
              Expected value is an average over many kills, not what one kill pays. Every rate, time and
              price here is editable and saved to this browser under the selected profile.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, tone, big, title }) {
  return (
    <div className={`bp-stat ${big ? "big" : ""}`} title={title}>
      <div className="bp-stat-lbl">{label}</div>
      <div className={`bp-stat-val ${tone || ""}`}>{value}</div>
    </div>
  );
}

/* Click a price to override it; the ↺ puts the market price back. */
function PriceCell({ item, chaos, overridden, entry, onSet, money }) {
  const [editing, setEditing] = useState(false);
  const spread = entry && entry.n > 1 ? `${entry.n} listings · ${Math.round(entry.lo)}–${Math.round(entry.hi)}c` : null;
  if (editing) {
    return <NumInput value={Math.round(chaos * 100) / 100} step={0.1} width={78} suffix="c"
      onCommit={(v) => { onSet(item, v); setEditing(false); }} />;
  }
  return (
    <span className="bp-price">
      <button className={`bp-price-btn ${overridden ? "ov" : ""}`} title={spread || "Click to override this price"}
        onClick={() => setEditing(true)}>
        {chaos > 0 ? money(chaos) : "—"}
      </button>
      {overridden && <button className="bp-price-reset" title="Use the market price again" onClick={() => onSet(item, null)}>↺</button>}
    </span>
  );
}

function round4(v) { return Math.round(v * 10000) / 10000; }
