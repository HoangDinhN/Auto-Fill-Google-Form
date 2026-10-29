const DEFAULT_OPTIONS = {
  preserveAnswered: true,
  avoidOther: true,
  fillText: false,
  useDesiredPercentages: false
};

const ACTIVE_RUN_KEY = "randomFormFillerActiveRun";
const LAST_RUN_KEY = "randomFormFillerLastRun";
const optionIds = Object.keys(DEFAULT_OPTIONS);
const statusElement = document.querySelector("#status");
const runCountElement = document.querySelector("#runCount");
const startButton = document.querySelector("#fillMultipleAndSubmit");
const stopButton = document.querySelector("#stop");
let activeRun = null;

document.querySelector("#version").textContent =
  `Phiên bản ${chrome.runtime.getManifest().version}`;

function getRunCount() {
  const parsed = Number.parseInt(runCountElement.value, 10);
  const normalized = Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 1;
  runCountElement.value = String(normalized);
  return normalized;
}

function updateBatchButton() {
  const count = getRunCount();
  startButton.textContent = `Điền và gửi ${count} form`;
}

function setStatus(message, kind = "info") {
  statusElement.textContent = message;
  statusElement.dataset.kind = kind;
}

function getOptions() {
  return Object.fromEntries(
    optionIds.map((id) => [id, document.querySelector(`#${id}`).checked])
  );
}

async function saveOptions() {
  await chrome.storage.local.set({ randomFormOptions: getOptions() });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setRunControls(isRunning) {
  startButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  runCountElement.disabled = isRunning;
  document.querySelector("#decreaseCount").disabled = isRunning;
  document.querySelector("#increaseCount").disabled = isRunning;
  optionIds.forEach((id) => {
    document.querySelector(`#${id}`).disabled = isRunning;
  });
}

function defaultStatusFor(run) {
  if (!run) return "Tiến trình sẽ hiển thị ở góc trên bên trái trang Google Form.";
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

function renderStatus(run) {
  setStatus(
    defaultStatusFor(run),
    run?.phase === "error" ? "error" : run?.phase === "completed" ? "success" : "info"
  );
}

async function refreshRunState() {
  const stored = await chrome.storage.local.get([ACTIVE_RUN_KEY, LAST_RUN_KEY]);
  activeRun = stored[ACTIVE_RUN_KEY] || null;
  setRunControls(Boolean(activeRun));
  renderStatus(activeRun || stored[LAST_RUN_KEY] || null);
}

async function startRun() {
  startButton.disabled = true;
  try {
    await saveOptions();
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("Không tìm thấy tab đang mở.");

    const totalRuns = getRunCount();
    const confirmed = window.confirm(
      `Extension sẽ điền ngẫu nhiên và gửi ${totalRuns} phản hồi tới Google Form. ` +
        "Chỉ tiếp tục nếu bạn được phép kiểm thử biểu mẫu này."
    );
    if (!confirmed) return;

    const response = await chrome.runtime.sendMessage({
      type: "START_AUTO_RUN",
      tabId: tab.id,
      options: getOptions(),
      autoSubmit: true,
      totalRuns
    });
    if (!response?.ok) throw new Error(response?.message || "Không thể bắt đầu.");
    await refreshRunState();
  } catch (error) {
    console.error("Random Form Filler:", error);
    setStatus(error.message || "Không thể kết nối với form.", "error");
  } finally {
    if (!activeRun) startButton.disabled = false;
  }
}

async function stopRun() {
  stopButton.disabled = true;
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("Không tìm thấy tab đang mở.");
    const response = await chrome.runtime.sendMessage({
      type: "STOP_AUTO_RUN",
      tabId: tab.id
    });
    if (!response?.ok) throw new Error(response?.message || "Không thể dừng.");
    await refreshRunState();
  } catch (error) {
    console.error("Random Form Filler:", error);
    setStatus(error.message || "Không thể dừng quá trình.", "error");
    stopButton.disabled = false;
  }
}

startButton.addEventListener("click", () => void startRun());
stopButton.addEventListener("click", () => void stopRun());
document.querySelector("#decreaseCount").addEventListener("click", () => {
  runCountElement.value = String(Math.max(1, getRunCount() - 1));
  updateBatchButton();
});
document.querySelector("#increaseCount").addEventListener("click", () => {
  runCountElement.value = String(Math.min(50, getRunCount() + 1));
  updateBatchButton();
});
runCountElement.addEventListener("input", updateBatchButton);
runCountElement.addEventListener("blur", updateBatchButton);

optionIds.forEach((id) => {
  document.querySelector(`#${id}`).addEventListener("change", saveOptions);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[ACTIVE_RUN_KEY] || changes[LAST_RUN_KEY]) void refreshRunState();
});

chrome.storage.local.get("randomFormOptions").then(({ randomFormOptions }) => {
  const options = { ...DEFAULT_OPTIONS, ...randomFormOptions };
  optionIds.forEach((id) => {
    document.querySelector(`#${id}`).checked = Boolean(options[id]);
  });
});

updateBatchButton();
void refreshRunState();
