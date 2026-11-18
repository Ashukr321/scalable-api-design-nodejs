import mongoose from 'mongoose';
import app from './app.js';

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/api_versioning_demo';

await mongoose.connect(MONGO_URI);
console.log(`MongoDB connected: ${mongoose.connection.name}`);

const server = app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}/api`));

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
