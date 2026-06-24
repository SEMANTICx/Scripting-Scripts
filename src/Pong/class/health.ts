// ============================================================================
// Node health presentation helpers. Pure and UI-agnostic: transforms live
// record state into restrained labels/tints for compact node cards.
// ============================================================================
import type { LiveRecord } from "./types";

export type NodeHealthLevel = "offline" | "syncing" | "normal" | "elevated" | "busy";

export type NodeHealthSummary = {
  level: NodeHealthLevel;
  tint: string;
  label: string;
  icon?: string;
  score: number;
};

/** Heavier of CPU / memory usage as a 0..1 ratio; -1 when no record. */
export function nodeLoadRatio(rec?: LiveRecord): number {
  if (!rec) return -1;
  const cpu = isFinite(rec.cpu?.usage) ? rec.cpu.usage / 100 : 0;
  const memTotal = rec.ram?.total || 0;
  const mem = memTotal > 0 ? rec.ram.used / memTotal : 0;
  return Math.max(cpu, mem);
}

function loadTint(r: number): string {
  if (r >= 0.9) return "systemRed";
  if (r >= 0.7) return "systemOrange";
  if (r >= 0.4) return "systemYellow";
  return "systemGreen";
}

/**
 * Compact state for list cards. Normal online nodes stay visually quiet; only
 * loading, high usage and offline states get explicit labels/icons.
 */
export function nodeHealthSummary(online: boolean, rec?: LiveRecord): NodeHealthSummary {
  if (!online) {
    return { level: "offline", tint: "systemGray", label: "离线", icon: "moon.zzz.fill", score: nodeHealthScore({ online }) };
  }
  const ratio = nodeLoadRatio(rec);
  if (ratio < 0) {
    return { level: "syncing", tint: "systemBlue", label: "同步中", icon: "arrow.triangle.2.circlepath", score: 60 };
  }
  const score = nodeHealthScore({ online, rec });
  if (ratio >= 0.9) {
    return { level: "busy", tint: "systemRed", label: "繁忙", icon: "exclamationmark.circle.fill", score };
  }
  if (ratio >= 0.7) {
    return { level: "elevated", tint: "systemOrange", label: "偏高", icon: "exclamationmark.triangle.fill", score };
  }
  return { level: "normal", tint: loadTint(ratio), label: "正常", score };
}

/** Map a node's online state + live record to a marker/list tint. */
export function healthTint(online: boolean, rec?: LiveRecord): string {
  return nodeHealthSummary(online, rec).tint;
}

export type NodeHealthScoreInput = {
  online: boolean;
  rec?: LiveRecord;
  latencyMs?: number | null;
  loss?: number;
  offlineMinutes?: number;
};

export type HealthReason = {
  label: string;
  penalty: number;
  detail: string;
};

function penaltyAbove(value: number, warn: number, bad: number, maxPenalty: number): number {
  if (!isFinite(value) || value <= warn) return 0;
  if (value >= bad) return maxPenalty;
  return ((value - warn) / (bad - warn)) * maxPenalty;
}

function reason(label: string, value: number, warn: number, bad: number, maxPenalty: number, detail: string): HealthReason | null {
  const penalty = penaltyAbove(value, warn, bad, maxPenalty);
  return penalty > 0 ? { label, penalty: Math.round(penalty), detail } : null;
}

/** 0..100 score: higher is healthier. Missing optional metrics are ignored. */
export function nodeHealthScore(input: NodeHealthScoreInput): number {
  if (!input.online) {
    const extra = Math.min(20, Math.max(0, input.offlineMinutes || 0) / 3);
    return Math.max(0, Math.round(30 - extra));
  }

  const rec = input.rec;
  let penalty = 0;
  if (!rec) return 60;

  const cpu = isFinite(rec.cpu?.usage) ? rec.cpu.usage : 0;
  const mem = rec.ram?.total ? (rec.ram.used / rec.ram.total) * 100 : 0;
  const disk = rec.disk?.total ? (rec.disk.used / rec.disk.total) * 100 : 0;
  const load1 = isFinite(rec.load?.load1) ? rec.load.load1 : 0;

  penalty += penaltyAbove(cpu, 70, 95, 18);
  penalty += penaltyAbove(mem, 75, 95, 18);
  penalty += penaltyAbove(disk, 80, 95, 16);
  penalty += penaltyAbove(load1, 4, 12, 12);
  penalty += penaltyAbove(input.latencyMs ?? 0, 100, 500, 16);
  penalty += penaltyAbove((input.loss || 0) * 100, 1, 20, 20);

  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export function nodeHealthReasons(input: NodeHealthScoreInput): HealthReason[] {
  if (!input.online) {
    return [{ label: "离线", penalty: 70, detail: input.offlineMinutes ? `已离线 ${input.offlineMinutes.toFixed(0)} 分钟` : "当前不在线" }];
  }
  const rec = input.rec;
  if (!rec) return [{ label: "同步中", penalty: 40, detail: "等待实时数据" }];

  const cpu = isFinite(rec.cpu?.usage) ? rec.cpu.usage : 0;
  const mem = rec.ram?.total ? (rec.ram.used / rec.ram.total) * 100 : 0;
  const disk = rec.disk?.total ? (rec.disk.used / rec.disk.total) * 100 : 0;
  const load1 = isFinite(rec.load?.load1) ? rec.load.load1 : 0;
  const latency = input.latencyMs ?? 0;
  const lossPercent = (input.loss || 0) * 100;

  return [
    reason("CPU", cpu, 70, 95, 18, `${cpu.toFixed(0)}%`),
    reason("内存", mem, 75, 95, 18, `${mem.toFixed(0)}%`),
    reason("磁盘", disk, 80, 95, 16, `${disk.toFixed(0)}%`),
    reason("负载", load1, 4, 12, 12, load1.toFixed(2)),
    reason("延迟", latency, 100, 500, 16, `${latency.toFixed(0)} ms`),
    reason("丢包", lossPercent, 1, 20, 20, `${lossPercent.toFixed(1)}%`),
  ].filter((r): r is HealthReason => !!r);
}
