# Birds

A job queue system that looks up bird information from Wikipedia. Clients submit a bird name via the HTTP API, a background worker fetches the Wikipedia intro, and the result is stored in an embedded LMDB database.

## Architecture

### Components

- **API server** (`src/index.ts`) — Express HTTP server that accepts job submissions and serves results. Instrumented with metrics on job creation and result requests.
- **Worker** (`daemons/worker.ts`) — Standalone process that claims queued jobs, fetches the Wikipedia intro for the bird name with exponential backoff retry, and writes results back to the DB. Supports multiple concurrent workers via `WORKER_CONCURRENCY`. Instrumented with metrics on jobs processed and processing errors.
- **Shared types** (`src/types.ts`) — `Job` interface shared between the server and worker.
- **Metrics** (`observability/metrics.ts`) — Lightweight counter-based metrics class backed by LMDB. Tracks jobs created, result requests, jobs processed per worker, and processing errors.

### Databases

- **Jobs** (`./data`) — LMDB key/value store shared between the API server and workers. Jobs are keyed by UUID and progress through the states: `queued` → `processing` → `complete` | `failed`.
- **Metrics** (`./metrics`) — Separate LMDB store used exclusively by the `Metrics` class.

### Project structure

```
├── daemons/
│   └── worker.ts           # Background worker process
├── observability/
│   └── metrics.ts          # Metrics class
├── src/
│   ├── index.ts            # API server
│   └── types.ts            # Shared Job type
├── tests/
│   ├── index.test.ts       # API unit tests
│   └── worker.test.ts      # Worker unit tests
├── package.json
└── tsconfig.json
```

## API

### `POST /bird`
Submit a new lookup job.

**Body:** `{ "name": "Robin" }`

**Responses:**
- `201` — job created: `{ id, name, status: "queued", createdAt }`
- `409` — a job with that name already exists

### `GET /bird?name=Robin`
Poll for a completed job.

**Responses:**
- `200` — job is complete: `{ id, name, status: "complete", createdAt, result }`
- `404` — job not found or not yet complete

## Getting Started

```bash
npm install
```

Start the API server:
```bash
npm run dev
```

Start a worker (in a separate terminal):
```bash
npm run worker
```

Run multiple concurrent workers by setting `WORKER_CONCURRENCY`:
```bash
WORKER_CONCURRENCY=4 npm run worker
```

## Running Tests

```bash
npm test
```

## Future Improvements

My first improvements for this project would focus on replacing the DB with a dedicated message queue. We could still use the standard RDMBS for metadata, but since the spec for this project centers around implementing a job queue, it makes sense to use technology that has been refined for this use case. 

In the short term we could use something like RabbitMQ for its simplicity. But as we scale up, we could consider industry standard options like Kafka or Cloud Pubsub. These would allows us to rapidly increase the number of concurrent workers and our overall throughput for our "jobs". 

Speaking of scaling we'll want to protect our API server with load balancing and basic replication. We can stand up a number of webservers to support our user traffic. Our webservers are stateless and most of the business logic is contained within the worker processes, so scaling should be fairly straightforward. The goal here is simply to achieve high availibility so that new jobs can be created and results can be retrieved without delay.

I've implemented rudimentary observability from scratch using the DB, but again, we'll want to replace this with a more robust technology as we scale. AWS Cloudwatch and GCP monitoring will provide us with easily scable options for tracking our systems performance, and alerting when that performance degrades. I wanted to respect the given time limit for this project and I ran out before I could implement an alerting daemons. This wouldn't really be a good use of time in any case, since we would almost certainly be relying on a dedicated service to handling our observability in production. The important part is that the code is properly instrumented with metrics and error handling.
