import mongoose from 'mongoose';
import { grpc } from './proto.js';
import { createGrpcServer } from './inventory.service.js';

const PORT = process.env.GRPC_PORT || 50051;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grpc_inventory_demo';
const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error('API_KEY is not set (copy .env.example to .env)');

await mongoose.connect(MONGO_URI);
console.log(`MongoDB connected: ${mongoose.connection.name}`);

const server = createGrpcServer({ apiKey: API_KEY });

// shortcut: plaintext HTTP/2 for local dev. In production use
// grpc.ServerCredentials.createSsl(...) or terminate TLS at a gRPC-aware proxy (Envoy, NGINX).
server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) throw err;
  console.log(`gRPC InventoryService listening on 0.0.0.0:${port}`);
});

// Graceful shutdown: stop accepting calls, let in-flight ones finish, force after 10 s.
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  const force = setTimeout(() => server.forceShutdown(), 10_000).unref();
  server.tryShutdown(async () => {
    clearTimeout(force);
    await mongoose.disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
