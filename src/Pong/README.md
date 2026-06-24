# Pong — Komari & 哪吒(Nezha)探针面板

一个运行在 [Scripting](https://scripting.fun)(iOS)里的服务器探针监控面板：在 3D 世界地图上展示节点的实时状态、负载指标与地理分布，并提供完整的节点管理与面板管理功能。**同时支持 Komari 与哪吒(Nezha v1)两种探针后端**，UI 按各后端的实际能力自动门控显示。

参照 [vPings](https://apps.apple.com/us/app/vpings/id6479573031) 的形态实现。

## 功能总览

### 监控
- **3D 地图视图**：按节点 GeoIP 地区在卫星地图上打点，颜色按该地区节点的最重负载着色（在线绿/黄/橙/红、离线灰），同地区多节点自动聚合为一个标记。
- **实时数据**：通过 WebSocket（+ 必要时 HTTP 轮询）每 2 秒拉取一次实时指标，断线自动重连；会话过期自动重新登录。
- **节点列表**：在线优先排序，行内显示 CPU / 内存仪表、上下行速率、以及一段开页即回填的 CPU 负载迷你曲线（sparkline）。
- **搜索与分类**：列表支持搜索、按在线/离线/地区/标签筛选，以及本地自定义分组（创建/改名/删除/分配节点）。
- **节点详情**：实时负载仪表（CPU/内存/磁盘/交换）、网络速率、连接数、进程数、运行时间；历史负载分指标卡片（多时间范围）；网络延迟（Ping）多线路折线图（可逐线显隐）；硬件信息、IP 地址卡片、计费信息。
- **健康评分与解释**：按实时负载、磁盘、延迟、丢包、在线状态生成 0–100 健康分；列表可按健康分桶排序，详情页解释扣分原因。
- **本地提醒**：设备本地通知，可配置离线、丢包、延迟、磁盘、流量阈值与冷却时间；不写入后端面板。
- **服务可用率**（哪吒）：服务监控的 30 天可用率热力墙 + 当前延迟。

### 多探针管理
- 在设置里添加 / 编辑 / 删除 / 切换多个探针实例，每个实例独立选择后端类型（Komari / 哪吒）。
- 支持「测试连接」（读取版本接口）。
- 支持「探针诊断」：只读检查连通性、认证、节点列表、历史数据与服务监控接口。
- 支持「本地提醒」阈值配置（设备本地 Storage）。
- 鉴权方式：无鉴权（访客）/ Token（Komari API Key、哪吒 Access Token）/ 账号密码登录（含两步验证，自动续期会话）。

### 节点 & 面板管理（按后端能力门控）
进入「管理面板」后，仅显示当前探针后端支持的功能：

| 功能 | Komari | 哪吒 |
|---|:--:|:--:|
| 新建节点（含装机引导） | ✓ | — |
| 删除 / 编辑节点 | ✓ | ✓ |
| 告警规则 | — | ✓ |
| 通知渠道 | — | ✓ |
| 计划任务（cron） | — | ✓ |
| 命令执行 | ✓（实时多机） | ✓（经计划任务） |
| 用户管理 | — | ✓ |
| API Tokens | — | ✓ |
| 会话管理 | ✓ | — |
| 站点设置（只读） | ✓ | ✓ |

> 管理操作直接写入面板，且部分不可逆（删除类），请确认所用凭证具备对应权限。

## 后端 API 契约

两个后端的差异完全封装在各自的适配器里，上层只认 `types.ts` 的规范模型。

**Komari**
| 用途 | 端点 |
|---|---|
| 静态节点列表 | `GET {baseUrl}/api/nodes` |
| 实时数据 | WebSocket `{ws}://{host}/api/clients`（连接后周期性发送 `get`） |
| 版本探测 | `GET {baseUrl}/api/version` |
| 负载 / Ping 历史、节点管理、命令执行、会话等 | 对应 `/api/...` 端点 |

**哪吒 Nezha v1**
| 用途 | 端点 |
|---|---|
| 实时数据 | WebSocket（实时帧同时携带完整节点列表，访客模式下据此构建列表） |
| 静态节点列表 / 节点关联服务 | `GET {baseUrl}/api/v1/server` / `GET {baseUrl}/api/v1/server/{id}/service` |
| 节点历史负载 | `GET {baseUrl}/api/v1/server/{id}/metrics?metric=...&period=...` |
| 节点延迟历史 | `GET {baseUrl}/api/v1/service/{id}/history?period=...` |
| 服务监控总览 | `GET {baseUrl}/api/v1/service`（含 30 天 up/down/delay） |
| 告警 / 通知 / 计划任务 / 用户 / Token / 设置 | 对应 `/api/v1/...` 端点 |

时间范围按后端能力不同：Komari 支持 1h/6h/1d/7d，哪吒支持 1d/7d/30d。

## 架构（S.U.P.E.R）

```
index.tsx                  入口：Navigation.present(<View/>)
page/
  index.tsx                根布局：MonitorProvider > MapSelectionProvider > ZStack(Map + Sheet)
  map.tsx                  3D 地图 + Marker（消费 Monitor context）
  sheet.tsx                悬浮控件：状态总览 + 进入列表 / 选中地区
  list.tsx                 节点列表（搜索 / 分类 / 自定义分组 / 行内仪表 + sparkline）
  detail.tsx               单节点详情（实时仪表 + 历史负载 + Ping 折线 + 硬件 / IP / 计费）
  services.tsx             服务可用率热力墙（哪吒）
  settings.tsx             探针实例 CRUD + 测试连接 + 进入管理面板
  diagnostics.tsx          探针只读诊断：连通性 / 认证 / 节点 / 历史 / 服务监控
  local_alerts.tsx         本地提醒阈值设置
  addnode.tsx              节点管理：列表 / 删除 / 新建（Komari）/ 装机引导
  groups.tsx               本地自定义分组管理
  admin.tsx                管理面板 HUB（按 caps 门控列出功能）
  alerts / notifications / cron / exec / users / tokens / sessions / settings_readonly.tsx
                           各管理功能页面
context/
  Monitor.tsx              唯一数据源：节点列表 + 实时记录 + 历史 + 地图标记 + 连接状态（单向流）
  MapSelection.tsx         地图选中态绑定
class/                     纯逻辑层（无 UI），通过 tsc 类型检查 + 运行时单测
  types.ts                 所有数据契约 + 后端能力描述（Port）
  backend.ts               Backend 抽象接口 + 各后端 caps + 适配器注册工厂
  komari.ts / nezha.ts     两个后端适配器（实现 Backend 接口）
  komari_transforms.ts     Komari 纯数据转换（无 I/O）
  nezha_transforms.ts      哪吒纯数据转换（无 I/O）
  diagnostics.ts           只读诊断检查编排
  server.ts                后端门面：分派到适配器 + 后端中立的视图助手（地图打点 / 着色）
  config.ts                探针实例配置持久化（Storage）
  filter.ts / groups.ts    列表筛选 / 自定义分组逻辑
  geo.ts / coords_data.ts  地区码 → 经纬度 / 旗帜 / 中英名
  ping.ts / loadchart.ts / uptime.ts   Ping 折线 / 历史负载 / 可用率计算
  health.ts                节点健康分与扣分解释（纯逻辑）
  alert_rules.ts           本地提醒判定规则（纯逻辑）
  alert_prefs.ts / local_alerts.ts     本地提醒偏好与通知调度
  history_cache.ts         历史负载 / 延迟短期缓存
  format.ts / ui.ts        展示格式化 / UI 尺寸适配
```

- **S** 单一职责：每个模块只做一件事（网络 / 配置 / 地理 / 格式化 / 状态 / 各页面）。
- **U** 单向数据流：适配器 → `Monitor` observables → 各视图（只读），视图从不直接碰 fetch / WebSocket。
- **P** 接口先行：所有跨模块数据走 `types.ts` 契约；视图依赖 `useMonitor()` 与 `Backend` 接口，而非具体实现。
- **E** 无硬编码：探针地址 / 凭证全部来自用户配置（`Storage`），代码内无任何固定 URL。
- **R** 可替换：新增第三种探针后端 = 新增一个适配器文件 + 一次 `registerBackend` 注册，上层零改动。

## 性能要点

实时帧每 2 秒驱动一次更新，热路径做了针对性优化：节点用 uuid 索引做 O(1) 查找；在线集合与地图标记按内容签名门控，成员/可见内容未变时不触发重渲染；列表筛选 / 排序管线 `useMemo` 缓存，纯实时帧不再整管线重算。

## 验证

- `npm run check`：使用 Node `--experimental-strip-types --check` 检查所有 `.ts` 文件，并运行 fixture / 转换 / Ping 单元测试。
- 当前仓库没有 TypeScript / Scripting 类型检查依赖；Node 原生检查不支持 `.tsx`，因此 `.tsx` 需要后续接入 Scripting 类型包或编译器后再做完整静态检查。
- 运行时单测覆盖：Komari fixture 归一化、哪吒 fixture 转换、Ping 颜色稳定性 / 隐藏逻辑 / 丢包统计、健康分 / 扣分解释、本地提醒规则、哪吒在线判断与服务历史转换。

## 导入与开发

本脚本作为 [Scripting-Scripts](https://github.com/SEMANTICx/Scripting-Scripts) 仓库的一员管理：源码在 `src/Pong/`，打包产物 `dist/Pong.scripting` 为导入源。导入链接、版本发布与回退流程见仓库根目录 README。

首次运行进入「设置」添加你的 Komari / 哪吒面板地址即可。访客模式只需地址；管理功能需要配置对应的 Token 或账号登录。
