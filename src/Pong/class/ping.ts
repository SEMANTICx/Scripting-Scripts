// ============================================================================
// Pure transforms for latency (ping) history. S: Single Purpose — turn the
// canonical PingData (adapted from Nezha's /server/{id}/service history in
// class/nezha.ts) into chart marks + per-task summaries. No I/O, no side
// effects, fully deterministic. (R: trivially replaceable.)
// ============================================================================
import type { PingData, PingRecord, PingTask } from "./types";

/** One point on the latency chart. label = sample time, category = task name. */
export type PingMark = {
  label: Date;
  value: number;
  category: string;
  /** Owning task id — lets the UI filter marks for hidden lines. */
  taskId: number;
  /** Line colour baked onto the mark so the built-in chart can't reshuffle it. */
  foregroundStyle: string;
};

/** Per-task latency summary shown under the chart. */
export type PingSummary = {
  taskId: number;
  name: string;
  /** Packet-loss ratio 0..1 (NaN-safe). */
  loss: number;
  min: number;
  max: number;
  avg: number;
  /** 50th / 95th / 99th percentile latency (ms). */
  p50: number;
  p95: number;
  p99: number;
  /** Most recent latency sample (ms), or null if none. */
  last: number | null;
  color: string;
};

export type PingLossSegment = {
  taskId: number;
  taskName: string;
  time: Date;
  color: string;
};

/** Whether every CURRENT ping line is hidden. Ignores stale hidden ids from a previous data set. */
export function areAllPingLinesHidden(
  summaries: Pick<PingSummary, "taskId">[],
  hiddenTaskIds: number[],
): boolean {
  if (summaries.length === 0) return false;
  const hidden = new Set(hiddenTaskIds);
  return summaries.every((summary) => hidden.has(summary.taskId));
}

// Chart-compatible HEX colours generated from the visible task order.
// Scripting ShapeStyle supports #RRGGBB, so this is not limited to system color names.
function colorForIndex(index: number): string {
  const hue = ((Math.max(0, index) * 137.508 + 210) % 360) / 60;
  const chroma = 0.56;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = 0.58 - chroma / 2;
  const [r, g, b] =
    hue < 1 ? [chroma, x, 0] :
    hue < 2 ? [x, chroma, 0] :
    hue < 3 ? [0, chroma, x] :
    hue < 4 ? [0, x, chroma] :
    hue < 5 ? [x, 0, chroma] :
    [chroma, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Map a task id to a unique colour within the CURRENT ordered task set.
 * The ordered-task argument keeps all visible rows distinct, while the fallback
 * remains deterministic for older call sites that only pass a task id.
 */
export function taskColor(taskId: number, orderedTaskIds?: number[]): string {
  const order = orderedTaskIds || [];
  const idx = order.indexOf(taskId);
  if (idx >= 0) return colorForIndex(idx);
  const i = Math.abs(Math.trunc(taskId));
  return colorForIndex(i);
}

function orderedTaskIdsFromRecords(records: PingRecord[]): number[] {
  return Object.keys(
    records.reduce((acc: Record<number, true>, r) => {
      acc[r.task_id] = true;
      return acc;
    }, {}),
  )
    .map((k) => Number(k))
    .sort((a, b) => a - b);
}

function nameForTask(taskId: number, tasks: PingTask[]): string {
  const t = tasks.find((x) => x.id === taskId);
  return t?.name || `任务 ${taskId}`;
}

/** Percentile (0..100) of a numeric array using linear interpolation. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const frac = rank - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

/**
 * Build chart marks from the ping payload. Records whose value is negative
 * (timeout / loss sentinel) are skipped on the line so they don't drag it to
 * zero, but they still count toward the loss ratio in the summary.
 */
export function buildPingMarks(data: PingData): PingMark[] {
  const tasks = data.tasks || [];
  const orderedTaskIds = orderedTaskIdsFromRecords(data.records || []);
  const marks: PingMark[] = [];
  for (const r of data.records || []) {
    if (!isFinite(r.value) || r.value < 0) continue;
    const d = new Date(r.time);
    if (isNaN(d.getTime())) continue;
    marks.push({
      label: d,
      value: r.value,
      category: nameForTask(r.task_id, tasks),
      taskId: r.task_id,
      foregroundStyle: taskColor(r.task_id, orderedTaskIds),
    });
  }
  // Chronological order keeps the line continuous.
  marks.sort((a, b) => a.label.getTime() - b.label.getTime());
  return marks;
}

/** Compute a per-task summary (min / max / avg / loss / last sample). */
export function buildPingSummaries(data: PingData): PingSummary[] {
  const tasks = data.tasks || [];
  const byTask: Record<number, PingRecord[]> = {};
  for (const r of data.records || []) {
    (byTask[r.task_id] ||= []).push(r);
  }

  const taskIds = Object.keys(byTask)
    .map((k) => Number(k))
    .sort((a, b) => a - b);

  return taskIds.map((taskId) => {
    const recs = byTask[taskId]
      .slice()
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const valid = recs.filter((r) => isFinite(r.value) && r.value >= 0);
    const lost = recs.length - valid.length;
    const loss = recs.length > 0 ? lost / recs.length : 0;
    const values = valid.map((r) => r.value);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const avg = values.length
      ? values.reduce((s, v) => s + v, 0) / values.length
      : 0;
    const sortedVals = values.slice().sort((a, b) => a - b);
    const p50 = percentile(sortedVals, 50);
    const p95 = percentile(sortedVals, 95);
    const p99 = percentile(sortedVals, 99);
    const last = recs.length ? recs[recs.length - 1].value : null;
    return {
      taskId,
      name: nameForTask(taskId, tasks),
      loss,
      min,
      max,
      avg,
      p50,
      p95,
      p99,
      last: last != null && last >= 0 ? last : null,
      color: taskColor(taskId, taskIds),
    };
  });
}

export function buildPingLossSegments(
  data: PingData,
  colors?: Record<number, string>,
): PingLossSegment[] {
  const tasks = data.tasks || [];
  const taskIds = orderedTaskIdsFromRecords(data.records || []);
  const out: PingLossSegment[] = [];
  for (const r of data.records || []) {
    if (!isFinite(r.value) || r.value >= 0) continue;
    const d = new Date(r.time);
    if (isNaN(d.getTime())) continue;
    out.push({
      taskId: r.task_id,
      taskName: nameForTask(r.task_id, tasks),
      time: d,
      color: colors?.[r.task_id] || taskColor(r.task_id, taskIds),
    });
  }
  return out.sort((a, b) => a.time.getTime() - b.time.getTime());
}

export function applyPingColorOverrides<T extends {
  taskId: number;
  color?: string;
  foregroundStyle?: string;
}>(items: T[], overrides: Record<number, string>): T[] {
  return items.map((item) => {
    const color = overrides[item.taskId];
    if (!color) return item;
    return {
      ...item,
      ...(item.color != null ? { color } : {}),
      ...(item.foregroundStyle != null ? { foregroundStyle: color } : {}),
    };
  });
}


/**
 * Legacy helper for callers that still use a category chart. Current ping
 * rendering uses one LineChart per task and passes the same summary colour.
 */
export function buildPingColorScale(
  summaries: PingSummary[],
): { [name: string]: { color: string } } {
  const scale: { [name: string]: { color: string } } = {};
  for (const s of summaries) {
    scale[s.name] = { color: s.color };
  }
  return scale;
}
