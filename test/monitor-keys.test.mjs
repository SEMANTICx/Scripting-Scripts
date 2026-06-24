import test from "node:test";
import assert from "node:assert/strict";
import { liveInstanceKey } from "../src/Pong/class/monitor_keys.ts";

const base = {
  id: "same-id",
  name: "Panel",
  kind: "komari",
  baseUrl: "https://old.example.com",
};

test("live instance key changes when same saved instance points to a new endpoint", () => {
  assert.notEqual(
    liveInstanceKey(base),
    liveInstanceKey({ ...base, baseUrl: "https://new.example.com" }),
  );
});

test("live instance key changes when transport-relevant auth mode changes", () => {
  assert.notEqual(
    liveInstanceKey({ ...base, auth: undefined }),
    liveInstanceKey({ ...base, auth: { mode: "token", apiKey: "secret" } }),
  );
});

test("live instance key does not expose credential material", () => {
  assert.equal(
    liveInstanceKey({ ...base, auth: { mode: "token", apiKey: "secret-a" } }),
    liveInstanceKey({ ...base, auth: { mode: "token", apiKey: "secret-b" } }),
  );
});
