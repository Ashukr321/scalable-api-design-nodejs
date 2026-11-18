# API Versioning in Node.js (Express + MongoDB)

A working **Users API** that runs **v1 (deprecated)** and **v2 (current)** side by side on one server and one MongoDB database. It shows how a real Node backend keeps old clients working while it ships breaking changes, and how a version is retired.

Terms used here are explained in [key-terminologies.md](key-terminologies.md).

---

## 1. Setting up a Node + Express + MongoDB project from scratch

These are the steps used to create this folder. Follow them for any new backend.

### Step 1: Create the project

```bash
mkdir my-api && cd my-api
git init
npm init -y
```

In `package.json` add `"type": "module"` (to use `import` / `export`) and the scripts:

```json
{
  "type": "module",
  "scripts": {
    "start": "node --env-file-if-exists=.env src/server.js",
    "dev": "node --watch --env-file-if-exists=.env src/server.js",
    "test": "node --test"
  },
  "engines": { "node": ">=22" }
}
```

> Node 22+ already has `--watch` (no nodemon), `--env-file` (no dotenv) and `node:test` (no Jest).

### Step 2: Install dependencies

```bash
npm install express mongoose helmet cors
npm install -D supertest
```

| Package | Why |
|---------|-----|
| `express` | HTTP server and routing (v5 sends async errors to the error handler for you) |
| `mongoose` | MongoDB schemas, validation, queries |
| `helmet` | Security headers |
| `cors` | Lets browser apps on other domains call the API |
| `supertest` *(dev)* | Calls the Express app in tests without opening a port |

### Step 3: Environment variables

`.env.example` (committed) documents what is needed. `.env` (git-ignored) holds real values.

```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/api_versioning_demo
```

Add `node_modules/` and `.env` to `.gitignore`.

### Step 4: Folder structure (versioned from day one)

```
src/
├── server.js                 # connect to MongoDB, start listening, graceful shutdown
├── app.js                    # Express app: middleware, version routers, error handler
├── versions.js               # which versions exist + their lifecycle dates
├── models/                   # Mongoose schemas: ONE per collection, shared by all versions
│   └── user.model.js
├── services/                 # business logic: shared by all versions
│   └── user.service.js
├── api/
│   ├── v1/                   # only what is different about v1
│   │   ├── index.js          # mounts every v1 resource
│   │   ├── users.routes.js
│   │   └── users.serializer.js
│   └── v2/
│       ├── index.js
│       ├── users.routes.js
│       └── users.serializer.js
├── middlewares/
│   ├── deprecation.js        # Deprecation / Sunset headers, 410 after sunset
│   └── errorHandler.js       # one error format for all versions
└── utils/ApiError.js
tests/
└── versioning.test.js
```

**Rule:** `models/` and `services/` are shared. Only routes and serializers live under `api/vN/`. A bug fixed in the service is fixed in every version at once.

### Step 5: Split `app.js` and `server.js`

`app.js` builds and exports the Express app. `server.js` connects to MongoDB and calls `listen`. Tests import `app.js` directly, so they never open a real port.

```js
// src/server.js
import mongoose from 'mongoose';
import app from './app.js';

await mongoose.connect(process.env.MONGO_URI);
app.listen(process.env.PORT || 3000);
```

```js
// src/app.js
app.use(express.json({ limit: '100kb' }));
app.use('/api/v1', deprecate(VERSIONS.v1.deprecation), v1);
app.use('/api/v2', v2);
app.use(notFound);
app.use(errorHandler);
```

### Step 6: Run

```bash
cp .env.example .env
npm run dev     # http://localhost:3000/api
npm test        # needs MongoDB running; uses the api_versioning_test database
```

---

## 2. How a request flows through versions

```
GET /api/v1/users/42                         GET /api/v2/users/42
        │                                            │
  deprecate() middleware                             │
  adds Deprecation/Sunset/Link                       │
  (or 410 Gone after sunset)                         │
        │                                            │
  api/v1/users.routes.js                     api/v2/users.routes.js
        │                                            │
        └──────────────► services/user.service.js ◄──┘
                                  │
                          models/user.model.js
                                  │
                               MongoDB
        ┌─────────────────────────┴──────────────────────────┐
  v1 serializer: toV1()                              v2 serializer: toV2()
  { id, name, email, isActive }      { id, firstName, lastName, email, phone, status, ... }
```

The database stores one shape. Each version's **serializer** translates between that shape and the version's public contract.

---

## 3. What changed from v1 to v2 (the migration guide)

Each row is a **breaking change**, which is why v2 exists.

| | v1 (deprecated) | v2 (current) |
|--|-----------------|--------------|
| Name | `name: "Asha Kumar"` | `firstName: "Asha"`, `lastName: "Kumar"` |
| Status | `isActive: true/false` | `status: "active" \| "inactive" \| "suspended"` |
| Phone | not available | `phone` |
| Timestamps | `createdAt` | `createdAt`, `updatedAt` |
| List filter | `?isActive=true` | `?status=active` |
| Pagination | Offset: `?page=2&limit=20` | Cursor: `?cursor=<nextCursor>&limit=20` |
| List response | `{ users, total, page, limit }` | `{ data, page: { limit, nextCursor } }` |
| Deprecation headers | Yes | No |

v1 example:

```http
GET /api/v1/users?page=1&limit=2

HTTP/1.1 200 OK
Deprecation: @1793491200
Sunset: Wed, 30 Jun 2027 00:00:00 GMT
Link: </api/v2/users>; rel="successor-version", <https://example.com/docs/migrate-v1-to-v2>; rel="deprecation"

{ "users": [{ "id": "…", "name": "Asha Kumar", "email": "asha@example.com", "isActive": true, "createdAt": "…" }],
  "total": 7, "page": 1, "limit": 2 }
```

v2 example (same user):

```http
GET /api/v2/users?limit=2

HTTP/1.1 200 OK

{ "data": [{ "id": "…", "firstName": "Asha", "lastName": "Kumar", "email": "asha@example.com",
             "phone": null, "status": "active", "createdAt": "…", "updatedAt": "…" }],
  "page": { "limit": 2, "nextCursor": "6650f1c2a1b2c3d4e5f60789" } }
```

To get the next page in v2, send `?cursor=<nextCursor>`. When `nextCursor` is `null` there are no more pages.

---

## 4. Endpoints

| Method | v1 | v2 |
|--------|----|----|
| `GET` | `/api/v1/users` | `/api/v2/users` |
| `GET` | `/api/v1/users/:id` | `/api/v2/users/:id` |
| `POST` | `/api/v1/users` | `/api/v2/users` |
| `PATCH` | `/api/v1/users/:id` | `/api/v2/users/:id` |
| `DELETE` | `/api/v1/users/:id` | `/api/v2/users/:id` |
| `GET` | `/api` lists live versions and the latest one | |

Errors use RFC 9457 Problem Details in both versions: `400` bad id / cursor, `404` not found, `409` duplicate email, `410` version retired, `422` validation failed.

---

## 5. How to ship a new version (v2 → v3 playbook)

### Do you even need a new version?

| Change | New version? |
|--------|:------------:|
| Add an endpoint, an optional field, an optional query param | ❌ Ship it in the current version |
| Fix a bug | ❌ Fix it in the shared service |
| Rename/remove a field, change a type, change the response envelope, change pagination, make a field required | ✅ New major version |

Most changes should **not** need a new version. Prefer additive changes.

### Steps

1. **Change the data layer without breaking anything (expand).** Add new fields to the Mongoose model so both versions can use them. Old documents must still load (use `default`), or run a data migration script.
2. **Create the new version folder.** Copy `api/v2/` to `api/v3/`, then change only its routes and serializer. Resources with no breaking change reuse the old router: `v3.use('/orders', v2OrdersRoutes)`.
3. **Mount it.** In `app.js`: `app.use('/api/v3', v3)`.
4. **Register it.** In `versions.js`: add `v3: { status: 'current' }`, set `LATEST = 'v3'`, and give v2 a `deprecation` with `since`, `sunset`, `successor: '/api/v3'` and a `docs` link.
5. **Mark the old version deprecated.** `app.use('/api/v2', deprecate(VERSIONS.v2.deprecation), v2)`. Clients now see `Deprecation`, `Sunset` and `Link` on every v2 response.
6. **Test both versions.** Old tests stay and must keep passing. Add tests for the new contract.
7. **Document and announce.** Publish a migration guide (like section 3), update the changelog and OpenAPI spec, and email API consumers.
8. **Monitor.** Log which clients still call the old version (per API key / user agent) and contact them.
9. **Retire.** After the sunset date the `deprecate()` middleware automatically returns `410 Gone`. Later, delete `api/v2/` and its route mount.
10. **Clean up the data (contract).** Once no version reads an old field, remove it from the model and the database.

### Typical timeline

```
Day 0           v3 GA, v2 deprecated (Deprecation + Sunset headers)
Day 0 – 6 mo    Clients migrate; v2 frozen (security/bug fixes only)
Sunset date     v2 returns 410 Gone automatically
Sunset + 1 mo   Delete api/v2/ code
```

### Rules for the team

- **Freeze old versions.** New features only go into the latest version.
- **Never change an existing version's contract**, even "small" field renames.
- **Keep at most two live versions** (current + one deprecated).
- **One error format** for every version.
- **Business logic lives in services**, never in `api/vN/` routes.
- **Version the edges** (routes, validation, serialization), not the database.

---

## 6. Other ways to read the version (not used here)

URI versioning (`/api/v1`) is the simplest and most common. If you need header versioning instead, read the version in middleware and pick the router:

```js
const routers = { 1: v1, 2: v2 };
app.use('/api', (req, res, next) => {
  const version = req.get('Api-Version') || '2';      // default = latest
  const router = routers[version];
  if (!router) return res.status(400).json({ title: `Unknown API version ${version}` });
  res.set('Vary', 'Api-Version');                       // caches must key on the header
  router(req, res, next);
});
```
