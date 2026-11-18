# GraphQL: Blog API (Node.js + Apollo Server + Express + MongoDB)

A small, production-style GraphQL API for a **blog**: authors, posts and comments. It shows queries, mutations, live subscriptions, the N+1 fix with DataLoader, cursor pagination, typed errors and query-depth limits. It puts the ideas from [key-terminologies.md](key-terminologies.md) into working code.

**Stack:** Node.js 22+, Apollo Server 5, Express 5, graphql-ws (subscriptions), DataLoader, MongoDB + Mongoose. Tests use `node:test` + supertest + a real graphql-ws client.

## Run it

```bash
cd graphql
npm install
cp .env.example .env     # set MONGO_URI if MongoDB is not on localhost:27017
npm run seed             # 2 authors, 4 posts, 3 comments
npm run dev              # open http://localhost:4000/graphql for Apollo Sandbox
npm test                 # needs MongoDB running; uses the graphql_blog_test database
```

One endpoint, one path:

| Protocol | URL | Used for |
|----------|-----|----------|
| HTTP `POST` (or `GET` for queries) | `http://localhost:4000/graphql` | Queries and mutations |
| WebSocket (`graphql-transport-ws`) | `ws://localhost:4000/graphql` | Subscriptions |
| HTTP `GET` | `/health` | Liveness + DB status |

## Schema

Full SDL: [src/graphql/typeDefs.js](src/graphql/typeDefs.js).

```graphql
type Author  { id, name, email, posts(first, after): PostConnection!, createdAt }
type Post    { id, title, body, tags, published, author: Author!, comments: [Comment!]!, createdAt, updatedAt }
type Comment { id, text, author: Author!, post: Post!, createdAt }

type Query {
  author(id: ID!): Author
  authors: [Author!]!
  post(id: ID!): Post
  posts(first: Int = 10, after: String, filter: PostFilter): PostConnection!
}

type Mutation {
  createAuthor(input: CreateAuthorInput!): Author!
  createPost(input: CreatePostInput!): Post!
  updatePost(id: ID!, input: UpdatePostInput!): Post!
  deletePost(id: ID!): Boolean!
  addComment(input: AddCommentInput!): Comment!
}

type Subscription {
  commentAdded(postId: ID!): Comment!
}
```

## Try it

**Query: nested data in one request, only the fields you need**

```graphql
query FeedPage($after: String) {
  posts(first: 2, after: $after, filter: { tag: "graphql", published: true }) {
    edges {
      node {
        title
        author { name }
        comments { text author { name } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

Pass the returned `endCursor` as `after` to get the next page.

**Mutation with variables**

```graphql
mutation AddPost($input: CreatePostInput!) {
  createPost(input: $input) { id title author { name } }
}
```

```json
{ "input": { "authorId": "<author id>", "title": "Hello", "body": "First post", "tags": ["intro"] } }
```

**Subscription** (open in a second Sandbox tab, then run `addComment` for the same post)

```graphql
subscription OnComment($postId: ID!) {
  commentAdded(postId: $postId) { text author { name } }
}
```

**curl**

```bash
curl -X POST localhost:4000/graphql -H "Content-Type: application/json" \
  -d '{"query":"{ authors { name posts(first: 1) { edges { node { title } } } } }"}'
```

## Errors

GraphQL responses are usually HTTP `200`, even with errors. Errors are in the `errors` array, each with a stable `extensions.code`. Any data that could be resolved is still returned next to the errors.

```json
{
  "errors": [{
    "message": "Validation failed",
    "path": ["createAuthor"],
    "extensions": { "code": "BAD_USER_INPUT", "fields": [{ "field": "email", "message": "..." }] }
  }],
  "data": null
}
```

| `extensions.code` | When | HTTP |
|-------------------|------|:----:|
| `GRAPHQL_PARSE_FAILED` | Query is not valid GraphQL syntax | `400` |
| `GRAPHQL_VALIDATION_FAILED` | Unknown field, wrong argument type, query deeper than 7 levels | `400` |
| `BAD_USER_INPUT` | Invalid id/cursor, `first` outside 1–50, schema validation (`fields` lists each problem) | `200` |
| `NOT_FOUND` | `authorId` / `postId` in a mutation does not exist | `200` |
| `CONFLICT` | Duplicate author email | `200` |
| `INTERNAL_SERVER_ERROR` | Unexpected error (logged; the client only sees "Internal server error") | `200` |

Querying a missing item with `post(id:)` / `author(id:)` returns `null`, not an error.

## Project structure

```
graphql/
├── src/
│   ├── graphql/
│   │   ├── typeDefs.js      # Schema (SDL)
│   │   ├── resolvers.js     # Query / Mutation / Subscription + field resolvers, pagination, errors
│   │   ├── loaders.js       # DataLoaders (batching + per-request cache)
│   │   └── depthLimit.js    # Validation rule: max query depth
│   ├── models/index.js      # Mongoose models: Author, Post, Comment
│   ├── app.js               # Express + Apollo + graphql-ws on one HTTP server
│   ├── server.js            # DB connect, listen, graceful shutdown
│   └── seed.js
└── tests/graphql.test.js
```

## GraphQL concepts shown in the code

| Concept | Where |
|---------|-------|
| Schema-first SDL: types, inputs, non-null `!`, lists, default argument values, descriptions | `typeDefs.js` |
| Custom scalar (`DateTime`) | `resolvers.js` |
| Query, Mutation, Subscription root types | `resolvers.js` |
| Field resolvers (run only when the field is requested) | `Post.author`, `Post.comments`, `Author.posts` |
| Context per request (holds the DataLoaders) | `expressMiddleware(..., { context })` in `app.js` |
| N+1 problem solved with DataLoader (test proves 1 query) | `loaders.js` |
| Relay-style cursor pagination (`edges`, `node`, `cursor`, `pageInfo`) | `paginate()` |
| Input types and partial updates | `CreatePostInput`, `UpdatePostInput` |
| Typed errors with `extensions.code`; partial data | `userError()`, `db()` |
| Masking internal errors | `formatError` in `app.js` |
| Subscriptions over WebSocket with filtering (`withFilter`) | `Subscription.commentAdded`, `useServer` |
| Query depth limit + page-size cap (DoS protection) | `depthLimit.js`, `MAX_PAGE` |
| Introspection and landing page off in production | `app.js` |
| CSRF prevention, body-size limit | `app.js` |
| NoSQL-injection safety (args are typed by the schema; filters built from known fields) | `postFilter()` |
| Graceful shutdown (drain HTTP + close subscriptions) | `app.js`, `server.js` |

## Next steps (not in this example)

- Authentication (JWT in the `Authorization` header → `context.user`) and per-field authorization
- Query cost / complexity analysis and persisted queries (only allow known operations)
- Redis PubSub for subscriptions across several instances
- Response caching (`@cacheControl`) and automatic persisted queries (APQ)
- Codegen for typed resolvers and client hooks (GraphQL Code Generator)
- Federation to compose several GraphQL services into one graph
