import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  enrichLiveData,
  normalizeKomariNodes,
  normalizeKomariPingData,
} = await import("../src/Pong/class/komari_transforms.ts");
const {
  buildLiveData,
  serviceHistoriesToPingData,
} = await import("../src/Pong/class/nezha_transforms.ts");

async function fixture(name) {
  const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  return JSON.parse(text);
}

test("Komari fixtures normalize nodes, GPU and ping data", async () => {
  const nodes = normalizeKomariNodes(await fixture("komari-nodes.json"));
  assert.deepEqual(nodes.map((n) => [n.uuid, n.id]), [
    ["node-a", 0],
    ["node-b", 0],
  ]);

  const live = enrichLiveData(await fixture("komari-live.json"));
  assert.equal(live.data["node-a"].gpu, 41);
  assert.equal(live.data["node-a"].temp, 66);
  assert.deepEqual(
    live.data["node-a"].gpus?.map((g) => [g.name, g.usage, g.temp]),
    [
      ["RTX 4060", 40, 61],
      ["RTX 4060 Ti", 42, 66],
    ],
  );

  const ping = normalizeKomariPingData(await fixture("komari-ping.json"));
  assert.equal(ping.count, 3);
  assert.equal(ping.tasks?.[0]?.name, "江苏移动");
  assert.deepEqual(
    ping.records.map((r) => r.value),
    [24, -1, 31],
  );
});

test("Nezha fixtures normalize live data and service history", async () => {
  const servers = await fixture("nezha-server.json");
  const live = buildLiveData(servers, Date.parse("2026-06-25T12:00:30.000Z"));
  assert.deepEqual(live.online, ["1"]);
  assert.equal(live.data["1"].cpu.usage, 23);
  assert.equal(live.data["1"].gpu, 17);
  assert.equal(live.data["1"].temp, 52);

  const ping = serviceHistoriesToPingData(await fixture("nezha-service-history.json"), 1);
  assert.deepEqual(ping.tasks, [{ id: 10, name: "江苏移动", clients: [] }]);
  assert.deepEqual(
    ping.records.map((r) => r.value),
    [27, -1],
  );
});
