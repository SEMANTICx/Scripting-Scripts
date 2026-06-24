import type { BackendKind, Instance } from "./types";

export function normalizeBackendKind(kind: unknown): BackendKind {
  return kind === "nezha" ? "nezha" : "komari";
}

export function normalizeInstance(input: Instance | any): Instance {
  return {
    ...input,
    kind: normalizeBackendKind(input?.kind),
  };
}
