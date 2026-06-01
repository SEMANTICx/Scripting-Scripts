// ============================================================================
// Komari backend adapter. Implements the `Backend` port against a Komari
// dashboard's HTTP + WebSocket API. Extracted from the original data layer.
// S: Single Purpose — all Komari-specific network I/O + shape handling.
// U: Unidirectional — network -> typed data -> canonical model -> callers.
// R: Replaceable — registered via class/backend.ts; nothing imports it directly.
// ============================================================================
import { fetch } from "scripting";
import type {
  NodeBasicInfo,
  NodeResponse,
  LiveData,
  LiveRecord,
  PingData,
  PingTask,
  LoadRecord,
  LoadData,
  LoadType,
  NodeEditPatch,
  CommandExecResult,
  LoginSession,
  SiteSettings,
  AuthConfig,
  ClientDetail,
} from "./types";
import {
  Backend,
  LoginResult,
  CreatedNode,
  LiveHandlers,
  LiveSession,
  KOMARI_CAPS,
} from "./backend";

// ----------------------------------------------------------------------------
// Auth helpers. "token" mode → Komari API Key (Bearer); "password" → the
// session_token cookie obtained from /api/login.
// ----------------------------------------------------------------------------

function authHeaders(auth?: AuthConfig): Record<string, string> {
  if (!auth || auth.mode === "none") return {};
  if (auth.mode === "token" && auth.apiKey) {
    return { Authorization: `Bearer ${auth.apiKey.trim()}` };
  }
  if (auth.mode === "password" && auth.sessionToken) {
    return { Cookie: `session_token=${auth.sessionToken}` };
  }
  return {};
}

function headersFor(auth?: AuthConfig, extra?: Record<string, string>): Record<string, string> {
  return { Accept: "application/json", ...authHeaders(auth), ...(extra || {}) };
}

/** Pull `session_token` out of a response's Set-Cookie header, if present. */
function extractSessionToken(res: any): string | null {
  try {
    const raw = res?.headers?.get?.("set-cookie") || res?.headers?.get?.("Set-Cookie") || "";
    if (!raw) return null;
    const m = /session_token=([^;]+)/i.exec(raw);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function adminError(status: number, msg?: string): Error {
  if (status === 401 || status === 403) {
    return new Error("当前凭证没有管理员权限 (HTTP " + status + ")");
  }
  return new Error(msg || `请求失败 (HTTP ${status})`);
}

// Online window for HTTP-polling mode (auth'd). Komari marks a node online by
// "has a live agent WS connection"; polling can't see that, so we use a
// generous freshness window anchored to the newest sample in the batch.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function isRecordFresh(rec: LiveRecord | null, nowMs: number): boolean {
  if (!rec) return false;
  const t = Date.parse(rec.updated_at || "");
  if (isNaN(t)) return true;
  return nowMs - t <= ONLINE_WINDOW_MS;
}

// ----------------------------------------------------------------------------
// Network calls (module-private; exposed through the Backend object below).
// ----------------------------------------------------------------------------

async function login(
  baseUrl: string,
  username: string,
  password: string,
  twoFactor?: string,
): Promise<LoginResult> {
  if (!baseUrl) return { ok: false, error: "未配置 Komari 地址" };
  try {
    const body: Record<string, string> = { username, password };
    if (twoFactor) body["2fa_code"] = twoFactor;
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      timeout: 15000,
    });
    const token = extractSessionToken(res);
    let parsed: any = null;
    try {
      parsed = await res.json();
    } catch {
      /* body may be empty on success */
    }
    if (!res.ok) {
      const msg = parsed?.message || parsed?.error || `登录失败 (HTTP ${res.status})`;
      const needs2FA = /2fa|two[- ]?factor|otp/i.test(String(msg));
      return { ok: false, error: msg, needs2FA };
    }
    if (parsed && (parsed.need_2fa || parsed.requires_2fa || parsed?.data?.need_2fa)) {
      return { ok: false, needs2FA: true, error: "需要两步验证码" };
    }
    const sessionToken = token || parsed?.data?.session_token || parsed?.session_token;
    if (!sessionToken) return { ok: false, error: "登录成功但未返回会话凭证" };
    return { ok: true, sessionToken };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function fetchNodes(baseUrl: string, auth?: AuthConfig): Promise<NodeBasicInfo[]> {
  if (!baseUrl) throw new Error("未配置 Komari 地址");
  const res = await fetch(`${baseUrl}/api/nodes`, {
    method: "GET",
    headers: headersFor(auth),
    timeout: 15000,
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("未授权：请检查登录凭证 (HTTP 401)");
    throw new Error(`请求失败 (HTTP ${res.status})`);
  }
  const body = (await res.json()) as NodeResponse;
  if (!body || body.status !== "success" || !Array.isArray(body.data)) {
    throw new Error(body?.message || "返回数据格式不正确");
  }
  // Normalize: ensure numeric `id` exists (Komari keys by uuid) and sort.
  return body.data
    .map((n) => ({ ...n, id: n.id || 0 }))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return (a.name || "").localeCompare(b.name || "");
    });
}

async function fetchVersion(baseUrl: string, auth?: AuthConfig): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/version`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 8000,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { version?: string } } | any;
    return body?.data?.version ?? body?.version ?? null;
  } catch {
    return null;
  }
}

async function verifyAuth(
  baseUrl: string,
  auth?: AuthConfig,
): Promise<{ ok: boolean; username?: string; error?: string }> {
  if (!baseUrl) return { ok: false, error: "未配置地址" };
  try {
    const res = await fetch(`${baseUrl}/api/me`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 10000,
    });
    if (res.status === 401) return { ok: false, error: "凭证无效或已过期" };
    if (!res.ok) return { ok: false, error: `验证失败 (HTTP ${res.status})` };
    const body = (await res.json()) as any;
    const u = body?.data?.username || body?.username || body?.data?.uuid;
    return { ok: true, username: u };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Komari's WebSocket / recent records map almost 1:1 onto the canonical
 * LiveRecord, EXCEPT GPU and temperature, which Komari nests under a `gpu`
 * object (`{ average_usage, detailed_info: [{ name, utilization, temperature }] }`).
 * This normalises those into the canonical flat `gpu` / `temp` / `gpus` fields
 * so the detail UI renders them the same way for both backends.
 */
function enrichRecord(rec: any): LiveRecord {
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
      // Live temperature: hottest GPU sensor (Komari has no CPU temp in Report).
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

/** Normalise a whole LiveData payload's records (GPU/temperature). */
function enrichLiveData(data: LiveData): LiveData {
  if (!data?.data) return data;
  for (const uuid of Object.keys(data.data)) {
    data.data[uuid] = enrichRecord(data.data[uuid]);
  }
  return data;
}

async function fetchRecentRecord(
  baseUrl: string,
  uuid: string,
  auth?: AuthConfig,
): Promise<LiveRecord | null> {
  if (!baseUrl || !uuid) return null;
  try {
    const res = await fetch(`${baseUrl}/api/recent/${encodeURIComponent(uuid)}`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 12000,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; data?: any } | any;
    if (body?.status !== "success") return null;
    const d = body.data;
    const rec = Array.isArray(d) ? d[d.length - 1] : d;
    if (!rec || typeof rec !== "object") return null;
    return enrichRecord(rec);
  } catch {
    return null;
  }
}

async function fetchPingRecords(
  baseUrl: string,
  uuid: string,
  hours: number,
  auth?: AuthConfig,
): Promise<PingData> {
  const empty: PingData = { count: 0, records: [], basic_info: [], tasks: [] };
  if (!baseUrl || !uuid) return empty;
  try {
    const res = await fetch(
      `${baseUrl}/api/records/ping?uuid=${encodeURIComponent(uuid)}&hours=${hours}`,
      { method: "GET", headers: headersFor(auth), timeout: 15000 },
    );
    if (!res.ok) return empty;
    const body = (await res.json()) as { status?: string; data?: PingData } | any;
    if (body?.status !== "success" || !body?.data) return empty;
    const data = body.data as PingData;
    return {
      count: data.count ?? (data.records?.length || 0),
      records: Array.isArray(data.records) ? data.records : [],
      basic_info: Array.isArray(data.basic_info) ? data.basic_info : [],
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
    };
  } catch {
    return empty;
  }
}

async function fetchPingTasks(baseUrl: string, auth?: AuthConfig): Promise<PingTask[]> {
  if (!baseUrl) return [];
  try {
    const res = await fetch(`${baseUrl}/api/task/ping`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 10000,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { status?: string; data?: PingTask[] } | any;
    if (body?.status !== "success" || !Array.isArray(body?.data)) return [];
    return body.data as PingTask[];
  } catch {
    return [];
  }
}

async function fetchLoadRecords(
  baseUrl: string,
  uuid: string,
  loadType: LoadType,
  hours: number,
  auth?: AuthConfig,
): Promise<LoadRecord[]> {
  if (!baseUrl || !uuid) return [];
  try {
    const res = await fetch(
      `${baseUrl}/api/records/load?uuid=${encodeURIComponent(uuid)}` +
        `&load_type=${loadType}&hours=${hours}`,
      { method: "GET", headers: headersFor(auth), timeout: 15000 },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { status?: string; data?: LoadData } | any;
    if (body?.status !== "success" || !body?.data) return [];
    const recs = body.data.records;
    return Array.isArray(recs) ? (recs as LoadRecord[]) : [];
  } catch {
    return [];
  }
}

async function createNode(
  baseUrl: string,
  name: string,
  auth?: AuthConfig,
): Promise<CreatedNode> {
  if (!baseUrl) throw new Error("未配置 Komari 地址");
  const res = await fetch(`${baseUrl}/api/admin/client/add`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: (name || "").trim() }),
    timeout: 15000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || body?.status === "error") {
    throw adminError(res.status, body?.message || body?.error);
  }
  const uuid = body?.uuid ?? body?.data?.uuid;
  const token = body?.token ?? body?.data?.token;
  if (!uuid || !token) throw new Error("创建成功但未返回 uuid / token");
  return { uuid, token };
}

async function fetchClientDetail(
  baseUrl: string,
  uuid: string,
  auth?: AuthConfig,
): Promise<ClientDetail | null> {
  if (!baseUrl || !uuid) return null;
  if (!auth || auth.mode === "none") return null;
  try {
    const res = await fetch(`${baseUrl}/api/admin/client/${encodeURIComponent(uuid)}`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 12000,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const d = body?.data ?? body;
    if (!d || typeof d !== "object") return null;
    const ipv4 = typeof d.ipv4 === "string" ? d.ipv4 : "";
    const ipv6 = typeof d.ipv6 === "string" ? d.ipv6 : "";
    return {
      uuid,
      name: d.name,
      ipv4: ipv4 || undefined,
      ipv6: ipv6 || undefined,
      region: d.region,
      remark: d.remark,
    };
  } catch {
    return null;
  }
}

async function getNodeToken(baseUrl: string, uuid: string, auth?: AuthConfig): Promise<string> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  const res = await fetch(`${baseUrl}/api/admin/client/${encodeURIComponent(uuid)}/token`, {
    method: "GET",
    headers: headersFor(auth),
    timeout: 12000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || body?.status === "error") {
    throw adminError(res.status, body?.message || body?.error);
  }
  const token = body?.token ?? body?.data?.token;
  if (!token) throw new Error("未返回 token");
  return token;
}

async function deleteNode(baseUrl: string, uuid: string, auth?: AuthConfig): Promise<void> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  const res = await fetch(`${baseUrl}/api/admin/client/${encodeURIComponent(uuid)}/remove`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: "{}",
    timeout: 15000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || body?.status === "error") {
    throw adminError(res.status, body?.message || body?.error);
  }
}

/**
 * Edit a node's metadata via `POST /api/admin/client/:uuid/edit`. Only the
 * provided patch fields are sent. Komari supports the full set (name / group /
 * tags / weight / price / billing_cycle / expired_at / remark). Requires admin.
 */
async function editNode(
  baseUrl: string,
  uuid: string,
  patch: NodeEditPatch,
  auth?: AuthConfig,
): Promise<void> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  const body: Record<string, any> = { uuid };
  if (patch.name != null) body.name = patch.name;
  if (patch.group != null) body.group = patch.group;
  if (patch.tags != null) body.tags = patch.tags;
  if (patch.weight != null) body.weight = patch.weight;
  if (patch.price != null) body.price = patch.price;
  if (patch.billing_cycle != null) body.billing_cycle = patch.billing_cycle;
  if (patch.expired_at != null) body.expired_at = patch.expired_at;
  if (patch.note != null) body.remark = patch.note;
  const res = await fetch(`${baseUrl}/api/admin/client/${encodeURIComponent(uuid)}/edit`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    timeout: 15000,
  });
  let rb: any = null;
  try {
    rb = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || rb?.status === "error") {
    throw adminError(res.status, rb?.message || rb?.error);
  }
}

function buildInstallCommands(
  baseUrl: string,
  token: string,
): { label: string; command: string }[] {
  const ep = baseUrl.replace(/\/+$/, "");
  const tok = token || "<TOKEN>";
  return [
    {
      label: "一键脚本 (Linux/macOS)",
      command:
        `curl -fsSL https://raw.githubusercontent.com/komari-monitor/komari-agent/main/install.sh ` +
        `-o komari-install.sh && sh komari-install.sh -e ${ep} -t ${tok}`,
    },
    {
      label: "二进制直接运行",
      command: `./komari-agent -e ${ep} -t ${tok}`,
    },
    {
      label: "Docker",
      command:
        `docker run -d --name komari-agent --restart=always --net=host \\\n` +
        `  ghcr.io/komari-monitor/komari-agent -e ${ep} -t ${tok}`,
    },
    {
      label: "环境变量",
      command: `AGENT_ENDPOINT=${ep} AGENT_TOKEN=${tok} ./komari-agent`,
    },
  ];
}

// ----------------------------------------------------------------------------
// Live transport: anonymous → /api/clients WebSocket (send "get" on a timer);
// authenticated → HTTP-poll /api/recent/:uuid per node (WS can't carry auth).
// ----------------------------------------------------------------------------

class KomariLiveClient implements LiveSession {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private polling = false;

  constructor(
    private baseUrl: string,
    private handlers: LiveHandlers,
    private intervalMs: number,
    private getAuth?: () => AuthConfig | undefined,
    private getUuids?: () => string[],
  ) {}

  private currentAuth(): AuthConfig | undefined {
    return this.getAuth ? this.getAuth() : undefined;
  }

  private useHttp(): boolean {
    const a = this.currentAuth();
    return !!a && a.mode !== "none";
  }

  private wsUrl(): string {
    const u = this.baseUrl.replace(/^http/i, "ws");
    return `${u}/api/clients`;
  }

  start(): void {
    this.closed = false;
    if (this.useHttp()) this.startHttpPolling();
    else this.connect();
  }

  private startHttpPolling(): void {
    this.handlers.onStatus("connected");
    this.pollHttp();
    this.timer = setInterval(() => this.pollHttp(), this.intervalMs);
  }

  private async pollHttp(): Promise<void> {
    if (this.closed || this.polling) return;
    const uuids = this.getUuids ? this.getUuids() : [];
    if (uuids.length === 0) return;
    this.polling = true;
    try {
      const online: string[] = [];
      const data: { [uuid: string]: LiveRecord } = {};
      const results = await Promise.all(
        uuids.map((uuid) => fetchRecentRecord(this.baseUrl, uuid, this.currentAuth())),
      );
      let anchor = 0;
      for (const rec of results) {
        if (rec) {
          const t = Date.parse(rec.updated_at || "");
          if (!isNaN(t) && t > anchor) anchor = t;
        }
      }
      const now = anchor > 0 ? anchor : Date.now();
      let anyOk = false;
      uuids.forEach((uuid, i) => {
        const rec = results[i];
        if (rec) {
          anyOk = true;
          data[uuid] = rec;
          if (isRecordFresh(rec, now)) online.push(uuid);
        }
      });
      this.handlers.onStatus(anyOk ? "connected" : "error");
      this.handlers.onData([], { online, data });
    } catch {
      this.handlers.onStatus("error");
    } finally {
      this.polling = false;
    }
  }

  private connect(): void {
    if (this.closed) return;
    try {
      const ws = new WebSocket(this.wsUrl());
      this.ws = ws;

      ws.onopen = () => {
        this.handlers.onStatus("connected");
        this.poll();
        this.timer = setInterval(() => this.poll(), this.intervalMs);
      };

      ws.onmessage = (message: string | Data) => {
        const text = typeof message === "string" ? message : message.toRawString() ?? "";
        if (!text) return;
        try {
          const parsed = JSON.parse(text) as { status: string; data: LiveData };
          if (parsed?.status === "success" && parsed.data) {
            this.handlers.onData([], enrichLiveData(parsed.data));
          }
        } catch {
          /* ignore malformed frames */
        }
      };

      ws.onerror = () => {
        this.handlers.onStatus("error");
        this.cleanupSocket();
        this.scheduleReconnect();
      };

      ws.onclose = () => {
        this.handlers.onStatus("disconnected");
        this.cleanupSocket();
        this.scheduleReconnect();
      };
    } catch {
      this.handlers.onStatus("error");
      this.scheduleReconnect();
    }
  }

  private poll(): void {
    try {
      this.ws?.send("get");
    } catch {
      /* socket not ready */
    }
  }

  private cleanupSocket(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2500);
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.timer = null;
    this.reconnectTimer = null;
    try {
      this.ws?.close(1000, "client stop");
    } catch {
      /* noop */
    }
    this.ws = null;
  }
}

// ----------------------------------------------------------------------------
// Admin: command execution, sessions, settings.
// ----------------------------------------------------------------------------

/** Generic Komari write returning the `{status,data}` envelope's data. */
async function komariWrite<T = any>(
  baseUrl: string,
  path: string,
  method: "POST" | "GET",
  body?: any,
  auth?: AuthConfig,
  timeout = 15000,
): Promise<T | undefined> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headersFor(auth, body !== undefined ? { "Content-Type": "application/json" } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeout,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok || json?.status === "error") {
    throw adminError(res.status, json?.message || json?.error);
  }
  return (json?.data ?? json) as T;
}

/**
 * Ad-hoc command execution. POST /api/admin/task/exec {command, clients[]}.
 * Returns a task id; results are fetched async per client. We then poll the
 * task result endpoint once (best-effort) so the caller can show output.
 */
async function execCommand(
  baseUrl: string,
  command: string,
  uuids: string[],
  auth?: AuthConfig,
): Promise<CommandExecResult> {
  const data = await komariWrite<any>(
    baseUrl,
    "/api/admin/task/exec",
    "POST",
    { command, clients: uuids },
    auth,
  );
  const taskId = data?.task_id || "";
  return {
    taskId,
    message: taskId ? "命令已下发，可稍后查看结果" : "命令已下发",
  };
}

/** Fetch a task's per-client results (GET /api/admin/task/:id/result). */
async function fetchExecResult(
  baseUrl: string,
  taskId: string,
  auth?: AuthConfig,
): Promise<{ uuid: string; ok: boolean; output: string }[]> {
  if (!taskId) return [];
  try {
    const data = await komariWrite<any>(
      baseUrl,
      `/api/admin/task/${encodeURIComponent(taskId)}/result`,
      "GET",
      undefined,
      auth,
    );
    const rows = Array.isArray(data) ? data : data?.results || data?.data || [];
    return (Array.isArray(rows) ? rows : []).map((r: any) => ({
      uuid: r?.client || r?.uuid || "",
      ok: r?.exit_code === 0 || r?.exitCode === 0 || !!r?.success,
      output: r?.result ?? r?.output ?? r?.message ?? "",
    }));
  } catch {
    return [];
  }
}

/** List login sessions. GET /api/admin/session/get → {current, data:[Session]}. */
async function listSessions(baseUrl: string, auth?: AuthConfig): Promise<LoginSession[]> {
  const res = await fetch(`${baseUrl}/api/admin/session/get`, {
    method: "GET",
    headers: headersFor(auth),
    timeout: 12000,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || json?.status === "error") {
    throw adminError(res.status, json?.message || json?.error);
  }
  const current = json?.current || "";
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows.map((s: any) => ({
    id: s?.session || "",
    userAgent: s?.latest_user_agent || s?.user_agent || "",
    ip: s?.latest_ip || s?.ip || "",
    latestOnline: s?.latest_online || "",
    current: !!current && s?.session === current,
  }));
}

/** Revoke one session. POST /api/admin/session/remove {session}. */
async function revokeSession(baseUrl: string, id: string, auth?: AuthConfig): Promise<void> {
  await komariWrite(baseUrl, "/api/admin/session/remove", "POST", { session: id }, auth);
}

/** Read site settings. GET /api/admin/settings/. */
async function fetchSiteSettings(baseUrl: string, auth?: AuthConfig): Promise<SiteSettings> {
  const data = await komariWrite<any>(baseUrl, "/api/admin/settings/", "GET", undefined, auth);
  return (data || {}) as SiteSettings;
}

/** Patch site settings. POST /api/admin/settings/ {key:value,...}. */
async function patchSiteSettings(baseUrl: string, patch: SiteSettings, auth?: AuthConfig): Promise<void> {
  await komariWrite(baseUrl, "/api/admin/settings/", "POST", patch, auth);
}

// ----------------------------------------------------------------------------
// The Backend implementation object.
// ----------------------------------------------------------------------------

export const KomariBackend: Backend = {
  caps: KOMARI_CAPS,
  fetchNodes,
  fetchVersion,
  verifyAuth,
  login,
  fetchPingRecords,
  fetchPingTasks,
  fetchLoadRecords,
  fetchClientDetail,
  createNode,
  getNodeToken,
  deleteNode,
  editNode,
  buildInstallCommands,
  execCommand,
  fetchExecResult,
  listSessions,
  revokeSession,
  fetchSiteSettings,
  patchSiteSettings,
  startLive(baseUrl, handlers, getAuth, getUuids) {
    const c = new KomariLiveClient(baseUrl, handlers, 2000, getAuth, getUuids);
    c.start();
    return c;
  },
};
