import assert from "node:assert/strict";
import {
  FARM_STRATEGY_KEY, computeFarmStrategy, loadFarmStrategy,
  sanitizeFarmStrategy, saveFarmStrategy,
} from "../src/farmStrategy.js";
import { CHANGE_WINDOW_OPTIONS, nearestRateWindow } from "../src/marketWindows.js";

const storage = new Map();
const fakeStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

const clean = sanitizeFarmStrategy({
  name: "  Harvest loop  ",
  scarabs: ["A", "A", "B", "C", "D", "E", "F", null],
  astrolabe: "  Templar Astrolabe  ",
});
assert.deepEqual(clean, { name: "Harvest loop", scarabs: ["A", "A", "B", "C", "D"], astrolabe: "Templar Astrolabe" });
assert.deepEqual(sanitizeFarmStrategy({ name: "Legacy", scarabs: ["A"] }),
  { name: "Legacy", scarabs: ["A"], astrolabe: "" }, "older saved strategies migrate without being lost");

saveFarmStrategy(clean, fakeStorage);
assert.deepEqual(loadFarmStrategy(fakeStorage), clean);
assert.ok(storage.has(FARM_STRATEGY_KEY));

const computed = computeFarmStrategy(clean, [
  { name: "A", chaosValue: 10, change1: 100, change1R: 50 },
  { name: "B", chaosValue: 20, change1: 0, change1R: -10 },
  { name: "C", chaosValue: 5, change1: -50, change1R: -60 },
  { name: "D", chaosValue: 15, change1: 50, change1R: 20 },
], [
  { name: "Templar Astrolabe", chaosValue: 40, change1: 25, change1R: 5 },
]);
assert.equal(computed.scarabMembers.length, 5, "duplicate scarabs occupy separate map-device slots");
assert.equal(computed.members.length, 6, "the Astrolabe contributes to the complete farming setup");
assert.equal(computed.total, 100);
assert.equal(computed.astrolabeItem.name, "Templar Astrolabe");
assert.equal(computed.hasItems, true);
assert.deepEqual(computed.missing, []);
assert.ok(Number.isFinite(computed.change1));
assert.ok(Number.isFinite(computed.change1R));
assert.notEqual(computed.change1, computed.change1R, "divine-adjusted movement stays separate");

const missing = computeFarmStrategy({ name: "Thin league", scarabs: ["A", "Gone"], astrolabe: "Gone Astrolabe" }, [
  { name: "A", chaosValue: 10 },
]);
assert.deepEqual(missing.missing, ["Gone", "Gone Astrolabe"]);
assert.equal(missing.change1, null);

assert.deepEqual(CHANGE_WINDOW_OPTIONS, ["1h", "2h", "4h", "8h", "12h", "24h", "48h"]);
assert.equal(nearestRateWindow([{ day: 1, rate: 100 }, { day: 1 + 1 / 24, rate: 101 }], "2h"), null,
  "a 1h-old rate must not be reused as a fake 2h comparison");
assert.ok(nearestRateWindow([{ day: 1, rate: 100 }, { day: 1 + 2 / 24, rate: 101 }], "2h"));

console.log("Farming strategy tests passed");
