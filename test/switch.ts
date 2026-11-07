/** Switch client test against a mock Switch agent bridge (same routes as the real one). */
import Fastify from 'fastify';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connectSwitch } from '../src/switch/client.js';

const CREDS = join(tmpdir(), `litti-switch-test-${process.pid}.json`);
process.env.SWITCH_CREDS_FILE = CREDS;

const REG_KEY = 'reg-key-test';
const posted: { room_id: string; content: string }[] = [];
const ops: string[] = [];
let registered: any = null;
let delivered = false;

const mock = Fastify();
mock.get('/health', () => ({ status: 'ok' }));
mock.post('/agents', (req, reply) => {
  if (req.headers.authorization !== `Bearer ${REG_KEY}`) return reply.code(401).send({ detail: 'bad key' });
  registered = req.body;
  return { id: 'agent-1', api_key: 'agent-key' };
});
mock.addHook('preHandler', async (req, reply) => {
  if (req.url.startsWith('/agents/agent-1') && req.headers.authorization !== 'Bearer agent-key') reply.code(401).send({ detail: 'bad agent key' });
});
mock.post<{ Params: { op: string } }>('/agents/agent-1/ops/:op', (req) => {
  ops.push(req.params.op);
  if (req.params.op === 'list_rooms') return { result: { rooms: [{ room_id: 'room-1', name: 'eng' }] } };
  return { result: { ok: true } };
});
mock.post('/agents/agent-1/message', (req) => { posted.push(req.body as any); return { ok: true, event_id: '$e' }; });
mock.get('/agents/agent-1/notifications', async (_req, reply) => {
  if (delivered) { await new Promise(r => setTimeout(r, 200)); return reply.code(204).send(); }
  delivered = true;
  return { events: [
    { type: 'message', room_id: 'room-2', payload: { addressed: false, body: 'chatter', sender_name: 'x' } },
    { type: 'message', room_id: 'room-2', payload: { addressed: true, body: '@litti help', sender: '@switch-user-1:s', sender_name: 'Priya' } },
  ] };
});

try {
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${(mock.server.address() as any).port}`;

  await assert.rejects(connectSwitch({ url, agentName: 'litti' }), /SWITCH_REGISTRATION_KEY/);
  await assert.rejects(connectSwitch({ url: 'http://127.0.0.1:1', agentName: 'litti' }), /not reachable/);

  const sw = await connectSwitch({ url, registrationKey: REG_KEY, agentName: 'litti' });
  assert.equal(registered.name, 'litti');
  assert.equal(registered.integration_profile.connection_model, 'always_on');
  assert.ok(existsSync(CREDS), 'credentials saved');
  assert.deepEqual(ops, ['list_rooms', 'update_agent_detail']);
  assert.equal(sw.roomId, 'room-1');

  await sw.postMessage('hello');
  assert.deepEqual(posted.at(-1), { room_id: 'room-1', content: 'hello' });

  // Second connect reuses saved credentials (no registration key needed).
  registered = null;
  const again = await connectSwitch({ url, agentName: 'litti' });
  assert.equal(registered, null);
  assert.equal(again.agentId, 'agent-1');

  // Only addressed messages are handled; reply goes back to the room that asked.
  const seen: string[] = [];
  const loop = sw.listen(async (e) => { seen.push(`${e.senderName}:${e.body}`); sw.stop(); return 'pong'; });
  await Promise.race([loop, new Promise((_, rej) => setTimeout(() => rej(new Error('listen timeout')), 5000))]);
  assert.deepEqual(seen, ['Priya:@litti help']);
  assert.deepEqual(posted.at(-1), { room_id: 'room-2', content: 'pong' });
  assert.equal(sw.roomId, 'room-2');

  console.log('✅ Switch client: register, save creds, open addressing, find room, post, listen, reply');
} catch (err) {
  console.error('❌ Switch client test failed:', err);
  process.exitCode = 1;
} finally {
  await mock.close();
  if (existsSync(CREDS)) rmSync(CREDS);
}
