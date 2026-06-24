import test from "node:test";
import assert from "node:assert/strict";

const {
  normalizeBackendKind,
  normalizeInstance,
} = await import("../src/Pong/class/config_normalize.ts");

test("normalizeBackendKind accepts only supported backend ids", () => {
  assert.equal(normalizeBackendKind("komari"), "komari");
  assert.equal(normalizeBackendKind("nezha"), "nezha");
  assert.equal(normalizeBackendKind(""), "komari");
  assert.equal(normalizeBackendKind("unknown"), "komari");
  assert.equal(normalizeBackendKind(undefined), "komari");
});

test("normalizeInstance keeps data and repairs invalid backend kind", () => {
  const inst = normalizeInstance({
    id: "1",
    name: "demo",
    kind: "bad",
    baseUrl: "https://example.com",
  });

  assert.equal(inst.kind, "komari");
  assert.equal(inst.name, "demo");
  assert.equal(inst.baseUrl, "https://example.com");
});
