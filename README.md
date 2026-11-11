# NeoWatch

Browse today’s near-Earth objects from NASA NeoWs, save a private watch list, and keep per-asteroid notes — as a guest on-device, or signed in with Clerk so favorites sync to MongoDB.

**[Live demo](https://neo-watch-asteroid.vercel.app/)**

![Guest catalog view with today’s NEOs, approach metrics, and local vault](docs/catalog-guest.jpg)

## Features

- **Today’s NEO catalog** — approach time, miss distance, relative velocity, absolute magnitude, diameter range, PHA / Sentry flags, and JPL SBDB links
- **Guest → account path** — full catalog without signing in; device-local vault in `localStorage`; on sign-in, local favorites (and notes) sync to the API
- **Authenticated favorites** — create, list, update notes (“Commander’s Log”), and delete, with Clerk JWT on every mutating/read favorites call
- **Per-user isolation** — queries and writes filter by Clerk `userId`; uniqueness is enforced on `(userId, name)` so users can favorite the same NEO independently

## Tech stack

| Layer | Technology |
| :--- | :--- |
| Frontend | React 19, Vite, Tailwind CSS v4, Clerk React SDK |
| Backend | Node.js, Express 5 |
| Database | MongoDB Atlas via Mongoose |
| Auth | Clerk (`ClerkExpressRequireAuth` on favorites routes) |
| Hosting | Frontend on Vercel; backend on Render |

## Architecture

```
Browser (React + Clerk session, or guest localStorage vault)
    │
    ├─ NASA catalog data ──► Express GET /asteroids ──► NASA NeoWs API
    │
    └─ Favorites CRUD ─────► Express /asteroids/favorites
                               (Bearer JWT via Clerk middleware)
                                    └──► MongoDB (scoped by userId)
```

**Design choices**

- **Server-side NASA proxy** — the browser never calls NeoWs; Express fetches and shapes the feed so the NASA key stays off the client.
- **Guest vault + sync** — guests favorite locally; after Clerk sign-in, the client posts the vault to `/asteroids/favorites` (and PATCHes notes) before loading the server list.
- **Auth-scoped data** — favorites handlers take `userId` from `req.auth` and use it on every MongoDB read/write; a compound unique index on `(userId, name)` blocks duplicate favorites per user without blocking other users.

## Project structure

```
neowatch/
├── docs/              # Screenshots and docs assets
├── frontend/          # Vite + React app
│   ├── .env.example
│   └── src/
└── backend/           # Express API
    ├── .env.example
    ├── models/Asteroid.js
    └── server.js
```

## API reference

Base URL locally: `http://localhost:3000` (or `PORT` if set)

### Catalog (public proxy)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Health check |
| `GET` | `/asteroids` | Today’s NEOs from NASA NeoWs (normalized fields) |
| `GET` | `/asteroids/search?date=YYYY-MM-DD` | NEOs for a given date |
| `GET` | `/asteroids/:id` | Single NEO by NASA ID |

Catalog payloads include `id`, `name`, diameter min/max, PHA flag, absolute magnitude, JPL URL, close-approach time, miss distance, relative velocity, and Sentry flag. The UI uses today’s feed; date and ID routes are available on the API.

### Favorites (Clerk JWT required)

`Authorization: Bearer <token>` on all routes below.

| Method | Endpoint | Description | Typical responses |
| :--- | :--- | :--- | :--- |
| `GET` | `/asteroids/favorites` | List the signed-in user’s favorites | `200`, `401`, `500` |
| `POST` | `/asteroids/favorites` | Save a favorite (name, PHA, optional NEO metadata) | `201`, `400`, `401`, `500` |
| `PATCH` | `/asteroids/favorites/:name` | Update `note` for that user’s favorite | `200`, `401`, `404`, `500` |
| `DELETE` | `/asteroids/favorites/:name` | Remove that user’s favorite | `200`, `401`, `404`, `500` |

## Local development

### Prerequisites

- Node.js 18+
- A [Clerk](https://clerk.com/) application
- A MongoDB Atlas (or local MongoDB) connection string

### 1. Environment variables

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

**Frontend (`frontend/.env`)**

| Variable | Description |
| :--- | :--- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key for the React SDK |
| `VITE_API_URL` | Express base URL (e.g. `http://localhost:3000`) |

**Backend (`backend/.env`)**

| Variable | Description |
| :--- | :--- |
| `CLERK_SECRET_KEY` | Clerk secret key used by `@clerk/clerk-sdk-node` |
| `MONGO_URL` | MongoDB connection string |

### 2. Install and run

Terminal 1 — API (port **3000** by default, or `PORT`):

```bash
cd backend
npm install
node server.js
```

Terminal 2 — UI:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal (usually `http://localhost:5173`).

## Notes

- NASA NeoWs is called only from Express (key never shipped to the browser). For production hardening, load the key from an environment variable rather than the source file.
- Free Render cold starts can take ~30s after idle; the UI shows a loading state for that case.
