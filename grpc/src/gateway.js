// REST gateway: browsers and public clients speak HTTP/JSON; this translates to gRPC
// for the internal InventoryService (the same idea as grpc-gateway / Envoy transcoding).
import express from 'express';
import helmet from 'helmet';
import { grpc, InventoryService, Health } from './proto.js';

const { status } = grpc;

const HTTP_STATUS = {
  [status.INVALID_ARGUMENT]: 400,
  [status.FAILED_PRECONDITION]: 400,
  [status.UNAUTHENTICATED]: 401,
  [status.PERMISSION_DENIED]: 403,
  [status.NOT_FOUND]: 404,
  [status.ALREADY_EXISTS]: 409,
  [status.RESOURCE_EXHAUSTED]: 429,
  [status.UNAVAILABLE]: 503,
  [status.DEADLINE_EXCEEDED]: 504,
};

export function createGatewayApp({ target, apiKey, deadlineMs = 2000 }) {
  // shortcut: plaintext to the gRPC service; use grpc.credentials.createSsl() across networks.
  const creds = grpc.credentials.createInsecure();
  const inventory = new InventoryService(target, creds);
  const health = new Health(target, creds);

  const metadata = () => {
    const md = new grpc.Metadata();
    md.set('x-api-key', apiKey);
    return md;
  };
  // Every call gets a deadline: a slow backend must not hang the HTTP request forever.
  const options = () => ({ deadline: Date.now() + deadlineMs });

  const unary = (client, method, request) =>
    new Promise((resolve, reject) =>
      client[method](request, metadata(), options(), (err, res) => (err ? reject(err) : resolve(res))),
    );

  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    const result = await unary(health, 'Check', { service: '' }).catch(() => ({ status: 'UNREACHABLE' }));
    res.status(result.status === 'SERVING' ? 200 : 503).json({ grpc: result.status });
  });

  app.get('/api/products', async (req, res) => {
    // shortcut: buffers the whole gRPC stream into one JSON array; stream NDJSON for very large lists.
    const items = [];
    const stream = inventory.ListProducts({ inStockOnly: req.query.inStock === 'true' }, metadata(), options());
    for await (const product of stream) items.push(product);
    res.json({ data: items });
  });

  app.get('/api/products/:id', async (req, res) => {
    res.json(await unary(inventory, 'GetProduct', { id: req.params.id }));
  });

  app.post('/api/products', async (req, res) => {
    const { sku, name, priceCents, stock } = req.body ?? {};
    // Protobuf would silently coerce wrong types (e.g. "abc" -> 0), so type-check at the HTTP edge.
    if (typeof sku !== 'string' || typeof name !== 'string' || !Number.isInteger(priceCents) || (stock !== undefined && !Number.isInteger(stock))) {
      return res.status(400).json({ error: 'sku and name must be strings; priceCents and stock must be integers' });
    }
    const product = await unary(inventory, 'CreateProduct', { sku, name, priceCents, stock });
    res.status(201).location(`/api/products/${product.id}`).json(product);
  });

  app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} does not exist` }));

  // gRPC status -> HTTP status. Unknown/internal errors are not leaked.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    const http = HTTP_STATUS[err.code] ?? err.status ?? 500;
    if (http >= 500 && err.code !== status.UNAVAILABLE && err.code !== status.DEADLINE_EXCEEDED) console.error(err);
    res.status(http).json({ error: http === 500 ? 'Internal Server Error' : err.details || err.message, grpcCode: err.code });
  });

  app.close = () => {
    inventory.close();
    health.close();
  };
  return app;
}

if (import.meta.main) {
  const PORT = process.env.GATEWAY_PORT || 3000;
  const app = createGatewayApp({
    target: process.env.GRPC_TARGET || 'localhost:50051',
    apiKey: process.env.API_KEY || '',
  });
  app.listen(PORT, () => console.log(`REST gateway on http://localhost:${PORT} -> gRPC ${process.env.GRPC_TARGET || 'localhost:50051'}`));
}
