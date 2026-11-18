import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createClient } from 'graphql-ws';
import { createServer } from '../src/app.js';
import { Author, Post } from '../src/models/index.js';

// Needs a running MongoDB. Uses its own database and drops it afterwards.
const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/graphql_blog_test';

let httpServer;
let stop;
let wsUrl;
let asha;
let ravi;

// Counts Mongo queries per collection, to prove DataLoader batching.
const queries = [];
mongoose.set('debug', (collection, method) => queries.push(`${collection}.${method}`));

async function gql(query, variables, { status = 200 } = {}) {
  const res = await request(httpServer).post('/graphql').send({ query, variables }).expect(status);
  return res.body;
}
const codeOf = (body) => body.errors?.[0]?.extensions?.code;

before(async () => {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();
  await Author.syncIndexes();
  ({ httpServer, stop } = await createServer());
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  wsUrl = `ws://127.0.0.1:${httpServer.address().port}/graphql`;
});

after(async () => {
  await stop();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const CREATE_AUTHOR = `mutation ($input: CreateAuthorInput!) { createAuthor(input: $input) { id name email } }`;
const CREATE_POST = `mutation ($input: CreatePostInput!) { createPost(input: $input) { id title tags published author { name } } }`;

test('mutations: createAuthor + createPost, nested author resolved', async () => {
  asha = (await gql(CREATE_AUTHOR, { input: { name: 'Asha', email: 'ASHA@example.com' } })).data.createAuthor;
  ravi = (await gql(CREATE_AUTHOR, { input: { name: 'Ravi', email: 'ravi@example.com' } })).data.createAuthor;
  assert.equal(asha.email, 'asha@example.com');

  const { data } = await gql(CREATE_POST, { input: { authorId: asha.id, title: 'Hello GraphQL', body: '...', tags: ['GraphQL'] } });
  assert.deepEqual(data.createPost, { id: data.createPost.id, title: 'Hello GraphQL', tags: ['graphql'], published: false, author: { name: 'Asha' } });
});

test('client gets exactly the fields it asked for', async () => {
  const { data } = await gql(`{ authors { name } }`);
  assert.deepEqual(data.authors, [{ name: 'Asha' }, { name: 'Ravi' }]);
});

test('errors carry extensions.code: BAD_USER_INPUT, CONFLICT, NOT_FOUND; partial data stays', async () => {
  const invalid = await gql(CREATE_AUTHOR, { input: { name: 'A', email: 'nope' } });
  assert.equal(codeOf(invalid), 'BAD_USER_INPUT');
  assert.deepEqual(invalid.errors[0].extensions.fields.map((f) => f.field).sort(), ['email', 'name']);

  assert.equal(codeOf(await gql(CREATE_AUTHOR, { input: { name: 'Asha 2', email: 'asha@example.com' } })), 'CONFLICT');
  assert.equal(codeOf(await gql(CREATE_POST, { input: { authorId: '000000000000000000000000', title: 'Orphan', body: 'x' } })), 'NOT_FOUND');
  assert.equal(codeOf(await gql(`{ post(id: "nope") { id } }`)), 'BAD_USER_INPUT');

  // A missing nullable field is just null; the rest of the query still returns data.
  const partial = await gql(`{ post(id: "000000000000000000000000") { id } authors { name } }`);
  assert.equal(partial.data.post, null);
  assert.equal(partial.data.authors.length, 2);
});

test('schema validation errors: unknown field, missing variable type -> 400', async () => {
  const body = await gql(`{ authors { password } }`, undefined, { status: 400 });
  assert.equal(codeOf(body), 'GRAPHQL_VALIDATION_FAILED');
  assert.match(body.errors[0].message, /Cannot query field "password"/);
});

test('cursor pagination: newest first, pages do not overlap', async () => {
  for (let i = 1; i <= 5; i++) await Post.create({ authorId: ravi.id, title: `Ravi post ${i}`, body: 'x', published: true });
  const PAGE = `query ($after: String) {
    posts(first: 2, after: $after, filter: { authorId: "${ravi.id}" }) { edges { cursor node { title } } pageInfo { hasNextPage endCursor } }
  }`;
  const titles = [];
  let after = null;
  let pages = 0;
  do {
    const { data } = await gql(PAGE, { after });
    titles.push(...data.posts.edges.map((e) => e.node.title));
    after = data.posts.pageInfo.hasNextPage ? data.posts.pageInfo.endCursor : null;
    pages++;
  } while (after);
  assert.equal(pages, 3);
  assert.deepEqual(titles, ['Ravi post 5', 'Ravi post 4', 'Ravi post 3', 'Ravi post 2', 'Ravi post 1']);

  assert.equal(codeOf(await gql(`{ posts(first: 500) { pageInfo { hasNextPage } } }`)), 'BAD_USER_INPUT');
  assert.equal(codeOf(await gql(`{ posts(after: "garbage") { pageInfo { hasNextPage } } }`)), 'BAD_USER_INPUT');
});

test('filters: tag + published', async () => {
  const { data } = await gql(`{ posts(filter: { tag: "GRAPHQL", published: false }) { edges { node { title } } } }`);
  assert.deepEqual(data.posts.edges.map((e) => e.node.title), ['Hello GraphQL']);
});

test('DataLoader: 6 posts + their authors = ONE authors query (no N+1)', async () => {
  queries.length = 0;
  const { data } = await gql(`{ posts(first: 6) { edges { node { title author { name } } } } }`);
  assert.equal(data.posts.edges.length, 6);
  assert.equal(queries.filter((q) => q.startsWith('authors.')).length, 1, queries.join(', '));
});

test('updatePost changes only the fields sent; deletePost', async () => {
  const { data: created } = await gql(CREATE_POST, { input: { authorId: asha.id, title: 'Draft', body: 'body', tags: ['a'] } });
  const id = created.createPost.id;

  const { data } = await gql(`mutation ($id: ID!) { updatePost(id: $id, input: { published: true }) { title published tags } }`, { id });
  assert.deepEqual(data.updatePost, { title: 'Draft', published: true, tags: ['a'] });

  assert.equal(codeOf(await gql(`mutation ($id: ID!) { updatePost(id: $id, input: { title: "x" }) { id } }`, { id })), 'BAD_USER_INPUT');

  const del = `mutation ($id: ID!) { deletePost(id: $id) }`;
  assert.equal((await gql(del, { id })).data.deletePost, true);
  assert.equal((await gql(del, { id })).data.deletePost, false);
});

test('depth limit rejects abusive nesting', async () => {
  const deep = `{ posts { edges { node { author { posts { edges { node { author { name } } } } } } } } }`;
  const body = await gql(deep, undefined, { status: 400 });
  assert.match(body.errors[0].message, /exceeds the maximum of 7/);
});

test('subscription: commentAdded pushes only comments for the subscribed post', async () => {
  const { data: p1 } = await gql(CREATE_POST, { input: { authorId: asha.id, title: 'Live post', body: 'x' } });
  const { data: p2 } = await gql(CREATE_POST, { input: { authorId: asha.id, title: 'Other post', body: 'x' } });
  const postId = p1.createPost.id;

  const client = createClient({ url: wsUrl, webSocketImpl: WebSocket, lazy: false });
  const received = [];
  const gotOne = new Promise((resolve, reject) => {
    client.subscribe(
      { query: `subscription ($postId: ID!) { commentAdded(postId: $postId) { text author { name } post { title } } }`, variables: { postId } },
      { next: (msg) => (received.push(msg.data.commentAdded), resolve()), error: reject, complete: () => {} },
    );
  });
  await new Promise((r) => setTimeout(r, 200)); // let the subscription register on the server

  const ADD = `mutation ($input: AddCommentInput!) { addComment(input: $input) { id } }`;
  await gql(ADD, { input: { postId: p2.createPost.id, authorId: ravi.id, text: 'not for you' } });
  await gql(ADD, { input: { postId, authorId: ravi.id, text: 'Nice post!' } });
  await gotOne;

  assert.deepEqual(received, [{ text: 'Nice post!', author: { name: 'Ravi' }, post: { title: 'Live post' } }]);
  await client.dispose();
});

test('GET /health', async () => {
  await request(httpServer).get('/health').expect(200);
});
