# NeoWatch

Full-stack app for browsing near-Earth objects from NASA’s NeoWs API and saving authenticated favorites (with optional notes) to MongoDB.

**[Live demo](https://neo-watch-asteroid.vercel.app/)**

![Guest catalog view with today’s NEOs, approach metrics, and local vault](docs/catalog-guest.jpg)

## Features

- Browse today’s near-Earth asteroids with approach time, miss distance, velocity, magnitude, diameter range, and JPL SBDB links
- Continue as guest to use the full catalog and a device-local vault; sign in with Clerk to sync favorites to MongoDB
- Save / remove favorites and edit a per-asteroid note (“Commander’s Log”)
- Favorites CRUD is scoped to the authenticated Clerk `userId`

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

- The **frontend never calls NASA directly**. It requests your Express API; the server proxies NeoWs.
- Guests can favorite locally; signing in syncs the local vault to the API when possible.
- Clerk issues a session on the client; protected API calls send `Authorization: Bearer <token>` from `getToken()`.
- Favorites handlers read `req.auth.userId` and include it in every MongoDB query/write.

**Note:** Favorites are unique per user on `(userId, name)` — different users can favorite the same asteroid independently.

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

### Public / proxy routes

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Health check |
| `GET` | `/asteroids` | Today’s NEOs from NASA NeoWs (proxied; expanded fields) |
| `GET` | `/asteroids/search?date=YYYY-MM-DD` | NEOs for a given date (proxied) |
| `GET` | `/asteroids/:id` | Single NEO by NASA ID (proxied) |

The search and `:id` routes exist on the server but are not used by the current UI.

Catalog objects include `id`, `name`, diameter min/max, PHA flag, absolute magnitude, JPL URL, close-approach time, miss distance, relative velocity, and Sentry flag.

### Authenticated favorites routes

Require a valid Clerk JWT in the `Authorization: Bearer` header.

| Method | Endpoint | Description | Typical responses |
| :--- | :--- | :--- | :--- |
| `GET` | `/asteroids/favorites` | List the signed-in user’s favorites | `200`, `401`, `500` |
| `POST` | `/asteroids/favorites` | Save a favorite (name, PHA, and optional NEO metadata) | `201`, `400`, `401`, `500` |
| `PATCH` | `/asteroids/favorites/:name` | Update `note` for that user’s favorite | `200`, `401`, `404`, `500` |
| `DELETE` | `/asteroids/favorites/:name` | Remove that user’s favorite | `200`, `401`, `404`, `500` |

## Local development

### Prerequisites

- Node.js 18+
- A [Clerk](https://clerk.com/) application
- A MongoDB Atlas (or local MongoDB) connection string

### 1. Environment variables

Copy the example files and fill in values:

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

Terminal 1 — API (listens on port **3000** by default, or `PORT`):

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

### Demo note

On the free Render tier, the API may take up to ~30 seconds to wake from sleep on the first request after idle. The UI shows a loading state for that case.

## Notes

- The NASA API key is currently hardcoded in `backend/server.js`; for production it should be moved to an environment variable.
- Older favorites created before the expanded NEO schema may be missing approach/diameter metadata until re-favorited.
- There is no automated test suite yet (`backend` `npm test` is a placeholder).
