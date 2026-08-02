import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { BOSSES, GROUP_ORDER, GROUP_TONES } from "./bossData.js";
import {
  makeResolver, computeBoss, loadProfiles, saveProfiles, loadActive, saveActive,
  defaultProfile, sanitizeProfile, uniqueName,
} from "./bossProfit.js";

/* ================================================================
   BOSS PROFITABILITY
   Expected value per kill from the drop pool, minus what it costs to
   open the fight, divided by how long a run takes you.
   ================================================================ */

const PRICE_BASIS = {
  c: { label: "Typical", hint: "median listed price across variants" },
  lo: { label: "Cheapest", hint: "lowest-priced variant — pessimistic" },
  hi: { label: "Best roll", hint: "highest-priced variant — optimistic" },
};

function fmtTime(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function pctText(v) {
  if (v >= 0.1) return `${(v * 100).toFixed(0)}%`;
  if (v >= 0.01) return `${(v * 100).toFixed(1)}%`;
  if (v > 0) return `${(v * 100).toFixed(2)}%`;
  return "—";
}

/* Small controlled number input that lets you clear the field while typing. */
function NumInput({ value, onCommit, step = 1, min = 0, width = 74, suffix, placeholder }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value ?? "")); }, [value]);
  return (
    <span className="bp-num">
      <input
        type="number" step={step} min={min} value={draft} placeholder={placeholder}
        style={{ width }}
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
  const [importErr, setImportErr] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");

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
    let list = groupFilter === "all" ? rows : rows.filter((r) => r.boss.group === groupFilter);
    list = list.slice().sort((a, b) => {
      if (sortKey === "name") return a.boss.name.localeCompare(b.boss.name);
      if (sortKey === "group") {
        const d = GROUP_ORDER.indexOf(a.boss.group) - GROUP_ORDER.indexOf(b.boss.group);
        return d || b.profitPerHour - a.profitPerHour;
      }
      return b[sortKey] - a[sortKey];
    });
    return list;
  }, [rows, sortKey, groupFilter]);

  const maxProfit = Math.max(1, ...rows.map((r) => Math.abs(r.profitPerHour)));
  const current = rows.find((r) => r.boss.id === selected) || rows[0];

  /* ---- profile mutation helpers ---- */
  const mutate = useCallback((fn) => {
    setProfiles((ps) => ps.map((p) => (p.name === activeName ? fn({ ...p }) : p)));
  }, [activeName]);

  const setBossField = useCallback((bossId, field, value) => {
    mutate((p) => {
      p.bosses = { ...p.bosses, [bossId]: { ...(p.bosses[bossId] || {}), [field]: value } };
      return p;
    });
  }, [mutate]);

  const setDropField = useCallback((bossId, item, kind, value) => {
    mutate((p) => {
      const b = { ...(p.bosses[bossId] || {}) };
      b.drops = { ...(b.drops || {}), [item]: { [kind]: value } };
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

  const resetAll = useCallback(() => {
    mutate((p) => ({ ...p, bosses: {}, priceOverrides: {} }));
  }, [mutate]);

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
    try {
      await navigator.clipboard.writeText(text);
      setImportText(text); setImportErr("Copied to clipboard."); setImportOpen(true);
    } catch {
      setImportText(text); setImportErr("Copy this JSON."); setImportOpen(true);
    }
  };
  const doImport = () => {
    let parsed;
    try { parsed = JSON.parse(importText); }
    catch { setImportErr("That isn't valid JSON."); return; }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const cleaned = list.map((p, i) => {
      const c = sanitizeProfile(p, `Imported ${i + 1}`);
      c.name = uniqueName(profiles, c.name);
      return c;
    });
    setProfiles((ps) => [...ps, ...cleaned]);
    setActiveName(cleaned[0].name);
    setImportOpen(false); setImportText(""); setImportErr("");
  };

  const money = (chaos) => fmtPrice(chaos, currency, divineRate);
  const unit = currency === "chaos" ? "c" : "div";
  const signed = (chaos) => {
    const v = currency === "chaos" ? chaos : chaos / divineRate;
    const f = currency === "chaos" ? fmtChaos : fmtDiv;
    return `${v < 0 ? "−" : ""}${f(Math.abs(v))}${unit}`;
  };

  const groupsPresent = useMemo(
    () => GROUP_ORDER.filter((g) => BOSSES.some((b) => b.group === g)),
    []
  );

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
          <button onClick={() => { setImportOpen(true); setImportText(""); setImportErr(""); }}>Import</button>
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
        <label className="st-ctl">
          <span>Group</span>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="all">All bosses</option>
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
            <option value="group">Group</option>
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
          <textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportErr(""); }}
            spellCheck="false" placeholder='{"name":"My TTK","bosses":{"maven":{"ttk":120}}}' />
          {importErr && <div className="bp-import-err">{importErr}</div>}
          <button className="bp-import-go" onClick={doImport}>Import as new profile</button>
        </div>
      )}

      <div className="bp-body">
        {/* ---------- ranked list ---------- */}
        <div className="bp-list">
          <div className="bp-list-head">
            <span>Boss</span><span>Profit / hr</span>
          </div>
          {visible.map((r) => {
            const tone = GROUP_TONES[r.boss.group] || "#c9a24b";
            const w = Math.min(100, (Math.abs(r.profitPerHour) / maxProfit) * 100);
            return (
              <button key={r.boss.id}
                className={`bp-item ${selected === r.boss.id ? "on" : ""}`}
                style={{ "--tone": tone }}
                onClick={() => setSelected(r.boss.id)}>
                <span className="bp-item-main">
                  <span className="bp-item-name">
                    <i className="bp-dot" />{r.boss.name}
                    {r.boss.rates === "estimate" && <em className="bp-flag" title="Drop split is an even-split estimate">est</em>}
                    {r.missingPrices > 0 && <em className="bp-flag warn" title={`${r.missingPrices} drop(s) have no price`}>?</em>}
                  </span>
                  <span className="bp-item-meta">
                    {r.boss.group} · {fmtTime(r.runSeconds)}/run · {r.runsPerHour.toFixed(1)}/hr
                  </span>
                  <span className="bp-meter"><i className={r.profitPerHour >= 0 ? "up" : "down"} style={{ width: `${w}%` }} /></span>
                </span>
                <span className={`bp-item-val ${r.profitPerHour >= 0 ? "pos" : "neg"}`}>{signed(r.profitPerHour)}</span>
              </button>
            );
          })}
          {!visible.length && <div className="st-cat-note">No bosses in that group.</div>}
        </div>

        {/* ---------- detail ---------- */}
        {current && (
          <div className="bp-detail">
            <div className="bp-detail-head" style={{ "--tone": GROUP_TONES[current.boss.group] || "#c9a24b" }}>
              <div>
                <h3>{current.boss.name}</h3>
                <div className="bp-detail-sub">
                  {current.boss.group}
                  {current.boss.rates === "estimate"
                    ? " · drop split is an even-split estimate"
                    : " · drop rates from poewiki"}
                </div>
              </div>
              <button className="st-close" onClick={() => resetBoss(current.boss.id)}>Reset this boss</button>
            </div>

            {current.boss.note && <p className="bp-note">{current.boss.note}</p>}

            <div className="bp-stats">
              <Stat label="Drop value / kill" value={money(current.gross)} />
              <Stat label="Entry cost" value={current.entryCost ? `−${money(current.entryCost)}` : "free"} tone={current.entryCost ? "neg" : null} />
              <Stat label="Profit / kill" value={signed(current.net)} tone={current.net >= 0 ? "pos" : "neg"} big />
              <Stat label="Profit / hour" value={signed(current.profitPerHour)} tone={current.profitPerHour >= 0 ? "pos" : "neg"} big />
            </div>

            <div className="bp-timing">
              <label>Kill time <NumInput value={current.ttk} suffix="s" onCommit={(v) => setBossField(current.boss.id, "ttk", v)} /></label>
              <label>Setup / travel <NumInput value={current.overhead} suffix="s" onCommit={(v) => setBossField(current.boss.id, "overhead", v)} /></label>
              <label title="How many guaranteed uniques the fight drops from its pool">
                Pool drops <NumInput value={current.poolRolls} step={0.1} width={62} onCommit={(v) => setBossField(current.boss.id, "poolRolls", v)} />
              </label>
              <span className="bp-timing-out">{fmtTime(current.runSeconds)} per run · {current.runsPerHour.toFixed(1)} runs/hr</span>
            </div>

            {current.entryLines.length > 0 && (
              <>
                <h4 className="bp-h">Cost to open</h4>
                <div className="bp-table">
                  <div className="bp-tr bp-th"><span>Item</span><span>Qty</span><span>Unit</span><span>Cost</span></div>
                  {current.entryLines.map((l) => (
                    <div key={l.item} className={`bp-tr ${!l.found ? "unknown" : ""}`}>
                      <span className="bp-cell-name">
                        {l.item}
                        {l.verify && <em className="bp-flag" title="Fragment name/quantity worth double-checking against your map device">verify</em>}
                        {!l.found && <em className="bp-flag warn" title="No poe.ninja price under this name">no price</em>}
                      </span>
                      <span><NumInput value={l.qty} width={54} onCommit={(v) => setEntryQty(current.boss.id, l.item, v)} /></span>
                      <span className="bp-cell-price">
                        <PriceCell item={l.item} chaos={l.unit} overridden={l.overridden}
                          onSet={setPriceOverride} money={money} />
                      </span>
                      <span className="bp-cell-val">{money(l.total)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <h4 className="bp-h">Drops</h4>
            <div className="bp-table">
              <div className="bp-tr bp-th"><span>Item</span><span>Per kill</span><span>Unit</span><span>Expected</span></div>
              {current.dropLines.map((l) => (
                <div key={l.item} className={`bp-tr ${!l.found && l.qty > 0 ? "unknown" : ""}`}>
                  <span className="bp-cell-name">
                    {l.label}
                    {l.kind === "pool" && <em className="bp-flag quiet" title="Share of the guaranteed unique pool">pool</em>}
                    {!l.found && l.qty > 0 && <em className="bp-flag warn" title="No poe.ninja price under this name — set one manually">no price</em>}
                  </span>
                  <span className="bp-cell-rate">
                    <NumInput value={round4(l.raw)} step={0.01} width={66}
                      onCommit={(v) => setDropField(current.boss.id, l.item, l.kind === "pool" ? "share" : l.kind === "chance" ? "chance" : "qty", v)} />
                    <em title={l.kind === "pool" ? "share of pool" : l.kind === "chance" ? "chance per kill" : "quantity per kill"}>
                      {l.kind === "qty" ? "×" : pctText(l.raw)}
                    </em>
                  </span>
                  <span className="bp-cell-price">
                    <PriceCell item={l.item} chaos={l.unit} overridden={l.overridden} entry={l.priceEntry}
                      onSet={setPriceOverride} money={money} />
                  </span>
                  <span className="bp-cell-val">{money(l.value)}</span>
                </div>
              ))}
              <div className="bp-tr bp-total">
                <span>Total expected value</span><span /><span />
                <span className="bp-cell-val">{money(current.gross)}</span>
              </div>
            </div>

            <p className="bp-foot">
              Expected value is an average over many kills, not what you get from one. Drop rates are
              crowdsourced and go stale when GGG rebalances — every number on this page is editable and
              your edits are saved to this browser under the selected profile.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, tone, big }) {
  return (
    <div className={`bp-stat ${big ? "big" : ""}`}>
      <div className="bp-stat-lbl">{label}</div>
      <div className={`bp-stat-val ${tone || ""}`}>{value}</div>
    </div>
  );
}

/* Click a price to override it; click the ↺ to go back to the market price. */
function PriceCell({ item, chaos, overridden, entry, onSet, money }) {
  const [editing, setEditing] = useState(false);
  const spread = entry && entry.n > 1 ? `${entry.n} variants · ${Math.round(entry.lo)}–${Math.round(entry.hi)}c` : null;
  if (editing) {
    return (
      <NumInput value={Math.round(chaos * 100) / 100} step={0.1} width={80} suffix="c"
        onCommit={(v) => { onSet(item, v); setEditing(false); }} />
    );
  }
  return (
    <span className="bp-price">
      <button className={`bp-price-btn ${overridden ? "ov" : ""}`} title={spread || "Click to override this price"}
        onClick={() => setEditing(true)}>
        {chaos > 0 ? money(chaos) : "—"}
      </button>
      {overridden && (
        <button className="bp-price-reset" title="Use the market price again" onClick={() => onSet(item, null)}>↺</button>
      )}
    </span>
  );
}

function round4(v) { return Math.round(v * 10000) / 10000; }
