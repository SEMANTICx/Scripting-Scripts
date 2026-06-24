// ============================================================================
// Pure local alert rules. No Scripting imports; safe to unit-test.
// ============================================================================
import type { LiveRecord, NodeBasicInfo } from "./types";
import type { PingSummary } from "./ping";

export type AlertPrefs = {
  enabled: boolean;
  offlineMinutes: number;
  lossPercent: number;
  latencyMs: number;
  diskPercent: number;
  trafficMBps: number;
  cooldownMinutes: number;
};

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  enabled: true,
  offlineMinutes: 5,
  lossPercent: 10,
  latencyMs: 250,
  diskPercent: 90,
  trafficMBps: 50,
  cooldownMinutes: 30,
};

export type AlertEvent = {
  kind: string;
  uuid: string;
  title: string;
  body: string;
};

export function liveAlertEvents(
  node: NodeBasicInfo,
  online: boolean,
  rec: LiveRecord | undefined,
  prefs: AlertPrefs,
  offlineForMinutes = 0,
): AlertEvent[] {
  if (!prefs.enabled) return [];
  const out: AlertEvent[] = [];
  if (!online) {
    if (offlineForMinutes >= prefs.offlineMinutes) {
      out.push({
        kind: "offline",
        uuid: node.uuid,
        title: `${node.name} 异常`,
        body: `已离线超过 ${prefs.offlineMinutes} 分钟`,
      });
    }
    return out;
  }
  if (!rec) return out;

  const diskRatio = rec.disk?.total ? rec.disk.used / rec.disk.total : 0;
  if (diskRatio * 100 >= prefs.diskPercent) {
    out.push({
      kind: "disk",
      uuid: node.uuid,
      title: `${node.name} 异常`,
      body: `磁盘使用率 ${(diskRatio * 100).toFixed(0)}%`,
    });
  }

  const traffic = (rec.network?.up || 0) + (rec.network?.down || 0);
  if (traffic >= prefs.trafficMBps * 1024 * 1024) {
    out.push({
      kind: "traffic",
      uuid: node.uuid,
      title: `${node.name} 异常`,
      body: `瞬时流量 ${(traffic / 1024 / 1024).toFixed(1)} MB/s`,
    });
  }
  return out;
}

export function pingAlertEvents(
  node: NodeBasicInfo,
  summaries: PingSummary[],
  prefs: AlertPrefs,
): AlertEvent[] {
  if (!prefs.enabled) return [];
  const out: AlertEvent[] = [];
  for (const s of summaries) {
    if (s.loss * 100 >= prefs.lossPercent) {
      out.push({
        kind: "ping-loss",
        uuid: node.uuid,
        title: `${node.name} 异常`,
        body: `${s.name} 丢包 ${(s.loss * 100).toFixed(1)}%`,
      });
    }
    const latency = s.p95 || s.avg;
    if (latency >= prefs.latencyMs) {
      out.push({
        kind: "ping-latency",
        uuid: node.uuid,
        title: `${node.name} 异常`,
        body: `${s.name} p95 延迟 ${latency.toFixed(0)} ms`,
      });
    }
  }
  return out;
}

export function canSendAlert(lastSentAt: number | undefined, now: number, prefs: AlertPrefs): boolean {
  return !lastSentAt || now - lastSentAt >= prefs.cooldownMinutes * 60 * 1000;
}
