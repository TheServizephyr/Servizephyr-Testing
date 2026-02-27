# ServiZephyr Frontend (Testing)

This folder is an isolated frontend workspace for testing against backend-v2.

## Setup

1. Copy `.env.example` to `.env.local`
2. Set `NEXT_PUBLIC_BACKEND_BASE_URL` to your backend-v2 URL
3. Install dependencies: `npm install`
4. Start frontend: `npm run dev`

## API Routing

- All requests to `/api/*` are rewritten to backend-v2 via `next.config.js`.
- This keeps frontend request paths unchanged while using the independent Express backend.
