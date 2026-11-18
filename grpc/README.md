# gRPC: Inventory Service (Node.js + MongoDB + Express REST gateway)

A small, production-style gRPC microservice for **product inventory**. It shows all four gRPC call types, status codes, metadata auth, deadlines, streaming backpressure, health checks, and a REST gateway that lets browsers use it. It puts the ideas from [key-terminologies.md](key-terminologies.md) into working code.

**Stack:** Node.js 22+, [`@grpc/grpc-js`](https://www.npmjs.com/package/@grpc/grpc-js), [`@grpc/proto-loader`](https://www.npmjs.com/package/@grpc/proto-loader), MongoDB + Mongoose, Express 5 (gateway). Tests use `node:test` + real gRPC clients + supertest.

```
 browser / public client ──HTTP+JSON──▶ REST gateway (Express :3000) ──gRPC──▶ InventoryService (:50051) ──▶ MongoDB
 internal services ─────────────────────────────────────────────────gRPC──▶
```

## Run it

```bash
cd grpc
npm install
cp .env.example .env     # API_KEY, MONGO_URI, ports
npm run dev              # gRPC server on localhost:50051
npm run client           # 2nd terminal: demo of all 4 call types
npm run gateway          # 3rd terminal: REST gateway on http://localhost:3000
npm test                 # needs MongoDB running; uses the grpc_inventory_test database
```

Try it with [grpcurl](https://github.com/fullstorydev/grpcurl) (the server has no reflection, so pass the proto):

```bash
grpcurl -plaintext -import-path proto -proto inventory.proto -H "x-api-key: dev-secret-key" \
  -d '{"sku":"KB-1","name":"Keyboard","price_cents":8950,"stock":10}' \
  localhost:50051 inventory.v1.InventoryService/CreateProduct

grpcurl -plaintext -import-path proto -proto health.proto localhost:50051 grpc.health.v1.Health/Check
```

Or through the gateway:

```bash
curl -X POST localhost:3000/api/products -H "Content-Type: application/json" \
  -d '{"sku":"KB-2","name":"Keyboard","priceCents":8950,"stock":10}'
curl "localhost:3000/api/products?inStock=true"
```

## The contract: [proto/inventory.proto](proto/inventory.proto)

| RPC | Type | Request → Response | What it does |
|-----|------|--------------------|--------------|
| `CreateProduct` | Unary | `CreateProductRequest` → `Product` | Create one product |
| `GetProduct` | Unary | `GetProductRequest` → `Product` | Get one by id |
| `ListProducts` | Server streaming | `ListProductsRequest` → `stream Product` | Stream products straight from a MongoDB cursor (`in_stock_only` filter) |
| `ImportProducts` | Client streaming | `stream CreateProductRequest` → `ImportSummary` | Bulk import; bad rows are reported, good rows are kept |
| `UpdateStock` | Bidirectional | `stream StockChange` → `stream StockLevel` | Send `+n` / `-n` stock changes, get the new level for each, in order |

Plus the standard `grpc.health.v1.Health/Check` ([proto/health.proto](proto/health.proto)), which needs no API key so probes can call it.

Money is `int64 price_cents`; stock never goes below 0 (checked and updated in one atomic MongoDB operation).

### Auth

Every `InventoryService` call must send metadata `x-api-key: <API_KEY>`, otherwise it fails with `UNAUTHENTICATED`. The key is compared in constant time.

### Status codes

| gRPC status | When | Gateway HTTP |
|-------------|------|:------------:|
| `OK` | Success | `200` / `201` |
| `INVALID_ARGUMENT` | Bad id, schema validation (sku format, name length, negative price) | `400` |
| `UNAUTHENTICATED` | Missing / wrong `x-api-key` | `401` |
| `NOT_FOUND` | Product id does not exist | `404` |
| `ALREADY_EXISTS` | Duplicate `sku` | `409` |
| `RESOURCE_EXHAUSTED` | More than 10,000 products in one import | `429` |
| `DEADLINE_EXCEEDED` | The caller's deadline passed | `504` |
| `UNAVAILABLE` | Server not reachable | `503` |
| `INTERNAL` | Unexpected error (logged, never sent in detail) | `500` |

`UpdateStock` reports per-item problems (`unknown sku`, `insufficient stock`, `delta must be a non-zero integer`) inside the stream as `ok: false`, so one bad change does not end the call.

### REST gateway

| Method | Route | gRPC call |
|--------|-------|-----------|
| `GET` | `/api/products?inStock=true` | `ListProducts` (stream collected into a JSON array) |
| `GET` | `/api/products/:id` | `GetProduct` |
| `POST` | `/api/products` | `CreateProduct` → `201` + `Location` |
| `GET` | `/health` | `Health/Check` |

The gateway adds the API key and a 2-second deadline to every call, and maps gRPC status codes to HTTP (table above).

## Project structure

```
grpc/
├── proto/
│   ├── inventory.proto          # The service contract
│   └── health.proto             # Standard health checking protocol
├── src/
│   ├── proto.js                 # Loads the .proto files (no code generation step)
│   ├── inventory.service.js     # RPC handlers, auth, error -> status mapping, health
│   ├── server.js                # Mongo connect, bind, graceful shutdown
│   ├── gateway.js               # Express REST -> gRPC gateway
│   ├── client.js                # Demo client: all 4 call types
│   └── models/product.model.js
└── tests/inventory.test.js
```

## gRPC concepts shown in the code

| Concept | Where |
|---------|-------|
| Contract-first `.proto`, package versioning (`inventory.v1`), field numbers | `proto/inventory.proto` |
| Dynamic loading with proto-loader (camelCase fields, `int64` → number) | `src/proto.js` |
| Unary, server streaming, client streaming, bidirectional streaming | `handlers` in `inventory.service.js` |
| Status codes instead of HTTP codes; internal errors hidden | `toStatus()` |
| Metadata (headers) for auth, constant-time key compare | `authorized()` |
| Deadlines on every client call; server stops work on cancel | `client.js`, `gateway.js`, `call.cancelled` |
| Streaming backpressure (`write()` returns false → wait for `drain`) | `drained()` |
| Streaming from a MongoDB cursor (flat memory) | `ListProducts` |
| Per-item errors inside a stream vs failing the whole call | `ImportProducts`, `UpdateStock` |
| Atomic stock update (no overselling under concurrency) | `applyStockChange()` |
| Standard health checking service | `grpc.health.v1.Health` |
| REST ↔ gRPC transcoding gateway | `gateway.js` |
| Graceful shutdown (`tryShutdown`, then `forceShutdown`) | `server.js` |

## Next steps (not in this example)

- TLS / mTLS between services (`grpc.ServerCredentials.createSsl`)
- Server reflection, so tools work without the `.proto` file
- Interceptors for logging, metrics and tracing (OpenTelemetry)
- Client-side load balancing (`round_robin` + DNS) or a service mesh, retries via a service config
- Generated TypeScript types (`ts-proto` or `buf generate`) and `buf lint` / `buf breaking` in CI
