/**
 * Real Switch integration. Litti joins Switch rooms as its own agent:
 *  - posts approval requests, rubber-stamp warnings and deploy results into the room
 *  - answers @litti commands from people and coding agents in the room
 *
 * Protocol (Switch agent bridge, default http://127.0.0.1:64300):
 *   POST /agents                         register (registration key, once)
 *   POST /agents/{id}/message            post into a room
 *   GET  /agents/{id}/notifications      long-poll for messages addressed to Litti
 *   POST /agents/{id}/ops/{op}           room operations (list_rooms, update_agent_detail)
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { ActionCard, RiskAssessment, SwitchClient } from '../types.js';

const credsFile = () => process.env.SWITCH_CREDS_FILE || '.litti-switch.json';
const TIER_LABEL = ['🟢 Tier 0 · auto', '🟡 Tier 1 · 1 reviewer', '🟠 Tier 2 · 2 reviewers', '🔴 Tier 3 · 3 reviewers'];

export interface SwitchEvent {
  roomId: string;
  sender: string;
  senderName: string;
  body: string;
}

export interface SwitchConfig {
  url: string;
  registrationKey?: string;
  agentName: string;
  roomId?: string;
}

/** Read Switch settings from the environment. */
export function switchConfigFromEnv(): SwitchConfig {
  return {
    url: (process.env.SWITCH_API_URL || 'http://127.0.0.1:64300').replace(/\/$/, ''),
    registrationKey: process.env.SWITCH_REGISTRATION_KEY || undefined,
    agentName: process.env.SWITCH_AGENT_NAME || 'litti',
    roomId: process.env.SWITCH_ROOM_ID || undefined,
  };
}

/** A live connection to Switch, acting as the Litti agent. */
export class LiveSwitch implements SwitchClient {
  /** Room Litti posts to. Follows the last room that addressed Litti. */
  roomId: string | null;
  /** True when SWITCH_ROOM_ID pins the room, so it never follows other rooms. */
  pinnedRoom = false;
  private stopped = false;
  private seen = new Set<string>();

  constructor(
    private readonly url: string,
    readonly agentId: string,
    private readonly apiKey: string,
    roomId: string | null,
  ) {
    this.roomId = roomId;
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) throw new Error(`Switch ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Run a Switch room operation. */
  op<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.call<any>('POST', `/agents/${this.agentId}/ops/${name}`, args)
      .then(r => (r && typeof r === 'object' && 'result' in r ? r.result : r) as T);
  }

  /** Post into a room (defaults to the current room). */
  async postMessage(content: string, roomId = this.roomId): Promise<void> {
    if (!roomId) {
      console.log(`🔑 [switch] (no room yet — mention @litti in a room) ${content}`);
      return;
    }
    try {
      await this.call('POST', `/agents/${this.agentId}/message`, { room_id: roomId, content });
      console.log(`🔑 [switch → room] ${content.split('\n')[0]}`);
    } catch (err) {
      console.error(`⚠️  Switch post failed: ${(err as Error).message}`);
    }
  }

  /** Post an approval request card into the room. */
  postCard(card: ActionCard, a: RiskAssessment, approvalUrl: string): Promise<void> {
    const lines = card.diff.split('\n').length;
    return this.postMessage([
      `🔒 **Approval needed** — ${TIER_LABEL[a.tier]}`,
      `**${card.action}** by \`${card.agent}\`: ${card.description}`,
      `Why: ${a.reasons.join(' · ')}`,
      `Diff: ${lines} lines · ${card.touchedPaths.join(', ') || 'no paths'} · reversible: ${card.reversible ? 'yes' : 'NO'}`,
      `👉 Reviewers: reply \`@litti review ${card.id}\` for your personal review link · ${approvalUrl}`,
      `_Nothing runs until ${a.requiredApprovers} reviewer(s) pass. Action id: \`${card.id}\`_`,
    ].join('\n'));
  }

  /** Long-poll Switch for messages addressed to Litti and hand them to `onEvent`. */
  async listen(onEvent: (e: SwitchEvent) => Promise<string | null>): Promise<void> {
    let failures = 0;
    while (!this.stopped) {
      try {
        const res = await this.call<{ events?: any[] } | undefined>(
          'GET', `/agents/${this.agentId}/notifications?timeout=25`, undefined, 45000);
        failures = 0;
        const events: any[] = Array.isArray(res) ? res : res?.events ?? [];
        // Never spin: if the server answers instantly with nothing, wait a moment.
        if (!events.length) await new Promise(r => setTimeout(r, 500));
        for (const ev of events) {
          const evId = ev.id ?? ev.event_id;
          if (evId) {
            if (this.seen.has(evId)) continue;
            this.seen.add(evId);
            if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string);
          }
          const p = ev.payload ?? {};
          if (ev.type !== 'message' || !p.addressed || !ev.room_id || typeof p.body !== 'string') continue;
          if (p.sender_kind === 'platform') continue;
          if (!this.pinnedRoom) this.roomId = ev.room_id;
          const e: SwitchEvent = { roomId: ev.room_id, sender: p.sender ?? '', senderName: p.sender_name ?? 'someone', body: p.body };
          console.log(`🔑 [room → litti] ${e.senderName}: ${e.body.split('\n')[0].slice(0, 120)}`);
          const reply = await onEvent(e).catch(err => `⚠️ Litti error: ${(err as Error).message}`);
          if (reply) await this.postMessage(reply, e.roomId);
        }
      } catch (err) {
        failures++;
        const msg = (err as Error).message;
        if (/→ 40[13]/.test(msg)) {
          console.error(`⚠️  Switch rejected Litti's credentials. Delete ${credsFile()}, set SWITCH_REGISTRATION_KEY in .env, and restart. (${msg})`);
        } else if (failures === 1 || failures % 10 === 0) {
          console.error(`⚠️  Switch listen error (retrying): ${msg}`);
        }
        await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** Math.min(failures, 5))));
      }
    }
  }

  stop(): void { this.stopped = true; }
}

/** Pull room ids out of a list_rooms result, whatever its exact shape. */
function roomIds(result: unknown): string[] {
  const r = result as any;
  const list = Array.isArray(r) ? r : r?.rooms ?? r?.data ?? r?.items ?? [];
  return (list as any[]).map(r => (typeof r === 'string' ? r : r?.room_id ?? r?.id)).filter(Boolean);
}

/**
 * Connect to Switch as the Litti agent. Registers on first run (needs
 * SWITCH_REGISTRATION_KEY) and stores the agent's credentials in
 * .litti-switch.json for later runs.
 */
export async function connectSwitch(cfg: SwitchConfig = switchConfigFromEnv()): Promise<LiveSwitch> {
  // Any HTTP answer means the server is up (some builds have no /health route).
  const health = await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!health) {
    throw new Error(`Switch is not reachable at ${cfg.url}. Open Switch Console (local server running) or set SWITCH_API_URL.`);
  }

  type Creds = { url: string; agentId: string; apiKey: string };
  const valid = (c: any): c is Creds =>
    !!c && typeof c.agentId === 'string' && !!c.agentId && typeof c.apiKey === 'string' && !!c.apiKey;

  let creds: Creds | null = null;
  let fromEnv = false;
  if (process.env.SWITCH_AGENT_ID && process.env.SWITCH_AGENT_API_KEY) {
    creds = { url: cfg.url, agentId: process.env.SWITCH_AGENT_ID, apiKey: process.env.SWITCH_AGENT_API_KEY };
    fromEnv = true;
  } else if (existsSync(credsFile())) {
    try {
      const saved = JSON.parse(readFileSync(credsFile(), 'utf8'));
      if (saved.url === cfg.url && valid(saved)) creds = saved;
    } catch {
      console.warn(`⚠️  Ignoring unreadable ${credsFile()}; registering again.`);
    }
  }

  const register = async (): Promise<Creds> => {
    if (!cfg.registrationKey) {
      throw new Error('First run needs SWITCH_REGISTRATION_KEY in .env (Switch Console → Settings → API keys). See README → "Quick start".');
    }
    const res = await fetch(`${cfg.url}/agents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.registrationKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: cfg.agentName,
        display_name: 'Litti',
        description: 'Approval gate for AI agents. Tiers risk, quizzes reviewers, blocks rubber-stamps, and keeps a tamper-evident receipt chain. Mention @litti help.',
        connector_type: 'litti',
        overwrite: true,
        integration_profile: {
          connection_model: 'always_on',
          message_exchange: true,
          pre_invocation_mediation: [],
          post_invocation_mediation: [],
          event_reporting: [],
          task_protocol: { can_delegate: false, can_accept: false },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Switch registration failed (${res.status}): ${text.slice(0, 300)}`);
    let raw: any;
    try { raw = JSON.parse(text); } catch { throw new Error(`Switch registration returned non-JSON: ${text.slice(0, 200)}`); }
    const body = raw?.result ?? raw?.agent ?? raw;
    const fresh = {
      url: cfg.url,
      agentId: body?.id ?? body?.agent_id ?? body?.agentId,
      apiKey: body?.api_key ?? body?.apiKey ?? body?.key ?? body?.token,
    };
    if (!valid(fresh)) throw new Error(`Switch registration response missing id/api_key: ${text.slice(0, 300)}`);
    writeFileSync(credsFile(), JSON.stringify(fresh, null, 2), { mode: 0o600 });
    console.log(`🔑 Registered "${cfg.agentName}" as a Switch agent (credentials saved to ${credsFile()}).`);
    return fresh;
  };

  if (!creds) creds = await register();

  const make = (c: Creds) => {
    const s = new LiveSwitch(cfg.url, c.agentId, c.apiKey, cfg.roomId ?? null);
    s.pinnedRoom = !!cfg.roomId;
    return s;
  };
  let sw = make(creds);

  // Check the credentials work; recover once from stale ones by registering again.
  let rooms: unknown = [];
  try {
    rooms = await sw.op('list_rooms');
  } catch (err) {
    const msg = (err as Error).message;
    const authFail = /→ 40[13]/.test(msg);
    if (authFail && !fromEnv && cfg.registrationKey) {
      console.warn('⚠️  Saved Switch credentials were rejected; registering again.');
      try { unlinkSync(credsFile()); } catch { /* already gone */ }
      creds = await register();
      sw = make(creds);
      rooms = await sw.op('list_rooms').catch(() => []);
    } else if (authFail) {
      throw new Error(`Switch rejected Litti's credentials (${msg}). Delete ${credsFile()} and set SWITCH_REGISTRATION_KEY in .env.`);
    } else {
      console.warn(`⚠️  list_rooms failed: ${msg}`);
    }
  }

  // Let teammates (and their coding agents) address @litti, not just the owner.
  await sw.op('update_agent_detail', { agent_id: creds.agentId, addressing: 'anyone' })
    .catch(err => console.warn(`⚠️  Could not open addressing: ${(err as Error).message}`));

  if (!sw.roomId) sw.roomId = roomIds(rooms)[0] ?? null;
  console.log(sw.roomId
    ? `🔑 Connected to Switch as @${cfg.agentName} · room ${sw.roomId}`
    : `🔑 Connected to Switch as @${cfg.agentName} · not in a room yet — add "${cfg.agentName}" to a room in Switch Console, then mention @${cfg.agentName}`);
  return sw;
}
