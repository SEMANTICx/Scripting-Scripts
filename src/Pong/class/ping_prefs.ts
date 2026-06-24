// ============================================================================
// Local ping chart preferences. Stored per script, keyed by backend+task id.
// ============================================================================
import { Script } from "scripting";
import type { Instance } from "./types";

const KEY = `${Script.name}.ping.colors`;

export const PING_COLOR_PRESETS = [
  "#4b9cff",
  "#35c759",
  "#ff9f0a",
  "#ff453a",
  "#bf5af2",
  "#64d2ff",
  "#ff375f",
  "#ffd60a",
];

type Store = Record<string, string>;

function colorKey(inst: Instance, taskId: number): string {
  return `${inst.kind}:${inst.baseUrl}:${taskId}`;
}

export function loadPingColorOverrides(inst: Instance): Record<number, string> {
  const raw = Storage.get<Store>(KEY) || {};
  const prefix = `${inst.kind}:${inst.baseUrl}:`;
  const out: Record<number, string> = {};
  for (const key of Object.keys(raw)) {
    if (!key.startsWith(prefix)) continue;
    const id = Number(key.slice(prefix.length));
    if (isFinite(id)) out[id] = raw[key];
  }
  return out;
}

export function setPingColorOverride(inst: Instance, taskId: number, color: string | null): void {
  const raw = Storage.get<Store>(KEY) || {};
  const key = colorKey(inst, taskId);
  if (color) raw[key] = color;
  else delete raw[key];
  Storage.set(KEY, raw);
}
