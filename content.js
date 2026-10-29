(() => {
  "use strict";

  if (window.__randomFormFillerLoaded) return;
  window.__randomFormFillerLoaded = true;

  const LEGACY_AUTO_KEY = "randomFormFillerAuto";
  const ACTIVE_RUN_KEY = "randomFormFillerActiveRun";
  const LAST_RUN_KEY = "randomFormFillerLastRun";
  const CUSTOM_DISTRIBUTIONS_KEY = "randomFormFillerDesiredDistributions";
  const LOCAL_RUN_TOKEN_KEY = "randomFormFillerRunToken";
  const MAX_RUN_AGE_MS = 60 * 60 * 1000;
  const FORM_ID = "1FAIpQLSdClsnVFzQEXCzTirtOhNlLQegqI2xyd6a58Tmx122usZgN6A";
  const DEFAULT_OPTIONS = {
    preserveAnswered: true,
    avoidOther: true,
    fillText: false,
    useDesiredPercentages: false
  };
  const NEXT_LABELS = new Set(["next", "tiếp", "tiếp"]);
  const SUBMIT_LABELS = new Set(["submit", "gửi", "gửi"]);
  const OTHER_PATTERN = /^(other|other answer|mục khác|câu trả lời khác)\b/i;
  const PLACEHOLDER_PATTERN = /^(choose|select|chọn|chọn)(\s|$)/i;
  const TEXT_VALUES = [
    "Không áp dụng",
    "Không có ý kiến",
    "Câu trả lời khác"
  ];

  let toastTimer;
  let autoFillStepRunning = false;
  let lastAutoPageSignature = null;
  let mutationResumeTimer;
  let progressHideTimer;
  let activeDesiredDistributions = null;

  const sleep = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  function getFormStartUrl() {
    const prefix = location.pathname.match(
      new RegExp(`^(/forms(?:/u/\\d+)?/d/e/${FORM_ID}/)`)
    )?.[1];
    return prefix ? `${location.origin}${prefix}viewform` : null;
  }

  function normalizedText(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("vi");
  }

  function randomIndex(length) {
    if (length < 1) return -1;
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % length;
  }

  function randomItem(items) {
    return items[randomIndex(items.length)];
  }

  function comparableText(value) {
    return normalizedText(value)
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function distributionQuestionKey(distribution) {
    const code = distribution.question.match(/^(IF|SR)\d+\./i)?.[0];
    return comparableText(code ? code.slice(0, -1) : distribution.question);
  }

  function findDesiredDistribution(group) {
    const distributions =
      activeDesiredDistributions ||
      globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS ||
      [];
    if (!distributions.length) return null;

    const questionRoot = group.closest('[role="listitem"]');
    const parameterText = [
      group.getAttribute("data-params"),
      group.closest("[data-params]")?.getAttribute("data-params"),
      questionRoot?.getAttribute("data-params")
    ]
      .filter(Boolean)
      .join(" ");
    const idMatches = distributions.filter((distribution) =>
      parameterText.includes(String(distribution.id))
    );
    if (idMatches.length === 1) return idMatches[0];

    const directText = comparableText(
      [
        group.getAttribute("aria-label"),
        group.getAttribute("data-params"),
        group.parentElement?.getAttribute("aria-label")
      ]
        .filter(Boolean)
        .join(" ")
    );
    const directMatches = distributions.filter((distribution) =>
      directText.includes(distributionQuestionKey(distribution))
    );
    if (directMatches.length === 1) return directMatches[0];

    if (!questionRoot) return null;
    const rootText = comparableText(questionRoot.innerText || questionRoot.textContent);
    const rootMatches = distributions.filter((distribution) =>
      rootText.includes(distributionQuestionKey(distribution))
    );
    if (rootMatches.length === 1) return rootMatches[0];

    if (rootMatches.length > 1) {
      const rootGroups = [...questionRoot.querySelectorAll('[role="radiogroup"]')].filter(
        isVisible
      );
      const groupIndex = rootGroups.indexOf(group);
      if (groupIndex >= 0 && groupIndex < rootMatches.length) {
        return rootMatches[groupIndex];
      }
    }
    return null;
  }

  async function loadDesiredDistributions(useDesiredPercentages) {
    const defaults = globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS || [];
    activeDesiredDistributions = defaults;
    if (!useDesiredPercentages) return;

    const stored = await chrome.storage.local.get(CUSTOM_DISTRIBUTIONS_KEY);
    const custom = stored[CUSTOM_DISTRIBUTIONS_KEY];
    if (
      custom?.source === "word" &&
      Array.isArray(custom.distributions) &&
      custom.distributions.length === defaults.length
    ) {
      activeDesiredDistributions = custom.distributions;
    }
  }

  function optionMatchesLabel(element, label) {
    const target = comparableText(label);
    if (!target) return false;
    if (
      (target.includes("other") || target.includes("muc khac")) &&
      isOtherOption(element)
    ) {
      return true;
    }
    const candidateTexts = [
      element.getAttribute("data-value"),
      element.getAttribute("aria-label"),
      controlLabel(element)
    ]
      .filter(Boolean)
      .map(comparableText);
    return candidateTexts.some(
      (candidate) =>
        candidate === target || candidate.includes(target) || target.includes(candidate)
    );
  }

  function desiredRadioChoice(group, candidates, run) {
    if (!run?.runId || !globalThis.RandomFormDistribution) return null;
    const distribution = findDesiredDistribution(group);
    if (!distribution) return null;

    const totalRuns = Math.max(1, Number(run.totalRuns) || 1);
    const runIndex = Math.min(
      totalRuns - 1,
      Math.max(0, Number(run.completedRuns) || 0)
    );
    const schedule = globalThis.RandomFormDistribution.buildSchedule(
      distribution.options.map((option) => option.percent),
      totalRuns,
      `${run.runId}:${distribution.id}`
    );
    const desiredOption = distribution.options[schedule[runIndex]];
    if (!desiredOption) return null;
    return candidates.find((element) => optionMatchesLabel(element, desiredOption.label)) || null;
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function isEnabled(element) {
    return (
      element.getAttribute("aria-disabled") !== "true" &&
      !element.hasAttribute("disabled")
    );
  }

  function controlLabel(element) {
    const aria = element.getAttribute("aria-label");
    if (aria) return aria.trim();
    return element.closest("label")?.innerText?.trim() || element.parentElement?.innerText?.trim() || "";
  }

  function isOtherOption(element) {
    const label = controlLabel(element);
    return !label || OTHER_PATTERN.test(normalizedText(label));
  }

  function showToast(message, kind = "success") {
    let toast = document.querySelector("#random-form-filler-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "random-form-filler-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.append(toast);
    }

    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.dataset.visible = "true";
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.dataset.visible = "false";
    }, 3500);
  }

  function installProgressPanel() {
    let panel = document.querySelector("#random-form-filler-progress");
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = "random-form-filler-progress";
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = `
      <div class="random-form-filler-progress__header">
        <span class="random-form-filler-progress__icon" aria-hidden="true">🎲</span>
        <span class="random-form-filler-progress__heading">
          <span class="random-form-filler-progress__title">Tiến trình tự động</span>
          <span class="random-form-filler-progress__count">0/1 form đã gửi</span>
        </span>
      </div>
      <div
        class="random-form-filler-progress__track"
        role="progressbar"
        aria-label="Số form đã gửi"
        aria-valuemin="0"
        aria-valuemax="1"
        aria-valuenow="0"
      >
        <div class="random-form-filler-progress__fill"></div>
      </div>
      <p class="random-form-filler-progress__status">Đang khởi động…</p>
    `;
    document.body.append(panel);
    return panel;
  }

  function progressStatus(run) {
    const total = Math.max(1, Number(run.totalRuns) || 1);
    const completed = Math.min(total, Math.max(0, Number(run.completedRuns) || 0));
    const current = Math.min(total, completed + 1);
    const messages = {
      starting: "Đang khởi động quá trình tự động…",
      filling: `Đang điền form ${current}/${total}…`,
      "next-page": `Form ${current}/${total}: đang chuyển sang trang tiếp theo…`,
      submitting: `Form ${current}/${total}: đang gửi phản hồi…`,
      "next-form": `Đã gửi ${completed}/${total} form. Đang mở lượt tiếp theo…`,
      completed: `Hoàn tất: đã gửi ${completed}/${total} form.`,
      stopped: `Đã dừng tại ${completed}/${total} form.`,
      error: `Quá trình dừng do lỗi sau ${completed}/${total} form.`
    };
    return run.statusMessage || messages[run.phase] || `Đã gửi ${completed}/${total} form.`;
  }

  function renderPageProgress(run, isActive) {
    const panel = installProgressPanel();
    clearTimeout(progressHideTimer);

    if (!run) {
      panel.dataset.visible = "false";
      return;
    }

    const total = Math.max(1, Number(run.totalRuns) || 1);
    const completed = Math.min(total, Math.max(0, Number(run.completedRuns) || 0));
    const percentage = Math.round((completed / total) * 100);
    const count = panel.querySelector(".random-form-filler-progress__count");
    const title = panel.querySelector(".random-form-filler-progress__title");
    const track = panel.querySelector(".random-form-filler-progress__track");
    const fill = panel.querySelector(".random-form-filler-progress__fill");
    const status = panel.querySelector(".random-form-filler-progress__status");

    title.textContent = run.options?.useDesiredPercentages
      ? "Điền theo tỷ lệ"
      : "Điền ngẫu nhiên";
    count.textContent = `${completed}/${total} form đã gửi`;
    fill.style.width = `${percentage}%`;
    track.setAttribute("aria-valuemax", String(total));
    track.setAttribute("aria-valuenow", String(completed));
    track.dataset.active = String(isActive);
    status.textContent = progressStatus(run);
    panel.dataset.kind = run.phase || "running";
    panel.dataset.visible = "true";

    if (!isActive) {
      const age = Math.max(0, Date.now() - (Number(run.endedAt) || Date.now()));
      const remaining = Math.max(0, 12000 - age);
      if (!remaining) {
        panel.dataset.visible = "false";
      } else {
        progressHideTimer = window.setTimeout(() => {
          panel.dataset.visible = "false";
        }, remaining);
      }
    }
  }

  async function refreshPageProgress() {
    const stored = await chrome.storage.local.get([ACTIVE_RUN_KEY, LAST_RUN_KEY]);
    const active = stored[ACTIVE_RUN_KEY] || null;
    renderPageProgress(active || stored[LAST_RUN_KEY] || null, Boolean(active));
  }

  function clickControl(element) {
    element.scrollIntoView({ block: "center", behavior: "auto" });
    element.click();
  }

  function fillRadioGroups(options, run) {
    let filled = 0;
    const groups = [...document.querySelectorAll('[role="radiogroup"]')].filter(isVisible);

    for (const group of groups) {
      const checked = group.querySelector('[role="radio"][aria-checked="true"]');
      if (options.preserveAnswered && checked) continue;

      let candidates = [...group.querySelectorAll('[role="radio"]')].filter(
        (element) => isVisible(element) && isEnabled(element)
      );

      if (options.avoidOther) {
        const regularOptions = candidates.filter((element) => !isOtherOption(element));
        if (regularOptions.length) candidates = regularOptions;
      }

      const choice = options.useDesiredPercentages
        ? desiredRadioChoice(group, candidates, run) || randomItem(candidates)
        : randomItem(candidates);
      if (!choice) continue;
      clickControl(choice);
      filled += 1;
    }

    return filled;
  }

  function fillCheckboxGroups(options) {
    let filled = 0;
    const questionRoots = [...document.querySelectorAll('[role="listitem"]')].filter(isVisible);

    for (const root of questionRoots) {
      const controls = [...root.querySelectorAll('[role="checkbox"]')].filter(
        (element) => isVisible(element) && isEnabled(element)
      );
      if (!controls.length) continue;

      const alreadyChecked = controls.some(
        (element) => element.getAttribute("aria-checked") === "true"
      );
      if (options.preserveAnswered && alreadyChecked) continue;

      let candidates = controls;
      if (options.avoidOther) {
        const regularOptions = candidates.filter((element) => !isOtherOption(element));
        if (regularOptions.length) candidates = regularOptions;
      }

      const choice = randomItem(candidates);
      if (!choice) continue;
      clickControl(choice);
      filled += 1;
    }

    return filled;
  }

  async function fillDropdowns(options) {
    let filled = 0;
    const listboxes = [...document.querySelectorAll('[role="listbox"]')].filter(
      (element) => isVisible(element) && isEnabled(element)
    );

    for (const listbox of listboxes) {
      const currentText = normalizedText(listbox.innerText || listbox.textContent);
      const looksEmpty = !currentText || PLACEHOLDER_PATTERN.test(currentText);
      if (options.preserveAnswered && !looksEmpty) continue;

      clickControl(listbox);
      await sleep(90);

      let choices = [...document.querySelectorAll('[role="option"]')].filter(
        (element) =>
          isVisible(element) &&
          isEnabled(element) &&
          !PLACEHOLDER_PATTERN.test(normalizedText(controlLabel(element)))
      );
      if (options.avoidOther) {
        const regularOptions = choices.filter((element) => !isOtherOption(element));
        if (regularOptions.length) choices = regularOptions;
      }

      const choice = randomItem(choices);
      if (choice) {
        clickControl(choice);
        filled += 1;
      } else {
        document.body.click();
      }
    }

    return filled;
  }

  function randomTextValue(field) {
    const type = normalizedText(field.getAttribute("type"));
    if (type === "number") return String(randomIndex(100) + 1);
    if (type === "email") return `random${randomIndex(9000) + 1000}@example.com`;
    if (type === "url") return "https://example.com";
    if (type === "date") return `199${randomIndex(10)}-0${randomIndex(9) + 1}-${String(randomIndex(28) + 1).padStart(2, "0")}`;
    if (type === "time") return `${String(randomIndex(24)).padStart(2, "0")}:${String(randomIndex(60)).padStart(2, "0")}`;
    return randomItem(TEXT_VALUES);
  }

  function fillTextFields(options) {
    if (!options.fillText) return 0;
    let filled = 0;
    const fields = [...document.querySelectorAll(
      'textarea, input[type="text"], input[type="email"], input[type="number"], input[type="url"], input[type="date"], input[type="time"]'
    )].filter((field) => isVisible(field) && isEnabled(field));

    for (const field of fields) {
      if (OTHER_PATTERN.test(normalizedText(field.getAttribute("aria-label")))) continue;
      const question = field.closest('[role="listitem"]');
      if (question?.querySelector('[role="radio"], [role="checkbox"]')) continue;
      if (options.preserveAnswered && field.value.trim()) continue;

      const value = randomTextValue(field);
      const prototype = field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      filled += 1;
    }

    return filled;
  }

  async function fillCurrentPage(rawOptions = {}, run = null) {
    const options = { ...DEFAULT_OPTIONS, ...rawOptions };
    await loadDesiredDistributions(options.useDesiredPercentages);
    const radioCount = fillRadioGroups(options, run);
    const checkboxCount = fillCheckboxGroups(options);
    const dropdownCount = await fillDropdowns(options);
    const textCount = fillTextFields(options);
    return radioCount + checkboxCount + dropdownCount + textCount;
  }

  function findActionButton(labels) {
    return [...document.querySelectorAll('button, [role="button"]')].find((button) => {
      if (!isVisible(button) || !isEnabled(button)) return false;
      const label = normalizedText(
        button.innerText || button.textContent || button.getAttribute("aria-label")
      );
      return labels.has(label);
    });
  }

  function getPageSignature() {
    const pageHistory = document.querySelector('input[name="pageHistory"]')?.value || "";
    const visibleQuestions = [...document.querySelectorAll('[role="listitem"]')]
      .filter(isVisible)
      .map((item) => normalizedText(item.innerText).slice(0, 160))
      .join("|");
    return `${location.href}::${pageHistory}::${visibleQuestions}`;
  }

  async function readActiveRun() {
    const run = (await chrome.storage.local.get(ACTIVE_RUN_KEY))[ACTIVE_RUN_KEY];
    if (!run?.runId || Date.now() - run.startedAt > MAX_RUN_AGE_MS) {
      await clearActiveRun();
      return null;
    }

    const localToken = sessionStorage.getItem(LOCAL_RUN_TOKEN_KEY);
    if (localToken && localToken !== run.runId) return null;
    if (!localToken) sessionStorage.setItem(LOCAL_RUN_TOKEN_KEY, run.runId);
    return run;
  }

  async function saveActiveRun(run) {
    sessionStorage.setItem(LOCAL_RUN_TOKEN_KEY, run.runId);
    const nextRun = { ...run, updatedAt: Date.now() };
    await chrome.storage.local.set({ [ACTIVE_RUN_KEY]: nextRun });
    return nextRun;
  }

  async function clearActiveRun() {
    sessionStorage.removeItem(LOCAL_RUN_TOKEN_KEY);
    await chrome.storage.local.remove(ACTIVE_RUN_KEY);
  }

  async function finishActiveRun(run, phase, statusMessage, completedRuns) {
    await chrome.storage.local.set({
      [LAST_RUN_KEY]: {
        ...run,
        phase,
        statusMessage,
        completedRuns,
        updatedAt: Date.now(),
        endedAt: Date.now()
      }
    });
    await clearActiveRun();
  }

  async function notifyAfterPageChange(previousSignature) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(250);
      if (getPageSignature() !== previousSignature) {
        await sleep(450);
        void resumeActiveRun();
        return;
      }
    }
  }

  async function resumeActiveRun({ force = false } = {}) {
    if (autoFillStepRunning) return;
    const run = await readActiveRun();
    if (!run || autoFillStepRunning) return;
    const currentSignature = getPageSignature();
    if (!force && currentSignature === lastAutoPageSignature) return;
    lastAutoPageSignature = currentSignature;
    void executeActiveRunStep(run);
  }

  async function executeActiveRunStep(run) {
    if (autoFillStepRunning) return;
    autoFillStepRunning = true;

    try {
      run = await saveActiveRun(
        run.awaitingConfirmation
          ? {
              ...run,
              phase: "submitting",
              statusMessage: `Form ${(run.completedRuns || 0) + 1}/${run.totalRuns || 1}: đang xác nhận phản hồi đã được gửi…`
            }
          : {
              ...run,
              phase: "filling",
              statusMessage: `Đang điền form ${(run.completedRuns || 0) + 1}/${run.totalRuns || 1}…`
            }
      );
      await sleep(250);
      const count = await fillCurrentPage(run.options, run);
      const nextButton = findActionButton(NEXT_LABELS);
      const submitButton = findActionButton(SUBMIT_LABELS);

      if (nextButton) {
        await saveActiveRun({
          ...run,
          phase: "next-page",
          statusMessage: `Form ${(run.completedRuns || 0) + 1}/${run.totalRuns || 1}: đã điền ${count} câu, đang chuyển trang…`
        });
        const previousSignature = getPageSignature();
        showToast(`Đã điền ${count} câu. Đang chuyển sang trang tiếp theo…`);
        await sleep(350);
        nextButton.click();
        void notifyAfterPageChange(previousSignature);
        return;
      }

      if (submitButton) {
        if (run.awaitingConfirmation) {
          await finishActiveRun(
            run,
            "error",
            `Không thể xác nhận đã gửi sau ${run.completedRuns || 0}/${run.totalRuns || 1} form.`,
            run.completedRuns || 0
          );
          showToast(
            "Không thể xác nhận đã gửi. Biểu mẫu vẫn đang ở trang cuối.",
            "warning"
          );
          return;
        }

        if (run.autoSubmit) {
          run = await saveActiveRun({
            ...run,
            awaitingConfirmation: true,
            phase: "submitting",
            statusMessage: `Form ${(run.completedRuns || 0) + 1}/${run.totalRuns || 1}: đang gửi phản hồi…`
          });
          const previousSignature = getPageSignature();
          showToast("Đã điền xong. Đang gửi biểu mẫu…", "success");
          await sleep(350);
          submitButton.click();
          void notifyAfterPageChange(previousSignature);
          return;
        }

        await finishActiveRun(
          run,
          "stopped",
          `Đã điền xong ${run.completedRuns || 0}/${run.totalRuns || 1} form và dừng trước nút Gửi.`,
          run.completedRuns || 0
        );
        showToast("Đã điền xong và dừng trước nút Gửi.", "success");
        return;
      }

      if (run.awaitingConfirmation) {
        const completedNow = (run.completedRuns || 0) + 1;
        const totalRuns = Math.max(1, run.totalRuns || 1);

        if (completedNow < totalRuns) {
          await saveActiveRun({
            ...run,
            completedRuns: completedNow,
            awaitingConfirmation: false,
            phase: "next-form",
            statusMessage: `Đã gửi ${completedNow}/${totalRuns} form. Đang mở lượt tiếp theo…`
          });
          showToast(
            `Đã gửi ${completedNow}/${totalRuns} form. Đang bắt đầu lượt tiếp theo…`,
            "success"
          );
          await sleep(700);
          const formStartUrl = getFormStartUrl();
          if (formStartUrl) location.assign(formStartUrl);
          return;
        }

        await finishActiveRun(
          run,
          "completed",
          `Hoàn tất: đã gửi ${completedNow}/${totalRuns} form.`,
          completedNow
        );
        showToast(`Đã gửi thành công ${completedNow}/${totalRuns} form.`, "success");
        return;
      }

      await finishActiveRun(
        run,
        "error",
        `Không tìm thấy nút Tiếp hoặc Gửi sau ${run.completedRuns || 0}/${run.totalRuns || 1} form.`,
        run.completedRuns || 0
      );
      showToast("Không tìm thấy nút Tiếp hoặc Gửi.", "warning");
    } catch (error) {
      console.error("Random Form Filler local run:", error);
      showToast("Chế độ tự động gặp lỗi và đã dừng.", "warning");
      await finishActiveRun(
        run,
        "error",
        `Quá trình dừng do lỗi sau ${run.completedRuns || 0}/${run.totalRuns || 1} form.`,
        run.completedRuns || 0
      );
    } finally {
      autoFillStepRunning = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "START_LOCAL_AUTO_RUN") {
      if (message.runId) {
        sessionStorage.setItem(LOCAL_RUN_TOKEN_KEY, message.runId);
      }
      lastAutoPageSignature = null;
      void resumeActiveRun({ force: true });
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "AUTO_RUN_STOPPED") {
      sessionStorage.removeItem(LOCAL_RUN_TOKEN_KEY);
      lastAutoPageSignature = null;
      showToast("Đã dừng chế độ tự động.", "warning");
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  const pageObserver = new MutationObserver(() => {
    if (!document.querySelector("#random-form-filler-progress")) {
      installProgressPanel();
      void refreshPageProgress();
    }

    clearTimeout(mutationResumeTimer);
    mutationResumeTimer = window.setTimeout(() => {
      void resumeActiveRun();
    }, 400);
  });
  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  sessionStorage.removeItem(LEGACY_AUTO_KEY);
  void chrome.storage.local.remove(LEGACY_AUTO_KEY);
  installProgressPanel();
  void refreshPageProgress();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[ACTIVE_RUN_KEY] || changes[LAST_RUN_KEY]) {
      void refreshPageProgress();
    }
  });
  for (const delay of [300, 1200, 3000]) {
    window.setTimeout(() => {
      void resumeActiveRun();
    }, delay);
  }
})();
