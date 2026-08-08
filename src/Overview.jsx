import { useEffect, useMemo, useState } from "react";
import { computeAll, loadActive, loadProfiles, makeResolver } from "./bossProfit.js";
import {
  computeBiomes, loadSettings, makePriceOf, loadSampleProfiles,
  loadActiveSampleProfile, sampleMetrics,
} from "./delve.js";
import { CHANGE_WINDOW_OPTIONS } from "./marketWindows.js";

const CATEGORY_FILES = [
  ["catalysts", "Catalysts"],
  ["astrolabes", "Astrolabes"],
];

function pct(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function sourceLabel(source) {
  if (!source) return "Snapshot data";
  if (typeof source === "string") return `Prices via ${source}`;
  const names = Object.entries(source)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name === "ggg" ? "GGG exchange" : name);
  return names.length ? `Prices via ${names.join(" + ")}` : "Snapshot data";
}

function Signal({ kind, title, value, tone = "", selected, onSelect }) {
  return (
    <button type="button" className={`ov-signal${selected ? " on" : ""}`}
      aria-pressed={selected} onClick={onSelect}>
      <span className="ov-kind">{kind}</span>
      <strong>{title}</strong>
      <span className={`ov-value ${tone}`}>{value}</span>
    </button>
  );
}

export default function Overview({
  league,
  staticBase,
  currency,
  divineRate,
  fmtPrice,
  movers,
  customFarms,
  activeKey,
  changeKey,
  changeWindow,
  setChangeWindow,
  mode,
  dataSource,
  staticInfo,
  onOpenTab,
}) {
  const [snapshots, setSnapshots] = useState(null);
  const [selectedSignal, setSelectedSignal] = useState("farms");
  const [strategyRotation, setStrategyRotation] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSnapshots(null);
    const read = async (file) => {
      try {
        const response = await fetch(`${staticBase}/${file}`, { cache: "no-cache" });
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      }
    };
    Promise.all([
      read("prices.json"),
      read("fossils.json"),
      read("resonators.json"),
      read("catalysts.json"),
      read("astrolabes.json"),
    ]).then(([prices, fossils, resonators, catalysts, astrolabes]) => {
      if (!cancelled) setSnapshots({ prices, fossils, resonators, catalysts, astrolabes });
    });
    return () => { cancelled = true; };
  }, [staticBase]);

  const profile = useMemo(() => {
    const profiles = loadProfiles();
    const active = loadActive(profiles);
    return profiles.find((item) => item.name === active) || profiles[0];
  }, []);
  const delveSettings = useMemo(() => loadSettings(), []);
  const delveSample = useMemo(() => {
    const profiles = loadSampleProfiles();
    const active = loadActiveSampleProfile(profiles);
    const selected = profiles.find((item) => item.name === active) || profiles[0];
    return sampleMetrics(selected);
  }, []);

  const bossSummary = useMemo(() => {
    const priceMap = snapshots?.prices?.prices;
    if (!priceMap) return null;
    const resolve = makeResolver(priceMap, {
      priceOverrides: profile?.priceOverrides || {},
      divineRate,
    });
    const rows = computeAll(resolve, profile);
    const best = rows
      .filter((row) => !row.entryUnknown && Number.isFinite(row.net))
      .sort((a, b) => b.net - a.net)[0] || null;
    const gaps = rows.flatMap((row) => row.hiddenLines.map((line) => ({
      boss: row.boss,
      line,
    })));
    return {
      best,
      missing: gaps.length,
      firstGap: gaps[0] || null,
    };
  }, [snapshots, profile, divineRate]);

  const delveSummary = useMemo(() => {
    const priceMap = snapshots?.prices?.prices || null;
    const categoryItems = [
      ...(snapshots?.fossils?.items || []),
      ...(snapshots?.resonators?.items || []),
    ];
    if (!priceMap && !categoryItems.length) return null;
    const categoryMap = {};
    for (const item of categoryItems) {
      if (item.chaosValue > 0) categoryMap[item.name] = { c: item.chaosValue, n: 1 };
    }
    const rate = snapshots?.fossils?.divineRate || divineRate;
    const priceOf = makePriceOf([categoryMap, priceMap], {
      overrides: delveSettings.priceOverrides || {},
      divineRate: rate,
    });
    const modelSettings = { ...delveSettings, ...delveSample.quantities };
    const best = computeBiomes(priceOf, modelSettings, delveSample).targets
      .filter((row) => row.opportunityIndex > 0)
      .sort((a, b) => b.opportunityIndex - a.opportunityIndex)[0] || null;
    return { best };
  }, [snapshots, delveSettings, delveSample, divineRate]);

  const categorySummary = useMemo(() => {
    if (!snapshots) return null;
    const candidates = [];
    for (const [key, label] of CATEGORY_FILES) {
      for (const item of snapshots[key]?.items || []) {
        const change = item[changeKey];
        if (Number.isFinite(change)) candidates.push({ ...item, change, label, tab: key });
      }
    }
    return candidates.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0] || null;
  }, [snapshots, changeKey]);

  const scarab = movers.rising[0] || movers.falling[0] || null;
  const scarabRising = !!movers.rising[0];
  const rankedStrategies = useMemo(() => (customFarms || [])
    .filter((strategy) => strategy.hasItems)
    .slice()
    .sort((a, b) => {
      const av = Number.isFinite(a[activeKey]) ? a[activeKey] : -Infinity;
      const bv = Number.isFinite(b[activeKey]) ? b[activeKey] : -Infinity;
      return bv - av;
    }), [customFarms, activeKey]);
  const rotatingStrategies = useMemo(() => {
    const measured = rankedStrategies.filter((strategy) => Number.isFinite(strategy[activeKey]));
    return (measured.length ? measured : rankedStrategies).slice(0, 3);
  }, [rankedStrategies, activeKey]);
  const fallingStrategies = useMemo(() => rankedStrategies
    .filter((strategy) => Number.isFinite(strategy[activeKey]) && strategy[activeKey] < 0)
    .slice()
    .sort((a, b) => a[activeKey] - b[activeKey])
    .slice(0, 3), [rankedStrategies, activeKey]);
  const rotationKey = rotatingStrategies.map((strategy) => strategy.id).join("|");

  useEffect(() => {
    setStrategyRotation(0);
    if (rotatingStrategies.length < 2) return undefined;
    const timer = setInterval(() => setStrategyRotation((index) => (index + 1) % rotatingStrategies.length), 5000);
    return () => clearInterval(timer);
  }, [rotationKey]);

  const customFarm = rotatingStrategies[strategyRotation % Math.max(1, rotatingStrategies.length)] || null;
  const customChange = customFarm?.[activeKey];
  const customDirection = Number.isFinite(customChange)
    ? customChange > 0 ? "more expensive" : customChange < 0 ? "cheaper" : "unchanged"
    : "waiting for history";
  const updatedAt = staticInfo?.generatedAt || snapshots?.prices?.generatedAt;
  const statusSource = snapshots?.prices?.priceSource || staticInfo?.priceSource;
  const status = mode === "connecting"
    ? "Loading market data"
    : mode === "demo"
      ? "Demo snapshot"
      : dataSource === "static" ? sourceLabel(statusSource) : "Live market data";

  const signals = [
    {
      id: "farms",
      kind: "Popular farms",
      status: "Scarab movement",
      title: scarab
        ? `${scarab.name} is the strongest ${scarabRising ? "rising" : "falling"} mechanic`
        : "No notable scarab mechanic movement",
      value: scarab ? pct(scarab[activeKey]) : "Stable",
      tone: scarab ? (scarab[activeKey] > 0 ? "up" : scarab[activeKey] < 0 ? "down" : "") : "",
      unit: `${changeWindow} mechanic-total movement`,
      note: "This is market movement, not a promised profit margin. The detailed tab keeps the existing scarab strategies and cost breakdowns unchanged.",
      flow: ["Live scarab prices", "Existing strategy recipes", "Mechanic movement"],
      openLabel: "Open Popular farms",
      open: () => onOpenTab("farms"),
    },
    customFarm?.hasItems ? {
      id: "watcher",
      kind: "Strat Watcher",
      status: `Top ${Math.min(3, rotatingStrategies.length)} · rotates every 5s`,
      title: `${customFarm.name} is ${customDirection}`,
      value: Number.isFinite(customChange) ? pct(customChange) : "—",
      tone: Number.isFinite(customChange) ? (customChange > 0 ? "up" : customChange < 0 ? "down" : "") : "",
      unit: `${changeWindow}${activeKey.endsWith("R") ? " divine-adjusted" : ""} total cost movement`,
      note: "This rotates through your three strongest saved setups for the selected window. The total counts every slot, including duplicates and the Astrolabe.",
      flow: [fmtPrice(customFarm.total, currency, divineRate), `${customFarm.scarabs.length} scarabs${customFarm.astrolabe ? " + Astrolabe" : ""}`, `${strategyRotation + 1}/${rotatingStrategies.length}`],
      openLabel: "Open Strat Watcher",
      open: () => onOpenTab("watcher"),
    } : null,
    {
      id: "boss",
      kind: "Boss profit",
      status: profile?.name || "Active TTK profile",
      title: bossSummary?.best
        ? `${bossSummary.best.boss.name} has the highest current estimated net`
        : snapshots === null ? "Loading boss prices" : "No complete boss estimate available",
      value: bossSummary?.best ? fmtPrice(bossSummary.best.net, currency, divineRate) : "—",
      tone: bossSummary?.best ? (bossSummary.best.net > 0 ? "up" : bossSummary.best.net < 0 ? "down" : "") : "",
      unit: "estimated net per kill",
      note: "Correct drop values can still produce a negative result. The detailed tab keeps entry cost, editable chances, kill distribution and the active TTK profile.",
      flow: ["Entry cost", "Median and mean", "Active TTK profile"],
      openLabel: "Open Boss profit",
      open: () => onOpenTab("bosses", bossSummary?.best?.boss?.id),
    },
    {
      id: "delve",
      kind: "Delve",
      status: "Experimental",
      title: delveSummary?.best
        ? `${delveSummary.best.biome.name} leads the fossil opportunities at depth ${delveSettings.depth}`
        : snapshots === null ? "Loading Delve prices" : "No priced biome value available",
      value: delveSummary?.best ? fmtPrice(delveSummary.best.depthAdjustedRange.median, currency, divineRate) : "—",
      tone: "",
      unit: "community Depth EV",
      note: "This reuses the saved depth and sample profile. It never mixes city bosses into fossil routing or invents a universal hourly rate.",
      flow: ["Live fossil price", `Depth ${delveSettings.depth}`, "Personal sample pace"],
      openLabel: "Open Delve",
      open: () => onOpenTab("delve"),
    },
    {
      id: "market",
      kind: categorySummary?.label || "Market movers",
      status: "Category movement",
      title: categorySummary
        ? `${categorySummary.name} has the largest ${changeWindow} category move`
        : snapshots === null ? "Loading category movement" : `No ${changeWindow} category movement available`,
      value: categorySummary ? pct(categorySummary.change) : "—",
      tone: categorySummary ? (categorySummary.change > 0 ? "up" : categorySummary.change < 0 ? "down" : "") : "",
      unit: `${changeWindow} price movement`,
      note: "One prominent mover appears here, then opens the existing category history for the full price path and divine-adjusted context.",
      flow: ["Live price", `${changeWindow} window`, "History chart"],
      openLabel: `Open ${categorySummary?.label || "market prices"}`,
      open: () => onOpenTab(categorySummary?.tab || "catalysts"),
    },
  ].filter(Boolean);
  const activeSignal = signals.find((signal) => signal.id === selectedSignal) || signals[0];

  const coverageTitle = bossSummary
    ? bossSummary.missing > 0
      ? `${bossSummary.missing} boss drop price${bossSummary.missing === 1 ? "" : "s"} missing`
      : "All configured boss drops are priced"
    : snapshots === null ? "Checking boss price coverage" : "Boss coverage unavailable";
  const coverageNote = bossSummary?.firstGap
    ? `First: ${bossSummary.firstGap.line.label} (${bossSummary.firstGap.boss.name})`
    : "Every configured drop contributes when broad pricing is available.";

  return (
    <main className="ov-main">
      <div className="ov-status">
        <b>{status}</b>
        <span>{league || "League loading"}</span>
        <span>{updatedAt ? `updated ${new Date(updatedAt).toLocaleString()}` : "updated recently"}</span>
        <span>1 Divine ≈ {Math.round(divineRate)} Chaos</span>
      </div>

      <div className="ov-head">
        <div>
          <div className="ov-kicker">Across Vaal Street</div>
          <h2>The daily briefing</h2>
          <p>The same live calculations, organised around what deserves a closer look.</p>
        </div>
        <div className="ov-window" aria-label="Change window">
          {CHANGE_WINDOW_OPTIONS.map((window) => (
            <button type="button" key={window} className={changeWindow === window ? "on" : ""}
              aria-pressed={changeWindow === window} onClick={() => setChangeWindow(window)}>
              {window}
            </button>
          ))}
        </div>
      </div>

      <div className="ov-briefing">
        <section className="ov-feature" aria-live="polite">
          <div className="ov-feature-top">
            <span className="ov-kind">{activeSignal.kind}</span>
            <em>{activeSignal.status}</em>
          </div>
          <h3>{activeSignal.title}</h3>
          <div className="ov-feature-number">
            <strong className={activeSignal.tone}>{activeSignal.value}</strong>
            <span>{activeSignal.unit}</span>
          </div>
          <p>{activeSignal.note}</p>
          <div className="ov-feature-bottom">
            <div className="ov-feature-flow">
              {activeSignal.flow.map((item) => <span key={item}>{item}</span>)}
            </div>
            <button type="button" onClick={activeSignal.open}>{activeSignal.openLabel}</button>
          </div>
        </section>

        <aside className="ov-signal-list" aria-label="Overview signals">
          {signals.map((signal) => (
            <Signal key={signal.id} kind={signal.kind} title={signal.title}
              value={signal.value} tone={signal.tone} selected={signal.id === activeSignal.id}
              onSelect={() => setSelectedSignal(signal.id)} />
          ))}
        </aside>
      </div>

      <section className="ov-falling" aria-label="Worst performing saved strategies">
        <div className="ov-falling-head">
          <div><span className="ov-kind">Downward trends</span><strong>Cooling saved strategies</strong></div>
          <button type="button" onClick={() => onOpenTab("watcher")}>Open Strat Watcher</button>
        </div>
        {fallingStrategies.length ? (
          <div className="ov-falling-grid">
            {fallingStrategies.map((strategy) => (
              <button type="button" className="ov-signal" key={strategy.id} onClick={() => onOpenTab("watcher")}>
                <span className="ov-kind">{changeWindow}{activeKey.endsWith("R") ? " divine-adjusted" : ""}</span>
                <strong>{strategy.name} is getting cheaper</strong>
                <span className="ov-value down">{pct(strategy[activeKey])}</span>
              </button>
            ))}
          </div>
        ) : (
          <p>No measured saved strategy is falling in the selected window.</p>
        )}
      </section>

      <h3 className="ov-section-title">Three decision desks</h3>
      <div className="ov-desks">
        <section className="ov-desk">
          <header><h3>{customFarm?.hasItems ? customFarm.name : "Watch a farming strategy"}</h3><em>Strat Watcher</em></header>
          <p>{customFarm?.hasItems ? "Currently rotating through your three strongest saved setups." : "Save up to ten setups of five scarabs and one Astrolabe."}</p>
          <dl>
            {customFarm?.hasItems ? <>
              <div><dt>Current cost</dt><dd>{fmtPrice(customFarm.total, currency, divineRate)}</dd></div>
              <div><dt>{changeWindow}{activeKey.endsWith("R") ? " divine-adjusted" : ""}</dt><dd>{pct(customChange)}</dd></div>
              <div><dt>Setup</dt><dd>{customFarm.scarabs.length}/5 scarabs{customFarm.astrolabe ? " + Astrolabe" : ""}</dd></div>
            </> : <>
              <div><dt>Movement leader</dt><dd>{scarab?.name || "No notable movement"}</dd></div>
              <div><dt>{changeWindow} move</dt><dd>{scarab ? pct(scarab[activeKey]) : "Stable"}</dd></div>
              <div><dt>Direction</dt><dd>{scarab ? (scarabRising ? "Rising" : "Falling") : "Stable"}</dd></div>
            </>}
          </dl>
          <button type="button" onClick={() => onOpenTab("watcher")}>Open Strat Watcher</button>
        </section>

        <section className="ov-desk">
          <header><h3>Price a boss kill</h3><em>Boss profit</em></header>
          <p>A quick read before the full loot and TTK view.</p>
          <dl>
            <div><dt>Current leader</dt><dd>{bossSummary?.best?.boss?.name || "Unavailable"}</dd></div>
            <div><dt>Estimated net</dt><dd>{bossSummary?.best ? fmtPrice(bossSummary.best.net, currency, divineRate) : "—"}</dd></div>
            <div><dt>TTK profile</dt><dd>{profile?.name || "Default"}</dd></div>
          </dl>
          <button type="button" onClick={() => onOpenTab("bosses", bossSummary?.best?.boss?.id)}>Open Boss profit</button>
        </section>

        <section className="ov-desk">
          <header><h3>Choose a Delve route</h3><em>Delve EXP</em></header>
          <p>Reuses saved depth and sample; EXP stays visible.</p>
          <dl>
            <div><dt>Target</dt><dd>{delveSummary?.best?.exclusive?.fossil || "Unavailable"}</dd></div>
            <div><dt>Depth EV</dt><dd>{delveSummary?.best ? fmtPrice(delveSummary.best.depthAdjustedRange.median, currency, divineRate) : "—"}</dd></div>
            <div><dt>Opportunity</dt><dd>{delveSummary?.best ? `${Math.round(delveSummary.best.opportunityIndex)}/100 at ${delveSettings.depth}` : "—"}</dd></div>
          </dl>
          <button type="button" onClick={() => onOpenTab("delve")}>Open Delve</button>
        </section>
      </div>

      <section className="ov-attention" aria-label="Data quality and assumptions">
        <button type="button" onClick={() => onOpenTab("bosses", bossSummary?.firstGap?.boss?.id)}>
          <span>Price coverage</span><strong>{coverageTitle}</strong><small>{coverageNote}</small>
        </button>
        <div><span>Experimental</span><strong>Delve assumptions stay labelled</strong><small>Community estimates never appear as official probabilities.</small></div>
        <div><span>Source quality</span><strong>{status}</strong><small>GGG exchange remains first; fallbacks stay visible.</small></div>
      </section>
    </main>
  );
}
