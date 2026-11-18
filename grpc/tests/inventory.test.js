import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { grpc, InventoryService, Health } from '../src/proto.js';
import { createGrpcServer } from '../src/inventory.service.js';
import { createGatewayApp } from '../src/gateway.js';
import { Product } from '../src/models/product.model.js';

// Needs a running MongoDB. Uses its own database and drops it afterwards.
const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/grpc_inventory_test';
const API_KEY = 'test-key';
const { status } = grpc;

let server;
let target;
let client;
let gateway;

const meta = (key = API_KEY) => {
  const md = new grpc.Metadata();
  md.set('x-api-key', key);
  return md;
};

const unary = (method, req, md = meta()) =>
  new Promise((resolve, reject) => client[method](req, md, (err, res) => (err ? reject(err) : resolve(res))));

const rejectsWith = (promise, code) => assert.rejects(promise, (err) => err.code === code || assert.fail(`${grpc.status[err.code]}: ${err.details}`));

before(async () => {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();
  await Product.syncIndexes();
  server = createGrpcServer({ apiKey: API_KEY });
  const port = await new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p))),
  );
  target = `127.0.0.1:${port}`;
  client = new InventoryService(target, grpc.credentials.createInsecure());
  gateway = createGatewayApp({ target, apiKey: API_KEY });
});

after(async () => {
  client.close();
  gateway.close();
  server.forceShutdown();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('unary: CreateProduct + GetProduct', async () => {
  const created = await unary('CreateProduct', { sku: 'kb-001', name: 'Keyboard', priceCents: 8950, stock: 3 });
  assert.equal(created.sku, 'KB-001'); // uppercased by schema
  assert.equal(created.priceCents, 8950); // int64 arrives as a JS number

  const got = await unary('GetProduct', { id: created.id });
  assert.deepEqual(got, created);
});

test('status codes: ALREADY_EXISTS, INVALID_ARGUMENT, NOT_FOUND, UNAUTHENTICATED', async () => {
  await rejectsWith(unary('CreateProduct', { sku: 'KB-001', name: 'Dup', priceCents: 1 }), status.ALREADY_EXISTS);
  await rejectsWith(unary('CreateProduct', { sku: 'x', name: 'Y', priceCents: 1 }), status.INVALID_ARGUMENT);
  await rejectsWith(unary('GetProduct', { id: 'nope' }), status.INVALID_ARGUMENT);
  await rejectsWith(unary('GetProduct', { id: '000000000000000000000000' }), status.NOT_FOUND);
  await rejectsWith(unary('GetProduct', { id: '000000000000000000000000' }, meta('wrong')), status.UNAUTHENTICATED);
  await rejectsWith(unary('GetProduct', { id: '000000000000000000000000' }, new grpc.Metadata()), status.UNAUTHENTICATED);
});

test('client streaming: ImportProducts creates valid rows and reports bad ones', async () => {
  const summary = await new Promise((resolve, reject) => {
    const call = client.ImportProducts(meta(), (err, res) => (err ? reject(err) : resolve(res)));
    call.write({ sku: 'MS-001', name: 'Mouse', priceCents: 1999, stock: 25 });
    call.write({ sku: 'HP-001', name: 'Headphones', priceCents: 5999, stock: 0 });
    call.write({ sku: 'KB-001', name: 'Duplicate', priceCents: 1 }); // exists
    call.write({ sku: 'BAD', name: 'Z', priceCents: 1 }); // name too short
    call.end();
  });
  assert.equal(summary.created, 2);
  assert.equal(summary.failed, 2);
  assert.deepEqual(summary.errors.map((e) => e.index), [2, 3]);
  assert.match(summary.errors[0].message, /already exists/);
});

test('server streaming: ListProducts streams every match in order', async () => {
  const all = [];
  for await (const p of client.ListProducts({}, meta())) all.push(p.sku);
  assert.deepEqual(all, ['KB-001', 'MS-001', 'HP-001']);

  const inStock = [];
  for await (const p of client.ListProducts({ inStockOnly: true }, meta())) inStock.push(p.sku);
  assert.deepEqual(inStock, ['KB-001', 'MS-001']);
});

test('server streaming without a key ends with UNAUTHENTICATED', async () => {
  const stream = client.ListProducts({}, meta('wrong'));
  await rejectsWith((async () => { for await (const _ of stream); })(), status.UNAUTHENTICATED);
});

test('bidirectional: UpdateStock answers each change in order, never goes below 0', async () => {
  const call = client.UpdateStock(meta());
  const levels = [];
  call.on('data', (l) => levels.push(l));
  const done = new Promise((resolve, reject) => call.on('end', resolve).on('error', reject));
  call.write({ sku: 'kb-001', delta: -2 }); // 3 -> 1
  call.write({ sku: 'KB-001', delta: -5 }); // insufficient
  call.write({ sku: 'KB-001', delta: 10 }); // 1 -> 11
  call.write({ sku: 'NOPE-1', delta: 1 });
  call.write({ sku: 'KB-001', delta: 0 });
  call.end();
  await done;

  assert.deepEqual(
    levels.map(({ stock, ok, error }) => [stock, ok, error]),
    [[1, true, ''], [1, false, 'insufficient stock'], [11, true, ''], [0, false, 'unknown sku'], [0, false, 'delta must be a non-zero integer']],
  );
});

test('parallel stock decrements never oversell', async () => {
  await Product.updateOne({ sku: 'MS-001' }, { stock: 5 });
  const sell = () =>
    new Promise((resolve, reject) => {
      const call = client.UpdateStock(meta());
      call.on('data', resolve).on('error', reject);
      call.write({ sku: 'MS-001', delta: -1 });
      call.end();
    });
  const results = await Promise.all(Array.from({ length: 8 }, sell));
  assert.equal(results.filter((r) => r.ok).length, 5);
  assert.equal((await Product.findOne({ sku: 'MS-001' })).stock, 0);
});

test('deadline: an already-expired deadline fails with DEADLINE_EXCEEDED', async () => {
  const call = new Promise((resolve, reject) =>
    client.GetProduct({ id: '000000000000000000000000' }, meta(), { deadline: Date.now() - 1 }, (err, res) => (err ? reject(err) : resolve(res))),
  );
  await rejectsWith(call, status.DEADLINE_EXCEEDED);
});

test('health check reports SERVING without an api key', async () => {
  const health = new Health(target, grpc.credentials.createInsecure());
  const res = await new Promise((resolve, reject) => health.Check({ service: '' }, (err, r) => (err ? reject(err) : resolve(r))));
  assert.equal(res.status, 'SERVING');
  health.close();
});

test('REST gateway translates HTTP <-> gRPC, including status codes', async () => {
  const created = await request(gateway).post('/api/products').send({ sku: 'gw-001', name: 'Gateway Item', priceCents: 500, stock: 1 }).expect(201);
  assert.equal(created.headers.location, `/api/products/${created.body.id}`);

  await request(gateway).get(`/api/products/${created.body.id}`).expect(200);
  await request(gateway).post('/api/products').send({ sku: 'gw-001', name: 'Dup', priceCents: 1 }).expect(409);
  await request(gateway).post('/api/products').send({ sku: 'gw-002', name: 'Bad', priceCents: 'abc' }).expect(400);
  await request(gateway).get('/api/products/000000000000000000000000').expect(404);
  await request(gateway).get('/api/products/nope').expect(400);

  const list = await request(gateway).get('/api/products?inStock=true').expect(200);
  assert.ok(list.body.data.some((p) => p.sku === 'GW-001'));
  await request(gateway).get('/health').expect(200);
});
