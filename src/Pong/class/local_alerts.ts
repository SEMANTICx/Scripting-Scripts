// ============================================================================
// Local-only anomaly notifications. These do not write backend alert rules;
// they schedule Scripting local notifications with cooldowns.
// ============================================================================
import { Notification, Script } from "scripting";
import type { Instance, LiveRecord, NodeBasicInfo } from "./types";
import type { PingSummary } from "./ping";
import { canSendAlert, liveAlertEvents, pingAlertEvents } from "./alert_rules";
import { loadAlertPrefs } from "./alert_prefs";

const STATE_KEY = `${Script.name}.localAlerts.state`;
type AlertState = Record<string, number>;

function state(): AlertState {
  return Storage.get<AlertState>(STATE_KEY) || {};
}

function saveState(s: AlertState): void {
  Storage.set(STATE_KEY, s);
}

async function sendOnce(kind: string, inst: Instance, node: NodeBasicInfo, title: string, body: string, now: number): Promise<void> {
  const prefs = loadAlertPrefs();
  const key = `${inst.id}:${node.uuid}:${kind}`;
  const s = state();
  if (!canSendAlert(s[key], now, prefs)) return;
  await Notification.schedule({
    title,
    body,
    threadIdentifier: `${Script.name}.localAlerts`,
    userInfo: { instanceId: inst.id, uuid: node.uuid, kind },
  });
  const next = state();
  next[key] = now;
  saveState(next);
}

export async function notifyLiveAnomalies(
  inst: Instance,
  nodes: NodeBasicInfo[],
  online: Set<string>,
  records: { [uuid: string]: LiveRecord },
  now = Date.now(),
): Promise<void> {
  const s = state();
  const prefs = loadAlertPrefs();
  const pending: { kind: string; node: NodeBasicInfo; title: string; body: string }[] = [];
  for (const node of nodes) {
    const rec = records[node.uuid];
    let offlineForMinutes = 0;
    if (!online.has(node.uuid)) {
      const startKey = `${inst.id}:${node.uuid}:offlineSince`;
      if (!s[startKey]) s[startKey] = now;
      offlineForMinutes = (now - s[startKey]) / 60000;
    } else {
      delete s[`${inst.id}:${node.uuid}:offlineSince`];
    }
    for (const event of liveAlertEvents(node, online.has(node.uuid), rec, prefs, offlineForMinutes)) {
      pending.push({ kind: event.kind, node, title: event.title, body: event.body });
    }
  }
  saveState(s);
  for (const event of pending) {
    try {
      await sendOnce(event.kind, inst, event.node, event.title, event.body, now);
    } catch {
      /* keep other local alerts independent */
    }
  }
}

export async function notifyPingAnomalies(
  inst: Instance,
  node: NodeBasicInfo,
  summaries: PingSummary[],
  now = Date.now(),
): Promise<void> {
  const prefs = loadAlertPrefs();
  for (const event of pingAlertEvents(node, summaries, prefs)) {
    try {
      await sendOnce(event.kind, inst, node, event.title, event.body, now);
    } catch {
      /* keep other local alerts independent */
    }
  }
}
