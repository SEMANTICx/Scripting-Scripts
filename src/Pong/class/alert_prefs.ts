// ============================================================================
// Local alert preferences. Device-local Storage only; no backend writes.
// ============================================================================
import { Script } from "scripting";
import { DEFAULT_ALERT_PREFS } from "./alert_rules";
import type { AlertPrefs } from "./alert_rules";

const KEY = `${Script.name}.localAlerts.prefs`;

function numberOr(value: unknown, fallback: number, min: number): number {
  const n = Number(value);
  return isFinite(n) && n >= min ? n : fallback;
}

export function normalizeAlertPrefs(raw: Partial<AlertPrefs> | null | undefined): AlertPrefs {
  return {
    enabled: raw?.enabled !== false,
    offlineMinutes: numberOr(raw?.offlineMinutes, DEFAULT_ALERT_PREFS.offlineMinutes, 1),
    lossPercent: numberOr(raw?.lossPercent, DEFAULT_ALERT_PREFS.lossPercent, 0),
    latencyMs: numberOr(raw?.latencyMs, DEFAULT_ALERT_PREFS.latencyMs, 1),
    diskPercent: Math.min(100, numberOr(raw?.diskPercent, DEFAULT_ALERT_PREFS.diskPercent, 1)),
    trafficMBps: numberOr(raw?.trafficMBps, DEFAULT_ALERT_PREFS.trafficMBps, 1),
    cooldownMinutes: numberOr(raw?.cooldownMinutes, DEFAULT_ALERT_PREFS.cooldownMinutes, 1),
  };
}

export function loadAlertPrefs(): AlertPrefs {
  return normalizeAlertPrefs(Storage.get<Partial<AlertPrefs>>(KEY));
}

export function saveAlertPrefs(prefs: AlertPrefs): void {
  Storage.set(KEY, normalizeAlertPrefs(prefs));
}
