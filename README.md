# Pong — Komari 探针面板

参照 [vPings](https://apps.apple.com/us/app/vpings/id6479573031) 实现的 Scripting (iOS) 应用：在 3D 世界地图上展示 Komari 探针的节点实时状态、负载指标与地理分布。原 Demo 的「哪吒探针」已替换为 **Komari 探针**。

## 功能

- **地图视图**：按节点 GeoIP 地区在 3D 卫星地图上打点，在线绿色、离线灰色，同地区节点自动散开避免重叠。
- **实时数据**：通过 WebSocket `ws(s)://host/api/clients` 每 2 秒拉取一次实时指标，断线自动重连。
- **节点列表**：所有节点按在线优先排序，行内显示 CPU / 内存环形仪表与上下行速率。
- **节点详情**：实时负载仪表（CPU/内存/磁盘/交换）、网络速率、连接数、进程数、运行时间，以及硬件与计费信息。
- **多探针管理**：在设置里添加/编辑/删除/切换多个 Komari 面板地址，支持「测试连接」（读取 `/api/version`）。

## Komari API 契约

| 用途 | 端点 |
|---|---|
| 静态节点列表 | `GET {baseUrl}/api/nodes` → `{status, data: NodeBasicInfo[]}` |
| 实时数据 | WebSocket `{ws}://{host}/api/clients`，连接后每 2s 发送文本 `get`，回 `{status, data:{online[], data:{[uuid]: LiveRecord}}}` |
| 版本探测 | `GET {baseUrl}/api/version` |

## 架构（S.U.P.E.R）

```
index.tsx                 入口：Navigation.present(<View/>)
page/
  index.tsx               根布局：MonitorProvider > MapSelectionProvider > ZStack(Map + Sheet)
  map.tsx                 地图 + Marker（消费 Monitor context）
  sheet.tsx               悬浮控件：状态总览 + 选中节点入口
  list.tsx                节点列表（在线优先，行内仪表）
  detail.tsx              单节点详情（实时仪表 + 硬件/计费）
  settings.tsx            探针 CRUD + 测试连接
context/
  Monitor.tsx             唯一数据源：节点列表 + 实时记录 + 连接状态（单向流）
  MapSelection.tsx        地图选中态绑定
class/                    纯逻辑层（无 UI），已通过 tsc 类型检查 + 运行时单测
  types.ts                所有数据契约（Port）
  server.ts               Komari 数据访问：fetchNodes / fetchVersion / buildPins / LiveClient(WebSocket)
  config.ts               探针配置持久化（Storage）
  geo.ts                  region(ISO码/旗帜emoji/中英名) → 经纬度
  coords_data.ts          ISO-3166 国家质心坐标表（自动生成）
  format.ts               纯展示格式化（字节/速率/百分比/计费…）
```

- **S** 单一职责：每个模块只做一件事（网络/配置/地理/格式化/状态/各页面）。
- **U** 单向数据流：`server.ts` → `Monitor` observables → 各视图（只读），视图从不直接碰 fetch/WebSocket。
- **P** 接口先行：所有跨模块数据走 `types.ts` 契约；视图依赖 `useMonitor()` 而非实现。
- **E** 无硬编码：探针地址全部来自用户配置（`Storage`），代码内无任何固定 URL。
- **R** 可替换：`LiveClient` 可整体换成 SSE/轮询而不影响 UI；坐标表/格式化均可独立替换。

## 验证

- `tsc --strict` 对纯逻辑层（class/*.ts）零错误；全量（含 .tsx）零错误。
- 运行时单测覆盖：格式化、地理解析（旗帜 emoji/ISO/中英名）、`buildPins`（跳过无法解析地区、在线/离线着色、同地区散开）、实时帧解析。

## 导入方式

本仓库根目录即 Scripting 脚本源码（`script.json` + `index.tsx` + 各子目录），可直接通过 GitHub 链接导入。

在 iOS 上点击下面任一链接即可唤起 Scripting 并导入：

- Deep link（直接唤起 App）：
  `scripting://import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FSEMANTICx%2FScripting-Scripts%22%5D`
- 跳板网页（分享给别人更稳，浏览器里点）：
  https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FSEMANTICx%2FScripting-Scripts%22%5D

导入后首次运行进入「设置」添加你的 Komari / 哪吒面板地址即可。

## 开发与版本控制

本仓库以**源码形式**管理（而非打包好的 `.scripting` zip），便于 `git diff` 追踪每次改动：

```bash
git clone https://github.com/SEMANTICx/Scripting-Scripts.git
# 修改 page/ class/ context/ 下的源码
git add -A && git commit -m "feat: xxx"
git push
```

推送后，重新点上面的导入链接即可在 Scripting 中拉取最新版本（导入会覆盖同名脚本）。`.scripting` 打包文件已在 `.gitignore` 中忽略，不纳入版本控制。

### 版本控制工作流（控制导入哪个版本 / 改坏可回退）

> Scripting 从仓库导入时拉取的是 **`main` 分支的当前内容**。所以「线上版本」=「`main` 上是什么」。
> 只有 `push main` 之后导入才会变；本地 `dev` 怎么改都不影响线上。

- **`dev` 分支**：日常开发，随便改、随便 commit，改坏了也没关系（它不是导入源）。
- **`main` 分支**：只放确认可用的版本，是 GitHub 导入源。每次发布打一个版本 tag。

**日常开发（在 dev）**
```bash
git checkout dev
# 改 page/ class/ context/ 源码
git add -A && git commit -m "改动说明"
```

**发布一个新版本**（把 dev 当前状态推成线上版本，并打 tag）
```bash
sh release.sh v1.0.1 "本次更新说明"
# 脚本只在本地合并到 main + 打 tag，不会自动 push
# 确认无误后，手动 push 才真正上线：
git push origin main --follow-tags
```

**改坏了，回退到旧版本**
```bash
sh rollback.sh v1.0.0          # 把 main 内容退回 v1.0.0（前进式，不改写历史）
git push origin main           # 确认后手动 push，导入即回到旧版
```

回退采用「用旧版本内容生成一个新提交」的方式，**不需要 force push**，远程历史永远完整、安全，随时可再前进或再回退。`release.sh` / `rollback.sh` 是本地辅助脚本，已在 `.gitignore` 中忽略。
