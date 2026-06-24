import test from "node:test";
import assert from "node:assert/strict";

const {
  DEFAULT_ALERT_PREFS,
  canSendAlert,
  liveAlertEvents,
  pingAlertEvents,
} = await import("../src/Pong/class/alert_rules.ts");

const node = { uuid: "n1", name: "Tokyo" };
const rec = {
  cpu: { usage: 1 },
  ram: { used: 1, total: 10 },
  swap: { used: 0, total: 0 },
  load: { load1: 0, load5: 0, load15: 0 },
  disk: { used: 95, total: 100 },
  network: { up: 60 * 1024 * 1024, down: 0, totalUp: 0, totalDown: 0 },
  connections: { tcp: 0, udp: 0 },
  uptime: 1,
  process: 1,
  message: "",
  updated_at: "",
};

test("local alert rules detect live and ping anomalies with cooldowns", () => {
  const live = liveAlertEvents(node, true, rec, DEFAULT_ALERT_PREFS);
  assert.deepEqual(live.map((e) => e.kind), ["disk", "traffic"]);

  const offline = liveAlertEvents(node, false, undefined, DEFAULT_ALERT_PREFS, 6);
  assert.deepEqual(offline.map((e) => e.kind), ["offline"]);

  const ping = pingAlertEvents(node, [
    { taskId: 1, name: "Line", loss: 0.2, min: 1, max: 500, avg: 300, p50: 10, p95: 300, p99: 500, last: 300, color: "#fff" },
  ], DEFAULT_ALERT_PREFS);
  assert.deepEqual(ping.map((e) => e.kind), ["ping-loss", "ping-latency"]);

  assert.equal(canSendAlert(undefined, 1000, DEFAULT_ALERT_PREFS), true);
  assert.equal(canSendAlert(1000, 2000, DEFAULT_ALERT_PREFS), false);
});
