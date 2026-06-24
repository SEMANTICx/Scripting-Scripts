// ============================================================================
// Node list page — search + category filtering + custom groups.
// S: Single Purpose — list presentation, filtering, navigation.
// P: filtering logic lives in class/filter.ts; groups in class/groups.ts.
// ============================================================================
import {
  Button,
  Group,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  ScrollView,
  Spacer,
  Text,
  VStack,
  useState,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import {
  formatSpeed,
  formatUptime,
  formatBytes,
} from "../class/format";
import { regionToName } from "../class/geo";
import { getBackend } from "../class/server";
import { nodeHealthScore, nodeHealthSummary } from "../class/health";
import {
  buildCategories,
  applyFilter,
  parseTags,
} from "../class/filter";
import type { Category } from "../class/filter";
import { loadGroups, toggleMember } from "../class/groups";

export function View({
  uuids,
  title,
}: {
  uuids?: string[];
  title?: string;
} = {}) {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const inst = monitor.instance.value;
  const showServices = inst ? getBackend(inst.kind).caps.hasServiceOverview : false;
  const [query, setQuery] = useState<string>("");
  const [catId, setCatId] = useState<string>("all");
  const [sortMode, setSortMode] = useState<number>(0);

  const all = monitor.nodes.value;
  const scoped = uuids != null;
  const online = monitor.online.value;
  const records = monitor.records.value;
  const customGroups = loadGroups();

  // The category/filter/sort pipeline is pure over (nodes, online, query,
  // catId, groups). Memoize it so the 2s live-record frames — which change
  // `records` but not these inputs — don't rerun the whole pipeline. `online`
  // now has a stable reference across frames (gated in Monitor.onData), so this
  // recomputes only on real membership / query / category / group changes.
  const nodes = uuids ? all.filter((n) => uuids.includes(n.uuid)) : all;
  const categories = buildCategories(nodes, online, customGroups);
  const activeCat: Category =
    categories.find((c) => c.id === catId) ?? categories[0];
  const ordered = applyFilter(nodes, query, activeCat, online, customGroups)
    .slice()
    .sort((a, b) => {
      if (sortMode === 1) {
        const sb = Math.floor(nodeHealthScore({ online: online.has(b.uuid), rec: records[b.uuid] }) / 10);
        const sa = Math.floor(nodeHealthScore({ online: online.has(a.uuid), rec: records[a.uuid] }) / 10);
        if (sb !== sa) return sb - sa;
      }
      return Number(online.has(b.uuid)) - Number(online.has(a.uuid));
    });

  async function openServices() {
    const mod = await import("./services");
    const ServicesView = mod.View;
    await Navigation.present({
      element: <ServicesView />,
    });
  }

  async function openGroups() {
    const mod = await import("./groups");
    const GroupsView = mod.View;
    await Navigation.present({
      element: <GroupsView />,
    });
  }

  async function openSettings() {
    const mod = await import("./settings");
    const SettingsView = mod.View;
    await Navigation.present({
      element: <SettingsView />,
    });
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={title ?? "节点列表"}
        navigationBarTitleDisplayMode={"inline"}
        listStyle={"plain"}
        searchable={{
          value: query,
          onChanged: setQuery,
          placement: "navigationBarDrawer",
          prompt: "搜索名称 / 地区 / 分组 / 标签",
        }}
        refreshable={async () => {
          await monitor.reload();
        }}
        toolbar={{
          cancellationAction: [
            <Button title={"关闭"} systemImage={"xmark"} action={dismiss} />,
          ],
          topBarTrailing: scoped
            ? []
            : [
                ...(showServices
                  ? [
                      <Button
                        action={openServices}
                      >
                        <Image systemName={"checkmark.shield"} />
                      </Button>,
                    ]
                  : []),
                <Button
                  action={openGroups}
                >
                  <Image systemName={"folder.badge.gearshape"} />
                </Button>,
                <Button
                  action={openSettings}
                >
                  <Image systemName={"gearshape"} />
                </Button>,
              ],
        }}
      >
        {monitor.instance.value == null ? (
          <EmptyState onConfigure={openSettings} />
        ) : monitor.error.value && nodes.length === 0 ? (
          <Text foregroundStyle={"systemRed"}>{monitor.error.value}</Text>
        ) : (
          <>
            <CategoryBar
              categories={categories}
              activeId={activeCat.id}
              onSelect={setCatId}
            />

            <Picker
              title={"排序"}
              value={sortMode}
              onChanged={setSortMode}
              pickerStyle={"segmented"}
              listRowSeparator={"hidden"}
              listRowInsets={{ top: 2, bottom: 2, leading: 16, trailing: 16 }}
            >
              <Text tag={0}>在线</Text>
              <Text tag={1}>健康</Text>
            </Picker>

            <Text
              font={"caption"}
              foregroundStyle={"secondaryLabel"}
              listRowSeparator={"hidden"}
              listRowInsets={{ top: 2, bottom: 2, leading: 18, trailing: 16 }}
            >
              {activeCat.id === "all" ? "共" : `${activeCat.label} ·`} {ordered.length} 个节点
              {query ? ` · 匹配“${query}”` : ""}
            </Text>

            {ordered.length === 0 ? (
              <HStack padding={{ vertical: 20 }} listRowSeparator={"hidden"}>
                <Spacer />
                <Text foregroundStyle={"tertiaryLabel"}>没有匹配的节点</Text>
                <Spacer />
              </HStack>
            ) : (
              ordered.map((node) => (
                <NodeRow key={node.uuid} uuid={node.uuid} />
              ))
            )}
          </>
        )}
      </List>
    </NavigationStack>
  );
}

function CategoryBar({
  categories,
  activeId,
  onSelect,
}: {
  categories: Category[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView
      axes={"horizontal"}
      showsIndicators={false}
      listRowSeparator={"hidden"}
      listRowInsets={{ top: 6, bottom: 4, leading: 16, trailing: 16 }}
    >
      <HStack spacing={8}>
        {categories.map((c) => (
          <Chip
            key={c.id}
            label={c.label}
            count={c.count}
            active={c.id === activeId}
            onTap={() => onSelect(c.id)}
          />
        ))}
      </HStack>
    </ScrollView>
  );
}

function Chip({
  label,
  count,
  active,
  onTap,
}: {
  label: string;
  count: number;
  active: boolean;
  onTap: () => void;
}) {
  return (
    <Button action={onTap}>
      <HStack
        spacing={5}
        padding={{ horizontal: 13, vertical: 7 }}
        background={active ? "systemBlue" : "secondarySystemFill"}
        clipShape={{ type: "capsule" }}
      >
        <Text
          font={"subheadline"}
          fontWeight={active ? "semibold" : "regular"}
          foregroundStyle={active ? "white" : "label"}
          lineLimit={1}
        >
          {label}
        </Text>
        <Text
          font={"caption2"}
          fontWeight={"medium"}
          foregroundStyle={active ? "white" : "secondaryLabel"}
          opacity={active ? 0.85 : 1}
        >
          {count}
        </Text>
      </HStack>
    </Button>
  );
}

function EmptyState({ onConfigure }: { onConfigure: () => void }) {
  return (
    <VStack spacing={12} padding={20} frame={{ maxWidth: "infinity" }}>
      <Image systemName={"antenna.radiowaves.left.and.right"} frame={{ width: 60, height: 60 }} foregroundStyle={"systemGreen"} />
      <Text font={"headline"}>尚未配置探针</Text>
      <Text font={"footnote"} foregroundStyle={"secondaryLabel"} multilineTextAlignment={"center"}>
        添加你的探针面板地址后即可查看节点的实时状态与地理分布。
      </Text>
      <Button action={onConfigure} buttonStyle={"borderedProminent"}>
        <HStack spacing={4}>
          <Image systemName={"plus"} foregroundStyle={"white"} />
          <Text foregroundStyle={"white"}>前往设置</Text>
        </HStack>
      </Button>
    </VStack>
  );
}

function NodeRow({ uuid }: { uuid: string }) {
  const monitor = useMonitor();

  const node = monitor.nodeIndex.value[uuid];
  if (!node) return <></>;

  async function openDetail() {
    const mod = await import("./detail");
    const DetailView = mod.View;
    await Navigation.present({
      element: <DetailView uuid={uuid} />,
    });
  }

  const isOnline = monitor.online.value.has(uuid);
  const rec = monitor.records.value[uuid];
  const health = nodeHealthSummary(isOnline, rec);
  const dotColor = health.tint;
  const series = monitor.history.value[uuid] || [];
  const groups = loadGroups();
  const tags = parseTags(node.tags);

  return (
    <Button
      listRowSeparator={"hidden"}
      listRowInsets={{ top: 6, bottom: 6, leading: 16, trailing: 16 }}
      action={openDetail}
      contextMenu={{
        menuItems: (
          <Group>
            {groups.length === 0 ? (
              <Button title={"暂无自定义分组"} action={() => {}} />
            ) : (
              groups.map((g) => (
                <Button
                  key={g.id}
                  title={`${g.uuids.includes(uuid) ? "✓ " : ""}${g.name}`}
                  action={() => {
                    toggleMember(g.id, uuid);
                    monitor.reload();
                  }}
                />
              ))
            )}
          </Group>
        ),
      }}
    >
      <VStack
        alignment={"leading"}
        spacing={10}
        padding={14}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        background={"secondarySystemGroupedBackground"}
        clipShape={{ type: "rect", cornerRadius: 20 }}
      >
        <HStack spacing={9}>
          <VStack
            frame={{ width: 9, height: 9 }}
            background={dotColor}
            clipShape={{ type: "circle" }}
          />
          <Text font={"headline"} fontWeight={"semibold"} lineLimit={1}>
            {node.name}
          </Text>
          <Spacer />
          <HealthCaption health={health} uptime={rec?.uptime || 0} />
        </HStack>

        {node.group || tags.length > 0 ? (
          <HStack spacing={6}>
            {node.group ? <Badge text={node.group} tint={"systemIndigo"} /> : null}
            {tags.map((t) => (
              <Badge key={t} text={`#${t}`} tint={"systemGray"} />
            ))}
            <Spacer />
          </HStack>
        ) : null}

        {/* CPU / RAM live readouts */}
        <HStack spacing={8}>
          <MiniStat
            label={"CPU"}
            value={rec ? `${(rec.cpu?.usage ?? 0).toFixed(0)}%` : "—"}
            r={rec ? (rec.cpu?.usage ?? 0) / 100 : 0}
            online={isOnline}
          />
          <MiniStat
            label={"内存"}
            value={
              rec && rec.ram?.total
                ? `${(((rec.ram.used ?? 0) / rec.ram.total) * 100).toFixed(0)}%`
                : "—"
            }
            r={rec && rec.ram?.total ? (rec.ram.used ?? 0) / rec.ram.total : 0}
            online={isOnline}
          />
        </HStack>

        <Sparkline data={series} online={isOnline} fallbackTint={dotColor} />

        <HStack spacing={12}>
          <HStack spacing={3}>
            <Image systemName={"globe.asia.australia"} font={"caption2"} foregroundStyle={"tertiaryLabel"} />
            <Text font={"caption2"} foregroundStyle={"secondaryLabel"} lineLimit={1}>
              {regionToName(node.region)}
            </Text>
          </HStack>
          <Spacer />
          {isOnline && rec ? (
            <>
              <Text font={"caption2"} foregroundStyle={"systemGreen"} lineLimit={1}>
                ↑ {formatSpeed(rec.network.up)}
              </Text>
              <Text font={"caption2"} foregroundStyle={"systemBlue"} lineLimit={1}>
                ↓ {formatSpeed(rec.network.down)}
              </Text>
            </>
          ) : (
            <Text font={"caption2"} foregroundStyle={"tertiaryLabel"} lineLimit={1}>
              {rec ? formatBytes(rec.network.totalUp + rec.network.totalDown) : "—"}
            </Text>
          )}
        </HStack>
      </VStack>
    </Button>
  );
}

function HealthCaption({
  health,
  uptime,
}: {
  health: ReturnType<typeof nodeHealthSummary>;
  uptime: number;
}) {
  const showUptime = health.level === "normal" && uptime > 0;
  const text = showUptime
    ? formatUptime(uptime)
    : uptime > 0 && (health.level === "elevated" || health.level === "busy")
      ? `${health.label} · ${formatUptime(uptime)}`
      : health.label;
  return (
    <HStack spacing={4}>
      {health.icon && health.level !== "normal" ? (
        <Image systemName={health.icon} font={"caption2"} foregroundStyle={health.tint} />
      ) : null}
      <Text font={"caption2"} foregroundStyle={health.tint} fontWeight={"medium"} lineLimit={1}>
        {text}
      </Text>
      {health.level === "normal" ? (
        <Text font={"caption2"} foregroundStyle={"tertiaryLabel"} lineLimit={1}>
          {health.score}
        </Text>
      ) : null}
    </HStack>
  );
}

function Badge({ text, tint }: { text: string; tint: string }) {
  return (
    <Text
      font={"caption2"}
      foregroundStyle={"white"}
      padding={{ horizontal: 7, vertical: 2 }}
      background={tint}
      clipShape={{ type: "capsule" }}
      lineLimit={1}
    >
      {text}
    </Text>
  );
}

/** Compact CPU/RAM readout chip. */
function MiniStat({
  label,
  value,
  r,
  online,
}: {
  label: string;
  value: string;
  r: number;
  online: boolean;
}) {
  const ratio = isNaN(r) ? 0 : Math.max(0, Math.min(1, r));
  const tint = !online ? "tertiaryLabel" : loadColor(ratio);
  return (
    <HStack
      spacing={6}
      padding={{ horizontal: 12, vertical: 9 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={"tertiarySystemFill"}
      clipShape={{ type: "rect", cornerRadius: 14 }}
    >
      <VStack
        frame={{ width: 6, height: 6 }}
        background={tint}
        clipShape={{ type: "circle" }}
      />
      <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
        {label}
      </Text>
      <Spacer />
      <Text font={"subheadline"} fontWeight={"semibold"} foregroundStyle={online ? "label" : "tertiaryLabel"}>
        {value}
      </Text>
    </HStack>
  );
}

/**
 * Variable-height sparkline of recent CPU load. Each bar's HEIGHT reflects the
 * sample value (so a real curve is visible immediately), and its colour tracks
 * load severity. Falls back to a flat idle pattern before history seeds.
 */
function Sparkline({
  data,
  online,
  fallbackTint,
}: {
  data: number[];
  online: boolean;
  fallbackTint: string;
}) {
  const MAXBARS = 36;
  const BARW = 5;
  const MAXH = 32;
  const MINH = 3;
  const seeded = data.length >= 6;
  const pts = seeded
    ? data.slice(-MAXBARS)
    : new Array(MAXBARS).fill(0).map((_, i) => idleSparkValue(i));

  return (
    <HStack spacing={3} alignment={"bottom"} frame={{ height: MAXH, maxWidth: "infinity", alignment: "leading" }}>
      {pts.map((v, i) => {
        const r = isNaN(v) ? 0 : Math.max(0, Math.min(1, v));
        const h = MINH + (MAXH - MINH) * r;
        return (
          <VStack
            key={`${i}`}
            frame={{ width: BARW, height: h }}
            background={seeded && online ? loadColor(r) : fallbackTint}
            opacity={seeded ? 0.92 : 0.3}
            clipShape={{ type: "capsule" }}
          />
        );
      })}
    </HStack>
  );
}

function idleSparkValue(index: number): number {
  return 0.065 + ((index * 7) % 5) * 0.008;
}

function loadColor(r: number): string {
  if (isNaN(r)) return "systemGray";
  if (r >= 0.9) return "systemRed";
  if (r >= 0.7) return "systemOrange";
  if (r >= 0.4) return "systemYellow";
  return "systemGreen";
}
