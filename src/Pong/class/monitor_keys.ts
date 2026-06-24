import type { Instance } from "./types";

export function liveInstanceKey(inst: Instance | null | undefined): string {
  if (!inst) return "";
  return `${inst.id}:${inst.kind}:${inst.baseUrl}:${inst.auth?.mode || "none"}`;
}
