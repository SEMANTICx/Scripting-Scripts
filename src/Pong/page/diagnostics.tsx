// ============================================================================
// Probe diagnostics page — read-only health checks for one saved instance.
// ============================================================================
import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Pasteboard,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting";
import type { Instance } from "../class/types";
import { runInstanceDiagnostics } from "../class/diagnostics";
import type { DiagnosticItem, DiagnosticStatus } from "../class/diagnostics";

function iconFor(status: DiagnosticStatus): { name: string; color: string } {
  switch (status) {
    case "ok":
      return { name: "checkmark.circle.fill", color: "systemGreen" };
    case "warn":
      return { name: "exclamationmark.triangle.fill", color: "systemOrange" };
    case "error":
      return { name: "xmark.octagon.fill", color: "systemRed" };
    case "skip":
      return { name: "minus.circle", color: "systemGray" };
  }
}

function statusText(status: DiagnosticStatus): string {
  switch (status) {
    case "ok": return "正常";
    case "warn": return "注意";
    case "error": return "失败";
    case "skip": return "跳过";
  }
}

function summaryFor(items: DiagnosticItem[]): { title: string; detail: string; status: DiagnosticStatus } {
  if (items.length === 0 || items.some((item) => item.id === "running")) {
    return { title: "正在检查", detail: "正在读取探针接口状态", status: "skip" };
  }
  const errors = items.filter((item) => item.status === "error").length;
  const warnings = items.filter((item) => item.status === "warn").length;
  const ok = items.filter((item) => item.status === "ok").length;
  const skipped = items.filter((item) => item.status === "skip").length;
  if (errors > 0) {
    return { title: "发现阻断项", detail: `${errors} 失败 · ${warnings} 注意 · ${ok} 正常`, status: "error" };
  }
  if (warnings > 0) {
    return { title: "可连接，需确认", detail: `${warnings} 注意 · ${ok} 正常 · ${skipped} 跳过`, status: "warn" };
  }
  return { title: "状态正常", detail: `${ok} 项检查通过`, status: "ok" };
}

function SummaryPanel({ items, running }: { items: DiagnosticItem[]; running: boolean }) {
  const summary = running ? { title: "正在检查", detail: "正在读取探针接口状态", status: "skip" as DiagnosticStatus } : summaryFor(items);
  const icon = iconFor(summary.status);
  return (
    <HStack
      spacing={12}
      padding={{ vertical: 14, horizontal: 14 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      glassEffect={safeGlassEffect(22)}
      background={"secondarySystemGroupedBackground"}
      clipShape={{ type: "rect", cornerRadius: 22 }}
      shadow={{ color: "rgba(0,0,0,0.10)", radius: 10, x: 0, y: 4 }}
    >
      <VStack
        frame={{ width: 38, height: 38 }}
        background={icon.color}
        clipShape={{ type: "circle" }}
      >
        <Spacer />
        <Image systemName={icon.name} foregroundStyle={"white"} />
        <Spacer />
      </VStack>
      <VStack alignment={"leading"} spacing={3}>
        <Text font={"headline"} fontWeight={"semibold"}>
          {summary.title}
        </Text>
        <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
          {summary.detail}
        </Text>
      </VStack>
      <Spacer />
    </HStack>
  );
}

function DiagnosticRow({ item }: { item: DiagnosticItem }) {
  const icon = iconFor(item.status);
  return (
    <HStack
      spacing={10}
      padding={{ vertical: 12, horizontal: 12 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      glassEffect={safeGlassEffect(18)}
      background={"secondarySystemGroupedBackground"}
      clipShape={{ type: "rect", cornerRadius: 18 }}
    >
      <VStack
        frame={{ width: 28, height: 28 }}
        background={icon.color}
        clipShape={{ type: "circle" }}
      >
        <Spacer />
        <Image systemName={icon.name} foregroundStyle={"white"} font={"caption"} />
        <Spacer />
      </VStack>
      <VStack alignment={"leading"} spacing={2}>
        <HStack spacing={6}>
          <Text font={"subheadline"} fontWeight={"semibold"} lineLimit={1}>
            {item.title}
          </Text>
          <Text font={"caption"} foregroundStyle={icon.color}>
            {statusText(item.status)}
          </Text>
        </HStack>
        <Text font={"caption"} foregroundStyle={"secondaryLabel"} lineLimit={2}>
          {item.detail}
        </Text>
      </VStack>
      <Spacer />
      {item.elapsedMs != null ? (
        <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
          {item.elapsedMs}ms
        </Text>
      ) : null}
    </HStack>
  );
}

function safeGlassEffect(cornerRadius: number): any {
  try {
    if (typeof UIGlass === "undefined") return undefined;
    return { glass: UIGlass.regular(), shape: { type: "rect", cornerRadius } };
  } catch {
    return undefined;
  }
}

function reportText(instance: Instance, items: DiagnosticItem[]): string {
  return [
    `探针诊断：${instance.name}`,
    `地址：${instance.baseUrl}`,
    `类型：${instance.kind}`,
    "",
    ...items
      .filter((item) => item.id !== "running")
      .map((item) => `- ${item.title}: ${statusText(item.status)} · ${item.detail}${item.elapsedMs != null ? ` (${item.elapsedMs}ms)` : ""}`),
  ].join("\n");
}

export function View({ instance }: { instance: Instance }) {
  const dismiss = Navigation.useDismiss();
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [running, setRunning] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  async function refresh() {
    setRunning(true);
    setItems([
      {
        id: "running",
        title: "正在诊断",
        status: "skip",
        detail: "正在执行只读 API 检查",
      },
    ]);
    const result = await runInstanceDiagnostics(instance);
    setItems(result);
    setCopied(false);
    setRunning(false);
  }

  function copyReport() {
    Pasteboard.setString(reportText(instance, items));
    setCopied(true);
  }

  useEffect(() => { refresh(); }, []);

  return (
    <NavigationStack>
      <List
        navigationTitle={"诊断"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          cancellationAction: [<Button title={"关闭"} action={dismiss} />],
          topBarTrailing: [
            <Button
              title={"复制"}
              systemImage={"doc.on.doc"}
              action={copyReport}
              disabled={running || items.length === 0}
            />,
            <Button
              title={"刷新"}
              systemImage={"arrow.clockwise"}
              action={refresh}
              disabled={running}
            />,
          ],
        }}
      >
        <Section
          header={<Text>{instance.name}</Text>}
          footer={<Text>{copied ? "诊断报告已复制。" : "只读检查连接、认证、节点、历史和服务监控接口。"}</Text>}
        >
          <SummaryPanel items={items} running={running} />
          {items.map((item) => (
            <DiagnosticRow key={item.id} item={item} />
          ))}
        </Section>
      </List>
    </NavigationStack>
  );
}
