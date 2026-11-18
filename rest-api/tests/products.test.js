import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { Product } from '../src/models/product.model.js';

// Needs a running MongoDB. Uses its own database and drops it afterwards.
const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/rest_api_test';
const API = '/api/v1/products';

const book = { name: 'Clean Code', sku: 'bk-cc-001', price: 32, category: 'books', stock: 5 };

before(async () => {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();
  await Product.syncIndexes(); // unique sku index must exist for the 409 test
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('POST creates a product: 201 + Location, ignores non-writable fields', async () => {
  const res = await request(app).post(API).send({ ...book, _id: 'hack', createdAt: '2000-01-01' }).expect(201);
  assert.equal(res.headers.location, `${API}/${res.body.id}`);
  assert.equal(res.body.sku, 'BK-CC-001'); // uppercased by schema
  assert.equal(res.body._id, undefined);
  assert.notEqual(new Date(res.body.createdAt).getFullYear(), 2000);
});

test('POST duplicate sku -> 409', async () => {
  const res = await request(app).post(API).send(book).expect(409);
  assert.equal(res.headers['content-type'], 'application/problem+json; charset=utf-8');
  assert.match(res.body.detail, /sku/);
});

test('POST invalid body -> 422 with field errors', async () => {
  const res = await request(app).post(API).send({ name: 'X', price: -1, category: 'cars', sku: 'ok-1' }).expect(422);
  const fields = res.body.errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ['category', 'name', 'price']);
});

test('POST malformed JSON -> 400', async () => {
  const res = await request(app).post(API).set('Content-Type', 'application/json').send('{"name":').expect(400);
  assert.equal(res.body.title, 'Malformed JSON');
});

test('GET list supports filter, sort, fields and pagination', async () => {
  await Product.insertMany([
    { name: 'Headphones', sku: 'EL-1', price: 60, category: 'electronics', stock: 3 },
    { name: 'Keyboard', sku: 'EL-2', price: 90, category: 'electronics', stock: 0 },
    { name: 'Mouse', sku: 'EL-3', price: 20, category: 'electronics', stock: 9 },
  ]);

  const res = await request(app)
    .get(API)
    .query({ category: 'electronics', minPrice: 25, sort: '-price', fields: 'name,price', limit: 1, page: 2 })
    .expect(200);

  assert.deepEqual(res.body.meta, { page: 2, limit: 1, total: 2, totalPages: 2 });
  assert.equal(res.body.data[0].name, 'Headphones');
  assert.equal(res.body.data[0].sku, undefined); // not selected

  const inStock = await request(app).get(API).query({ category: 'electronics', inStock: 'true', q: 'o' }).expect(200);
  assert.deepEqual(inStock.body.data.map((p) => p.name).sort(), ['Headphones', 'Mouse']);
});

test('GET list rejects operator injection and bad numbers', async () => {
  await request(app).get(`${API}?minPrice=abc`).expect(400);
  // Express 5 does not parse ?category[$ne]=x into {$ne: 'x'}; the key is just unknown and ignored.
  const all = await request(app).get(API).expect(200);
  const res = await request(app).get(`${API}?category[$ne]=x`).expect(200);
  assert.equal(res.body.meta.total, all.body.meta.total);
});

test('GET one: 200, 404 for missing, 400 for malformed id', async () => {
  const { body } = await request(app).post(API).send({ ...book, sku: 'BK-2' });
  await request(app).get(`${API}/${body.id}`).expect(200);
  await request(app).get(`${API}/${new mongoose.Types.ObjectId()}`).expect(404);
  await request(app).get(`${API}/not-an-id`).expect(400);
});

test('PATCH changes only sent fields; PUT replaces and resets missing ones', async () => {
  const { body: created } = await request(app).post(API).send({ ...book, sku: 'BK-3', tags: ['dev'] });

  const patched = await request(app).patch(`${API}/${created.id}`).send({ price: 25 }).expect(200);
  assert.equal(patched.body.price, 25);
  assert.deepEqual(patched.body.tags, ['dev']);

  const put = await request(app)
    .put(`${API}/${created.id}`)
    .send({ name: 'Clean Code 2e', sku: 'BK-3', price: 40, category: 'books' })
    .expect(200);
  assert.deepEqual(put.body.tags, []); // reset to default
  assert.equal(put.body.stock, 0);
  assert.equal(put.body.createdAt, created.createdAt); // preserved

  await request(app).put(`${API}/${created.id}`).send({ name: 'No price' }).expect(422);
});

test('DELETE -> 204, then 404', async () => {
  const { body } = await request(app).post(API).send({ ...book, sku: 'BK-4' });
  await request(app).delete(`${API}/${body.id}`).expect(204);
  await request(app).delete(`${API}/${body.id}`).expect(404);
});

test('unknown route -> 404 problem details', async () => {
  const res = await request(app).get('/api/v1/nope').expect(404);
  assert.equal(res.body.status, 404);
});
