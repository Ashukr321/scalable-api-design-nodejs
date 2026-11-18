import { WebSocketServer, WebSocket } from 'ws';
import { Message, ROOM_RE } from './models/message.model.js';

const HEARTBEAT_MS = 30_000;
const HISTORY_SIZE = 50;
const RATE_LIMIT = { max: 5, windowMs: 1000 }; // per socket
const MAX_BUFFERED = 1024 * 1024; // skip slow consumers holding > 1 MB unsent

/*
 * Protocol: every frame is JSON with a "type".
 *   client -> server: { type: 'join', room, name } | { type: 'message', text } | { type: 'typing' }
 *   server -> client: { type: 'joined', room, users, history } | { type: 'presence', room, users }
 *                     { type: 'message', id, room, user, text, createdAt } | { type: 'typing', user }
 *                     { type: 'error', code, message }
 */
export function attachChat(httpServer, { path = '/ws', allowedOrigins = [], heartbeatMs = HEARTBEAT_MS } = {}) {
  // shortcut: rooms live in this process's memory, so this works on ONE instance.
  // For several instances behind a load balancer, fan messages out via Redis pub/sub.
  const rooms = new Map(); // room -> Set<ws>
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  // The handshake is a plain HTTP GET with "Upgrade: websocket". Check it before accepting.
  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname !== path) return socket.destroy();
    // Browsers always send Origin; reject other sites (Cross-Site WebSocket Hijacking).
    if (allowedOrigins.length && !allowedOrigins.includes(req.headers.origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (ws, data) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(JSON.stringify(data));
  };
  const usersIn = (room) => [...(rooms.get(room) ?? [])].map((c) => c.name);
  const broadcast = (room, data, except) => {
    for (const client of rooms.get(room) ?? []) if (client !== except) send(client, data);
  };
  const fail = (ws, code, message) => send(ws, { type: 'error', code, message });

  function leave(ws) {
    const members = rooms.get(ws.room);
    if (!members?.delete(ws)) return;
    if (members.size === 0) rooms.delete(ws.room);
    else broadcast(ws.room, { type: 'presence', room: ws.room, users: usersIn(ws.room) });
    ws.room = undefined;
  }

  const handlers = {
    async join(ws, { room, name }) {
      name = typeof name === 'string' ? name.trim() : '';
      if (typeof room !== 'string' || !ROOM_RE.test(room)) return fail(ws, 'INVALID_ROOM', 'room must match [a-z0-9-]{1,32}');
      if (!name || name.length > 32) return fail(ws, 'INVALID_NAME', 'name must be 1-32 characters');
      leave(ws);
      Object.assign(ws, { room, name });
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room).add(ws);

      const history = (await Message.find({ room }).sort({ _id: -1 }).limit(HISTORY_SIZE)).reverse();
      send(ws, { type: 'joined', room, users: usersIn(room), history });
      broadcast(room, { type: 'presence', room, users: usersIn(room) }, ws);
    },

    async message(ws, { text }) {
      if (!ws.room) return fail(ws, 'NOT_IN_ROOM', 'join a room first');
      text = typeof text === 'string' ? text.trim() : '';
      if (!text || text.length > 1000) return fail(ws, 'INVALID_TEXT', 'text must be 1-1000 characters');
      // Save first, then broadcast: everyone sees the same id/createdAt, and nothing shown is lost.
      const msg = await Message.create({ room: ws.room, user: ws.name, text });
      broadcast(ws.room, { type: 'message', ...msg.toJSON() });
    },

    typing(ws) {
      if (ws.room) broadcast(ws.room, { type: 'typing', user: ws.name }, ws);
    },
  };

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.hits = { count: 0, windowStart: Date.now() };
    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', async (raw, isBinary) => {
      // shortcut: fixed-window rate limit per socket; use a shared store if limits must span reconnects.
      const now = Date.now();
      if (now - ws.hits.windowStart > RATE_LIMIT.windowMs) ws.hits = { count: 0, windowStart: now };
      if (++ws.hits.count > RATE_LIMIT.max) return fail(ws, 'RATE_LIMITED', 'too many messages, slow down');

      let data;
      try {
        if (isBinary) throw new Error('binary');
        data = JSON.parse(raw.toString());
      } catch {
        return fail(ws, 'BAD_FRAME', 'frames must be JSON text');
      }
      const handler = Object.hasOwn(handlers, data?.type) ? handlers[data.type] : null;
      if (!handler) return fail(ws, 'UNKNOWN_TYPE', `unknown type: ${String(data?.type)}`);

      try {
        await handler(ws, data);
      } catch (err) {
        console.error(err);
        fail(ws, 'INTERNAL_ERROR', 'something went wrong');
      }
    });

    ws.on('close', () => leave(ws));
    ws.on('error', () => ws.terminate());
  });

  // Heartbeat: ping every client; one that did not pong since the last round is dead
  // (laptop closed, network dropped) and gets terminated so its room slot is freed.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  // Graceful shutdown: tell clients to reconnect elsewhere (1001 Going Away).
  function close() {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.close(1001, 'server shutting down');
    wss.close();
  }

  return { wss, rooms, close };
}
