# API Versioning: Key Terminologies

**API versioning** lets you change an API without breaking the clients already using it. Old clients keep calling the old version while new clients move to the new one.

---

## 1. Core concepts

| Term | Meaning |
|------|---------|
| **API version** | A named snapshot of the API contract (`v1`, `v2`, `2024-06-01`). |
| **API contract** | The promise to clients: endpoints, inputs, outputs, status codes, errors. |
| **Consumer / Client** | Anyone calling the API; they depend on the contract. |
| **Breaking change** | A change that makes existing clients fail. Needs a new version. |
| **Non-breaking (additive) change** | A change old clients can safely ignore. No new version needed. |
| **Backward compatibility** | New server works with old clients. |
| **Forward compatibility** | Old clients tolerate responses from a newer server (e.g. ignore unknown fields). |
| **Default version** | The version served when the client does not ask for one. |
| **Latest version** | The newest released version. |

## 2. Breaking vs non-breaking changes

| Breaking ❌ | Non-breaking ✅ |
|------------|----------------|
| Removing or renaming an endpoint | Adding a new endpoint |
| Removing or renaming a field | Adding a new optional response field |
| Changing a field's type (`id`: number → string) | Adding a new optional request field / query param |
| Making an optional request field required | Making a required request field optional |
| Changing status codes or error format | Adding a new enum value *(only if clients handle unknown values)* |
| Changing auth method | Improving performance |
| Changing default behavior, sorting, or pagination | Adding new headers |

> **Tolerant Reader**: clients should ignore fields they don't know. This makes additive changes safe.

## 3. Versioning strategies

| Strategy | Example | Pros | Cons |
|----------|---------|------|------|
| **URI path** | `GET /v1/users` | Clear, easy to route, cache, and test in a browser | URL changes per version; "not pure REST" |
| **Query parameter** | `GET /users?version=1` | Easy to add | Easy to forget; messy caching |
| **Custom header** | `X-API-Version: 1` | Clean URLs | Hidden; harder to test and cache |
| **Media type / content negotiation** | `Accept: application/vnd.myapp.v2+json` | Most "RESTful"; can version per resource | Complex for clients |
| **Date-based** | `Stripe-Version: 2024-06-20` | Fine-grained, frequent small changes | Server must maintain many transforms |
| **Hostname / subdomain** | `v2.api.example.com` | Fully separate deployments | Heavy infra cost |

> **URI path versioning** is the most common choice for public APIs (GitHub, Twitter/X, many others).

## 4. Version numbering

| Term | Meaning | Example |
|------|---------|---------|
| **Semantic Versioning (SemVer)** | `MAJOR.MINOR.PATCH` | `2.4.1` |
| **MAJOR** | Breaking changes | `1.x` → `2.0` |
| **MINOR** | New backward-compatible features | `2.3` → `2.4` |
| **PATCH** | Backward-compatible bug fixes | `2.4.0` → `2.4.1` |
| **Major-only versioning** | Public APIs usually expose only the major number. | `/v1`, `/v2` |
| **Calendar / date versioning** | Version named by release date. | `2024-06-20` |

## 5. Lifecycle terms

| Term | Meaning |
|------|---------|
| **Alpha / Beta / Preview** | Unstable version; may change without notice. |
| **GA (General Availability)** | Stable, supported version. |
| **Deprecation** | Version still works but is scheduled for removal; clients should migrate. |
| **Sunset** | The date a deprecated version stops working. |
| **Retirement / EOL (End of Life)** | Version is removed; calls return `410 Gone` (or `404`). |
| **Deprecation policy** | Published rule for how long old versions live (e.g. "12 months after v2 GA"). |
| **Migration guide** | Doc explaining how to move from `v1` to `v2`. |
| **Changelog** | Ordered list of changes per version. |
| **Version pinning** | A client locks to a specific version (often per API key / account). |

```
 Beta ──► GA ──► Deprecated ──► Sunset ──► Retired (410 Gone)
```

## 6. Headers used in versioning

| Header | Purpose | Example |
|--------|---------|---------|
| `Accept` | Request a versioned media type | `application/vnd.myapp.v2+json` |
| `Content-Type` | Version of the body sent | `application/vnd.myapp.v2+json` |
| `X-API-Version` / `Api-Version` | Custom version header | `2` |
| `Deprecation` (RFC 9745) | Marks a response as deprecated | `Deprecation: @1735689600` |
| `Sunset` (RFC 8594) | When this version stops working | `Sunset: Wed, 31 Dec 2025 23:59:59 GMT` |
| `Link` | Points to docs / successor version | `Link: <https://api.example.com/v2/users>; rel="successor-version"` |
| `Vary` | Tells caches the response depends on a header | `Vary: Accept, X-API-Version` |

## 7. Implementation terms (Node.js)

| Term | Meaning |
|------|---------|
| **Versioned router** | Mount one router per version: `app.use('/v1', v1Router)`, `app.use('/v2', v2Router)`. |
| **Version middleware** | Reads the version from URL / header and sets `req.apiVersion`. |
| **Shared service layer** | Business logic shared by all versions; only controllers / serializers differ. |
| **Serializer / transformer** | Converts internal data to the shape a given version expects. |
| **Adapter / compatibility layer** | Translates an old-version request into the new format so one codebase serves both. |
| **Version gateway routing** | API Gateway routes `/v1/*` and `/v2/*` to different services or deployments. |
| **Feature flag** | Turns new behavior on per client without a new version. |

```js
// Version via URI path
app.use('/v1/users', require('./v1/users.routes'));
app.use('/v2/users', require('./v2/users.routes'));

// Version via header
app.use((req, res, next) => {
  req.apiVersion = req.get('X-API-Version') || '1'; // default version
  next();
});
```

## 8. Related concepts

| Term | Meaning |
|------|---------|
| **API evolution (versionless)** | Avoid versions: only make additive changes forever (common in GraphQL with `@deprecated`). |
| **Expand and contract** | Add the new field, migrate clients, then remove the old field. |
| **Contract testing** | Tests that check a provider still meets each consumer's expectations (e.g. Pact). |
| **OpenAPI spec per version** | Separate `openapi-v1.yaml` / `openapi-v2.yaml` documenting each version. |
| **API diff** | Tool comparing two specs to detect breaking changes (e.g. `oasdiff`). |
| **Usage analytics** | Track which clients still call old versions before sunsetting. |

## 9. Best practices

- Version from day one (`/v1`), even if you never ship `v2`.
- Bump the version **only for breaking changes**; ship additive changes in place.
- Keep the number of live versions small (usually 2).
- Announce deprecations early with `Deprecation` + `Sunset` headers and a migration guide.
- Never change behavior of an existing version silently.
- Share business logic across versions; version only the edges (routes, validation, serialization).
- Monitor old-version traffic and contact clients before retirement.
