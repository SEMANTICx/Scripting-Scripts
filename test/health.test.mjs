import test from "node:test";
import assert from "node:assert/strict";

const {
  healthTint,
  nodeHealthScore,
  nodeHealthReasons,
  nodeHealthSummary,
  nodeLoadRatio,
} = await import("../src/Pong/class/health.ts");

function record(cpu, memUsed = 1, memTotal = 10) {
  return {
    cpu: { usage: cpu },
    ram: { used: memUsed, total: memTotal },
    swap: { used: 0, total: 0 },
    load: { load1: 0, load5: 0, load15: 0 },
    disk: { used: 0, total: 0 },
    network: { up: 0, down: 0, totalUp: 0, totalDown: 0 },
    connections: { tcp: 0, udp: 0 },
    uptime: 1,
    process: 1,
    message: "",
    updated_at: "2026-06-25T12:00:00.000Z",
  };
}

test("nodeLoadRatio uses the heavier CPU or memory ratio", () => {
  assert.equal(nodeLoadRatio(record(10, 8, 10)), 0.8);
  assert.equal(nodeLoadRatio(record(75, 1, 10)), 0.75);
  assert.equal(nodeLoadRatio(), -1);
});

test("nodeHealthReasons explains meaningful score penalties", () => {
  const reasons = nodeHealthReasons({ online: true, rec: record(95, 9, 10), latencyMs: 600, loss: 0.2 });
  assert.deepEqual(
    reasons.map((r) => r.label),
    ["CPU", "内存", "延迟", "丢包"],
  );
  assert.deepEqual(nodeHealthReasons({ online: true, rec: record(10) }), []);
});

test("nodeHealthSummary stays quiet for normal nodes and flags only notable states", () => {
  assert.deepEqual(nodeHealthSummary(false, record(5)), {
    level: "offline",
    tint: "systemGray",
    label: "离线",
    icon: "moon.zzz.fill",
    score: 30,
  });
  assert.deepEqual(nodeHealthSummary(true), {
    level: "syncing",
    tint: "systemBlue",
    label: "同步中",
    icon: "arrow.triangle.2.circlepath",
    score: 60,
  });
  assert.equal(nodeHealthSummary(true, record(20)).level, "normal");
  assert.equal(nodeHealthSummary(true, record(75)).level, "elevated");
  assert.equal(nodeHealthSummary(true, record(95)).level, "busy");
  assert.equal(healthTint(true, record(95)), "systemRed");
});

test("nodeHealthScore combines live load, latency and loss into a bounded score", () => {
  assert.equal(nodeHealthScore({ online: true, rec: record(10), latencyMs: 30, loss: 0 }), 100);
  assert.ok(nodeHealthScore({ online: true, rec: record(95), latencyMs: 600, loss: 0.25 }) < 50);
  assert.equal(nodeHealthScore({ online: false, offlineMinutes: 0 }), 30);
  assert.equal(nodeHealthScore({ online: false, offlineMinutes: 120 }), 10);
  assert.equal(nodeHealthScore({ online: true }), 60);
});
