# REST API: Products Catalog (Node.js + Express + MongoDB)

A small, production-style REST API for an e-commerce **product catalog**. It puts the ideas from [key-terminologies.md](key-terminologies.md) into working code.

**Stack:** Node.js 22+, Express 5, MongoDB + Mongoose, helmet, cors, express-rate-limit. Tests use `node:test` + supertest.

## Run it

```bash
cd rest-api
npm install
cp .env.example .env     # set MONGO_URI if MongoDB is not on localhost:27017
npm run seed             # 7 sample products
npm run dev              # http://localhost:3000
npm test                 # needs MongoDB running; uses the rest_api_test database
```

Open [requests.http](requests.http) in VS Code (REST Client extension) to try every endpoint.

## Endpoints

Base URL: `http://localhost:3000/api/v1`

| Method | Route | What it does | Success |
|--------|-------|--------------|---------|
| `GET` | `/products` | List with filter, search, sort, fields, pagination | `200` |
| `GET` | `/products/:id` | Get one product | `200` |
| `POST` | `/products` | Create a product | `201` + `Location` |
| `PUT` | `/products/:id` | Replace the whole product (missing fields reset to defaults) | `200` |
| `PATCH` | `/products/:id` | Update only the fields sent | `200` |
| `DELETE` | `/products/:id` | Delete a product | `204` |
| `GET` | `/health` | Liveness + DB status | `200` / `503` |

### List query parameters

| Param | Example | Meaning |
|-------|---------|---------|
| `category` | `?category=books` | Exact match |
| `minPrice`, `maxPrice` | `?minPrice=10&maxPrice=50` | Price range |
| `inStock` | `?inStock=true` | `stock > 0` |
| `isActive` | `?isActive=true` | Active products only |
| `q` | `?q=keyboard` | Case-insensitive name search |
| `sort` | `?sort=-price,name` | `-` = descending. Default `-createdAt` |
| `fields` | `?fields=name,price` | Return only these fields |
| `page`, `limit` | `?page=2&limit=20` | Offset pagination (`limit` max 100) |

List response:

```json
{
  "data": [{ "id": "...", "name": "Clean Code", "price": 32 }],
  "meta": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 }
}
```

### Product shape

```json
{
  "id": "6650f1c2a1b2c3d4e5f60789",
  "name": "Mechanical Keyboard",
  "sku": "EL-KB-002",
  "description": "",
  "price": 89.5,
  "category": "electronics",
  "stock": 15,
  "tags": ["pc"],
  "isActive": true,
  "createdAt": "2026-11-18T07:30:00.000Z",
  "updatedAt": "2026-11-18T07:30:00.000Z"
}
```

`category` is one of `electronics`, `books`, `fashion`, `home`, `sports`. `sku` is unique and stored uppercase.

### Errors (RFC 9457 Problem Details)

Every error uses `Content-Type: application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 422,
  "instance": "/api/v1/products",
  "errors": [{ "field": "price", "message": "Path `price` is required." }]
}
```

| Status | When |
|--------|------|
| `400` | Malformed JSON, invalid id, non-numeric `minPrice` / `maxPrice` |
| `404` | Product or route does not exist |
| `409` | Duplicate `sku` |
| `413` | Body larger than 100 KB |
| `422` | Body fails schema validation |
| `429` | Rate limit hit (300 requests / 15 min per IP) |
| `500` | Unexpected error (details are logged, never sent to the client) |

## Project structure

```
rest-api/
├── src/
│   ├── app.js                         # Express app: middleware, routes, error handler
│   ├── server.js                      # DB connect, listen, graceful shutdown
│   ├── seed.js                        # Sample data
│   ├── models/product.model.js        # Mongoose schema + validation + indexes
│   ├── controllers/product.controller.js
│   ├── routes/product.routes.js
│   ├── middlewares/errorHandler.js    # 404 + Problem Details
│   └── utils/
│       ├── ApiError.js
│       └── listQuery.js               # Whitelisted filter / sort / fields / pagination
├── tests/products.test.js
└── requests.http
```

## REST concepts shown in the code

| Concept | Where |
|---------|-------|
| Resource nouns, plural, method carries the action | `routes/product.routes.js` |
| URI versioning (`/api/v1`) | `app.js` |
| `201` + `Location` header on create | `createProduct` |
| `PUT` (replace) vs `PATCH` (partial update) | `replaceProduct`, `updateProduct` |
| `204 No Content` on delete | `deleteProduct` |
| Filtering, search, sorting, field selection, pagination | `utils/listQuery.js` |
| Stable pagination (`_id` tie-breaker) | `utils/listQuery.js` |
| Mass-assignment protection (writable-field whitelist) | `WRITABLE_FIELDS`, `pickWritable` |
| NoSQL-injection safety (no raw query objects reach Mongo) | `utils/listQuery.js` |
| Consistent error format (Problem Details) | `middlewares/errorHandler.js` |
| Security headers, CORS, rate limiting, body-size limit | `app.js` |
| `ETag` / `304 Not Modified` on `GET` | Built into Express |
| Health check for load balancers | `GET /health` |
| Graceful shutdown | `server.js` |
| Stateless server (scale horizontally behind a load balancer) | No sessions anywhere |

## Next steps (not in this example)

- Authentication (JWT) and role-based authorization on write routes
- Cursor pagination for very large collections
- Redis caching and a shared rate-limit store when running several instances
- OpenAPI spec + Swagger UI
