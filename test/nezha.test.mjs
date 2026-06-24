import test from "node:test";
import assert from "node:assert/strict";

const {
  hoursToPeriod,
  isServerOnline,
  serviceHistoriesToPingData,
  serviceInfosToPingData,
} = await import("../src/Pong/class/nezha_transforms.ts");

test("hoursToPeriod maps UI windows to documented Nezha periods", () => {
  assert.equal(hoursToPeriod(6), "1d");
  assert.equal(hoursToPeriod(24), "1d");
  assert.equal(hoursToPeriod(25), "7d");
  assert.equal(hoursToPeriod(24 * 7), "7d");
  assert.equal(hoursToPeriod(24 * 7 + 1), "30d");
});

test("isServerOnline tolerates normal Nezha refresh jitter", () => {
  const now = Date.parse("2026-06-25T12:00:30.000Z");

  assert.equal(
    isServerOnline({ id: 1, last_active: "2026-06-25T12:00:00.000Z" }, now),
    true,
  );
  assert.equal(
    isServerOnline({ id: 1, last_active: "2026-06-25T11:59:59.000Z" }, now),
    false,
  );
  assert.equal(
    isServerOnline({ id: 1, last_active: "2026-06-25T12:00:31.000Z" }, now),
    true,
  );
});

test("serviceHistoriesToPingData adapts documented service history for one server", () => {
  const data = serviceHistoriesToPingData(
    [
      {
        service_id: 10,
        service_name: "HTTPS",
        servers: [
          {
            server_id: 1,
            stats: {
              data_points: [
                { ts: 1760000030000, delay: 72.5, status: 1 },
                { ts: 1760000000000, delay: 0, status: 0 },
              ],
            },
          },
          {
            server_id: 2,
            stats: {
              data_points: [{ ts: 1760000030000, delay: 33, status: 1 }],
            },
          },
        ],
      },
      {
        service_id: 11,
        service_name: "ICMP",
        servers: [
          {
            server_id: 1,
            stats: {
              data_points: [{ ts: 1760000060000, delay: 18, status: 1 }],
            },
          },
        ],
      },
    ],
    "1",
  );

  assert.deepEqual(data.tasks, [
    { id: 10, name: "HTTPS", clients: [] },
    { id: 11, name: "ICMP", clients: [] },
  ]);
  assert.deepEqual(
    data.records.map((r) => [r.task_id, r.value]),
    [
      [10, -1],
      [10, 72.5],
      [11, 18],
    ],
  );
  assert.equal(data.count, 3);
});

test("serviceInfosToPingData keeps compatibility with legacy service arrays", () => {
  const data = serviceInfosToPingData([
    {
      monitor_id: 7,
      monitor_name: "Legacy Ping",
      created_at: [1760000000000, 1760000030000],
      avg_delay: [12, 0],
    },
  ]);

  assert.deepEqual(data.tasks, [{ id: 7, name: "Legacy Ping", clients: [] }]);
  assert.deepEqual(
    data.records.map((r) => r.value),
    [12, -1],
  );
});
