import test from "node:test";
import assert from "node:assert/strict";
import { buildLoadMarks } from "../src/Pong/class/loadchart.ts";

test("load marks derive RAM percentage from Komari byte fields", () => {
  const marks = buildLoadMarks("ram", [
    { time: "2026-06-25T00:00:00Z", ram: 256, ram_total: 1024 },
  ]);

  assert.equal(marks.length, 1);
  assert.equal(marks[0].category, "内存");
  assert.equal(marks[0].value, 25);
});

test("load marks derive disk percentage from Komari byte fields", () => {
  const marks = buildLoadMarks("disk", [
    { time: "2026-06-25T00:00:00Z", disk: 80, disk_total: 100 },
  ]);

  assert.equal(marks.length, 1);
  assert.equal(marks[0].category, "磁盘");
  assert.equal(marks[0].value, 80);
});

test("explicit backend percentages still take precedence", () => {
  const marks = buildLoadMarks("ram", [
    { time: "2026-06-25T00:00:00Z", ram: 256, ram_total: 1024, ram_percent: 33 },
  ]);

  assert.equal(marks[0].value, 33);
});

test("load marks keep aggregate connection history when tcp and udp split is absent", () => {
  const marks = buildLoadMarks("connections", [
    { time: "2026-06-25T00:00:00Z", connections: 42 },
  ]);

  assert.equal(marks.length, 1);
  assert.equal(marks[0].category, "连接");
  assert.equal(marks[0].value, 42);
});
