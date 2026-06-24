// ============================================================================
// Local alert preferences — device-local notification thresholds.
// ============================================================================
import {
  Button,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  Toggle,
  useState,
} from "scripting";
import { DEFAULT_ALERT_PREFS, type AlertPrefs } from "../class/alert_rules";
import { loadAlertPrefs, normalizeAlertPrefs, saveAlertPrefs } from "../class/alert_prefs";

function NumberField({
  title,
  value,
  onChanged,
  suffix,
}: {
  title: string;
  value: number;
  onChanged: (v: number) => void;
  suffix: string;
}) {
  return (
    <TextField
      title={title}
      prompt={suffix}
      value={`${value}`}
      onChanged={(v) => {
        const n = Number(v);
        if (isFinite(n)) onChanged(n);
      }}
    />
  );
}

export function View() {
  const dismiss = Navigation.useDismiss();
  const [prefs, setPrefs] = useState<AlertPrefs>(loadAlertPrefs());
  const [saved, setSaved] = useState<string>("");

  function update(patch: Partial<AlertPrefs>) {
    setPrefs(normalizeAlertPrefs({ ...prefs, ...patch }));
    setSaved("");
  }

  function save() {
    saveAlertPrefs(prefs);
    setSaved("已保存");
  }

  function reset() {
    setPrefs(DEFAULT_ALERT_PREFS);
    setSaved("");
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={"本地提醒"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          cancellationAction: [<Button title={"关闭"} action={dismiss} />],
          confirmationAction: [<Button title={"保存"} action={save} />],
        }}
      >
        <Section
          footer={<Text>{saved || "仅在本机调度通知，不会写入 Komari 或哪吒面板。"}</Text>}
        >
          <Toggle title={"启用本地提醒"} value={prefs.enabled} onChanged={(enabled) => update({ enabled })} />
        </Section>

        <Section header={<Text>阈值</Text>}>
          <NumberField title={"离线超过"} value={prefs.offlineMinutes} suffix={"分钟"} onChanged={(offlineMinutes) => update({ offlineMinutes })} />
          <NumberField title={"丢包超过"} value={prefs.lossPercent} suffix={"%"} onChanged={(lossPercent) => update({ lossPercent })} />
          <NumberField title={"p95 延迟超过"} value={prefs.latencyMs} suffix={"ms"} onChanged={(latencyMs) => update({ latencyMs })} />
          <NumberField title={"磁盘超过"} value={prefs.diskPercent} suffix={"%"} onChanged={(diskPercent) => update({ diskPercent })} />
          <NumberField title={"流量突增超过"} value={prefs.trafficMBps} suffix={"MB/s"} onChanged={(trafficMBps) => update({ trafficMBps })} />
          <NumberField title={"冷却时间"} value={prefs.cooldownMinutes} suffix={"分钟"} onChanged={(cooldownMinutes) => update({ cooldownMinutes })} />
        </Section>

        <Section>
          <Button title={"恢复默认"} role={"destructive"} action={reset} />
        </Section>
      </List>
    </NavigationStack>
  );
}
