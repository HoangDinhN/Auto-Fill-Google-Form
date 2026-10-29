import assert from "node:assert/strict";

await import("../distribution-utils.js");
await import("../desired-distributions.js");

const { allocateCounts, buildSchedule } = globalThis.RandomFormDistribution;

assert.deepEqual(allocateCounts([35, 35, 30], 1), [1, 0, 0]);
assert.deepEqual(allocateCounts([35, 35, 30], 2), [1, 1, 0]);
assert.deepEqual(allocateCounts([90, 10], 2), [1, 1]);
assert.deepEqual(allocateCounts([100], 2), [2]);
assert.deepEqual(allocateCounts([55, 45], 20), [11, 9]);
assert.deepEqual(allocateCounts([25, 35, 25, 15], 20), [5, 7, 5, 3]);

const schedule = buildSchedule([20, 30, 50], 10, "stable-seed");
assert.equal(schedule.length, 10);
assert.deepEqual(
  schedule.reduce((counts, optionIndex) => {
    counts[optionIndex] += 1;
    return counts;
  }, [0, 0, 0]),
  [2, 3, 5]
);
assert.deepEqual(schedule, buildSchedule([20, 30, 50], 10, "stable-seed"));

assert.equal(globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS.length, 22);
assert.deepEqual(
  globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS[0].options.map((option) => option.percent),
  [35, 35, 30, 0]
);
assert.deepEqual(
  globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS[2].options.map((option) => option.percent),
  [80, 20]
);
assert.deepEqual(
  globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS[7].options.map((option) => option.percent),
  [0, 15, 30, 25, 30]
);
assert.deepEqual(
  globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS[21].options.map((option) => option.percent),
  [20, 20, 30, 30, 0, 0]
);
for (const distribution of globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS) {
  const total = distribution.options.reduce((sum, option) => sum + option.percent, 0);
  assert.equal(total, 100, `Question ${distribution.number} must total 100%`);
}

console.log("desired answer distribution allocation: OK");
