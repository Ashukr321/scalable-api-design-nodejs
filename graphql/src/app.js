import http from 'node:http';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { specifiedRules, validate } from 'graphql';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { typeDefs } from './graphql/typeDefs.js';
import { resolvers } from './graphql/resolvers.js';
import { createLoaders } from './graphql/loaders.js';
import { depthLimit } from './graphql/depthLimit.js';

const MAX_DEPTH = 7;

// Builds Express + Apollo (HTTP queries/mutations) + graphql-ws (subscriptions) on ONE http server,
// all on the same /graphql path.
export async function createServer({ production = process.env.NODE_ENV === 'production' } = {}) {
  const schema = makeExecutableSchema({ typeDefs, resolvers });
  const app = express();
  const httpServer = http.createServer(app);

  // Subscriptions: WebSocket with the graphql-ws protocol (the "graphql-transport-ws" subprotocol).
  const wsServer = new WebSocketServer({ server: httpServer, path: '/graphql', maxPayload: 64 * 1024 });
  const wsCleanup = useServer(
    {
      schema,
      // Loaders without cache: a subscription lives long, cached authors would go stale.
      context: () => ({ loaders: createLoaders({ cache: false }) }),
      validate: (s, document) => validate(s, document, [...specifiedRules, depthLimit(MAX_DEPTH)]),
    },
    wsServer,
  );

  const apollo = new ApolloServer({
    schema,
    validationRules: [depthLimit(MAX_DEPTH)],
    introspection: !production, // hide the schema from the public in production
    csrfPrevention: true, // default in Apollo 4+, written out because it matters
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }), // finish in-flight requests on stop()
      { async serverWillStart() { return { drainServer: () => wsCleanup.dispose() }; } },
      ...(production ? [ApolloServerPluginLandingPageDisabled()] : []),
    ],
    // Expected errors (with a code we set) pass through; anything else is logged and masked.
    formatError(formatted, error) {
      if (formatted.extensions?.code === 'INTERNAL_SERVER_ERROR') {
        console.error(error);
        return { message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } };
      }
      return formatted;
    },
  });
  await apollo.start();

  app.get('/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down' });
  });

  app.use(
    '/graphql',
    cors(), // shortcut: allows every origin; pass { origin: [...] } before going public
    express.json({ limit: '100kb' }),
    // New loaders per request = batching + caching scoped to this one request.
    expressMiddleware(apollo, { context: async () => ({ loaders: createLoaders() }) }),
  );

  return { app, httpServer, stop: () => apollo.stop() };
}
