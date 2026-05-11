# pier

A small Bun + Elysia service that stands in for the dead `jetty` Rust backend behind [`KodexLabs/kodex-interface`](https://github.com/KodexLabs/kodex-interface). It speaks the routes the frontend's fetchers call, returns JSON in the shape the frontend deserializes, and reads ENS data from [ENSNode](https://ensnode.io) instead of Postgres. Every route's input and output is described by a TypeBox schema, so the OpenAPI spec at `/docs/json` and the Scalar UI at `/docs` stay in lock-step with the implementation.

The original jetty needed Postgres + Redis + an Ethereum archive node + Reservoir + a now-defunct Heroku-hosted vectorisation service. Reviving any of that is out of scope. pier is stateless except for an in-memory session map and an LRU cache, so `bun --hot src/index.ts` is the entire dev story.

## Quick start

```bash
bun install
cp .env.example .env       # optional — defaults work for local dev
bun --hot src/index.ts     # listens on :8000
```

Then point the frontend at it. **Setting `NEXT_PUBLIC_JETTY_URL` alone is not enough** — only the RainbowKit SIWE adapter reads `config.jettyBaseUrl` from that env var (in `app/lib/core/siweAuthentication.ts`). Every other fetcher (`fetchMarketplaceDomains`, `fetchUserDomains`, `fetchDomainExpiryDate`, the cart/like mutations, …) imports a hardcoded `JETTY_URL` from `app/constants/api/index.ts`:

```ts
export const JETTY_URL = 'https://jetty.kodex.io'
```

Patch that one line to read from the env so the data fetchers also hit pier:

```diff
-export const JETTY_URL = 'https://jetty.kodex.io'
+export const JETTY_URL = process.env.NEXT_PUBLIC_JETTY_URL || 'https://jetty.kodex.io'
```

Then run the frontend:

```bash
# in kodex-interface, after the patch above
echo 'NEXT_PUBLIC_JETTY_URL=http://localhost:8000' >> .env.local
bun dev                    # runs on :3071
```

If you'd rather not edit kodex-interface (the project's no-modify-frontend rule applies in spirit to pier itself, not to your local dev tree), the alternative is a hosts-file redirect of `jetty.kodex.io` to `127.0.0.1` plus a local TLS proxy in front of pier — more setup, no source edits.

`http://localhost:3071` should boot. Search returns real ENS names, domain detail pages show real owners and expiry dates, SIWE login works, and the portfolio page lists names you actually own. Marketplace buy/sell flows depend on the Reservoir SDK and remain broken — that's expected.

The interactive API browser is at <http://localhost:8000/docs> (Scalar) and the raw OpenAPI spec at <http://localhost:8000/docs/json>.

### Docker

A multi-stage Dockerfile (per [Elysia's deploy guide](https://elysiajs.com/patterns/deploy)) compiles a single static binary on the Bun image and ships it from `gcr.io/distroless/base`. End image is ~140 MB with no shell, no Node, no Bun runtime — just the binary.

```bash
docker build -t pier .
docker run --rm -p 8000:8000 pier
# or override env: -e ENSNODE_URL=... -e GRAILS_ANALYTICS_BASE=... -e ALLOWED_ORIGINS=https://my.frontend
```

`PORT`, `ENSNODE_URL`, `GRAILS_ANALYTICS_BASE` (optional), `ALLOWED_ORIGINS`, `SESSION_TTL_MS`, and `NODE_ENV` are all picked up from the container env. There's no HEALTHCHECK directive in the Dockerfile — point your orchestrator's HTTP probe at `/health_check`.

## Environment variables

| var | default | purpose |
|---|---|---|
| `PORT` | `8000` | HTTP listen port |
| `ENSNODE_URL` | `https://api.alpha.ensnode.io/subgraph` | upstream GraphQL endpoint |
| `GRAILS_ANALYTICS_BASE` | _(unset)_ | optional — e.g. `https://api.grails.app/api/v1/analytics` feeds `/total_stats` sales columns from [Grails](https://api.grails.app/api/v1/analytics/market) market + sales APIs |
| `ALLOWED_ORIGINS` | `http://localhost:3071` | comma-separated CORS allowlist |
| `SESSION_TTL_MS` | `86400000` (24h) | SIWE session lifetime |
| `NODE_ENV` | `development` | when `production`, the session cookie is `Secure` |

## Route table

Real = backed by ENSNode. Stub = returns the right shape with empty/zero values because the upstream data source is gone.

| method | path | status | source |
|---|---|---|---|
| GET | `/health_check` | real | static `{ stable: true }` |
| GET | `/nonce` | real | `siwe.generateNonce()` |
| POST | `/verify` | real | SIWE EIP-191 verify, sets `id` cookie |
| GET | `/authenticate` | real | reads cookie or `id` header |
| GET | `/search/plain` | real | ENSNode `name_starts_with` |
| GET | `/search/similar` | MVP | ENSNode `name_contains` (no embeddings) |
| GET | `/info/domain/expires` | real | ENSNode `name_in`; `expires: 0` for unknown ids |
| GET | `/info/domain/categories` | stub | empty `categories[]` per requested domain |
| GET | `/domains/owner` | real | ENSNode `where: { owner }` |
| GET | `/roll` | real | random pick from a hardcoded pool of well-known names |
| GET | `/total_stats` | partial | ENSNode + optional Grails; **amounts are integer wei strings** (Kodex UI `formatEtherPrice`) |
| GET | `/floor_price` | stub | `{ domains: [] }` |
| GET | `/feed/events` | stub | `{ events: [] }` |
| GET | `/feed/aggregate` | stub | `{ aggregations: [] }` |
| GET | `/feed/activity/domain` | stub | `{ events: [] }` |
| GET | `/user/like` | stub (auth) | `{ domains: [] }` |
| POST/DELETE | `/user/like` | stub (auth) | 204 |
| GET | `/user/cart/list` | stub (auth) | `[]` |
| POST/DELETE | `/user/cart/modify` | stub (auth) | 204 |
| DELETE | `/user/cart/clear` | stub (auth) | 204 |

The stubs are not gaps in pier's coverage — they exist because the frontend will call them and the responses must deserialize cleanly. The corresponding UI surfaces (cart, likes, marketplace stats, activity feeds, floor prices) will render their empty state.

## How it fits together

```
src/
├── index.ts              Elysia app + @elysiajs/cors + @elysiajs/openapi (Scalar)
├── env.ts                zod-parsed process.env (+ derived allowedDomains set)
├── upstreams/ensnode.ts  GraphQL fetch wrapper + 5 typed helpers (cached, single-flight)
├── routes/               one file per logical route group; each carries its t schemas
│   ├── health.ts
│   ├── auth.ts           /nonce, /verify, /authenticate
│   ├── search.ts         /search/plain, /search/similar, /roll
│   ├── domain.ts         /info/domain/*
│   ├── user.ts           /domains/owner, /user/like, /user/cart/* (auth gate via .resolve)
│   ├── stats.ts          /total_stats, /floor_price
│   └── feed.ts           /feed/*
└── lib/
    ├── shape.ts          ENSNode Domain → MarketplaceDomainType
    ├── cache.ts          `ensCache` 30s/1000-entry TTL+LRU; `statsAggregationCache` 60s for `/total_stats` registration aggregates
    ├── session.ts        in-memory sessions + nonce store (single-use, 5min TTL)
    ├── schemas.ts        TypeBox schemas reused across routes (drives OpenAPI)
    └── types.ts
```

## Adding a new upstream

1. Drop a file in `src/upstreams/` that exposes typed functions returning the upstream's native shape.
2. Wrap each query in `ensCache.getOrSet` (or a sibling cache instance) so concurrent calls collapse to one upstream request.
3. Add a converter in `src/lib/shape.ts` that maps the upstream shape into the frontend type the route returns. Test it.
4. Wire the route handler in `src/routes/<group>.ts` and mount the group in `src/index.ts`.

Keep upstream code stupid (just fetch + parse) and let `lib/shape.ts` carry the format-translation logic. That's the only place we run unit tests, and it's where bugs hide.

## Tests

```bash
bun test
```

99 tests across 5 files cover:

- **`shape.ts`** — every ENSNode→kodex field mapping, including the labelName/multi-label fallbacks and the expiry source priority.
- **`cache.ts`** — TTL expiry, LRU eviction, recency promotion on get, single-flight deduplication, errored loaders not poisoning the slot, and post-expiry refetch.
- **`session.ts`** — nonce single-use + 5-minute TTL, session creation lowercasing, resolve/drop lifecycle and TTL eviction (`spyOn(Date, 'now')`), `readSessionId` precedence.
- **`upstreams/ensnode.ts`** — gql wrapper with mocked `fetch`: variable passing, owner lowercasing, sorted-input cache keys, retry-once-on-5xx, no-retry-on-4xx, GraphQL `errors[]` propagation.
- **`routes/*`** — every endpoint exercised in-process via `app.handle(new Request(...))`, with the full SIWE handshake driven by viem (happy path, malformed body, wrong domain, unknown nonce, tampered signature, replay, signOut-via-/nonce), CORS preflight from allowed and disallowed origins, auth gating on `/user/*`, and the `/docs` + `/docs/json` mounts.

Test helpers in `test/helpers.ts` (`installFetch`, `gqlOk`, `ensDomain`, `req.{get,post,del,options}`) keep the assertions short.

## Known limitations

- Reservoir-dependent endpoints (listings, offers, floor price, activity feeds, total stats) return empty/zero values. Buy/sell flows from `@reservoir0x/reservoir-kit-ui` will fail at runtime; pier is not their replacement.
- `/info/domain/expires` only returns real data for identifiers shaped like ENS names. Hex tokenIds (`getDomainHexId(...)`) get `expires: 0` because we can't reverse a keccak.
- `/search/similar` is a substring match, not real similarity. Replacing it with embeddings is plausible future work but out of scope for the MVP.
- Sessions live in-process. Restart pier and every signed-in user has to re-sign. Fine for dev; would need swapping `lib/session.ts` for a real store before any multi-process deployment.
- ENSNode's alpha endpoint may rotate. If it goes away, set `ENSNODE_URL` to The Graph's hosted ENS subgraph (or whatever ENSNode publishes next) — the schema is stable.
