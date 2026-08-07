import { useEffect, useMemo, useState } from "react";
import { computeAll, loadActive, loadProfiles, makeResolver } from "./bossProfit.js";
import {
  computeBiomes, loadSettings, makePriceOf, loadSampleProfiles,
  loadActiveSampleProfile, sampleMetrics,
} from "./delve.js";

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

  useEffect(() => {
    let cancelled = false;
    setSnapshots(null);
    const read = async (file) => {
      try {
        const response = await fetch(`${staticBase}/${file}`);
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
  ];
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
          {["4h", "8h", "12h", "24h", "48h"].map((window) => (
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

      <h3 className="ov-section-title">Three decision desks</h3>
      <div className="ov-desks">
        <section className="ov-desk">
          <header><h3>Run a scarab strategy</h3><em>Popular farms</em></header>
          <p>The existing strategy presentation stays unchanged.</p>
          <dl>
            <div><dt>Movement leader</dt><dd>{scarab?.name || "No notable movement"}</dd></div>
            <div><dt>{changeWindow} move</dt><dd>{scarab ? pct(scarab[activeKey]) : "Stable"}</dd></div>
            <div><dt>Direction</dt><dd>{scarab ? (scarabRising ? "Rising" : "Falling") : "Stable"}</dd></div>
          </dl>
          <button type="button" onClick={() => onOpenTab("farms")}>Open Popular farms</button>
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
