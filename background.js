"use strict";

const FORM_ID = "1FAIpQLSdClsnVFzQEXCzTirtOhNlLQegqI2xyd6a58Tmx122usZgN6A";
const FORM_URL_PATTERN = new RegExp(
  `^https://docs\\.google\\.com/forms(?:/u/\\d+)?/d/e/${FORM_ID}/`
);
const ACTIVE_RUN_KEY = "randomFormFillerActiveRun";
const LAST_RUN_KEY = "randomFormFillerLastRun";

function isTargetFormUrl(url) {
  return typeof url === "string" && FORM_URL_PATTERN.test(url);
}

async function sendToContent(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["desired-distributions.js", "distribution-utils.js", "content.js"]
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_TAB_ID") {
    sendResponse({ ok: true, tabId: sender.tab?.id ?? null });
    return false;
  }

  if (message?.type === "START_AUTO_RUN") {
    const tabId = Number(message.tabId);
    const requestedRuns = Number.parseInt(message.totalRuns, 10);
    const totalRuns = Number.isFinite(requestedRuns)
      ? Math.min(50, Math.max(1, requestedRuns))
      : 1;

    chrome.tabs.get(tabId)
      .then(async (tab) => {
        if (!isTargetFormUrl(tab.url)) {
          throw new Error("Tab hiện tại không phải Google Form đã cấu hình.");
        }

        const runId = crypto.randomUUID();
        const options = message.options || {};
        const modeText = options.useDesiredPercentages
          ? "theo tỷ lệ phần trăm mong muốn"
          : "ngẫu nhiên";
        await chrome.storage.local.remove(LAST_RUN_KEY);
        await chrome.storage.local.set({
          [ACTIVE_RUN_KEY]: {
            runId,
            tabId,
            options,
            startedAt: Date.now(),
            autoSubmit: Boolean(message.autoSubmit),
            awaitingConfirmation: false,
            totalRuns,
            completedRuns: 0,
            phase: "starting",
            statusMessage: `Đang khởi động chế độ ${modeText} cho ${totalRuns} form…`,
            updatedAt: Date.now()
          }
        });

        await sendToContent(tabId, { type: "START_LOCAL_AUTO_RUN", runId });
        sendResponse({
          ok: true,
          message: message.autoSubmit
            ? `Đang tự động điền và gửi ${totalRuns} form.`
            : "Đang điền các trang; extension sẽ dừng trước nút Gửi."
        });
      })
      .catch(async (error) => {
        const { [ACTIVE_RUN_KEY]: run } = await chrome.storage.local.get(ACTIVE_RUN_KEY);
        if (run?.tabId === tabId) {
          await chrome.storage.local.set({
            [LAST_RUN_KEY]: {
              ...run,
              phase: "error",
              statusMessage: `Không thể bắt đầu: ${error.message}`,
              updatedAt: Date.now(),
              endedAt: Date.now()
            }
          });
          await chrome.storage.local.remove(ACTIVE_RUN_KEY);
        }
        sendResponse({ ok: false, message: error.message });
      });
    return true;
  }

  if (message?.type === "STOP_AUTO_RUN") {
    const tabId = Number(message.tabId);
    chrome.storage.local.get(ACTIVE_RUN_KEY)
      .then(async ({ [ACTIVE_RUN_KEY]: run }) => {
        if (run) {
          await chrome.storage.local.set({
            [LAST_RUN_KEY]: {
              ...run,
              phase: "stopped",
              statusMessage: `Đã dừng tại ${run.completedRuns || 0}/${run.totalRuns || 1} form.`,
              updatedAt: Date.now(),
              endedAt: Date.now()
            }
          });
        }
        await chrome.storage.local.remove(ACTIVE_RUN_KEY);
        try {
          await chrome.tabs.sendMessage(tabId, { type: "AUTO_RUN_STOPPED" });
        } catch {
          // Removing the persisted run is sufficient while the tab navigates.
        }
        sendResponse({ ok: true, message: "Đã dừng chế độ tự động." });
      })
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.local.get(ACTIVE_RUN_KEY).then(({ [ACTIVE_RUN_KEY]: run }) => {
    if (run?.tabId === tabId) {
      return chrome.storage.local
        .set({
          [LAST_RUN_KEY]: {
            ...run,
            phase: "stopped",
            statusMessage: `Đã dừng vì tab Google Form đã đóng tại ${run.completedRuns || 0}/${run.totalRuns || 1} form.`,
            updatedAt: Date.now(),
            endedAt: Date.now()
          }
        })
        .then(() => chrome.storage.local.remove(ACTIVE_RUN_KEY));
    }
    return undefined;
  });
});
