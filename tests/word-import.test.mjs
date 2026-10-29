import assert from "node:assert/strict";

await import("../desired-distributions.js");
await import("../word-import.js");

const defaults = globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS;
const { buildDistributionsFromParagraphTexts } = globalThis.RandomFormWordImport;

function paragraphTexts(overrides = new Map()) {
  return defaults.flatMap((distribution) => {
    const percentages =
      overrides.get(distribution.question) ||
      distribution.options.map((option) => option.percent);
    return [
      `${distribution.number}. ${distribution.question}  Required`,
      ...distribution.options.map(
        (option, index) => `○  ${option.label}\t${percentages[index]} %`
      )
    ];
  });
}

const targetQuestion =
  "Are you applying structure self-development method to managing impostor feelings?";
const imported = buildDistributionsFromParagraphTexts(
  paragraphTexts(new Map([[targetQuestion, [70, 30]]])),
  defaults
);
assert.deepEqual(
  imported[2].options.map((option) => option.percent),
  [70, 30]
);
assert.deepEqual(
  imported[0].options.map((option) => option.percent),
  [35, 35, 30, 0]
);

assert.throws(
  () =>
    buildDistributionsFromParagraphTexts(
      paragraphTexts(new Map([[targetQuestion, [70, 20]]])),
      defaults
    ),
  /cần bằng 100%/
);

assert.throws(
  () => buildDistributionsFromParagraphTexts(paragraphTexts().slice(1), defaults),
  /Không tìm thấy câu hỏi/
);

console.log("Word percentage import validation: OK");
