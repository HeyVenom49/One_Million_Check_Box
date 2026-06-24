# One Million Checkboxes

A real-time web app with **1,000,000 checkboxes**. Toggle any box and the change syncs instantly across all open browser tabs and connected clients.

Built with **Node.js**, **Express**, **Socket.IO**, and **Redis** (Valkey).

---

## Features

- 1 million shared checkboxes
- Live sync via WebSockets (Socket.IO)
- Checkbox state stored in Redis as a **bitmap** (~125 KB instead of a huge JSON array)
- Virtual scrolling in the browser — only visible rows are rendered
- Rate limit: one toggle per client every **6 seconds**
- Jump to any checkbox by number

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [Docker](https://www.docker.com/) (for Redis/Valkey)

---

## Getting Started

### 1. Start Redis (Valkey)

```bash
docker compose up -d
```

This runs Valkey on `localhost:6379`.

### 2. Install dependencies

```bash
npm install
```

### 3. Run the server

```bash
npm run dev
```

The app will be available at **http://localhost:8010**

To use a different port:

```bash
PORT=3000 npm run dev
```

---

## Project Structure

```
├── index.js              # Express + Socket.IO server
├── redis-connection.js   # Redis client setup (publisher, subscriber, main)
├── public/
│   └── index.html        # Frontend UI
├── docker-compose.yml    # Valkey (Redis-compatible) container
└── package.json
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/checkboxes/stats` | Total and checked count |
| `GET` | `/checkboxes?start=0&count=100` | Fetch a slice of checkbox states |

### Example: get stats

```bash
curl http://localhost:8010/checkboxes/stats
```

```json
{ "total": 1000000, "checked": 42 }
```

### Example: get checkboxes 0–4

```bash
curl "http://localhost:8010/checkboxes?start=0&count=5"
```

```json
{ "start": 0, "checkboxes": [false, true, false, false, true] }
```

---

## Socket.IO Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `client:checkbox:change` | `{ index, checked }` | Toggle a checkbox |

Connect with a `clientId` in auth (the frontend generates one and stores it in `localStorage`):

```js
io({ auth: { clientId: "your-uuid-here" } });
```

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `server:checkbox:change` | `{ index, checked }` | A checkbox was toggled |
| `server:error` | `{ index, error, retryAfter? }` | Rate limit or validation error |

---

## How It Works

1. **State** — All 1M checkbox values live in Redis as a bitmap (`checkbox-state:bitmap`). Each bit is `0` (unchecked) or `1` (checked).

2. **Toggle flow** — Client sends a socket event → server validates and updates Redis → server publishes to a Redis channel → all server instances broadcast the change to connected clients.

3. **Frontend** — The page uses virtual scrolling. As you scroll, it loads small chunks from `/checkboxes` and only renders the rows on screen (~800 checkboxes at a time, not 1 million).

4. **Rate limiting** — Each client ID can toggle once every 6 seconds. This is stored in Redis with a TTL.

---

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8010` | Server port |

Redis connection is configured in `redis-connection.js` (`localhost:6379`).

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server with nodemon (auto-restart on file changes) |
