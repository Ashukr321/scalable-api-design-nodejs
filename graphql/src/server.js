import mongoose from 'mongoose';
import { createServer } from './app.js';

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/graphql_blog_demo';

await mongoose.connect(MONGO_URI);
console.log(`MongoDB connected: ${mongoose.connection.name}`);

const { httpServer, stop } = await createServer();
httpServer.listen(PORT, () => {
  console.log(`GraphQL:        http://localhost:${PORT}/graphql  (open in a browser for Apollo Sandbox)`);
  console.log(`Subscriptions:  ws://localhost:${PORT}/graphql`);
});

// Graceful shutdown: Apollo drains HTTP requests and closes subscriptions, then the DB closes.
async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  setTimeout(() => process.exit(1), 10_000).unref();
  await stop();
  await mongoose.disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
