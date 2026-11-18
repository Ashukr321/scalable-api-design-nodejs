import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { User } from '../src/models/user.model.js';
import { deprecate } from '../src/middlewares/deprecation.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';

// Needs a running MongoDB. Uses its own database and drops it afterwards.
const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/api_versioning_test';

before(async () => {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();
  await User.syncIndexes();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('same user, two contracts: created via v1, read via v2', async () => {
  const v1 = await request(app)
    .post('/api/v1/users')
    .send({ name: 'Asha Rani Kumar', email: 'ASHA@example.com', isActive: true })
    .expect(201);
  assert.deepEqual(Object.keys(v1.body).sort(), ['createdAt', 'email', 'id', 'isActive', 'name']);
  assert.equal(v1.body.name, 'Asha Rani Kumar');

  const v2 = await request(app).get(`/api/v2/users/${v1.body.id}`).expect(200);
  assert.equal(v2.body.firstName, 'Asha');
  assert.equal(v2.body.lastName, 'Rani Kumar');
  assert.equal(v2.body.status, 'active');
  assert.equal(v2.body.email, 'asha@example.com');
  assert.equal(v2.body.name, undefined);
});

test('v1 responses carry Deprecation, Sunset and successor Link; v2 does not', async () => {
  const v1 = await request(app).get('/api/v1/users').expect(200);
  assert.match(v1.headers.deprecation, /^@\d+$/);
  assert.equal(v1.headers.sunset, new Date('2027-06-30').toUTCString());
  assert.match(v1.headers.link, /<\/api\/v2\/users>; rel="successor-version"/);

  const v2 = await request(app).get('/api/v2/users').expect(200);
  assert.equal(v2.headers.deprecation, undefined);
  assert.equal(v2.headers.sunset, undefined);
});

test('v1 PATCH stays partial and maps isActive -> status', async () => {
  const { body } = await request(app).post('/api/v1/users').send({ name: 'Ravi', email: 'ravi@example.com' });
  const patched = await request(app).patch(`/api/v1/users/${body.id}`).send({ isActive: false }).expect(200);
  assert.equal(patched.body.isActive, false);
  assert.equal(patched.body.name, 'Ravi');

  const v2 = await request(app).get(`/api/v2/users/${body.id}`);
  assert.equal(v2.body.status, 'inactive');
});

test('v2 accepts new fields (phone, suspended status) that v1 never exposes', async () => {
  const v2 = await request(app)
    .post('/api/v2/users')
    .send({ firstName: 'Meera', lastName: 'Shah', email: 'meera@example.com', phone: '+91-9000000000', status: 'suspended' })
    .expect(201);
  assert.equal(v2.headers.location, `/api/v2/users/${v2.body.id}`);

  const v1 = await request(app).get(`/api/v1/users/${v2.body.id}`).expect(200);
  assert.equal(v1.body.phone, undefined);
  assert.equal(v1.body.isActive, false); // suspended is "not active" for v1 clients
});

test('v1 uses offset pagination, v2 uses cursor pagination over the same data', async () => {
  await User.insertMany(Array.from({ length: 5 }, (_, i) => ({ firstName: `P${i}`, email: `p${i}@example.com` })));
  const total = await User.countDocuments();

  const v1 = await request(app).get('/api/v1/users?page=1&limit=2').expect(200);
  assert.equal(v1.body.users.length, 2);
  assert.equal(v1.body.total, total);

  const seen = [];
  let cursor = '';
  do {
    const res = await request(app).get('/api/v2/users').query({ limit: 2, ...(cursor && { cursor }) }).expect(200);
    seen.push(...res.body.data.map((u) => u.id));
    cursor = res.body.page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, total);
  assert.equal(new Set(seen).size, total); // no duplicates across pages

  await request(app).get('/api/v2/users?cursor=bad').expect(400);
});

test('errors: duplicate email 409, validation 422, unknown version 404', async () => {
  await request(app).post('/api/v2/users').send({ firstName: 'A', email: 'dup@example.com' }).expect(201);
  await request(app).post('/api/v1/users').send({ name: 'B', email: 'dup@example.com' }).expect(409);
  await request(app).post('/api/v2/users').send({ firstName: 'C', email: 'bad', status: 'zombie' }).expect(422);
  await request(app).get('/api/v3/users').expect(404);
});

test('GET /api lists versions and the latest one', async () => {
  const res = await request(app).get('/api').expect(200);
  assert.equal(res.body.latest, 'v2');
  assert.equal(res.body.versions.v1.status, 'deprecated');
});

test('after the sunset date a version returns 410 Gone', async () => {
  const retired = express();
  retired.use('/api/v0', deprecate({ since: '2020-01-01', sunset: '2021-01-01', successor: '/api/v2' }), (_req, res) => res.json({}));
  retired.use(errorHandler);

  const res = await request(retired).get('/api/v0/users').expect(410);
  assert.match(res.body.detail, /\/api\/v2/);
});
