// ============================================================================
// Node detail page — full live metrics + hardware info for one node.
// S: Single Purpose — detail presentation, reads from the Monitor context.
// ============================================================================
import {
  Button,
  Chart,
  Gauge,
  Group,
  HStack,
  Image,
  LineCategoryChart,
  LineChart,
  List,
  Navigation,
  NavigationStack,
  Pasteboard,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
  useObservable,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import { regionToName, regionToCode, codeToFlag } from "../class/geo";
import { fetchClientDetail, getBackend } from "../class/server";
import { fetchLoadRecordsCachedMeta, fetchPingRecordsCachedMeta } from "../class/history_cache";
import { getActiveInstance } from "../class/config";
import { notifyPingAnomalies } from "../class/local_alerts";
import { nodeHealthReasons, nodeHealthScore } from "../class/health";
import { chartHeight } from "../class/ui";
import type { Instance, ClientDetail } from "../class/types";
import {
  buildPingMarks,
  buildPingSummaries,
  buildPingLossSegments,
  applyPingColorOverrides,
  areAllPingLinesHidden,
} from "../class/ping";
import type { PingLossSegment, PingMark, PingSummary } from "../class/ping";
import {
  loadPingColorOverrides,
  setPingColorOverride,
  PING_COLOR_PRESETS,
} from "../class/ping_prefs";
import {
  buildLoadMarks,
  buildLoadSummaries,
  LOAD_CHARTS,
  chartsForNode,
} from "../class/loadchart";
import type { LoadMark, LoadChartSpec, LoadSummary } from "../class/loadchart";
import {
  formatBytes,
  formatSpeed,
  formatUptime,
  formatPercent,
  ratio,
  percentToRatio,
  loadTint,
  formatPrice,
  daysUntil,
  formatClock,
} from "../class/format";

type Obs<T> = { value: T; setValue: (v: T) => void };

export function View({ uuid }: { uuid: string }) {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const node = monitor.nodeIndex.value[uuid];

  return (
    <NavigationStack>
      <List
        navigationTitle={node?.name ?? "节点详情"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          cancellationAction: [
            <Button title="关闭" systemImage="xmark" action={dismiss} />,
          ],
        }}
      >
        {node ? <Body uuid={uuid} /> : <Section><Text>节点不存在</Text></Section>}
      </List>
    </NavigationStack>
  );
}

function Body({ uuid }: { uuid: string }) {
  const monitor = useMonitor();
  const node = monitor.nodeIndex.value[uuid]!;
  const inst = monitor.instance.value;

  const expDays = daysUntil(node.expired_at);

  return (
    <>
      {/* Live status + gauges + realtime dashboard. Isolated so the 2s live
          frames only re-render this subtree, keeping the List (and its scroll
          position / child range selectors) stable. */}
      <LiveOverview uuid={uuid} />
      <HealthSection uuid={uuid} />

      {/* Network latency history (ping) */}
      <PingSection uuid={uuid} />

      {/* Historical load charts (CPU/RAM/Disk/Network/Connections/Process,
          plus GPU/温度 when the node reports them). This component reads the
          live record on its OWN (one-shot, via mount effect) so Body itself
          never subscribes to the high-frequency `records` observable — keeping
          the 2s frames scoped to <LiveOverview>. */}
      <LoadChartSection
        uuid={uuid}
        memTotal={node.mem_total}
        diskTotal={node.disk_total}
        gpuName={node.gpu_name}
      />

      {/* Static hardware info */}
      <Section title={"硬件信息"}>
        <Row label={"地区"} value={regionToName(node.region)} />
        <Row label={"系统"} value={node.os || "—"} />
        <Row label={"架构"} value={node.arch || "—"} />
        <Row label={"CPU"} value={node.cpu_name || "—"} />
        <Row label={"核心数"} value={node.cpu_cores ? `${node.cpu_cores} 核` : "—"} />
        {node.gpu_name ? <Row label={"GPU"} value={node.gpu_name} /> : null}
        {node.virtualization ? <Row label={"虚拟化"} value={node.virtualization} /> : null}
        <Row label={"内存总量"} value={node.mem_total ? formatBytes(node.mem_total) : "—"} />
        <Row label={"磁盘总量"} value={node.disk_total ? formatBytes(node.disk_total) : "—"} />
        {node.version ? <Row label={"探针版本"} value={node.version} /> : null}
      </Section>

      {/* Server IP addresses (admin-only; long-press to copy) */}
      <IPSection uuid={uuid} region={node.region} instance={inst} />

      {/* Billing (only when meaningful) */}
      {node.price > 0 || expDays != null ? (
        <Section title={"计费信息"}>
          {node.price > 0 ? (
            <Row label={"价格"} value={formatPrice(node.price, node.billing_cycle)} />
          ) : null}
          {expDays != null ? (
            <Row
              label={"到期"}
              value={expDays >= 0 ? `${expDays} 天后` : `已过期 ${-expDays} 天`}
              tint={expDays < 7 ? "systemRed" : undefined}
            />
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

function HealthSection({ uuid }: { uuid: string }) {
  const monitor = useMonitor();
  const isOnline = monitor.online.value.has(uuid);
  const rec = monitor.records.value[uuid];
  const score = nodeHealthScore({ online: isOnline, rec });
  const reasons = nodeHealthReasons({ online: isOnline, rec });
  const tint = score >= 85 ? "systemGreen" : score >= 65 ? "systemYellow" : score >= 40 ? "systemOrange" : "systemRed";

  return (
    <Section title={"健康"}>
      <HStack>
        <Image systemName={"heart.text.square"} foregroundStyle={tint} />
        <Text font={"headline"}>{score}</Text>
        <Spacer />
        <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
          {reasons.length === 0 ? "状态正常" : `${reasons.length} 项扣分`}
        </Text>
      </HStack>
      {reasons.slice(0, 4).map((r) => (
        <HStack key={r.label}>
          <Text font={"caption"}>{r.label}</Text>
          <Spacer />
          <Text font={"caption"} foregroundStyle={"secondaryLabel"}>{r.detail}</Text>
          <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>{`-${r.penalty}`}</Text>
        </HStack>
      ))}
    </Section>
  );
}

/**
 * Live status banner + gauges + realtime dashboard. Reads the high-frequency
 * `online` / `records` observables HERE (not in Body) so only this small
 * subtree re-renders on each 2s live frame — the surrounding List keeps its
 * scroll position and child state.
 */
function LiveOverview({ uuid }: { uuid: string }) {
  const monitor = useMonitor();
  const isOnline = monitor.online.value.has(uuid);
  const rec = monitor.records.value[uuid];

  return (
    <>
      {/* Status banner */}
      <Section>
        <HStack>
          <Image
            systemName={isOnline ? "checkmark.circle.fill" : "wifi.slash"}
            foregroundStyle={isOnline ? "systemGreen" : "systemGray"}
          />
          <Text font={"headline"}>{isOnline ? "在线" : "离线"}</Text>
          <Spacer />
          {rec ? (
            <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
              更新 {formatClock(rec.updated_at)}
            </Text>
          ) : null}
        </HStack>
        {isOnline && rec ? (
          <HStack>
            <Image systemName={"clock.arrow.circlepath"} foregroundStyle={"secondaryLabel"} />
            <Text>运行时间</Text>
            <Spacer />
            <Text foregroundStyle={"secondaryLabel"}>{formatUptime(rec.uptime)}</Text>
          </HStack>
        ) : null}
        {isOnline && rec && rec.message ? (
          <Text font={"caption"} foregroundStyle={"systemOrange"}>
            {rec.message}
          </Text>
        ) : null}
      </Section>

      {/* Live gauges */}
      {isOnline && rec ? (
        <Section title={"实时负载"}>
          <HStack spacing={6} padding={{ vertical: 6 }}>
            <BigGauge
              label={"CPU"}
              r={percentToRatio(rec.cpu.usage)}
              caption={`${rec.cpu.usage.toFixed(1)}%`}
            />
            <BigGauge
              label={"内存"}
              r={ratio(rec.ram.used, rec.ram.total)}
              caption={formatPercent(rec.ram.used, rec.ram.total)}
            />
            <BigGauge
              label={"磁盘"}
              r={ratio(rec.disk.used, rec.disk.total)}
              caption={formatPercent(rec.disk.used, rec.disk.total)}
            />
            <BigGauge
              label={"交换"}
              r={ratio(rec.swap.used, rec.swap.total)}
              caption={
                rec.swap.total > 0 ? formatPercent(rec.swap.used, rec.swap.total) : "无"
              }
            />
          </HStack>
        </Section>
      ) : null}

      {/* Live data visual dashboard */}
      {isOnline && rec ? (
        <Section title={"实时数据"}>
          <HStack spacing={10} padding={{ vertical: 4 }} listRowSeparator={"hidden"}>
            <SpeedCard dir={"up"} speed={rec.network.up} total={rec.network.totalUp} />
            <SpeedCard dir={"down"} speed={rec.network.down} total={rec.network.totalDown} />
          </HStack>

          <UsageBar
            label={"CPU"}
            r={percentToRatio(rec.cpu.usage)}
            caption={`${rec.cpu.usage.toFixed(1)}%`}
            listRowSeparator={"hidden"}
          />
          <UsageBar
            label={"内存"}
            r={ratio(rec.ram.used, rec.ram.total)}
            caption={`${formatBytes(rec.ram.used)} / ${formatBytes(rec.ram.total)}`}
            listRowSeparator={"hidden"}
          />
          <UsageBar
            label={"磁盘"}
            r={ratio(rec.disk.used, rec.disk.total)}
            caption={`${formatBytes(rec.disk.used)} / ${formatBytes(rec.disk.total)}`}
            listRowSeparator={"hidden"}
          />
          {rec.swap.total > 0 ? (
            <UsageBar
              label={"交换"}
              r={ratio(rec.swap.used, rec.swap.total)}
              caption={`${formatBytes(rec.swap.used)} / ${formatBytes(rec.swap.total)}`}
              listRowSeparator={"hidden"}
            />
          ) : null}

          <HStack spacing={8} padding={{ vertical: 6 }} listRowSeparator={"hidden"}>
            <StatTile
              icon={"gauge.with.dots.needle.33percent"}
              label={"负载"}
              value={rec.load.load1.toFixed(2)}
              sub={`${rec.load.load5.toFixed(2)} · ${rec.load.load15.toFixed(2)}`}
              tint={"systemIndigo"}
            />
            <StatTile
              icon={"network"}
              label={"连接"}
              value={`${rec.connections.tcp + rec.connections.udp}`}
              sub={`TCP ${rec.connections.tcp} · UDP ${rec.connections.udp}`}
              tint={"systemTeal"}
            />
            <StatTile
              icon={"cpu"}
              label={"进程"}
              value={`${rec.process}`}
              sub={"运行中"}
              tint={"systemPurple"}
            />
          </HStack>

          {rec.gpu != null || rec.temp != null ? (
            <HStack spacing={8} padding={{ vertical: 6 }} listRowSeparator={"hidden"}>
              {rec.gpu != null ? (
                <StatTile
                  icon={"cpu.fill"}
                  label={"GPU"}
                  value={`${rec.gpu.toFixed(0)}%`}
                  sub={rec.gpus && rec.gpus.length > 0 ? rec.gpus[0].name : "使用率"}
                  tint={"systemPink"}
                />
              ) : null}
              {rec.temp != null ? (
                <StatTile
                  icon={"thermometer.medium"}
                  label={"温度"}
                  value={`${rec.temp.toFixed(0)}°C`}
                  sub={"峰值"}
                  tint={rec.temp >= 80 ? "systemRed" : rec.temp >= 65 ? "systemOrange" : "systemGreen"}
                />
              ) : null}
              {/* keep the row balanced when only one of the two is present */}
              {rec.gpu == null || rec.temp == null ? <Spacer /> : null}
            </HStack>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------------------
// Historical load charts — the six metrics shown on the node detail page.
// ----------------------------------------------------------------------------
function formatMetricValue(spec: LoadChartSpec, v: number): string {
  if (spec.percent) return `${v.toFixed(0)}%`;
  if (spec.type === "network") return formatSpeed(v);
  return v.toFixed(0);
}

function LoadChartSection({
  uuid,
  memTotal,
  diskTotal,
  gpuName,
}: {
  uuid: string;
  memTotal?: number;
  diskTotal?: number;
  gpuName?: string;
}) {
  const monitor = useMonitor();
  const [rangeIdx, setRangeIdx] = useState<number>(0); // default first range
  const [specIdx, setSpecIdx] = useState<number>(0); // default CPU
  const [loading, setLoading] = useState<boolean>(true);
  const [cacheLabel, setCacheLabel] = useState<string>("");
  const [marks, setMarks] = useState<LoadMark[]>([]);
  const [summaries, setSummaries] = useState<LoadSummary[]>([]);
  // GPU/temp availability captured ONCE from a live-record snapshot on mount,
  // plus the static gpu_name. Reading the snapshot in an effect (not in render)
  // means this component never subscribes to the 2s `records` frames.
  const [hasGpu, setHasGpu] = useState<boolean>(!!gpuName);
  const [hasTemp, setHasTemp] = useState<boolean>(false);

  useEffect(() => {
    const rec = monitor.records.value[uuid];
    if (rec?.gpu != null || gpuName) setHasGpu(true);
    if (rec?.temp != null) setHasTemp(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  const activeInst = getActiveInstance();
  const ranges = activeInst ? getBackend(activeInst.kind).caps.ranges : DEFAULT_RANGES;
  const charts = chartsForNode({ hasGpu, hasTemp });
  const spec = charts[specIdx] ?? charts[0];
  const hours = (ranges[rangeIdx] ?? ranges[0]).hours;

  useEffect(() => {
    let cancelled = false;
    const inst = getActiveInstance();
    if (!inst) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchLoadRecordsCachedMeta(inst, uuid, spec.type, hours, {
      mem: memTotal,
      disk: diskTotal,
    }).then((result) => {
      if (cancelled) return;
      const records = result.data;
      const m = buildLoadMarks(spec.type, records);
      setMarks(m);
      setSummaries(buildLoadSummaries(m));
      setCacheLabel(result.cached ? `缓存 ${Math.round(result.ageMs / 1000)} 秒` : "刚更新");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [uuid, spec.type, hours]);

  return (
    <Section
      title={"历史负载"}
      footer={
        <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
          来自探针历史记录（哪吒需启用 TSDB），按所选时间范围聚合。
          {cacheLabel ? ` · ${cacheLabel}` : ""}
        </Text>
      }
    >
      <Picker title={"指标"} value={specIdx} onChanged={setSpecIdx} pickerStyle={"menu"}>
        {charts.map((s, i) => (
          <Text key={s.type} tag={i}>
            {s.title}
          </Text>
        ))}
      </Picker>
      <Picker
        title={"时间范围"}
        value={rangeIdx}
        onChanged={setRangeIdx}
        pickerStyle={"segmented"}
      >
        {ranges.map((r, i) => (
          <Text key={`${r.hours}`} tag={i}>
            {r.label}
          </Text>
        ))}
      </Picker>

      {loading ? (
        <HStack padding={{ vertical: 10 }}>
          <ProgressView />
          <Text foregroundStyle={"secondaryLabel"}>加载中…</Text>
          <Spacer />
        </HStack>
      ) : marks.length === 0 ? (
        <VStack alignment={"leading"} spacing={4} padding={{ vertical: 10 }}>
          <HStack>
            <Image systemName={"chart.xyaxis.line"} foregroundStyle={"tertiaryLabel"} />
            <Text foregroundStyle={"secondaryLabel"}>暂无历史数据</Text>
            <Spacer />
          </HStack>
          {activeInst?.kind === "nezha" ? (
            <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
              哪吒需在面板「设置 → 监控」开启历史数据存储（TSDB），否则不返回历史曲线。
            </Text>
          ) : null}
        </VStack>
      ) : (
        <>
          <Chart frame={{ height: chartHeight() }} chartLegend={"bottom"}>
            <LineCategoryChart marks={marks} />
          </Chart>
          {summaries.map((s) => (
            <HStack key={s.category} spacing={8}>
              <Text lineLimit={1}>{s.category}</Text>
              <Spacer />
              <Text font={"caption"}>
                {`当前 ${formatMetricValue(spec, s.last)}`}
              </Text>
              <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
                {`峰值 ${formatMetricValue(spec, s.max)}`}
              </Text>
            </HStack>
          ))}
        </>
      )}
    </Section>
  );
}

// Fallback history windows when no active instance is resolvable. Each backend
// supplies its own ranges via caps.ranges (Komari: fractional hours; Nezha:
// 1d/7d/30d). The detail sections read caps.ranges and fall back to this.
const DEFAULT_RANGES: { label: string; hours: number }[] = [
  { label: "1天", hours: 24 },
  { label: "7天", hours: 168 },
  { label: "30天", hours: 720 },
];

function PingSection({ uuid }: { uuid: string }) {
  const monitor = useMonitor();
  const [rangeIdx, setRangeIdx] = useState<number>(0); // default first range
  const [statIdx, setStatIdx] = useState<number>(0); // 0=p50, 1=p95, 2=p99
  const [loading, setLoading] = useState<boolean>(true);
  const [cacheLabel, setCacheLabel] = useState<string>("");
  const [marks, setMarks] = useState<PingMark[]>([]);
  const [summaries, setSummaries] = useState<PingSummary[]>([]);
  const [losses, setLosses] = useState<PingLossSegment[]>([]);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [colorVersion, setColorVersion] = useState<number>(0);
  // Hidden task ids live in an Observable so that ONLY the views that read
  // `hiddenObs.value` (each row + the chart) re-render on toggle. The parent
  // PingSection deliberately never reads it, so toggling never rebuilds the
  // whole Section (which is what made rows vanish / fail to recover before).
  const hiddenObs = useObservable<number[]>([]);

  const activeInst = getActiveInstance();
  const ranges = activeInst ? getBackend(activeInst.kind).caps.ranges : DEFAULT_RANGES;
  const hours = (ranges[rangeIdx] ?? ranges[0]).hours;
  const statKey = statIdx === 0 ? "p50" : statIdx === 1 ? "p95" : "p99";

  useEffect(() => {
    let cancelled = false;
    const inst = getActiveInstance();
    if (!inst) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchPingRecordsCachedMeta(inst, uuid, hours).then((result) => {
      if (cancelled) return;
      const data = result.data;
      const overrides = loadPingColorOverrides(inst);
      const m = applyPingColorOverrides(buildPingMarks(data), overrides);
      const s = applyPingColorOverrides(buildPingSummaries(data), overrides);
      const colors: Record<number, string> = {};
      for (const row of s) colors[row.taskId] = row.color;
      setMarks(m);
      setSummaries(s);
      setLosses(buildPingLossSegments(data, colors));
      setCacheLabel(result.cached ? `缓存 ${Math.round(result.ageMs / 1000)} 秒` : "刚更新");
      const node = monitor.nodeIndex.value[uuid];
      if (node) notifyPingAnomalies(inst, node, s).catch(() => {});
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [uuid, hours, colorVersion]);

  function toggle(taskId: number) {
    const cur = hiddenObs.value;
    hiddenObs.setValue(
      cur.includes(taskId) ? cur.filter((id) => id !== taskId) : [...cur, taskId],
    );
  }

  function changeColor(taskId: number) {
    const inst = getActiveInstance();
    if (!inst) return;
    const current = loadPingColorOverrides(inst)[taskId];
    const idx = current ? PING_COLOR_PRESETS.indexOf(current) : -1;
    const next = PING_COLOR_PRESETS[(idx + 1) % PING_COLOR_PRESETS.length];
    setPingColorOverride(inst, taskId, next);
    setColorVersion(colorVersion + 1);
  }

  return (
    <Section
      title={"网络延迟"}
      footer={
        activeInst?.kind === "nezha" ? (
          <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
            哪吒数据来自当前节点关联的服务监控；丢包点显示在图下方。
            {cacheLabel ? ` · ${cacheLabel}` : ""}
          </Text>
        ) : cacheLabel ? <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>{cacheLabel}</Text> : undefined
      }
    >
      {/* Range selector */}
      <Picker
        title={"时间范围"}
        value={rangeIdx}
        onChanged={setRangeIdx}
        pickerStyle={"segmented"}
      >
        {ranges.map((r, i) => (
          <Text key={`${r.hours}`} tag={i}>
            {r.label}
          </Text>
        ))}
      </Picker>
      <Picker
        title={"分位"}
        value={statIdx}
        onChanged={setStatIdx}
        pickerStyle={"segmented"}
      >
        <Text tag={0}>p50</Text>
        <Text tag={1}>p95</Text>
        <Text tag={2}>p99</Text>
      </Picker>

      {loading ? (
        <HStack padding={{ vertical: 10 }}>
          <ProgressView />
          <Text foregroundStyle={"secondaryLabel"}>加载中…</Text>
          <Spacer />
        </HStack>
      ) : summaries.length === 0 ? (
        <VStack alignment={"leading"} spacing={4} padding={{ vertical: 10 }}>
          <HStack>
            <Image systemName={"chart.xyaxis.line"} foregroundStyle={"tertiaryLabel"} />
            <Text foregroundStyle={"secondaryLabel"}>暂无延迟数据</Text>
            <Spacer />
          </HStack>
          <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
            {activeInst?.kind === "nezha"
              ? "请检查哪吒服务监控是否关联该节点。"
              : "请检查 Komari Ping 任务是否启用并包含该节点。"}
          </Text>
        </VStack>
      ) : (
        <>
          {summaries.map((s) => (
            <PingSummaryRow
              key={`${s.taskId}`}
              s={s}
              statKey={statKey}
              highlighted={highlighted === s.taskId}
              muted={highlighted != null && highlighted !== s.taskId}
              hiddenObs={hiddenObs}
              onToggle={() => toggle(s.taskId)}
              onHighlight={() => setHighlighted(highlighted === s.taskId ? null : s.taskId)}
              onColor={() => changeColor(s.taskId)}
            />
          ))}
          <PingChart
            marks={marks}
            summaries={summaries}
            losses={losses}
            highlightedTaskId={highlighted}
            hiddenObs={hiddenObs}
          />
        </>
      )}
    </Section>
  );
}

/**
 * The latency line chart. Reads `hiddenObs.value` itself so it re-renders in
 * place when a line is toggled — without forcing the parent Section (and its
 * summary rows) to rebuild.
 */
function PingChart({
  marks,
  summaries,
  losses,
  highlightedTaskId,
  hiddenObs,
}: {
  marks: PingMark[];
  summaries: PingSummary[];
  losses: PingLossSegment[];
  highlightedTaskId: number | null;
  hiddenObs: Obs<number[]>;
}) {
  const hidden = hiddenObs.value;
  const allHidden = areAllPingLinesHidden(summaries, hidden);
  if (allHidden) {
    return (
      <HStack padding={{ vertical: 20 }}>
        <Spacer />
        <Text font={"caption"} foregroundStyle={"tertiaryLabel"}>
          全部线路已隐藏
        </Text>
        <Spacer />
      </HStack>
    );
  }
  // Render each latency line as its own LineChart with a fixed per-mark
  // foregroundStyle. LineCategoryChart can reassign category colours when
  // visible categories change, which makes lines drift after toggling.
  const visibleSummaries = summaries.filter((s) => !hidden.includes(s.taskId));
  return (
    <>
      <Chart frame={{ height: chartHeight() }} chartLegend={"hidden"}>
        {visibleSummaries.map((s) => {
          const muted = highlightedTaskId != null && highlightedTaskId !== s.taskId;
          return (
            <LineChart
              key={`${s.taskId}`}
              marks={marks
                .filter((m) => m.taskId === s.taskId)
                .map((m) => ({
                  label: m.label,
                  value: m.value,
                  foregroundStyle: s.color,
                  opacity: muted ? 0.24 : 1,
                }))}
            />
          );
        })}
      </Chart>
      <PingLossStrip losses={losses.filter((l) => !hidden.includes(l.taskId))} highlightedTaskId={highlightedTaskId} />
    </>
  );
}

function PingLossStrip({
  losses,
  highlightedTaskId,
}: {
  losses: PingLossSegment[];
  highlightedTaskId: number | null;
}) {
  const shown = losses.slice(-28);
  if (shown.length === 0) return null;
  return (
    <HStack spacing={4} padding={{ top: 2, bottom: 6 }}>
      <Image systemName={"bolt.slash"} font={"caption2"} foregroundStyle={"tertiaryLabel"} />
      {shown.map((loss, i) => (
        <VStack
          key={`${loss.taskId}-${loss.time.getTime()}-${i}`}
          frame={{ width: 7, height: 7 }}
          background={loss.color}
          opacity={highlightedTaskId != null && highlightedTaskId !== loss.taskId ? 0.25 : 0.9}
          clipShape={{ type: "circle" }}
        />
      ))}
      <Spacer />
      <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
        {`${losses.length} 个丢包点`}
      </Text>
    </HStack>
  );
}

function PingSummaryRow({
  s,
  statKey,
  highlighted,
  muted,
  hiddenObs,
  onToggle,
  onHighlight,
  onColor,
}: {
  s: PingSummary;
  statKey: "p50" | "p95" | "p99";
  highlighted: boolean;
  muted: boolean;
  hiddenObs: Obs<number[]>;
  onToggle: () => void;
  onHighlight: () => void;
  onColor: () => void;
}) {
  // Read the observable HERE so this row re-renders in place on toggle,
  // without the parent Section rebuilding every row.
  const hidden = hiddenObs.value.includes(s.taskId);
  const dim = hidden ? 0.35 : muted ? 0.45 : 1;
  const statValue = statKey === "p50" ? s.p50 : statKey === "p95" ? s.p95 : s.p99;
  return (
    <HStack
      spacing={10}
      listRowInsets={{ top: 5, bottom: 5, leading: 16, trailing: 16 }}
      background={highlighted ? "tertiarySystemFill" : undefined}
      clipShape={{ type: "rect", cornerRadius: 10 }}
      onTapGesture={onHighlight}
    >
      <Button action={onColor}>
        <VStack
          frame={{ width: 8, height: 30 }}
          background={s.color}
          clipShape={{ type: "capsule" }}
          opacity={dim}
        />
      </Button>
      <VStack alignment={"leading"} spacing={1} opacity={dim}>
        <Text font={"subheadline"} fontWeight={"semibold"} lineLimit={1}>
          {s.name}
        </Text>
        <HStack spacing={6}>
          <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
            {s.last != null ? `${s.last.toFixed(0)} ms` : "—"}
          </Text>
          <Text
            font={"caption2"}
            foregroundStyle={s.loss > 0 ? "systemRed" : "secondaryLabel"}
          >
            {`${(s.loss * 100).toFixed(1)}% loss`}
          </Text>
        </HStack>
      </VStack>
      <Spacer />
      <VStack alignment={"trailing"} spacing={1} opacity={dim}>
        <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
          {`${statKey} ${statValue.toFixed(0)} ms`}
        </Text>
        <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
          {`p50 ${s.p50.toFixed(0)} / p99 ${s.p99.toFixed(0)}`}
        </Text>
      </VStack>
      <Button action={onToggle}>
        <Image
          systemName={hidden ? "eye.slash" : "eye"}
          font={"footnote"}
          foregroundStyle={hidden ? "tertiaryLabel" : "secondaryLabel"}
        />
      </Button>
    </HStack>
  );
}

// A prominent network-speed card: big arrow + speed, total below.
function SpeedCard({
  dir,
  speed,
  total,
}: {
  dir: "up" | "down";
  speed: number;
  total: number;
}) {
  const isUp = dir === "up";
  const tint = isUp ? "systemGreen" : "systemBlue";
  return (
    <VStack alignment={"leading"} spacing={2} padding={8} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={4}>
        <Image systemName={isUp ? "arrow.up" : "arrow.down"} font={12} foregroundStyle={tint} />
        <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
          {isUp ? "上行" : "下行"}
        </Text>
      </HStack>
      <Text font={"title3"} foregroundStyle={tint} lineLimit={1}>
        {formatSpeed(speed)}
      </Text>
      <Text font={"caption2"} foregroundStyle={"tertiaryLabel"} lineLimit={1}>
        累计 {formatBytes(total)}
      </Text>
    </VStack>
  );
}

// A labelled usage row with an inline progress bar.
function UsageBar({
  label,
  r,
  caption,
  listRowSeparator,
}: {
  label: string;
  r: number;
  caption: string;
  listRowSeparator?: "hidden" | "visible" | "automatic";
}) {
  const safeR = isNaN(r) || r < 0 ? 0 : r > 1 ? 1 : r;
  return (
    <VStack
      alignment={"leading"}
      spacing={4}
      padding={{ vertical: 4 }}
      listRowSeparator={listRowSeparator}
    >
      <HStack>
        <Text font={"subheadline"}>{label}</Text>
        <Spacer />
        <Text font={"caption"} foregroundStyle={"secondaryLabel"} lineLimit={1}>
          {caption}
        </Text>
      </HStack>
      <ProgressView value={safeR} total={1} progressViewStyle={"linear"} />
    </VStack>
  );
}

// A compact stat tile: icon + big value + sub-caption.
function StatTile({
  icon,
  label,
  value,
  sub,
  tint,
}: {
  icon: string;
  label: string;
  value: string;
  sub: string;
  tint: string;
}) {
  return (
    <VStack spacing={2} padding={8} frame={{ maxWidth: "infinity" }}>
      <Image systemName={icon} font={14} foregroundStyle={tint} />
      <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
        {label}
      </Text>
      <Text font={"headline"} lineLimit={1}>
        {value}
      </Text>
      <Text font={"caption2"} foregroundStyle={"tertiaryLabel"} lineLimit={1}>
        {sub}
      </Text>
    </VStack>
  );
}

function BigGauge({ label, r, caption }: { label: string; r: number; caption: string }) {
  const safeR = isNaN(r) || r < 0 ? 0 : r > 1 ? 1 : r;
  return (
    <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
      <Gauge
        value={safeR}
        min={0}
        max={1}
        label={<Text font={"caption2"}>{label}</Text>}
        gaugeStyle={"accessoryCircularCapacity"}
        tint={loadTint(safeR)}
        currentValueLabel={<Text font={"caption"}>{caption}</Text>}
      />
      <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
        {label}
      </Text>
    </VStack>
  );
}

/**
 * Server IP card. Nezha redacts the geoip block for non-owners, so real
 * IPv4/IPv6 only come back when the instance is authenticated as the owner /
 * an admin AND the server actually reports an address. Long-press an IP row to
 * copy it (system context menu).
 */
function IPSection({
  uuid,
  region,
  instance,
}: {
  uuid: string;
  region: string;
  instance: Instance | null;
}) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!instance) {
        setDetail(null);
        return;
      }
      const d = await fetchClientDetail(instance, uuid);
      if (!cancelled) setDetail(d);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [uuid, instance]);

  const ipv4 = detail?.ipv4;
  const ipv6 = detail?.ipv6;
  if (!ipv4 && !ipv6) return <></>;

  const flag = codeToFlag(regionToCode(region));

  return (
    <Section
      title={"IP 地址"}
      footer={
        <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
          长按 IP 可复制
        </Text>
      }
    >
      {ipv4 ? <IPRow kind={"IPv4"} value={ipv4} flag={flag} /> : null}
      {ipv6 ? <IPRow kind={"IPv6"} value={ipv6} flag={flag} /> : null}
    </Section>
  );
}

function IPRow({ kind, value, flag }: { kind: string; value: string; flag: string }) {
  return (
    <HStack
      spacing={10}
      padding={{ vertical: 4 }}
      contextMenu={{
        menuItems: (
          <Group>
            <Button
              title={`复制 ${kind}`}
              systemImage={"doc.on.doc"}
              action={() => {
                Pasteboard.setString(value);
              }}
            />
          </Group>
        ),
      }}
    >
      <Text
        font={"caption2"}
        foregroundStyle={"white"}
        padding={{ horizontal: 8, vertical: 3 }}
        background={"systemBlue"}
        clipShape={{ type: "capsule" }}
      >
        {kind}
      </Text>
      <Text font={"callout"} fontDesign={"monospaced"} foregroundStyle={"label"} lineLimit={1}>
        {value}
      </Text>
      <Spacer />
      {flag ? <Text font={"callout"}>{flag}</Text> : null}
    </HStack>
  );
}

function Row({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <HStack>
      <Text foregroundStyle={"secondaryLabel"}>{label}</Text>
      <Spacer />
      <Text foregroundStyle={tint ?? "label"} lineLimit={1}>
        {value}
      </Text>
    </HStack>
  );
}
