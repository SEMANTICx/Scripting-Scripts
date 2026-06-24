// ============================================================================
// Komari PURE transforms — raw Komari JSON -> canonical app model.
// Kept free of `scripting` imports so fixture tests can exercise API contracts
// without a Scripting runtime.
// ============================================================================
import type {
  LiveData,
  LiveRecord,
  LoadData,
  LoadRecord,
  NodeBasicInfo,
  PingData,
} from "./types";

/** Normalise Komari `/api/nodes` rows and apply the app's stable sort. */
export function normalizeKomariNodes(nodes: NodeBasicInfo[]): NodeBasicInfo[] {
  return (nodes || [])
    .map((n) => ({ ...n, id: n.id || 0 }))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return (a.name || "").localeCompare(b.name || "");
    });
}

/**
 * Komari's WebSocket / recent records map almost 1:1 onto LiveRecord, except
 * GPU and temperature, which Komari nests under a `gpu` object.
 */
export function enrichRecord(rec: any): LiveRecord {
  if (!rec || typeof rec !== "object") return rec as LiveRecord;
  const g = rec.gpu;
  if (g && typeof g === "object" && !Array.isArray(g)) {
    const detail = Array.isArray(g.detailed_info) ? g.detailed_info : [];
    const avg =
      typeof g.average_usage === "number"
        ? g.average_usage
        : detail.length > 0
          ? detail.reduce((a: number, d: any) => a + (Number(d?.utilization) || 0), 0) / detail.length
          : undefined;
    if (avg != null) rec.gpu = avg;
    if (detail.length > 0) {
      rec.gpus = detail.map((d: any, i: number) => ({
        name: d?.name || `GPU ${i}`,
        usage: typeof d?.utilization === "number" ? d.utilization : undefined,
        temp: typeof d?.temperature === "number" ? d.temperature : undefined,
      }));
      let hi = 0;
      for (const d of detail) {
        const v = Number(d?.temperature) || 0;
        if (v > hi) hi = v;
      }
      if (hi > 0) rec.temp = hi;
    }
  }
  return rec as LiveRecord;
}

/** Normalise a whole LiveData payload's records. */
export function enrichLiveData(data: LiveData): LiveData {
  if (!data?.data) return data;
  for (const uuid of Object.keys(data.data)) {
    data.data[uuid] = enrichRecord(data.data[uuid]);
  }
  return data;
}

/** Normalise Komari `/api/records/ping` data. */
export function normalizeKomariPingData(data: Partial<PingData> | null | undefined): PingData {
  return {
    count: data?.count ?? (data?.records?.length || 0),
    records: Array.isArray(data?.records) ? data.records : [],
    basic_info: Array.isArray(data?.basic_info) ? data.basic_info : [],
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
  };
}

/** Normalise Komari `/api/records/load` data. */
export function normalizeKomariLoadRecords(data: Partial<LoadData> | null | undefined): LoadRecord[] {
  const recs = data?.records;
  return Array.isArray(recs) ? recs : [];
}
