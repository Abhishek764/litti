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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  private stopped = false;

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
    return this.call<{ result: T }>('POST', `/agents/${this.agentId}/ops/${name}`, args).then(r => r.result);
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
        for (const ev of res?.events ?? []) {
          const p = ev.payload ?? {};
          if (ev.type !== 'message' || !p.addressed || !ev.room_id || typeof p.body !== 'string') continue;
          if (p.sender_kind === 'platform') continue;
          this.roomId = ev.room_id;
          const e: SwitchEvent = { roomId: ev.room_id, sender: p.sender ?? '', senderName: p.sender_name ?? 'someone', body: p.body };
          console.log(`🔑 [room → litti] ${e.senderName}: ${e.body.split('\n')[0].slice(0, 120)}`);
          const reply = await onEvent(e).catch(err => `⚠️ Litti error: ${(err as Error).message}`);
          if (reply) await this.postMessage(reply, e.roomId);
        }
      } catch (err) {
        failures++;
        if (failures === 1 || failures % 10 === 0) console.error(`⚠️  Switch listen error (retrying): ${(err as Error).message}`);
        await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** Math.min(failures, 5))));
      }
    }
  }

  stop(): void { this.stopped = true; }
}

/** Pull room ids out of a list_rooms result, whatever its exact shape. */
function roomIds(result: unknown): string[] {
  const list = Array.isArray(result) ? result : (result as any)?.rooms ?? [];
  return (list as any[]).map(r => (typeof r === 'string' ? r : r?.room_id ?? r?.id)).filter(Boolean);
}

/**
 * Connect to Switch as the Litti agent. Registers on first run (needs
 * SWITCH_REGISTRATION_KEY) and stores the agent's credentials in
 * .litti-switch.json for later runs.
 */
export async function connectSwitch(cfg: SwitchConfig = switchConfigFromEnv()): Promise<LiveSwitch> {
  const health = await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!health?.ok) {
    throw new Error(`Switch is not reachable at ${cfg.url}. Open Switch Console (local server running) or set SWITCH_API_URL.`);
  }

  let creds: { url: string; agentId: string; apiKey: string } | null = null;
  if (process.env.SWITCH_AGENT_ID && process.env.SWITCH_AGENT_API_KEY) {
    creds = { url: cfg.url, agentId: process.env.SWITCH_AGENT_ID, apiKey: process.env.SWITCH_AGENT_API_KEY };
  } else if (existsSync(credsFile())) {
    const saved = JSON.parse(readFileSync(credsFile(), 'utf8'));
    if (saved.url === cfg.url) creds = saved;
  }

  if (!creds) {
    if (!cfg.registrationKey) {
      throw new Error('First run needs SWITCH_REGISTRATION_KEY in .env (Switch Console → Gateway → API keys). See README → "Connect to Switch".');
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
    const body = JSON.parse(text) as { id: string; api_key: string };
    creds = { url: cfg.url, agentId: body.id, apiKey: body.api_key };
    writeFileSync(credsFile(), JSON.stringify(creds, null, 2), { mode: 0o600 });
    console.log(`🔑 Registered "${cfg.agentName}" as a Switch agent (credentials saved to ${credsFile()}).`);
  }

  const sw = new LiveSwitch(cfg.url, creds.agentId, creds.apiKey, cfg.roomId ?? null);

  // Let teammates (and their coding agents) address @litti, not just the owner.
  await sw.op('update_agent_detail', { agent_id: creds.agentId, addressing: 'anyone' })
    .catch(err => console.warn(`⚠️  Could not open addressing: ${(err as Error).message}`));

  if (!sw.roomId) {
    const rooms = roomIds(await sw.op('list_rooms').catch(() => []));
    sw.roomId = rooms[0] ?? null;
  }
  console.log(sw.roomId
    ? `🔑 Connected to Switch as @${cfg.agentName} · room ${sw.roomId}`
    : `🔑 Connected to Switch as @${cfg.agentName} · not in a room yet — add "${cfg.agentName}" to a room in Switch Console, then mention @${cfg.agentName}`);
  return sw;
}
