/** @litti chat commands, answered inside the Switch room. */
import type { ActionKind } from '../types.js';
import type { SwitchEvent } from './client.js';
import { buildActionCard } from '../agents/builder.js';
import { registerPending, computeStats } from '../approval/server.js';
import { getPending, listPending, allReceipts } from '../chain/db.js';
import { verifyChain } from '../chain/verify.js';
import { issueTicket } from '../approval/identity.js';

const ACTIONS: ActionKind[] = ['read', 'lint', 'format', 'test', 'edit', 'migrate', 'deploy', 'delete'];

const HELP = [
  '🔒 **Litti** — nobody ships on a rubber stamp.',
  '• `@litti propose` + a ```json block``` — ask for approval before acting',
  '  fields: action, description, diff, touchedPaths[], reversible, rollbackPlan',
  '• `@litti review <id>` — get your personal, signed review link',
  '• `@litti status <id>` — has this action been approved?',
  '• `@litti pending` — actions waiting for reviewers',
  '• `@litti verify` — check the receipt chain for tampering',
  '• `@litti stats` — reviewer attention scores and rubber-stamps',
  'Approving happens on the review page, never in chat: you have to read the diff and pass the quiz.',
].join('\n');

/** Pull a JSON object out of a chat message (```json fenced or bare). */
function extractJson(body: string): any | null {
  // Chat apps turn quotes into smart quotes; undo that first.
  const clean = body.replace(/[\u201C\u201D\u201E\u2033]/g, '"').replace(/[\u2018\u2019\u2032]/g, "'");
  const fenced = clean.match(/(?:```|~~~)(?:json)?\s*([\s\S]*?)(?:```|~~~)/);
  let raw = fenced && fenced[1].includes('{') ? fenced[1] : '';
  if (!raw) {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    raw = start >= 0 && end > start ? clean.slice(start, end + 1) : '';
  }
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch { /* try again below */ }
  // People paste diffs with real line breaks inside the "diff" string. Escape them.
  let out = '';
  let inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr && ch === '\\') { out += ch + (raw[i + 1] ?? ''); i++; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') continue;
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  try { return JSON.parse(out); } catch { return null; }
}

const COMMANDS = ['propose', 'request', 'review', 'status', 'pending', 'verify', 'stats', 'approve', 'help'];

/** Build the command handler. `baseUrl` is where reviewers open approval pages. */
export function createCommandHandler(baseUrl: string) {
  return async (e: SwitchEvent): Promise<string | null> => {
    // Drop the leading mention(s), keep the command.
    let text = e.body.replace(/^\s*(?:(?:<@[!&]?[^>]+>|@[\w.\-]+)[:,]?\s*)+/i, '').trim();
    // If the first word isn't a command (mention mid-sentence), jump to the first command word.
    const words = text.split(/\s+/);
    const firstCmd = words.findIndex(w => COMMANDS.includes(w.toLowerCase().replace(/[^a-z]/g, '')));
    if (firstCmd > 0) text = words.slice(firstCmd).join(' ');
    const [rawCmd = 'help', rawArg = ''] = text.split(/\s+/);
    const cmd = rawCmd.replace(/[^A-Za-z]/g, '') || 'help';
    const arg = rawArg.replace(/[`<>*.,!'"]/g, '');
    const c = cmd.toLowerCase();

    if (c === 'propose' || c === 'request') {
      const b = extractJson(text);
      if (!b) return '⚠️ Send the action as JSON, e.g.\n```json\n{"action":"migrate","description":"Add MFA columns","diff":"+ALTER TABLE users ADD COLUMN mfa BOOLEAN;","touchedPaths":["migrations/001.sql"]}\n```';
      if (!ACTIONS.includes(b.action) || !b.description || typeof b.diff !== 'string') {
        return `⚠️ Need \`action\` (${ACTIONS.join('|')}), \`description\` and \`diff\`.`;
      }
      const card = buildActionCard({
        agent: b.agent || e.senderName,
        action: b.action,
        description: String(b.description),
        diff: b.diff,
        touchedPaths: Array.isArray(b.touchedPaths) ? b.touchedPaths.map(String) : [],
        reversible: b.reversible !== false,
        rollbackPlan: String(b.rollbackPlan ?? ''),
      });
      const { tier } = registerPending(card, baseUrl); // posts the approval card to the room
      return tier === 0 ? `🟢 Tier 0 read-only — auto-approved. \`${card.id}\`` : null;
    }

    if (c === 'review') {
      const p = arg ? getPending(arg) : null;
      if (!p) return `⚠️ Unknown action id \`${arg || '?'}\`. Try \`@litti pending\`.`;
      if (p.status !== 'pending') return `✅ "${p.actionCard.description}" is already ${p.status}.`;
      if (e.senderName.toLowerCase() === p.actionCard.agent.toLowerCase()) {
        return '🔒 You requested this action — someone else has to review it.';
      }
      const t = issueTicket(p.id, e.senderName, e.sender);
      return `🔐 @${e.senderName}, your review link (valid 30 min, signs as you): ${baseUrl}/approve/${p.id}?t=${encodeURIComponent(t)}`;
    }

    if (c === 'status' || c === 'check') {
      const p = arg ? getPending(arg) : null;
      if (!p) return `⚠️ Unknown action id \`${arg || '?'}\`. Try \`@litti pending\`.`;
      const state = p.status === 'approved' ? '✅ APPROVED — token issued, deploy ran' : `⏳ PENDING — ${p.currentApprovals.length}/${p.requiredApprovers} reviewers passed`;
      return `${state}\n${p.actionCard.description} · Tier ${p.tier} · ${baseUrl}/approve/${p.id}`;
    }

    if (c === 'pending' || c === 'queue') {
      const list = listPending();
      if (!list.length) return '✅ Nothing waiting for review.';
      return ['⏳ **Waiting for reviewers**', ...list.map(p =>
        `• Tier ${p.tier} · ${p.actionCard.description} · ${p.currentApprovals.length}/${p.requiredApprovers} · ${baseUrl}/approve/${p.id}`)].join('\n');
    }

    if (c === 'verify' || c === 'audit') {
      const links = verifyChain();
      if (!links.length) return '📭 No receipts yet.';
      const bad = links.findIndex(l => !l.valid);
      return bad === -1
        ? `✅ Receipt chain intact — ${links.length} receipts, every hash link verified.`
        : `❌ **Chain broken at receipt #${bad + 1}** (\`${links[bad].id}\`). Someone edited history. ${links.length - bad} receipt(s) from there on can't be trusted.`;
    }

    if (c === 'stats' || c === 'leaderboard') {
      const stats = computeStats();
      if (!stats.length) return '📭 No reviews yet.';
      return ['📊 **Reviewer attention**', ...stats.map(s =>
        `• ${s.approver}: avg attention ${s.avgAttention}/100 · rubber-stamps ${s.rubberStampCount} · approval rate ${s.approvalRate}%`),
        `${allReceipts().length} receipts total.`].join('\n');
    }

    if (c === 'approve' || c === 'lgtm' || c === 'yes') {
      return '🔒 Nice try. Litti doesn\'t take approvals in chat. Open the review link, read the diff, and pass the quiz.';
    }

    return HELP;
  };
}
