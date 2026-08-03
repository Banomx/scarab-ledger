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

   Two views: the ranked boss list, and a manager for TTK profiles where
   every boss's kill time is editable in one grid.
   ================================================================ */

const PRICE_BASIS = {
  c: { label: "Typical", hint: "median listed price across variants" },
  lo: { label: "Cheapest", hint: "lowest-priced variant — pessimistic" },
  hi: { label: "Best roll", hint: "highest-priced variant — optimistic" },
};

const RATE_BADGE = {
  ledger: null,
  wiki: { text: "wiki", title: "Rates from poewiki, not the ledger drop tables" },
  estimate: { text: "est", title: "Rates are a placeholder — nothing published" },
};

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* "4:00" -> 240, "90" -> 90. Anything unparseable returns null so the
   caller can put the old value back rather than writing NaN. */
function parseTime(text) {
  const t = String(text).trim();
  if (!t) return null;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const mm = Number(m), ss = Number(s || 0);
    if (!isFinite(mm) || !isFinite(ss)) return null;
    return Math.max(0, Math.round(mm * 60 + ss));
  }
  const n = Number(t);
  return isFinite(n) ? Math.max(0, Math.round(n)) : null;
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

/* Same idea, but m:ss — kill times read far better that way. */
function TimeInput({ value, onCommit, width = 58, title, custom }) {
  const [draft, setDraft] = useState(fmtTime(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(fmtTime(value)); }, [value]);
  return (
    <input
      className={`bp-time ${custom ? "custom" : ""}`} type="text" inputMode="numeric"
      value={draft} style={{ width }} title={title}
      onFocus={(e) => { focused.current = true; e.target.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        focused.current = false;
        const n = parseTime(e.target.value);
        if (n == null) { setDraft(fmtTime(value)); return; }
        setDraft(fmtTime(n));
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

export default function BossProfit({ league, staticBase, currency, divineRate, fmtPrice, fmtChaos, fmtDiv }) {
  const [priceMap, setPriceMap] = useState(null);   // null = loading, "missing" = no snapshot
  const [generatedAt, setGeneratedAt] = useState(null);
  const [profiles, setProfiles] = useState(() => loadProfiles());
  const [activeName, setActiveName] = useState(() => loadActive(loadProfiles()));
  const [view, setView] = useState("bosses");       // bosses | profiles
  const [editingProfile, setEditingProfile] = useState(null);
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
  const mutateNamed = useCallback((name, fn) => {
    setProfiles((ps) => ps.map((p) => (p.name === name ? fn({ ...p }) : p)));
  }, []);
  const mutate = useCallback((fn) => mutateNamed(activeName, fn), [mutateNamed, activeName]);

  const setBossFieldIn = useCallback((profName, bossId, field, value) => {
    mutateNamed(profName, (p) => {
      const b = { ...(p.bosses[bossId] || {}) };
      if (value == null) delete b[field]; else b[field] = value;
      p.bosses = { ...p.bosses, [bossId]: b };
      if (!Object.keys(b).length) delete p.bosses[bossId];
      return p;
    });
  }, [mutateNamed]);

  const setBossField = useCallback((bossId, field, value) =>
    setBossFieldIn(activeName, bossId, field, value), [setBossFieldIn, activeName]);

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
    setEditingProfile(name);
    return name;
  };
  const renameProfile = (from, to) => {
    const clean = (to || "").trim();
    if (!clean || clean === from) return;
    const name = uniqueName(profiles.filter((p) => p.name !== from), clean);
    setProfiles((ps) => ps.map((p) => (p.name === from ? { ...p, name } : p)));
    if (activeName === from) setActiveName(name);
    if (editingProfile === from) setEditingProfile(name);
  };
  const deleteProfile = (name) => {
    setProfiles((ps) => {
      if (ps.length <= 1) return [defaultProfile("Default")];
      const next = ps.filter((p) => p.name !== name);
      if (activeName === name) setActiveName(next[0].name);
      return next;
    });
    if (editingProfile === name) setEditingProfile(null);
  };
  const exportProfile = async (p) => {
    const text = JSON.stringify(p, null, 2);
    setImportText(text); setImportOpen(true);
    try { await navigator.clipboard.writeText(text); setImportMsg("Copied to clipboard."); }
    catch { setImportMsg("Copy this JSON."); }
  };
  const doImport = () => {
    let parsed;
    try { parsed = JSON.parse(importText); }
    catch { setImportMsg("That isn't valid JSON."); return; }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const cleaned = [];
    for (const [i, raw] of list.entries()) {
      const c = sanitizeProfile(raw, `Imported ${i + 1}`);
      c.name = uniqueName([...profiles, ...cleaned], c.name);
      cleaned.push(c);
    }
    setProfiles((ps) => [...ps, ...cleaned]);
    setActiveName(cleaned[0].name);
    setImportOpen(false); setImportText(""); setImportMsg("");
    setView("profiles");
  };

  const money = (chaos) => fmtPrice(chaos, currency, divineRate);
  const unit = currency === "chaos" ? "c" : "div";
  const signed = (chaos) => {
    const v = currency === "chaos" ? chaos : chaos / divineRate;
    const f = currency === "chaos" ? fmtChaos : fmtDiv;
    return `${v < 0 ? "−" : ""}${f(Math.abs(v))}${unit}`;
  };

  const groupsPresent = useMemo(() => GROUP_ORDER.filter((g) => BOSSES.some((b) => b.group === g)), []);
  const ttkOf = (p, b) => (p.bosses?.[b.id]?.ttk ?? b.ttk) + (p.bosses?.[b.id]?.overhead ?? b.overhead ?? 0);
  const profileStats = (p) => {
    const times = BOSSES.map((b) => ttkOf(p, b));
    const customised = BOSSES.filter((b) => p.bosses?.[b.id]?.ttk != null || p.bosses?.[b.id]?.overhead != null).length;
    return { avg: times.reduce((s, v) => s + v, 0) / (times.length || 1), customised };
  };

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

      <div className="bp-views">
        <button className={view === "bosses" ? "on" : ""} onClick={() => setView("bosses")}>Bosses</button>
        <button className={view === "profiles" ? "on" : ""} onClick={() => setView("profiles")}>TTK profiles</button>
        <span className="bp-views-active">Using <strong>{profile?.name}</strong></span>
        <button className="bp-reset" onClick={resetAll} title="Clear every override in the active profile">Reset overrides</button>
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

      {/* ================= TTK profile manager ================= */}
      {view === "profiles" && (
        <div className="bp-manage">
          <div className="bp-manage-head">
            <h3>Manage TTK profiles</h3>
            <button className="bp-primary" onClick={() => addProfile(null)}>+ New profile</button>
            <button onClick={() => { setImportOpen(true); setImportText(""); setImportMsg(""); }}>Import</button>
          </div>

          {profiles.map((p) => {
            const stats = profileStats(p);
            const editing = editingProfile === p.name;
            return (
              <div className={`bp-prof ${editing ? "editing" : ""} ${activeName === p.name ? "active" : ""}`} key={p.name}>
                <div className="bp-prof-head">
                  {editing
                    ? <input className="bp-prof-name" defaultValue={p.name} aria-label="Profile name"
                        onBlur={(e) => renameProfile(p.name, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                    : <strong className="bp-prof-title">{p.name}{activeName === p.name && <em>in use</em>}</strong>}
                  <span className="bp-prof-meta">
                    {BOSSES.length} bosses · avg {fmtTime(stats.avg)}
                    {stats.customised ? ` · ${stats.customised} customised` : " · all default"}
                  </span>
                  <span className="bp-prof-btns">
                    <button onClick={() => setEditingProfile(editing ? null : p.name)}>{editing ? "Done" : "Edit times"}</button>
                    <button onClick={() => exportProfile(p)}>Export</button>
                    <button onClick={() => addProfile(p)}>Duplicate</button>
                    {activeName !== p.name && <button onClick={() => { setActiveName(p.name); setView("bosses"); }}>Use</button>}
                    <button className="bp-danger" onClick={() => deleteProfile(p.name)}>Delete</button>
                  </span>
                </div>

                {editing && (
                  <>
                    <div className="bp-prof-hint">
                      Kill time per boss, as <code>m:ss</code> (plain numbers are read as seconds). Highlighted
                      fields differ from the default. Setup/travel time stays on the boss page.
                    </div>
                    <div className="bp-prof-grid">
                      {GROUP_ORDER.filter((g) => BOSSES.some((b) => b.group === g)).map((g) => (
                        <div className="bp-prof-section" key={g}>
                          <div className="bp-prof-section-head" style={{ "--tone": GROUP_TONES[g] }}>{g}</div>
                          {BOSSES.filter((b) => b.group === g).map((b) => {
                            const custom = p.bosses?.[b.id]?.ttk != null;
                            return (
                              <label className="bp-prof-cell" key={b.id}>
                                <span>{b.name}</span>
                                <TimeInput
                                  value={p.bosses?.[b.id]?.ttk ?? b.ttk}
                                  custom={custom}
                                  title={custom ? `Default is ${fmtTime(b.ttk)} — clear to nothing to restore` : "Default"}
                                  onCommit={(v) => setBossFieldIn(p.name, b.id, "ttk", v === b.ttk ? null : v)} />
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <div className="bp-prof-foot">
                      <button onClick={() => mutateNamed(p.name, (pp) => {
                        const next = {};
                        for (const [id, s] of Object.entries(pp.bosses)) {
                          const { ttk, overhead, ...rest } = s;
                          if (Object.keys(rest).length) next[id] = rest;
                        }
                        return { ...pp, bosses: next };
                      })}>Reset all times to default</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ================= ranked bosses ================= */}
      {view === "bosses" && (
        <>
          <div className="bp-bar">
            <label className="st-ctl">
              <span>TTK profile</span>
              <select value={activeName} onChange={(e) => setActiveName(e.target.value)}>
                {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </label>
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
          </div>

          <div className="bp-body">
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
                  <label>Kill time
                    <TimeInput value={current.ttk} title="m:ss" custom={(profile?.bosses || {})[current.boss.id]?.ttk != null}
                      onCommit={(v) => setBossField(current.boss.id, "ttk", v === current.boss.ttk ? null : v)} />
                  </label>
                  <label>Setup / travel
                    <TimeInput value={current.overhead} title="m:ss"
                      custom={(profile?.bosses || {})[current.boss.id]?.overhead != null}
                      onCommit={(v) => setBossField(current.boss.id, "overhead", v === (current.boss.overhead ?? 0) ? null : v)} />
                  </label>
                  {current.groups.some((g) => g.scaled) && (
                    <label title="Area item quantity — multiplies the quantity-scaled additional drops">
                      Quantity <NumInput value={current.quantity} suffix="%" width={54} onCommit={(v) => setBossField(current.boss.id, "quantity", v)} />
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
                        {l.qty !== 1 && (
                          <NumInput value={l.qty} width={40} title="Quantity" onCommit={(v) => setEntryQty(current.boss.id, l.item, v)} />
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
                          {g.kind === "pool" && <em>({g.rolls === 1 ? "1" : g.rolls} of {g.lines.length})</em>}
                          {g.kind === "independent" && <em>{g.scaled ? "(independent · quantity)" : "(independent)"}</em>}
                        </span>
                        <span className="bp-group-ctl">
                          {g.kind === "pool" && (
                            <NumInput value={g.rolls} step={0.5} width={42} suffix="rolls"
                              title="How many drops this group yields per kill — fractional is fine"
                              onCommit={(v) => setGroupField(current.boss.id, g.id, "rolls", v)} />
                          )}
                          {g.kind === "weighted" && (
                            <NumInput value={round4(g.base * 100)} step={0.5} width={46} suffix="% base"
                              title="Chance this group drops anything at all"
                              onCommit={(v) => setGroupField(current.boss.id, g.id, "base", v / 100)} />
                          )}
                          <span className="bp-group-sub">{money(g.subtotal)}</span>
                        </span>
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
        </>
      )}
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
