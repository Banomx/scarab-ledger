import { useEffect, useMemo, useState } from "react";
import { computeAll, loadActive, loadProfiles, makeResolver } from "./bossProfit.js";
import {
  computeBiomes, loadSettings, makePriceOf, loadSampleProfiles,
  loadActiveSampleProfile, sampleMetrics,
} from "./delve.js";
import { CHANGE_WINDOW_OPTIONS } from "./marketWindows.js";
import { TREND_DEPTH, TREND_ROTATION_MS, pickTrend, rotateTrend } from "./overviewTrends.js";

const CATEGORY_FILES = [
  ["catalysts", "Catalysts"],
  ["astrolabes", "Astrolabes"],
];
const ROTATION_SECONDS = Math.round(TREND_ROTATION_MS / 1000);

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

function Feature({ signal }) {
  return (
    <section className="ov-feature" aria-live="polite">
      <div className="ov-feature-top">
        <span className="ov-kind">{signal.kind}</span>
        <em>{signal.status}</em>
      </div>
      <h3>{signal.title}</h3>
      <div className="ov-feature-number">
        <strong className={signal.tone}>{signal.value}</strong>
        <span>{signal.unit}</span>
      </div>
      <p>{signal.note}</p>
      <div className="ov-feature-bottom">
        <div className="ov-feature-flow">
          {signal.flow.map((item) => <span key={item}>{item}</span>)}
        </div>
        <button type="button" onClick={signal.open}>{signal.openLabel}</button>
      </div>
    </section>
  );
}

function SignalList({ label, signals, activeId, onSelect }) {
  return (
    <aside className="ov-signal-list" aria-label={label}>
      {signals.map((signal) => (
        <Signal key={signal.id} kind={signal.kind} title={signal.title}
          value={signal.value} tone={signal.tone} selected={signal.id === activeId}
          onSelect={() => onSelect(signal.id)} />
      ))}
    </aside>
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
  const [selectedRising, setSelectedRising] = useState("farms");
  const [selectedFalling, setSelectedFalling] = useState("farms");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), TREND_ROTATION_MS);
    return () => clearInterval(timer);
  }, []);

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
    const gaps = rows.flatMap((row) => row.hiddenLines.map((line) => ({
      boss: row.boss,
      line,
    })));
    return {
      rows: rows.filter((row) => !row.entryUnknown && Number.isFinite(row.net)),
      missing: gaps.length,
      firstGap: gaps[0] || null,
    };
  }, [snapshots, profile, divineRate]);

  const delveTargets = useMemo(() => {
    const priceMap = snapshots?.prices?.prices || null;
    const categoryItems = [
      ...(snapshots?.fossils?.items || []),
      ...(snapshots?.resonators?.items || []),
    ];
    if (!priceMap && !categoryItems.length) return [];
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
    return computeBiomes(priceOf, modelSettings, delveSample).targets
      .filter((row) => row.opportunityIndex > 0);
  }, [snapshots, delveSettings, delveSample, divineRate]);

  const categoryRows = useMemo(() => {
    if (!snapshots) return [];
    const candidates = [];
    for (const [key, label] of CATEGORY_FILES) {
      for (const item of snapshots[key]?.items || []) {
        const change = item[changeKey];
        if (Number.isFinite(change)) candidates.push({ ...item, change, label, tab: key });
      }
    }
    return candidates;
  }, [snapshots, changeKey]);

  const strategyRows = useMemo(
    () => (customFarms || []).filter((strategy) => strategy.hasItems),
    [customFarms],
  );

  /* Each desk keeps its own three-deep rising and falling shortlist. The panels
     below are the same five desks read from opposite ends of these lists. */
  const pools = useMemo(() => {
    const byChange = (rows, valueOf) => ({
      up: pickTrend(rows, valueOf, "up"),
      down: pickTrend(rows, valueOf, "down"),
    });
    const byLevel = (rows, valueOf) => ({
      up: pickTrend(rows, valueOf, "up", { signed: false }),
      down: pickTrend(rows, valueOf, "down", { signed: false }),
    });
    return {
      farms: {
        up: movers.rising.slice(0, TREND_DEPTH),
        down: movers.falling.slice(0, TREND_DEPTH),
      },
      watcher: byChange(strategyRows, (strategy) => strategy[activeKey]),
      boss: byLevel(bossSummary?.rows, (row) => row.net),
      delve: byLevel(delveTargets, (row) => row.opportunityIndex),
      market: byChange(categoryRows, (row) => row.change),
    };
  }, [movers, strategyRows, bossSummary, delveTargets, categoryRows, activeKey]);

  const realSuffix = activeKey.endsWith("R") ? " divine-adjusted" : "";

  const buildSignals = (direction) => {
    const up = direction === "up";
    const signals = [];
    const position = (slot) => `${slot.index + 1}/${slot.count}`;

    const farm = rotateTrend(pools.farms[direction], tick);
    if (farm.entry) signals.push({
      id: "farms",
      kind: "Popular farms",
      status: `Scarab movement · ${position(farm)}`,
      title: farm.index === 0
        ? `${farm.entry.name} is the strongest ${up ? "rising" : "falling"} mechanic`
        : `${farm.entry.name} is the #${farm.index + 1} ${up ? "rising" : "falling"} mechanic`,
      value: pct(farm.entry[activeKey]),
      tone: up ? "up" : "down",
      unit: `${changeWindow} mechanic-total movement`,
      note: "This is market movement, not a promised profit margin. The detailed tab keeps the existing scarab strategies and cost breakdowns unchanged.",
      flow: ["Live scarab prices", "Existing strategy recipes", "Mechanic movement"],
      openLabel: "Open Popular farms",
      open: () => onOpenTab("farms"),
    });

    const strategy = rotateTrend(pools.watcher[direction], tick);
    if (strategy.entry) signals.push({
      id: "watcher",
      kind: "Strat Watcher",
      status: `${up ? "Top" : "Bottom"} ${strategy.count} · rotates every ${ROTATION_SECONDS}s`,
      title: `${strategy.entry.name} is getting ${up ? "more expensive" : "cheaper"}`,
      value: pct(strategy.entry[activeKey]),
      tone: up ? "up" : "down",
      unit: `${changeWindow}${realSuffix} total cost movement`,
      note: "The total counts every slot of the saved setup, including duplicates and the Astrolabe.",
      flow: [
        fmtPrice(strategy.entry.total, currency, divineRate),
        `${strategy.entry.scarabs.length} scarabs${strategy.entry.astrolabe ? " + Astrolabe" : ""}`,
        position(strategy),
      ],
      openLabel: "Open Strat Watcher",
      open: () => onOpenTab("watcher"),
    });

    const boss = rotateTrend(pools.boss[direction], tick);
    if (boss.entry) signals.push({
      id: "boss",
      kind: "Boss profit",
      status: profile?.name || "Active TTK profile",
      title: boss.index === 0
        ? `${boss.entry.boss.name} has the ${up ? "highest" : "lowest"} current estimated net`
        : `${boss.entry.boss.name} is #${boss.index + 1} from the ${up ? "top" : "bottom"} by estimated net`,
      value: fmtPrice(boss.entry.net, currency, divineRate),
      tone: boss.entry.net > 0 ? "up" : boss.entry.net < 0 ? "down" : "",
      unit: "estimated net per kill",
      note: "Correct drop values can still produce a negative result. The detailed tab keeps entry cost, editable chances, kill distribution and the active TTK profile.",
      flow: ["Entry cost", "Median and mean", "Active TTK profile"],
      openLabel: "Open Boss profit",
      open: () => onOpenTab("bosses", boss.entry.boss?.id),
    });

    const delve = rotateTrend(pools.delve[direction], tick);
    if (delve.entry) signals.push({
      id: "delve",
      kind: "Delve",
      status: "Experimental",
      title: delve.index === 0
        ? `${delve.entry.biome.name} ${up ? "leads" : "trails"} the fossil opportunities at depth ${delveSettings.depth}`
        : `${delve.entry.biome.name} is #${delve.index + 1} from the ${up ? "top" : "bottom"} of the fossil opportunities`,
      value: fmtPrice(delve.entry.depthAdjustedRange.median, currency, divineRate),
      tone: "",
      unit: "community Depth EV",
      note: "This reuses the saved depth and sample profile. It never mixes city bosses into fossil routing or invents a universal hourly rate.",
      flow: ["Live fossil price", `Depth ${delveSettings.depth}`, "Personal sample pace"],
      openLabel: "Open Delve",
      open: () => onOpenTab("delve"),
    });

    const market = rotateTrend(pools.market[direction], tick);
    if (market.entry) signals.push({
      id: "market",
      kind: market.entry.label,
      status: `Category movement · ${position(market)}`,
      title: market.index === 0
        ? `${market.entry.name} has the largest ${changeWindow} category ${up ? "gain" : "drop"}`
        : `${market.entry.name} is the #${market.index + 1} ${changeWindow} category ${up ? "gain" : "drop"}`,
      value: pct(market.entry.change),
      tone: up ? "up" : "down",
      unit: `${changeWindow} price movement`,
      note: "One prominent mover appears here, then opens the existing category history for the full price path and divine-adjusted context.",
      flow: ["Live price", `${changeWindow} window`, "History chart"],
      openLabel: `Open ${market.entry.label}`,
      open: () => onOpenTab(market.entry.tab),
    });

    if (signals.length) return signals;
    /* Keep both panels the same shape while data is loading or genuinely flat,
       so the page does not collapse to a single column and back. */
    return [{
      id: "quiet",
      kind: up ? "Rising" : "Cooling",
      status: snapshots === null ? "Loading" : "Nothing measured",
      title: snapshots === null
        ? "Loading market data"
        : `Nothing is measurably ${up ? "climbing" : "cooling"} in the ${changeWindow} window`,
      value: "—",
      tone: "",
      unit: `${changeWindow}${realSuffix} window`,
      note: "Short windows stay empty until a snapshot old enough to compare against exists. They are never estimated.",
      flow: ["Live prices", `${changeWindow} window`, "No measured move"],
      openLabel: "Open Popular farms",
      open: () => onOpenTab("farms"),
    }];
  };

  const risingSignals = buildSignals("up");
  const fallingSignals = buildSignals("down");
  const risingSignal = risingSignals.find((signal) => signal.id === selectedRising) || risingSignals[0];
  const fallingSignal = fallingSignals.find((signal) => signal.id === selectedFalling) || fallingSignals[0];

  const updatedAt = staticInfo?.generatedAt || snapshots?.prices?.generatedAt;
  const statusSource = snapshots?.prices?.priceSource || staticInfo?.priceSource;
  const status = mode === "connecting"
    ? "Loading market data"
    : mode === "demo"
      ? "Demo snapshot"
      : dataSource === "static" ? sourceLabel(statusSource) : "Live market data";

  const bestBoss = pools.boss.up[0] || null;
  const bestDelve = pools.delve.up[0] || null;
  const leadFarm = pools.farms.up[0] || pools.farms.down[0] || null;
  const leadFarmRising = !!pools.farms.up[0];
  const deskStrategy = rotateTrend(pools.watcher.up, tick).entry || strategyRows[0] || null;
  const deskChange = deskStrategy?.[activeKey];

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
        <Feature signal={risingSignal} />
        <SignalList label="Upward trends" signals={risingSignals}
          activeId={risingSignal.id} onSelect={setSelectedRising} />
      </div>

      <div className="ov-head ov-head-down">
        <div>
          <div className="ov-kicker">Downward trends</div>
          <h2>What is cooling off</h2>
          <p>The same desks, read from the bottom of each list.</p>
        </div>
      </div>

      <div className="ov-briefing ov-down">
        <Feature signal={fallingSignal} />
        <SignalList label="Downward trends" signals={fallingSignals}
          activeId={fallingSignal.id} onSelect={setSelectedFalling} />
      </div>

      <h3 className="ov-section-title">Three decision desks</h3>
      <div className="ov-desks">
        <section className="ov-desk">
          <header><h3>{deskStrategy ? deskStrategy.name : "Watch a farming strategy"}</h3><em>Strat Watcher</em></header>
          <p>{deskStrategy ? `Rotating through your strongest saved setups every ${ROTATION_SECONDS} seconds.` : "Save up to ten setups of five scarabs and one Astrolabe."}</p>
          <dl>
            {deskStrategy ? <>
              <div><dt>Current cost</dt><dd>{fmtPrice(deskStrategy.total, currency, divineRate)}</dd></div>
              <div><dt>{changeWindow}{realSuffix}</dt><dd>{pct(deskChange)}</dd></div>
              <div><dt>Setup</dt><dd>{deskStrategy.scarabs.length}/5 scarabs{deskStrategy.astrolabe ? " + Astrolabe" : ""}</dd></div>
            </> : <>
              <div><dt>Movement leader</dt><dd>{leadFarm?.name || "No notable movement"}</dd></div>
              <div><dt>{changeWindow} move</dt><dd>{leadFarm ? pct(leadFarm[activeKey]) : "Stable"}</dd></div>
              <div><dt>Direction</dt><dd>{leadFarm ? (leadFarmRising ? "Rising" : "Falling") : "Stable"}</dd></div>
            </>}
          </dl>
          <button type="button" onClick={() => onOpenTab("watcher")}>Open Strat Watcher</button>
        </section>

        <section className="ov-desk">
          <header><h3>Price a boss kill</h3><em>Boss profit</em></header>
          <p>A quick read before the full loot and TTK view.</p>
          <dl>
            <div><dt>Current leader</dt><dd>{bestBoss?.boss?.name || "Unavailable"}</dd></div>
            <div><dt>Estimated net</dt><dd>{bestBoss ? fmtPrice(bestBoss.net, currency, divineRate) : "—"}</dd></div>
            <div><dt>TTK profile</dt><dd>{profile?.name || "Default"}</dd></div>
          </dl>
          <button type="button" onClick={() => onOpenTab("bosses", bestBoss?.boss?.id)}>Open Boss profit</button>
        </section>

        <section className="ov-desk">
          <header><h3>Choose a Delve route</h3><em>Delve EXP</em></header>
          <p>Reuses saved depth and sample; EXP stays visible.</p>
          <dl>
            <div><dt>Target</dt><dd>{bestDelve?.exclusive?.fossil || "Unavailable"}</dd></div>
            <div><dt>Depth EV</dt><dd>{bestDelve ? fmtPrice(bestDelve.depthAdjustedRange.median, currency, divineRate) : "—"}</dd></div>
            <div><dt>Opportunity</dt><dd>{bestDelve ? `${Math.round(bestDelve.opportunityIndex)}/100 at ${delveSettings.depth}` : "—"}</dd></div>
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
