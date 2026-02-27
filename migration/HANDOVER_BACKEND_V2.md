# Backend V2 Handover (Server-Only)

Last updated: 2026-02-23
Owner branch context: `server/` migration work only

## 1. Scope and Non-Negotiable Constraints

- Production Next.js code (`src/`) must remain untouched during migration work.
- All migration implementation is inside `server/`.
- Frontend can continue on Vercel; backend v2 can be deployed separately (Render).
- Legacy compatibility is preserved through proxy fallback where native parity is not complete.

## 2. Current Snapshot

- Route inventory file: `server/migration/endpoint-inventory.json`
- Latest summary:
  - Total endpoints discovered: `134`
  - Marked native in inventory: `134`
  - Marked proxy in inventory: `0`

Important nuance:
- Inventory "native" means route path is registered in backend v2.
- Most high-traffic P0 routes are now fully native; legacy dependency remains mainly in hybrid fallbacks and wildcard safety-net routes.

## 3. What Has Been Built (Major Work Done)

### 3.1 Core platform / infra

- Express backend structure finalized under `server/src`.
- Access control and owner/rider/admin context resolution implemented.
- Legacy proxy service hardened to support streamed multipart forwarding:
  - `server/src/services/legacyProxy.service.js`
- Firebase Admin wrapper extended with storage accessor:
  - `server/src/lib/firebaseAdmin.js` now exposes `getStorage()`.
- New dependency added for multipart handling:
  - `server/package.json` -> `multer`

### 3.2 New/updated owner domain services

Implemented native logic services (full or partial) for:

- `server/src/services/ownerCustomers.service.js`
- `server/src/services/ownerDashboardData.service.js`
- `server/src/services/ownerServiceRequests.service.js`
- `server/src/services/ownerDineInHistory.service.js`
- `server/src/services/ownerDelivery.service.js`
- `server/src/services/ownerInventory.service.js`
- `server/src/services/ownerPayouts.service.js`
- `server/src/services/ownerRefund.service.js`
- `server/src/services/ownerCustomBill.service.js` (history flow native)
- `server/src/services/ownerWhatsAppOnboarding.service.js`
- `server/src/services/ownerWhatsAppDirect.service.js`
- `server/src/services/ownerTables.service.js`
- `server/src/services/ownerWhatsAppDirectUpload.service.js`
- `server/src/services/ownerQrUpload.service.js`
- `server/src/services/paymentUpiQrCard.service.js`
- `server/src/services/aiScanMenu.service.js`
- `server/src/services/whatsappWebhook.service.js`
- `server/src/services/whatsappGraph.service.js`
- `server/src/services/whatsappRealtime.service.js`

Supporting utility added:

- `server/src/utils/inventory.js`

### 3.3 Route wiring completed

Primary routing file updated:

- `server/src/routes/owner.routes.js`

Other route modules added/updated:

- `server/src/routes/payment.routes.js`
- `server/src/routes/ai.routes.js`
- `server/src/routes/whatsapp.routes.js`
- `server/src/app.js` updated to mount `/api/ai` and `/api/whatsapp`

### 3.4 Docs and migration tooling updates

- `server/scripts/generate-endpoint-inventory.js` updated with new native pattern coverage.
- `server/scripts/assert-p0-native-routes.js` added for regression guard on critical native routes.
- `server/README.md` updated with current route status.
- `server/ROUTE_MATRIX.md` updated with native vs compatibility-forwarded route clarity.

## 4. Remaining Legacy Dependencies

### 4.1 Hybrid fallback behavior (conditional legacy path)

- `POST /api/order/create` uses native for supported flows, auto-falls back for complex legacy-only cases.
- `POST /api/customer/register` same hybrid logic for certain payment flows.
- `PATCH /api/owner/menu` has native branches and fallback branch for unsupported patch payload shapes.
- `/api/webhooks/razorpay` native behavior is feature-flagged.

### 4.2 Wildcard proxy safety-net routes

- Multiple route modules still keep `router.all('*', proxyToLegacy)` as guard for non-migrated subpaths.
- Global `/api/*` proxy safety-net remains mounted when `ENABLE_LEGACY_PROXY=true`.

## 5. Newly Native Endpoints in Recent Passes

Recently moved to native (server-owned implementation):

- `GET /api/owner/tables`
- `POST /api/owner/tables`
- `PATCH /api/owner/tables`
- `POST /api/owner/settings/upload-qr-url`
- `POST /api/owner/whatsapp-direct/upload-url`
- `GET /api/owner/inventory`
- `POST /api/owner/inventory/adjust`
- `POST /api/owner/inventory/sync-from-menu`
- `GET /api/owner/delivery`
- `POST /api/owner/delivery`
- `PATCH /api/owner/delivery`
- `DELETE /api/owner/delivery`
- `POST /api/owner/delivery/invite`
- `GET /api/owner/payouts`
- `POST /api/owner/refund`
- `POST /api/owner/whatsapp-onboarding`
- `GET/POST/PATCH /api/owner/custom-bill/history`
- `POST /api/owner/custom-bill/create-order`
- `GET/PATCH /api/owner/whatsapp-direct/conversations`
- `GET/PATCH /api/owner/whatsapp-direct/customer-details`
- `GET/POST/PATCH /api/owner/whatsapp-direct/messages`
- `GET /api/payment/upi-qr-card`
- `POST /api/ai/scan-menu`
- `GET/POST /api/whatsapp/webhook`

## 6. Validation Already Run

Executed and passing:

- `node --check` on all newly created/edited server files.
- `node server/scripts/generate-endpoint-inventory.js`
- `npm --prefix server run readiness:capacity`
- `npm --prefix server run indexes:check`
- `npm --prefix server run test:native-p0`

Notes:
- `npm --prefix server run check` can fail if dependencies are not installed in local env (example: missing `helmet`).
- This is environment/dependency setup issue, not syntax issue in new code.

## 7. Environment and Infra Requirements for Continuation

Minimum env expected in `server/.env`:

- Firebase credentials:
  - `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_BASE64`
- Legacy proxy:
  - `ENABLE_LEGACY_PROXY=true`
  - `LEGACY_API_BASE_URL=<current Vercel domain>`
- Cache/perf:
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`
- Payments:
  - `NEXT_PUBLIC_RAZORPAY_KEY_ID`
  - `RAZORPAY_KEY_SECRET`
  - `PHONEPE_*`
- WhatsApp:
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_VERIFY_TOKEN`
- AI:
  - `GEMINI_API_KEY` (or `GOOGLE_GENAI_API_KEY` / `GOOGLE_API_KEY`)
- Webhooks/auth keys and other existing required envs per README.
- For storage URLs:
  - optional `FIREBASE_STORAGE_BUCKET` (fallback uses Firebase project id)

## 8. Exact Next Work for New Engineer (Recommended Order)

Priority P0 (remaining full-native parity work):

1. Remove hybrid fallback from `POST /api/order/create` by covering legacy-only payment/add-on edge cases natively.
2. Remove hybrid fallback from `POST /api/customer/register` for unsupported payment flows.
3. Remove fallback branch from `PATCH /api/owner/menu` for unsupported payload shapes.
4. Make Razorpay webhook native-by-default (`ENABLE_NATIVE_RAZORPAY_WEBHOOK=true`) after parity validation.
5. Reduce/remove `router.all('*', proxyToLegacy)` blocks module-by-module after route inventory parity.

Priority P1 (hardening and confidence):

1. Keep `npm run test:native-p0` in CI as regression gate.
2. Run load tests against Render staging (not localhost):
   - `npm --prefix server run loadtest:smoke`
   - `npm --prefix server run loadtest:peak`
3. Validate indexes and readiness before cutover:
   - `npm --prefix server run indexes:check`
   - `npm --prefix server run readiness:capacity`

Priority P2 (cutover prep):

1. Deploy backend v2 to Render staging with `ENABLE_LEGACY_PROXY=true`.
2. Route internal frontend/staging traffic to Render and verify owner/customer/rider/admin critical flows.
3. Monitor p95/p99 latency, error rates, and webhook success rates.
4. Switch production frontend API base gradually to Render.
5. Disable legacy proxy after soak test and parity sign-off.

## 9. Quick Continuation Checklist for New Engineer

1. `cd server`
2. `npm install`
3. Verify env in `server/.env`
4. Run:
   - `npm run inventory:routes`
   - `npm run test:native-p0`
   - `npm run readiness:capacity`
5. Finish remaining hybrid fallback routes (`order/create`, `customer/register`, `owner/menu`, `webhooks/razorpay`) before disabling legacy proxy.
6. Update docs (`README.md`, `ROUTE_MATRIX.md`) after every migration chunk.

## 10. Important Handoff Notes

- Do not edit production `src/` during this migration track.
- Keep all work in `server/`.
- Inventory can show `native:134` even while some handlers are compatibility-forwarded; always verify route implementation code.
- Critical files for understanding current status:
  - `server/src/routes/owner.routes.js`
  - `server/src/routes/payment.routes.js`
  - `server/src/routes/ai.routes.js`
  - `server/src/routes/whatsapp.routes.js`
  - `server/migration/endpoint-inventory.json`
  - `server/ROUTE_MATRIX.md`
