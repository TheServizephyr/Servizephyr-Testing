# ServiZephyr Backend V2 (`server/`)

Independent Express backend designed for Render deployment, isolated from the existing Next.js/Vercel app.

## Why this exists

- Current production APIs and frontend are both on Vercel serverless.
- This folder lets you migrate backend safely without touching live production code paths.
- You can move traffic endpoint-by-endpoint with feature flags and instant rollback.

## Current migration status

Implemented locally in this backend:

- `GET /healthz`
- `GET /readyz`
- `GET /api/public/bootstrap/:restaurantId`
- `GET /api/public/menu/:restaurantId` (backward-compatible alias)
- `GET /api/public/locations`
- `GET /api/public/location/geocode`
- `GET /api/public/location/search`
- `GET /api/public/location/ip`
- `GET /api/public/restaurant-overview/:restaurantId`
- `GET /api/discover/locations`
- `GET /api/location/geocode`
- `GET /api/location/search`
- `GET /api/owner/settings?restaurantId=...` (public mode)
- `GET /api/owner/settings` (authenticated owner/employee/admin-impersonation mode)
- `PATCH /api/owner/settings`
- `GET /api/owner/status`
- `GET /api/owner/orders`
- `PATCH /api/owner/orders`
- `GET /api/owner/coupons`
- `POST /api/owner/coupons`
- `PATCH /api/owner/coupons`
- `DELETE /api/owner/coupons`
- `GET /api/owner/bookings`
- `POST /api/owner/bookings`
- `PATCH /api/owner/bookings`
- `GET /api/owner/car-spots`
- `POST /api/owner/car-spots`
- `DELETE /api/owner/car-spots`
- `POST /api/owner/create-linked-account`
- `GET /api/owner/delivery-settings`
- `PATCH /api/owner/delivery-settings`
- `GET /api/owner/employees`
- `POST /api/owner/employees`
- `PATCH /api/owner/employees`
- `DELETE /api/owner/employees`
- `POST /api/owner/menu-bulk`
- `GET /api/owner/analytics`
- `GET /api/owner/connections`
- `GET /api/owner/locations`
- `POST /api/owner/locations`
- `PATCH /api/owner/locations`
- `GET /api/owner/open-items`
- `POST /api/owner/open-items`
- `DELETE /api/owner/open-items`
- `GET /api/owner/customers`
- `PATCH /api/owner/customers`
- `GET /api/owner/dashboard-data`
- `POST /api/owner/custom-bill/create-order` (compatibility-forwarded)
- `GET /api/owner/custom-bill/history`
- `POST /api/owner/custom-bill/history`
- `PATCH /api/owner/custom-bill/history`
- `GET /api/owner/delivery`
- `POST /api/owner/delivery`
- `PATCH /api/owner/delivery`
- `DELETE /api/owner/delivery`
- `POST /api/owner/delivery/invite`
- `GET /api/owner/service-requests`
- `POST /api/owner/service-requests`
- `PATCH /api/owner/service-requests`
- `GET /api/owner/dine-in-history`
- `POST /api/owner/dine-in-history/undo`
- `GET /api/owner/inventory`
- `POST /api/owner/inventory/adjust`
- `POST /api/owner/inventory/sync-from-menu`
- `GET /api/owner/payouts`
- `POST /api/owner/refund`
- `POST /api/owner/whatsapp-onboarding`
- `GET /api/owner/tables`
- `POST /api/owner/tables`
- `PATCH /api/owner/tables`
- `POST /api/owner/settings/upload-qr-url`
- `POST /api/owner/whatsapp-direct/upload-url`
- `POST /api/owner/cleanup-stale-tabs`
- `GET /api/owner/dine-in-tables`
- `POST /api/owner/dine-in-tables`
- `PATCH /api/owner/dine-in-tables`
- `DELETE /api/owner/dine-in-tables`
- `GET /api/owner/menu`
- `POST /api/owner/menu`
- `PATCH /api/owner/menu` (availability, category image, bulk stock/delete actions)
- `DELETE /api/owner/menu`
- `GET /api/order/active`
- `POST /api/order/create` (native for COD/PhonePe-safe flows, automatic legacy fallback for complex flows)
- `GET /api/order/status/:orderId` (supports `?lite=1`)
- `PATCH /api/order/update`
- `POST /api/order/cancel`
- `POST /api/order/mark-paid`
- `POST /api/order/settle-payment`
- `POST /api/delivery/calculate-charge`
- `POST /api/customer/lookup`
- `POST /api/customer/register` (native for compatible payment flows, automatic legacy fallback for unsupported flows)
- `GET /api/customer/profile`
- `PATCH /api/customer/profile`
- `GET /api/customer/hub-data`
- `GET /api/customer/analytics`
- `GET /api/employee/me`
- `PATCH /api/employee/me`
- `GET /api/employee/accept-invite`
- `POST /api/employee/accept-invite`
- `GET /api/admin/dashboard-stats`
- `GET /api/admin/analytics`
- `POST /api/admin/log-impersonation`
- `GET /api/admin/listings`
- `PATCH /api/admin/listings`
- `GET /api/admin/listing-analytics`
- `GET /api/admin/users`
- `PATCH /api/admin/users`
- `GET /api/admin/users/:userId`
- `GET /api/admin/audit-logs`
- `POST /api/admin/check-ids`
- `GET /api/admin/mailbox`
- `POST /api/admin/mailbox`
- `PATCH /api/admin/mailbox`
- `POST /api/admin/retry-webhook`
- `GET /api/admin/waitlist`
- `GET /api/admin/ops-telemetry`
- `GET /api/admin/read-telemetry`
- `GET /api/admin/restaurants`
- `PATCH /api/admin/restaurants`
- `GET /api/admin/migration/display-ids`
- `POST /api/admin/migrate-delivery-settings`
- `POST /api/admin/migrate-delivery-settings/cleanup`
- `POST /api/admin/migrate-custom-categories`
- `POST /api/admin/migrate-custom-categories/cleanup`
- `POST /api/auth/check-role`
- `POST /api/auth/complete-profile`
- `POST /api/auth/login`
- `POST /api/auth/login-google`
- `POST /api/auth/forgot-password`
- `POST /api/auth/signup-owner`
- `POST /api/auth/generate-session-token`
- `POST /api/auth/verify-token`
- `GET /api/dine-in/table-status`
- `POST /api/dine-in/create-tab`
- `POST /api/dine-in/join-table`
- `GET /api/dine-in/tab-status/:tabId`
- `POST /api/dine-in/initiate-payment`
- `POST /api/dine-in/unlock-payment`
- `POST /api/dine-in/clean-table`
- `PATCH /api/dine-in/clean-table`
- `POST /api/payment/create-order`
- `POST /api/payment/create-split-order` (compatibility alias)
- `GET /api/payment/status?splitId=...`
- `GET /api/payment/split-status?splitId=...`
- `POST /api/payment/phonepe/initiate`
- `GET /api/payment/phonepe/status/:orderId`
- `GET /api/payment/phonepe/token` (internal secret protected)
- `POST /api/payment/phonepe/refund` (admin-only)
- `POST /api/payment/phonepe/callback`
- `GET /api/payment/upi-qr-card` (compatibility-forwarded)
- `POST /api/ai/scan-menu` (compatibility-forwarded)
- `GET /api/whatsapp/webhook` (compatibility-forwarded)
- `POST /api/whatsapp/webhook` (compatibility-forwarded)
- `POST /api/webhooks/razorpay` (feature-flagged, native when `ENABLE_NATIVE_RAZORPAY_WEBHOOK=true`)
- `GET /api/rider/dashboard`
- `PATCH /api/rider/dashboard`
- `POST /api/rider/accept-invite`
- `POST /api/rider/accept-order`
- `PATCH /api/rider/update-order-status`
- `POST /api/rider/reached-restaurant`
- `POST /api/rider/start-delivery`
- `POST /api/rider/attempt-delivery`
- `POST /api/rider/mark-failed`
- `POST /api/rider/return-order`
- `POST /api/rider/update-payment-status`
- `POST /api/rider/send-payment-request`
- `PATCH /api/rider/send-payment-request`
- `POST /api/rider/optimize-route`
- `POST /api/waitlist`
- `POST /api/telemetry/client-event`
- `GET /api/cron/cleanup-retention`
- `GET /api/test`
- `GET /api/test-admin`
- `GET /api/user/addresses`
- `POST /api/user/addresses`
- `DELETE /api/user/addresses`
- `POST /api/user/delete`

Migration inventory:

- `server/migration/endpoint-inventory.json` now reports `Total: 134, Native: 134, Proxy: 0`.
- A small subset of long-tail endpoints is intentionally compatibility-forwarded inside native route modules for safe rollout (mainly AI scan + WhatsApp webhook + selected WhatsApp-direct flows).

Phase 2 note:

- Order write path has started with native `POST /api/order/create`.
- Payment write/read core is now native (`/api/payment/create-order`, split status, PhonePe status/callback, token, refund).
- Razorpay webhook native handler is available behind `ENABLE_NATIVE_RAZORPAY_WEBHOOK`.
- Owner and rider high-traffic routes are now mostly native (orders/menu/dine-in read+write core + rider lifecycle core).
- Customer account + dine-in standalone compatibility APIs are now partially native.
- Complex flows (Razorpay online, split bill, add-on merge) currently auto-fallback to legacy.

## Safety model

- Existing Next.js API routes remain unchanged.
- This backend runs as a separate service/process.
- Non-migrated paths are forwarded to legacy backend through proxy mode.
- Rollback path: switch frontend API base URL back to Vercel.

## Quick start

1. Copy env:

```bash
cp .env.example .env
```

2. Fill required env vars:

- `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_BASE64`
- Optional legacy fallback (only if `ENABLE_LEGACY_PROXY=true`):
  - `LEGACY_API_BASE_URL` (your current Vercel domain)
- `PHONEPE_BASE_URL`, `PHONEPE_AUTH_URL`, `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET` (for PhonePe native flows)
- `INTERNAL_API_SECRET` (required for `/api/payment/phonepe/token` internal access)
- `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (for Razorpay native flows)
- `GOOGLE_MAPS_API_KEY` or `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (for `/api/location/*` and `/api/public/location/*`)
- `CRON_SECRET` (for `/api/cron/cleanup-retention`)
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` (for `/api/whatsapp/webhook` and owner WhatsApp direct messaging)
- `GEMINI_API_KEY` (or `GOOGLE_GENAI_API_KEY` / `GOOGLE_API_KEY`) for `/api/ai/scan-menu`
- Optional cache: `KV_REST_API_URL` and `KV_REST_API_TOKEN`
- Recommended perf setting: `CACHE_PUBLIC_BOOTSTRAP_TTL_SEC=43200` (safe because cache keys include `menuVersion`)
- Optional cache bound: `CACHE_L1_MAX_ENTRIES` (default `5000`)
- Optional telemetry tuning: `ENABLE_OPS_TELEMETRY`, `OPS_TELEMETRY_SAMPLE_RATE`
- Optional distributed WS tuning: `ENABLE_DISTRIBUTED_WS`, `WS_DISTRIBUTED_COLLECTION`, `WS_DISTRIBUTED_POLL_MS`, `WS_DISTRIBUTED_RETENTION_MS`

Optional toggle:

- `ENABLE_NATIVE_RAZORPAY_WEBHOOK` defaults to `true`; set to `false` only if you intentionally want legacy webhook handling.

Capacity hardening assets:

- Firestore index verifier: `npm run indexes:check`
- Full speed/capacity readiness gate: `npm run readiness:capacity`
- Render autoscale profile template: `server/deploy/render-autoscale.json`

3. Install and run:

```bash
npm install
npm run dev
```

## Deployment (Render)

- `render.yaml` is included.
- Service root: `server/`
- Health endpoint: `/healthz`
- Start command: `npm run start`

## Important notes

- Keep `LEGACY_API_BASE_URL` pointed to current production Next/Vercel API during migration.
- Do not point `LEGACY_API_BASE_URL` to this same backend, it will create proxy loops.
- Webhook/signature-sensitive routes are proxied using raw request body in proxy mode.
- WebSocket clients can subscribe to scoped channels (`owner:<businessId>`, `rider:<uid>`, `order:<orderId>`) for live order events.

## Recommended rollout sequence

1. Deploy this backend to Render.
2. Route internal/staging frontend traffic to Render backend.
3. Validate migrated endpoints:
   - `/api/public/menu/:restaurantId`
   - `/api/order/active`
   - `/api/order/status/:orderId`
4. Migrate write-heavy order/payment flows next.
5. Move owner/rider/admin domains in batches.
6. Disable legacy proxy after full migration.

## Route inventory

Generate a full API migration inventory (native vs proxy):

```bash
npm run inventory:routes
```

Output file:

- `server/migration/endpoint-inventory.json`
- Detailed handover for next engineer: `server/migration/HANDOVER_BACKEND_V2.md`

Run capacity checks before production cutover:

```bash
npm run test:native-p0
npm run indexes:check
npm run readiness:capacity
npm run loadtest:smoke
npm run loadtest:peak
```
