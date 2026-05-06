# pier

A small Bun + Hono service that stands in for the dead `jetty` Rust backend behind [`KodexLabs/kodex-interface`](https://github.com/KodexLabs/kodex-interface). It speaks the routes the frontend's fetchers call, returns JSON in the shape the frontend deserializes, and reads ENS data from [ENSNode](https://ensnode.io) instead of Postgres.

The original jetty needed Postgres + Redis + an Ethereum archive node + Reservoir + a now-defunct Heroku-hosted vectorisation service. Reviving any of that is out of scope. pier is stateless except for an in-memory session map and an LRU cache, so `bun --hot src/index.ts` is the entire dev story.

## Quick start

```bash
bun install
cp .env.example .env       # optional — defaults work for local dev
bun --hot src/index.ts     # listens on :8000
```

Then point the frontend at it:

```bash
# in kodex-interface
echo 'NEXT_PUBLIC_JETTY_URL=http://localhost:8000' >> .env.local
bun dev                    # runs on :3071
```

`http://localhost:3071` should boot. Search returns real ENS names, domain detail pages show real owners and expiry dates, SIWE login works, and the portfolio page lists names you actually own. Marketplace buy/sell flows depend on the Reservoir SDK and remain broken — that's expected.

## Environment variables

| var | default | purpose |
|---|---|---|
| `PORT` | `8000` | HTTP listen port |
| `ENSNODE_URL` | `https://api.alpha.ensnode.io/subgraph` | upstream GraphQL endpoint |
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
| GET | `/total_stats` | stub | all-zero `TotalStatsType` |
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
├── index.ts              Hono app + Bun.serve
├── env.ts                zod-parsed process.env
├── upstreams/ensnode.ts  GraphQL fetch wrapper + 5 typed helpers
├── routes/               one file per logical route group
│   ├── health.ts
│   ├── auth.ts           /nonce, /verify, /authenticate
│   ├── search.ts         /search/plain, /search/similar, /roll
│   ├── domain.ts         /info/domain/*
│   ├── user.ts           /domains/owner, /user/like, /user/cart/*
│   ├── stats.ts          /total_stats, /floor_price
│   └── feed.ts           /feed/*
└── lib/
    ├── shape.ts          ENSNode Domain → frontend MarketplaceDomainType (tested)
    ├── cache.ts          30s/1000-entry TTL+LRU with single-flight
    ├── session.ts        in-memory session map + requireAuth
    ├── cors.ts           echo-origin CORS w/ credentials
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

Only `lib/shape.ts` is under test. Stubs are not.

## Known limitations

- Reservoir-dependent endpoints (listings, offers, floor price, activity feeds, total stats) return empty/zero values. Buy/sell flows from `@reservoir0x/reservoir-kit-ui` will fail at runtime; pier is not their replacement.
- `/info/domain/expires` only returns real data for identifiers shaped like ENS names. Hex tokenIds (`getDomainHexId(...)`) get `expires: 0` because we can't reverse a keccak.
- `/search/similar` is a substring match, not real similarity. Replacing it with embeddings is plausible future work but out of scope for the MVP.
- Sessions live in-process. Restart pier and every signed-in user has to re-sign. Fine for dev; would need swapping `lib/session.ts` for a real store before any multi-process deployment.
- ENSNode's alpha endpoint may rotate. If it goes away, set `ENSNODE_URL` to The Graph's hosted ENS subgraph (or whatever ENSNode publishes next) — the schema is stable.
