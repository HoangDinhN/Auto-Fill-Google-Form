import assert from "node:assert/strict";

const listeners = { message: [], removed: [] };
const localStore = {};
const sentMessages = [];

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return { [key]: localStore[key] };
      },
      async set(values) {
        Object.assign(localStore, values);
      },
      async remove(key) {
        delete localStore[key];
      }
    }
  },
  scripting: {
    async insertCSS() {},
    async executeScript() {}
  },
  runtime: {
    onMessage: {
      addListener(listener) {
        listeners.message.push(listener);
      }
    }
  },
  tabs: {
    async get(tabId) {
      return {
        id: tabId,
        url: "https://docs.google.com/forms/u/0/d/e/1FAIpQLSdClsnVFzQEXCzTirtOhNlLQegqI2xyd6a58Tmx122usZgN6A/viewform"
      };
    },
    async sendMessage(tabId, message) {
      sentMessages.push({ tabId, message });
      return { ok: true };
    },
    onRemoved: {
      addListener(listener) {
        listeners.removed.push(listener);
      }
    }
  }
};

await import("../background.js");

function dispatchMessage(message, sender = {}) {
  return new Promise((resolve, reject) => {
    const handled = listeners.message.some((listener) =>
      listener(message, sender, resolve)
    );
    if (!handled) reject(new Error(`Unhandled message: ${message.type}`));
  });
}

const tabResult = await dispatchMessage({ type: "GET_TAB_ID" }, { tab: { id: 7 } });
assert.deepEqual(tabResult, { ok: true, tabId: 7 });

const startResult = await dispatchMessage({
  type: "START_AUTO_RUN",
  tabId: 7,
  options: { preserveAnswered: true, avoidOther: true, fillText: false },
  autoSubmit: true,
  totalRuns: 3
});
assert.equal(startResult.ok, true);
assert.equal(localStore.randomFormFillerActiveRun.tabId, 7);
assert.equal(localStore.randomFormFillerActiveRun.totalRuns, 3);
assert.equal(localStore.randomFormFillerActiveRun.completedRuns, 0);
assert.equal(localStore.randomFormFillerActiveRun.phase, "starting");
assert.ok(localStore.randomFormFillerActiveRun.runId);
assert.equal(sentMessages[0].message.type, "START_LOCAL_AUTO_RUN");
assert.equal(
  sentMessages[0].message.runId,
  localStore.randomFormFillerActiveRun.runId
);

const stopResult = await dispatchMessage({ type: "STOP_AUTO_RUN", tabId: 7 });
assert.equal(stopResult.ok, true);
assert.equal(localStore.randomFormFillerActiveRun, undefined);
assert.equal(localStore.randomFormFillerLastRun.phase, "stopped");
assert.equal(localStore.randomFormFillerLastRun.totalRuns, 3);
assert.equal(sentMessages[1].message.type, "AUTO_RUN_STOPPED");

await dispatchMessage({
  type: "START_AUTO_RUN",
  tabId: 9,
  options: {},
  autoSubmit: true,
  totalRuns: 2
});
assert.equal(localStore.randomFormFillerLastRun, undefined);
for (const listener of listeners.removed) listener(9);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(localStore.randomFormFillerActiveRun, undefined);
assert.equal(localStore.randomFormFillerLastRun.phase, "stopped");

console.log("background local-run persistence flow: OK");
