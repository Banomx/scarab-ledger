import { useEffect, useMemo, useState } from "react";
import { computeAll, loadActive, loadProfiles, makeResolver } from "./bossProfit.js";
import { computeBiomes, computeDelveBosses, loadSettings, makePriceOf } from "./delve.js";

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

function Signal({ kind, title, note, value, tone = "", onClick }) {
  const content = (
    <>
      <span className="ov-kind">{kind}</span>
      <span className="ov-signal-copy"><strong>{title}</strong><small>{note}</small></span>
      <span className={`ov-value ${tone}`}>{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="ov-signal" onClick={onClick}>{content}</button>
  ) : (
    <div className="ov-signal">{content}</div>
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

  const bossSummary = useMemo(() => {
    const priceMap = snapshots?.prices?.prices;
    if (!priceMap) return null;
    const resolve = makeResolver(priceMap, {
      priceOverrides: profile?.priceOverrides || {},
      divineRate,
    });
    const rows = computeAll(resolve, profile);
    const best = rows
      .filter((row) => !row.entryUnknown && row.net > 0)
      .sort((a, b) => b.net - a.net)[0] || null;
    return {
      best,
      missing: rows.reduce((sum, row) => sum + row.missingPrices, 0),
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
    const resolve = makeResolver(priceMap, {
      priceOverrides: delveSettings.priceOverrides || {},
      divineRate: rate,
    });
    const bosses = computeDelveBosses(resolve, delveSettings);
    const bossValues = Object.fromEntries(bosses.map((row) => [row.delve.id, row.gross]));
    const best = computeBiomes(priceOf, delveSettings, bossValues).rows
      .filter((row) => row.headline > 0)
      .sort((a, b) => b.headline - a.headline)[0] || null;
    return { best };
  }, [snapshots, delveSettings, divineRate]);

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
          <div className="ov-kicker">Across the site</div>
          <h2>What to watch</h2>
          <p>A compact readout of notable values already calculated in each tool.</p>
        </div>
        <div className="ov-window" aria-label="Change window">
          {["4h", "8h", "12h", "24h", "48h"].map((window) => (
            <button
              type="button"
              key={window}
              className={changeWindow === window ? "on" : ""}
              aria-pressed={changeWindow === window}
              onClick={() => setChangeWindow(window)}
            >{window}</button>
          ))}
        </div>
      </div>

      <div className="ov-layout">
        <section className="ov-signals">
          <h3 className="ov-section-title">Current signals</h3>
          <Signal
            kind="Scarabs"
            title={scarab
              ? `${scarab.name} is the strongest ${scarabRising ? "rising" : "falling"} mechanic`
              : "No notable scarab mechanic movement"}
            note="Uses the same mechanic-total movement shown in Popular farms."
            value={scarab ? pct(scarab[activeKey]) : "Stable"}
            tone={scarab ? (scarab[activeKey] > 0 ? "up" : "down") : ""}
            onClick={() => onOpenTab("farms")}
          />
          <Signal
            kind="Boss EV"
            title={bossSummary?.best
              ? `${bossSummary.best.boss.name} has the highest positive estimated net value`
              : snapshots === null ? "Loading boss prices" : "No complete positive boss estimate available"}
            note="Calculated from the active TTK profile, current entry price and editable drop table."
            value={bossSummary?.best ? fmtPrice(bossSummary.best.net, currency, divineRate) : "—"}
            onClick={() => onOpenTab("bosses")}
          />
          <Signal
            kind="Delve"
            title={delveSummary?.best
              ? `${delveSummary.best.biome.name} leads the current biome node values`
              : snapshots === null ? "Loading Delve prices" : "No priced biome value available"}
            note="Uses the existing biome-value calculation at your saved depth and assumptions."
            value={delveSummary?.best ? fmtPrice(delveSummary.best.headline, currency, divineRate) : "—"}
            onClick={() => onOpenTab("delve")}
          />
          <Signal
            kind={categorySummary?.label || "Market"}
            title={categorySummary
              ? `${categorySummary.name} has the largest ${changeWindow} category move`
              : snapshots === null ? "Loading category movement" : `No ${changeWindow} category movement available`}
            note="Compares current Catalyst and Astrolabe price-change data."
            value={categorySummary ? pct(categorySummary.change) : "—"}
            tone={categorySummary ? (categorySummary.change > 0 ? "up" : categorySummary.change < 0 ? "down" : "") : ""}
            onClick={() => onOpenTab(categorySummary?.tab || "catalysts")}
          />
          <Signal
            kind="Data"
            title={bossSummary
              ? bossSummary.missing > 0
                ? `${bossSummary.missing} boss drop price${bossSummary.missing === 1 ? " is" : "s are"} currently missing`
                : "All configured boss drops have a usable price"
              : snapshots === null ? "Checking price coverage" : "Broad boss pricing is not in this snapshot"}
            note="Missing lines contribute zero until a supported source supplies a price."
            value={bossSummary ? (bossSummary.missing > 0 ? "Check gaps" : "Covered") : "Unavailable"}
            tone={bossSummary?.missing > 0 ? "warn" : ""}
            onClick={() => onOpenTab("bosses")}
          />
        </section>

        <aside className="ov-side" aria-label="Market context">
          <section className="ov-side-section">
            <h3 className="ov-section-title">Market context</h3>
            <div className="ov-context-row"><span>Divine Orb</span><strong>{Math.round(divineRate)}c</strong></div>
            <div className="ov-context-row"><span>Change window</span><strong>{changeWindow}</strong></div>
            <div className="ov-context-row"><span>Display</span><strong>{currency === "smart" ? "Smart currency" : currency}</strong></div>
            <div className="ov-context-row"><span>League</span><strong>{league || "—"}</strong></div>
          </section>
          <section className="ov-side-section">
            <h3 className="ov-section-title">Data quality</h3>
            <div className="ov-quality"><strong>GGG exchange first</strong>Completed hourly trades provide supported currency and scarab prices.</div>
            <div className="ov-quality"><strong>Fallback coverage</strong>poe.watch and poe.ninja fill items outside the public exchange feed.</div>
          </section>
        </aside>
      </div>
    </main>
  );
}
