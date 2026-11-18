# WebSocket: Real-time Chat Rooms (Node.js + Express + ws + MongoDB)

A small, production-style real-time chat: rooms, live messages, "who is online", typing indicators and saved history. It puts the ideas from [key-terminologies.md](key-terminologies.md) into working code.

**Stack:** Node.js 22+, Express 5, [`ws`](https://www.npmjs.com/package/ws), MongoDB + Mongoose, helmet. Tests use `node:test` + real `ws` clients + supertest.

## Run it

```bash
cd websocket
npm install
cp .env.example .env     # set MONGO_URI / ALLOWED_ORIGINS if needed
npm run dev              # open http://localhost:3000 in two browser tabs and chat
npm test                 # needs MongoDB running; uses the websocket_chat_test database
```

Quick test from a terminal (no browser): `npx wscat -c ws://localhost:3000/ws -o http://localhost:3000`, then type
`{"type":"join","room":"general","name":"cli"}`.

## Endpoints

One HTTP server handles both. Normal requests go to Express; requests with `Upgrade: websocket` go to the chat.

| Protocol | URL | What it does |
|----------|-----|--------------|
| WebSocket | `ws://localhost:3000/ws` | Live chat (protocol below) |
| HTTP `GET` | `/` | Demo chat page ([public/](public)) |
| HTTP `GET` | `/api/rooms/:room/messages?before=<id>&limit=50` | Older history, cursor-paginated, newest first |
| HTTP `GET` | `/health` | Liveness + DB status |

## Message protocol

Every frame is a JSON text frame with a `type`.

### Client → server

| `type` | Fields | Effect |
|--------|--------|--------|
| `join` | `room` (`[a-z0-9-]{1,32}`), `name` (1–32 chars) | Leave the current room (if any) and join this one |
| `message` | `text` (1–1000 chars) | Save to MongoDB, then broadcast to the room (sender included) |
| `typing` | – | Tell others in the room you are typing |

### Server → client

| `type` | Fields | When |
|--------|--------|------|
| `joined` | `room`, `users`, `history` (last 50) | Reply to your `join` |
| `presence` | `room`, `users` | Someone joined or left your room |
| `message` | `id`, `room`, `user`, `text`, `createdAt` | New chat message |
| `typing` | `user` | Someone else is typing |
| `error` | `code`, `message` | Your frame was rejected; the socket stays open |

```json
→ { "type": "join", "room": "general", "name": "Asha" }
← { "type": "joined", "room": "general", "users": ["Asha"], "history": [] }
→ { "type": "message", "text": "hello" }
← { "type": "message", "id": "6650f...", "room": "general", "user": "Asha", "text": "hello", "createdAt": "2026-11-18T14:30:00.000Z" }
```

### Error codes

| Code | When |
|------|------|
| `BAD_FRAME` | Not JSON, or a binary frame |
| `UNKNOWN_TYPE` | `type` is not `join` / `message` / `typing` |
| `INVALID_ROOM`, `INVALID_NAME`, `INVALID_TEXT` | Field fails validation |
| `NOT_IN_ROOM` | `message` before `join` |
| `RATE_LIMITED` | More than 5 frames per second |
| `INTERNAL_ERROR` | Unexpected error (logged, never sent in detail) |

### Close codes you may see

| Code | Meaning |
|------|---------|
| `1000` | Normal close |
| `1001` | Server shutting down (client reconnects) |
| `1006` | Connection dropped without a close frame (e.g. killed by the heartbeat) |
| `1009` | Frame larger than 16 KB |

## Project structure

```
websocket/
├── src/
│   ├── chat.js                    # WebSocket server: handshake checks, rooms, protocol, heartbeat
│   ├── app.js                     # Express: static page, history REST endpoint, health
│   ├── server.js                  # One HTTP server for both, graceful shutdown
│   └── models/message.model.js    # Mongoose schema + index for history
├── public/
│   ├── index.html                 # Demo chat page
│   └── chat-client.js             # Browser client with auto-reconnect
└── tests/chat.test.js
```

## WebSocket concepts shown in the code

| Concept | Where |
|---------|-------|
| HTTP `Upgrade` handshake on the same port as Express | `server.js`, `httpServer.on('upgrade')` in `chat.js` |
| Checking the handshake: path + `Origin` allow-list (blocks Cross-Site WebSocket Hijacking) | `chat.js` |
| JSON message protocol with a `type` field | `handlers` in `chat.js` |
| Rooms / channels and broadcast | `rooms` map, `broadcast()` |
| Presence (who is online) and typing indicators | `presence`, `typing` frames |
| Heartbeat with ping/pong, dead connections terminated | `setInterval` in `chat.js` |
| Max frame size (`maxPayload`), per-socket rate limit | `chat.js` |
| Backpressure: skip clients with > 1 MB unsent (`bufferedAmount`) | `send()` |
| Persist first, then broadcast | `handlers.message` |
| Live updates over WebSocket, older history over REST with cursor pagination | `app.js` |
| Auto-reconnect with exponential backoff + jitter, re-join after reconnect | `public/chat-client.js` |
| `ws://` vs `wss://` chosen from the page protocol | `public/chat-client.js` |
| XSS-safe rendering (`textContent`, never `innerHTML`) | `public/chat-client.js` |
| Graceful shutdown with close code `1001` | `close()` in `chat.js`, `server.js` |

## Scaling notes

- **One instance only as written.** Rooms are kept in memory, so two servers would not see each other's clients. To run several instances, publish each message to **Redis pub/sub** (or NATS / Kafka) and have every instance broadcast what it receives to its own sockets.
- Behind a load balancer, enable WebSocket support and raise the idle timeout above the heartbeat interval (30 s). Sticky sessions are not needed once messages go through pub/sub.
- One Node process can hold tens of thousands of idle sockets; watch memory and file-descriptor limits (`ulimit -n`).

## Next steps (not in this example)

- Authentication: send a JWT in the first frame (or a short-lived ticket in the URL) and verify it before `join`
- Redis pub/sub adapter for multiple instances
- Delivery acknowledgements and "missed messages since id X" on reconnect
- Private (1-to-1) messages and read receipts
