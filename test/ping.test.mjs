import test from "node:test";
import assert from "node:assert/strict";

const {
  areAllPingLinesHidden,
  applyPingColorOverrides,
  buildPingLossSegments,
  buildPingMarks,
  buildPingSummaries,
  buildPingColorScale,
  taskColor,
} = await import("../src/Pong/class/ping.ts");

test("areAllPingLinesHidden ignores stale hidden ids from previous ping data", () => {
  const current = [{ taskId: 3 }, { taskId: 4 }];

  assert.equal(areAllPingLinesHidden(current, [1, 2]), false);
  assert.equal(areAllPingLinesHidden(current, [1, 2, 3]), false);
  assert.equal(areAllPingLinesHidden(current, [1, 2, 3, 4]), true);
});

test("areAllPingLinesHidden is false for empty summaries", () => {
  assert.equal(areAllPingLinesHidden([], [1, 2, 3]), false);
});

test("task colors are unique within the current visible task set", () => {
  const ids = Array.from({ length: 16 }, (_, i) => i);
  const colors = ids.map((id) => taskColor(id, ids));

  assert.equal(new Set(colors).size, colors.length);
  assert.ok(colors.every((c) => /^#[0-9a-f]{6}$/.test(c)));
});

test("ping marks skip loss samples but summaries count them", () => {
  const data = {
    count: 4,
    tasks: [{ id: 1, name: "Tokyo", clients: [] }],
    records: [
      { task_id: 1, time: "2026-06-24T00:00:00.000Z", value: 10 },
      { task_id: 1, time: "2026-06-24T00:01:00.000Z", value: -1 },
      { task_id: 1, time: "2026-06-24T00:02:00.000Z", value: 30 },
      { task_id: 1, time: "not-a-date", value: 50 },
    ],
  };

  const marks = buildPingMarks(data);
  assert.equal(marks.length, 2);
  assert.deepEqual(
    marks.map((m) => m.value),
    [10, 30],
  );

  const [summary] = buildPingSummaries(data);
  assert.equal(summary.name, "Tokyo");
  assert.equal(summary.loss, 0.25);
  assert.equal(summary.min, 10);
  assert.equal(summary.max, 50);
  assert.ok(Math.abs(summary.p95 - 48) < 0.000001);
  assert.equal(summary.last, 50);
});

test("ping color scale matches stable task colors", () => {
  const summaries = [
    {
      taskId: 8,
      name: "A",
      loss: 0,
      min: 1,
      max: 1,
      avg: 1,
      p50: 1,
      p95: 1,
      p99: 1,
      last: 1,
      color: taskColor(8, [8, 9]),
    },
    {
      taskId: 9,
      name: "B",
      loss: 0,
      min: 1,
      max: 1,
      avg: 1,
      p50: 1,
      p95: 1,
      p99: 1,
      last: 1,
      color: taskColor(9, [8, 9]),
    },
  ];

  assert.deepEqual(buildPingColorScale(summaries), {
    A: { color: taskColor(8, [8, 9]) },
    B: { color: taskColor(9, [8, 9]) },
  });
});

test("ping loss segments and color overrides are stable pure transforms", () => {
  const data = {
    count: 2,
    tasks: [{ id: 1, name: "Line A", clients: [] }],
    records: [
      { task_id: 1, time: "2026-06-24T00:00:00.000Z", value: -1 },
      { task_id: 1, time: "2026-06-24T00:01:00.000Z", value: 20 },
    ],
  };

  const losses = buildPingLossSegments(data, { 1: "#abcdef" });
  assert.equal(losses.length, 1);
  assert.equal(losses[0].taskName, "Line A");
  assert.equal(losses[0].color, "#abcdef");

  assert.deepEqual(
    applyPingColorOverrides([{ taskId: 1, color: "#000000" }], { 1: "#ffffff" }),
    [{ taskId: 1, color: "#ffffff" }],
  );
});
