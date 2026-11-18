import { timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import { grpc, InventoryService, Health } from './proto.js';
import { Product } from './models/product.model.js';

const { status } = grpc;
const MAX_IMPORT = 10_000; // per ImportProducts call
const MAX_IMPORT_ERRORS = 100; // errors listed in the summary

export const rpcError = (code, details) => Object.assign(new Error(details), { code, details, isRpc: true });

// Map any thrown error to a gRPC status. Internals are logged, never sent to the client.
function toStatus(err) {
  if (err?.isRpc) return err;
  if (err?.name === 'ValidationError') {
    return rpcError(status.INVALID_ARGUMENT, Object.values(err.errors).map((e) => e.message).join('; '));
  }
  if (err?.code === 11000) return rpcError(status.ALREADY_EXISTS, `${Object.keys(err.keyValue).join(', ')} already exists`);
  console.error(err);
  return rpcError(status.INTERNAL, 'Internal error');
}

const toProto = (p) => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  priceCents: p.priceCents,
  stock: p.stock,
  createdAt: p.createdAt.toISOString(),
});

// Resolves when the client can take more data, or when the call is cancelled (so we never hang).
const drained = (call) =>
  new Promise((resolve) => {
    const done = () => {
      call.off('drain', done);
      call.off('cancelled', done);
      resolve();
    };
    call.on('drain', done);
    call.on('cancelled', done);
  });

const handlers = {
  async CreateProduct({ request: { sku, name, priceCents, stock } }) {
    return toProto(await Product.create({ sku, name, priceCents, stock }));
  },

  async GetProduct({ request: { id } }) {
    if (!mongoose.isValidObjectId(id)) throw rpcError(status.INVALID_ARGUMENT, 'id must be a valid ObjectId');
    const product = await Product.findById(id);
    if (!product) throw rpcError(status.NOT_FOUND, `Product ${id} not found`);
    return toProto(product);
  },

  // Streams one product at a time from a Mongo cursor: memory stays flat for any collection size.
  async ListProducts(call) {
    const filter = call.request.inStockOnly ? { stock: { $gt: 0 } } : {};
    for await (const product of Product.find(filter).sort({ _id: 1 }).cursor()) {
      if (call.cancelled) return; // client gone or deadline passed: stop reading Mongo
      if (!call.write(toProto(product))) await drained(call); // backpressure
    }
  },

  // Reads the whole client stream, creates what is valid, reports the rest. One bad row does not fail the batch.
  async ImportProducts(call) {
    let index = 0;
    let created = 0;
    const errors = [];
    for await (const { sku, name, priceCents, stock } of call) {
      if (index >= MAX_IMPORT) throw rpcError(status.RESOURCE_EXHAUSTED, `at most ${MAX_IMPORT} products per import`);
      try {
        await Product.create({ sku, name, priceCents, stock });
        created++;
      } catch (err) {
        if (errors.length < MAX_IMPORT_ERRORS) errors.push({ index, sku, message: toStatus(err).details });
      }
      index++;
    }
    return { created, failed: index - created, errors };
  },

  // One response per change, in order. Errors are reported per item; the stream stays open.
  async UpdateStock(call) {
    // destroyOnReturn: false - a plain `for await` destroys the duplex when reading ends,
    // and then our write side (and the final status) never reaches the client.
    for await (const { sku, delta } of call.iterator({ destroyOnReturn: false })) {
      if (call.cancelled) return;
      if (!call.write(await applyStockChange(sku.toUpperCase(), delta))) await drained(call);
    }
  },
};

async function applyStockChange(sku, delta) {
  if (!delta) return { sku, ok: false, error: 'delta must be a non-zero integer' };
  // Check and update in ONE atomic operation: parallel sales can never push stock below 0.
  const updated = await Product.findOneAndUpdate(
    { sku, stock: { $gte: Math.max(0, -delta) } },
    { $inc: { stock: delta } },
    { returnDocument: 'after' },
  );
  if (updated) return { sku, stock: updated.stock, ok: true };
  const existing = await Product.findOne({ sku });
  return existing
    ? { sku, stock: existing.stock, ok: false, error: 'insufficient stock' }
    : { sku, ok: false, error: 'unknown sku' };
}

// --- Auth + error plumbing, per call type ---------------------------------------------------

function authorized(call, apiKey) {
  const sent = Buffer.from(String(call.metadata.get('x-api-key')[0] ?? ''));
  const expected = Buffer.from(apiKey);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}
const unauthenticated = () => rpcError(status.UNAUTHENTICATED, 'missing or invalid x-api-key metadata');

// Unary and client-streaming handlers answer through a callback.
const withCallback = (fn, apiKey) => (call, callback) => {
  if (!authorized(call, apiKey)) return callback(unauthenticated());
  fn(call).then((res) => callback(null, res), (err) => callback(toStatus(err)));
};

// Server-streaming and bidi handlers write to the call, then end it or emit an error status.
const withStream = (fn, apiKey) => (call) => {
  if (!authorized(call, apiKey)) return call.emit('error', unauthenticated());
  fn(call).then(
    () => !call.cancelled && call.end(),
    (err) => !call.cancelled && call.emit('error', toStatus(err)),
  );
};

export function createGrpcServer({ apiKey }) {
  if (!apiKey) throw new Error('apiKey is required');
  const server = new grpc.Server();
  const { service } = InventoryService;

  server.addService(
    service,
    Object.fromEntries(
      Object.entries(handlers).map(([name, fn]) => {
        const { responseStream } = service[name];
        return [name, responseStream ? withStream(fn, apiKey) : withCallback(fn, apiKey)];
      }),
    ),
  );

  // Health is public so probes need no key. "" = whole server.
  server.addService(Health.service, {
    Check({ request }, callback) {
      if (request.service && request.service !== 'inventory.v1.InventoryService') {
        return callback(rpcError(status.NOT_FOUND, 'unknown service'));
      }
      callback(null, { status: mongoose.connection.readyState === 1 ? 'SERVING' : 'NOT_SERVING' });
    },
  });

  return server;
}
