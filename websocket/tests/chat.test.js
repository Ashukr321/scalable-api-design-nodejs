import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import mongoose from 'mongoose';
import request from 'supertest';
import { WebSocket } from 'ws';
import app from '../src/app.js';
import { attachChat } from '../src/chat.js';
import { Message } from '../src/models/message.model.js';

// Needs a running MongoDB. Uses its own database and drops it afterwards.
const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/websocket_chat_test';
const ORIGIN = 'http://localhost:3000';

let server;
let chat;
let url;

before(async () => {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();
  server = http.createServer(app);
  chat = attachChat(server, { allowedOrigins: [ORIGIN], heartbeatMs: 200 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `ws://127.0.0.1:${server.address().port}/ws`;
});

after(async () => {
  chat.close();
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// Opens a socket and queues every incoming frame, so tests can await "the next frame of type X".
async function connect(options = {}) {
  const ws = new WebSocket(url, { origin: ORIGIN, ...options });
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.type === msg.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  ws.next = (type) => {
    const i = inbox.findIndex((m) => m.type === type);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve) => waiters.push({ type, resolve }));
  };
  ws.json = (data) => ws.send(JSON.stringify(data));
  await once(ws, 'open');
  return ws;
}

async function joinAs(name, room = 'general', options) {
  const ws = await connect(options);
  ws.json({ type: 'join', room, name });
  ws.joined = await ws.next('joined');
  return ws;
}

test('join -> joined with users + history; others get presence', async () => {
  const asha = await joinAs('Asha', 'presence-room');
  assert.deepEqual(asha.joined.users, ['Asha']);
  assert.deepEqual(asha.joined.history, []);

  const ravi = await joinAs('Ravi', 'presence-room');
  assert.deepEqual((await asha.next('presence')).users, ['Asha', 'Ravi']);

  ravi.close();
  assert.deepEqual((await asha.next('presence')).users, ['Asha']);
  asha.close();
});

test('message is saved, broadcast to the room only, and shows up in history', async () => {
  const a = await joinAs('A', 'room-1');
  const b = await joinAs('B', 'room-1');
  const outsider = await joinAs('C', 'room-2');
  let leaked = false;
  outsider.on('message', (raw) => (leaked ||= JSON.parse(raw).type === 'message'));

  a.json({ type: 'message', text: '  hello <b>all</b>  ' });
  const [toA, toB] = await Promise.all([a.next('message'), b.next('message')]);
  assert.equal(toA.text, 'hello <b>all</b>'); // trimmed; stored as text, client renders with textContent
  assert.equal(toA.user, 'A');
  assert.deepEqual(toA, toB);
  assert.ok(await Message.findById(toA.id));

  const late = await joinAs('D', 'room-1');
  assert.equal(late.joined.history.at(-1).text, 'hello <b>all</b>');
  assert.equal(leaked, false);
  [a, b, outsider, late].forEach((s) => s.close());
});

test('typing goes to others, not the sender', async () => {
  const a = await joinAs('A', 'typing-room');
  const b = await joinAs('B', 'typing-room');
  a.json({ type: 'typing' });
  assert.equal((await b.next('typing')).user, 'A');
  a.close();
  b.close();
});

test('bad frames get an error frame, connection stays open', async () => {
  const ws = await connect();
  const cases = [
    ['not json', 'BAD_FRAME'],
    [JSON.stringify({ type: 'nope' }), 'UNKNOWN_TYPE'],
    [JSON.stringify({ type: 'constructor' }), 'UNKNOWN_TYPE'], // no prototype lookups
    [JSON.stringify({ type: 'message', text: 'hi' }), 'NOT_IN_ROOM'],
    [JSON.stringify({ type: 'join', room: 'Bad Room!', name: 'x' }), 'INVALID_ROOM'],
  ];
  for (const [frame, code] of cases) {
    ws.send(frame);
    assert.equal((await ws.next('error')).code, code, frame);
    await new Promise((r) => setTimeout(r, 250)); // stay under the rate limit
  }
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
});

test('more than 5 frames per second -> RATE_LIMITED', async () => {
  const ws = await joinAs('Spammer', 'spam');
  for (let i = 0; i < 6; i++) ws.json({ type: 'typing' });
  assert.equal((await ws.next('error')).code, 'RATE_LIMITED');
  ws.close();
});

test('handshake from a foreign Origin is rejected with 403', async () => {
  const ws = new WebSocket(url, { origin: 'https://evil.example' });
  const [, res] = await once(ws, 'unexpected-response');
  assert.equal(res.statusCode, 403);
});

test('frame larger than maxPayload (16 KB) closes the socket with 1009', async () => {
  const ws = await joinAs('Big', 'big');
  ws.json({ type: 'message', text: 'x'.repeat(20 * 1024) });
  const [code] = await once(ws, 'close');
  assert.equal(code, 1009); // Message Too Big
});

test('heartbeat terminates a client that stops answering pings', async () => {
  const ws = await joinAs('Ghost', 'ghost', { autoPong: false }); // simulate a dead network: never pong
  const [code] = await once(ws, 'close');
  assert.equal(code, 1006); // abnormal closure: server terminated without a close frame
  while (chat.rooms.has('ghost')) await new Promise((r) => setTimeout(r, 10)); // server-side close lands just after
  assert.equal(chat.rooms.has('ghost'), false);
});

test('REST history: cursor pagination, newest first', async () => {
  await Message.insertMany(Array.from({ length: 5 }, (_, i) => ({ room: 'paged', user: 'u', text: `m${i}` })));

  const page1 = await request(app).get('/api/rooms/paged/messages?limit=2').expect(200);
  assert.deepEqual(page1.body.data.map((m) => m.text), ['m4', 'm3']);

  const page2 = await request(app).get(`/api/rooms/paged/messages?limit=2&before=${page1.body.nextCursor}`).expect(200);
  assert.deepEqual(page2.body.data.map((m) => m.text), ['m2', 'm1']);

  await request(app).get('/api/rooms/BAD!/messages').expect(400);
  await request(app).get('/api/rooms/paged/messages?before=nope').expect(400);
});
