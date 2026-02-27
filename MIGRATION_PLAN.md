# Backend Migration Plan (Zero Production Impact)

## Objective

Build and roll out a full standalone backend on Render while keeping current production (Next.js + Vercel APIs) stable and untouched.

## Architecture target

- Frontend: Vercel (existing)
- Backend: Render (`server/` in this repo)
- Database/Auth: Firebase (existing)
- Cache: Upstash Redis (optional but recommended)
- Real-time: WebSocket endpoint on Render (`/ws`)

## Domain migration order

### Phase 1 (Highest traffic, highest ROI)

- `public` customer read APIs
- `order` customer live APIs
- payment initiation/status and webhook flows

### Phase 2

- owner live operations (orders, dine-in, inventory hot paths)
- rider live APIs
- street-vendor live APIs

### Phase 3

- customer profile/dashboard APIs
- medium traffic owner APIs

### Phase 4 (Low traffic / backoffice)

- admin analytics / audit / migration helpers
- rarely used maintenance endpoints

## Cutover mechanics

1. Keep `ENABLE_LEGACY_PROXY=true` in Render backend.
2. Point frontend API base to Render for internal/staging users.
3. For non-migrated routes, Render proxies to legacy Vercel API.
4. Migrate endpoint groups one by one from proxy mode to native mode.
5. When all migrated and validated, set `ENABLE_LEGACY_PROXY=false`.

## Safety and rollback

- No changes required to existing production API files.
- Fast rollback path:
  - switch frontend API base back to Vercel, or
  - keep frontend on Render but re-enable legacy proxy.

## Acceptance gates per phase

1. Error rate unchanged or better.
2. P95 latency improves for migrated endpoints.
3. No data integrity regressions in orders/payments.
4. Monitoring and logs validated before traffic increase.

## Suggested rollout percentages

- 0% internal testing
- 5% canary
- 25% limited rollout
- 50% progressive rollout
- 100% full rollout
