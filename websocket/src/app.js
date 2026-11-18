import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { Message, ROOM_RE } from './models/message.model.js';

const app = express();

app.use(helmet());
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)))); // demo chat page

app.get('/health', (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down' });
});

// Older history over plain HTTP: WebSocket is for live events, REST for paging the past.
// GET /api/rooms/:room/messages?before=<messageId>&limit=50  (cursor pagination, newest first)
app.get('/api/rooms/:room/messages', async (req, res) => {
  const { room } = req.params;
  const { before } = req.query;
  if (!ROOM_RE.test(room)) return res.status(400).json({ error: 'invalid room' });
  if (before !== undefined && !mongoose.isValidObjectId(before)) return res.status(400).json({ error: 'invalid before' });
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);

  const filter = { room, ...(before && { _id: { $lt: before } }) };
  const data = await Message.find(filter).sort({ _id: -1 }).limit(limit);
  res.json({ data, nextCursor: data.length === limit ? data.at(-1).id : null });
});

app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} does not exist` }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
