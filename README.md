# Birds

A job queue system that looks up bird information from Wikipedia. Clients submit a bird name via the HTTP API, a background worker fetches the Wikipedia intro, and the result is stored in an embedded LMDB database.

## Architecture

- **API server** (`src/index.ts`) — Express HTTP server that accepts job submissions and serves results
- **Worker** (`worker.ts`) — Standalone process that picks up queued jobs, fetches Wikipedia, and writes results back to the DB
- **Database** — [LMDB](https://github.com/kriszyp/lmdb-js) embedded key/value store at `./data` (shared between server and worker)

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
