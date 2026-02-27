# Render Autoscale Profile

Use `render-autoscale.json` as your baseline profile before traffic cutover.

## Apply in Render

1. Open Render service settings for backend v2.
2. Enable autoscaling.
3. Set min/max instances and CPU/memory targets from `render-autoscale.json`.
4. Save and wait for rollout completion.

## Validation loop

1. Run `npm run readiness:capacity`.
2. Run `npm run loadtest:smoke`.
3. Run `npm run loadtest:peak`.
4. Re-check p95/error-rate in ops telemetry.
