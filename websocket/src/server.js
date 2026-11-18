import http from 'node:http';
import mongoose from 'mongoose';
import app from './app.js';
import { attachChat } from './chat.js';

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/websocket_chat_demo';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);

await mongoose.connect(MONGO_URI);
console.log(`MongoDB connected: ${mongoose.connection.name}`);

// One HTTP server for both: Express answers normal requests, the chat takes "Upgrade" requests.
const server = http.createServer(app);
const chat = attachChat(server, { allowedOrigins });

server.listen(PORT, () => {
  console.log(`Chat page:  http://localhost:${PORT}`);
  console.log(`WebSocket:  ws://localhost:${PORT}/ws`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  chat.close(); // close sockets first, or server.close() waits on them forever
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
