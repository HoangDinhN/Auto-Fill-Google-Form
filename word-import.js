(() => {
  "use strict";

  const QUESTION_PATTERN = /^\d+\.\s+(.+?)(?:\s+Required)?$/;
  const PERCENTAGE_PATTERN = /(-?\d+(?:[.,]\d+)?)\s*%/;

  function normalizedText(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildDistributionsFromParagraphTexts(paragraphTexts, defaults) {
    if (!Array.isArray(defaults) || !defaults.length) {
      throw new Error("Extension không có cấu hình tỷ lệ mặc định.");
    }

    const percentagesByQuestion = new Map();
    let currentQuestion = null;

    for (const rawText of paragraphTexts) {
      const text = String(rawText || "").trim();
      if (!text) continue;

      const questionMatch = normalizedText(text).match(QUESTION_PATTERN);
      if (questionMatch) {
        currentQuestion = normalizedText(questionMatch[1]);
        percentagesByQuestion.set(currentQuestion, []);
        continue;
      }

      if (!currentQuestion || !text.includes("%")) continue;
      const percentageSegment = text.split("\t").at(-1);
      const percentageMatch = percentageSegment.match(PERCENTAGE_PATTERN);
      if (!percentageMatch) continue;
      const percentage = Number(percentageMatch[1].replace(",", "."));
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        throw new Error(`Tỷ lệ không hợp lệ ở câu: ${currentQuestion}`);
      }
      percentagesByQuestion.get(currentQuestion).push(percentage);
    }

    const imported = defaults.map((distribution) => {
      const question = normalizedText(distribution.question);
      const percentages = percentagesByQuestion.get(question);
      if (!percentages) {
        throw new Error(`Không tìm thấy câu hỏi trong Word: ${distribution.question}`);
      }
      if (percentages.length !== distribution.options.length) {
        throw new Error(
          `Câu “${distribution.question}” có ${percentages.length} tỷ lệ, ` +
            `nhưng cần ${distribution.options.length}.`
        );
      }

      const total = percentages.reduce((sum, value) => sum + value, 0);
      if (Math.abs(total - 100) > 0.01) {
        throw new Error(
          `Tổng tỷ lệ của câu “${distribution.question}” là ${total}%, cần bằng 100%.`
        );
      }

      return {
        ...distribution,
        options: distribution.options.map((option, index) => ({
          ...option,
          percent: percentages[index]
        }))
      };
    });

    if (percentagesByQuestion.size !== defaults.length) {
      throw new Error(
        `File Word có ${percentagesByQuestion.size} câu hỏi, ` +
          `nhưng extension cần đúng ${defaults.length} câu.`
      );
    }
    return imported;
  }

  function paragraphText(paragraph) {
    const parts = [];
    for (const element of paragraph.getElementsByTagName("*")) {
      if (element.localName === "t") parts.push(element.textContent || "");
      if (element.localName === "tab") parts.push("\t");
    }
    return parts.join("").trim();
  }

  async function parseDocx(arrayBuffer, defaults) {
    if (!globalThis.JSZip) {
      throw new Error("Không thể khởi tạo bộ đọc file Word.");
    }

    let archive;
    try {
      archive = await globalThis.JSZip.loadAsync(arrayBuffer);
    } catch {
      throw new Error("File được chọn không phải tài liệu Word .docx hợp lệ.");
    }

    const documentEntry = archive.file("word/document.xml");
    if (!documentEntry) {
      throw new Error("Không tìm thấy nội dung chính trong file Word.");
    }

    const documentXml = await documentEntry.async("string");
    const xml = new DOMParser().parseFromString(documentXml, "application/xml");
    if (xml.querySelector("parsererror")) {
      throw new Error("Không thể đọc cấu trúc nội dung của file Word.");
    }

    const paragraphTexts = [...xml.getElementsByTagNameNS("*", "p")]
      .map(paragraphText)
      .filter(Boolean);
    return buildDistributionsFromParagraphTexts(paragraphTexts, defaults);
  }

  globalThis.RandomFormWordImport = Object.freeze({
    buildDistributionsFromParagraphTexts,
    parseDocx
  });
})();
