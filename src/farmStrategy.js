import { CHANGE_KEYS, weightedChange } from "./marketWindows.js";

export const FARM_STRATEGY_KEY = "vaal-street.farmingStrategy.v1";
export const FARM_STRATEGY_LIMIT = 5;

export function defaultFarmStrategy() {
  return { name: "My farming strat", scarabs: [], astrolabe: "" };
}

export function sanitizeFarmStrategy(raw) {
  const fallback = defaultFarmStrategy();
  const name = typeof raw?.name === "string" && raw.name.trim()
    ? raw.name.trim().slice(0, 48)
    : fallback.name;
  const scarabs = Array.isArray(raw?.scarabs)
    ? raw.scarabs
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim())
      .slice(0, FARM_STRATEGY_LIMIT)
    : [];
  const astrolabe = typeof raw?.astrolabe === "string" ? raw.astrolabe.trim() : "";
  return { name, scarabs, astrolabe };
}

export function loadFarmStrategy(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!storage) return defaultFarmStrategy();
  try {
    return sanitizeFarmStrategy(JSON.parse(storage.getItem(FARM_STRATEGY_KEY)));
  } catch {
    return defaultFarmStrategy();
  }
}

export function saveFarmStrategy(strategy, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const clean = sanitizeFarmStrategy(strategy);
  if (storage) storage.setItem(FARM_STRATEGY_KEY, JSON.stringify(clean));
  return clean;
}

export function computeFarmStrategy(strategy, items, astrolabes = []) {
  const clean = sanitizeFarmStrategy(strategy);
  const byName = new Map((items || []).map((item) => [item.name, item]));
  const astrolabeByName = new Map((astrolabes || []).map((item) => [item.name, item]));
  const scarabMembers = clean.scarabs.map((name) => byName.get(name)).filter(Boolean);
  const astrolabeItem = clean.astrolabe ? astrolabeByName.get(clean.astrolabe) || null : null;
  const members = astrolabeItem ? [...scarabMembers, astrolabeItem] : scarabMembers;
  const missing = clean.scarabs.filter((name) => !byName.has(name));
  if (clean.astrolabe && !astrolabeItem) missing.push(clean.astrolabe);
  const result = {
    ...clean,
    scarabMembers,
    astrolabeItem,
    members,
    missing,
    hasItems: clean.scarabs.length > 0 || !!clean.astrolabe,
    total: members.reduce((sum, item) => sum + (Number(item.chaosValue) || 0), 0),
  };
  for (const key of Object.values(CHANGE_KEYS)) {
    result[key] = weightedChange(members, key);
    result[`${key}R`] = weightedChange(members, `${key}R`);
  }
  return result;
}
