// ============================================================================
// Read-only backend diagnostics. These checks deliberately use the same facade
// calls as the UI so failures point at the actual path users exercise.
// ============================================================================
import type { Instance, NodeBasicInfo } from "./types";
import {
  backendFor,
  fetchLoadRecords,
  fetchNodes,
  fetchPingRecords,
  fetchServiceOverview,
  fetchVersion,
  verifyAuth,
} from "./server";
import { fetchLoadRecordsCached, fetchPingRecordsCached } from "./history_cache";

export type DiagnosticStatus = "ok" | "warn" | "error" | "skip";

export type DiagnosticItem = {
  id: string;
  title: string;
  status: DiagnosticStatus;
  detail: string;
  elapsedMs?: number;
};

async function timed(
  id: string,
  title: string,
  run: () => Promise<{ status: DiagnosticStatus; detail: string }>,
): Promise<DiagnosticItem> {
  const t0 = Date.now();
  try {
    const out = await run();
    return { id, title, ...out, elapsedMs: Date.now() - t0 };
  } catch (e: any) {
    return {
      id,
      title,
      status: "error",
      detail: e?.message || String(e),
      elapsedMs: Date.now() - t0,
    };
  }
}

export async function runInstanceDiagnostics(inst: Instance): Promise<DiagnosticItem[]> {
  const backend = backendFor(inst);
  const caps = backend.caps;
  const items: DiagnosticItem[] = [
    {
      id: "instance",
      title: "探针配置",
      status: "ok",
      detail: `${caps.label} · ${inst.baseUrl} · ${inst.auth?.mode || "none"}`,
    },
  ];

  items.push(await timed("version", "版本 / 连通性", async () => {
    const version = await fetchVersion(inst);
    return version
      ? { status: "ok", detail: `已连接 · ${version}` }
      : { status: "warn", detail: "地址可达性不确定：版本接口未返回可识别信息" };
  }));

  items.push(await timed("auth", "认证凭证", async () => {
    if (!inst.auth || inst.auth.mode === "none") {
      return { status: "skip", detail: "未配置认证，按公开 / 游客模式访问" };
    }
    const r = await verifyAuth(inst.kind, inst.baseUrl, inst.auth);
    return r.ok
      ? { status: "ok", detail: r.username ? `认证成功 · ${r.username}` : "认证成功" }
      : { status: "error", detail: r.error || "认证失败" };
  }));

  let nodes: NodeBasicInfo[] = [];
  items.push(await timed("nodes", "节点列表", async () => {
    nodes = await fetchNodes(inst);
    if (nodes.length === 0) {
      return { status: "warn", detail: "接口可用，但没有返回节点" };
    }
    return {
      status: "ok",
      detail: `${nodes.length} 个节点 · 示例 ${nodes[0].name || nodes[0].uuid}`,
    };
  }));

  const first = nodes[0];
  const hours = caps.ranges[0]?.hours || 24;
  items.push(await timed("load", "负载历史", async () => {
    if (!first) return { status: "skip", detail: "没有节点，跳过历史检查" };
    const rows = await fetchLoadRecordsCached(inst, first.uuid, "cpu", hours);
    return rows.length > 0
      ? { status: "ok", detail: `CPU 历史 ${rows.length} 条` }
      : { status: "warn", detail: "没有返回 CPU 历史；可能是后端未保留历史或权限不足" };
  }));

  items.push(await timed("ping", "延迟历史", async () => {
    if (!first) return { status: "skip", detail: "没有节点，跳过延迟检查" };
    const data = await fetchPingRecordsCached(inst, first.uuid, hours);
    const tasks = data.tasks?.length || 0;
    return data.records.length > 0
      ? { status: "ok", detail: `${tasks} 条线路 · ${data.records.length} 个样本` }
      : { status: "warn", detail: "没有返回延迟样本；检查服务监控/任务是否关联该节点" };
  }));

  items.push(await timed("services", "服务监控", async () => {
    if (!caps.hasServiceOverview) {
      return { status: "skip", detail: "当前后端没有全局服务监控概览" };
    }
    const services = await fetchServiceOverview(inst);
    return services.length > 0
      ? { status: "ok", detail: `${services.length} 个服务监控项` }
      : { status: "warn", detail: "服务监控接口可用，但没有返回监控项" };
  }));

  return items;
}
