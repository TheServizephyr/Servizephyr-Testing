# Load Testing

Use `k6` to validate peak behavior before production cutover.

## Prerequisites

- Install `k6`: https://k6.io/docs/get-started/installation/
- Start backend locally or use Render URL.

## Smoke test (quick)

```bash
BASE_URL=http://localhost:8080 RESTAURANT_ID=<restaurantId> k6 run loadtest/k6-smoke.js
```

## Peak read test

```bash
BASE_URL=https://<render-service>.onrender.com RESTAURANT_ID=<restaurantId> k6 run loadtest/k6-peak.js
```

## Recommended acceptance gates

- `p95` under `1200ms` for customer read routes
- error rate `< 2%` under peak
- no sustained 5xx bursts in `api.admin.ops-telemetry`
