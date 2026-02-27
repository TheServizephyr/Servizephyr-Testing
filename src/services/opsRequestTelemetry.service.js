const { Redis } = require('@upstash/redis');
const { config } = require('../config/env');

const TELEMETRY_TTL_SECONDS = 14 * 24 * 60 * 60;
const RECENT_ERRORS_KEY = 'telemetry:ops:errors:recent';
const MAX_RECENT_ERRORS = 250;

const LATENCY_BUCKET_LIMITS = [100, 250, 500, 1000, 2000, 3000, 5000, 8000, 12000];

let redis = null;
if (config.upstash.url && config.upstash.token) {
  redis = new Redis({
    url: config.upstash.url,
    token: config.upstash.token,
  });
}

function getTelemetryTimeZone() {
  const configured = String(process.env.OPS_TELEMETRY_TIMEZONE || 'Asia/Kolkata').trim();
  return configured || 'UTC';
}

function getTelemetryDay(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: getTelemetryTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // fall through
  }

  return date.toISOString().slice(0, 10);
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function getLatencyBucket(durationMs) {
  const safeMs = Math.max(0, toInt(durationMs, 0));
  for (const limit of LATENCY_BUCKET_LIMITS) {
    if (safeMs <= limit) return `le_${limit}`;
  }
  return `gt_${LATENCY_BUCKET_LIMITS[LATENCY_BUCKET_LIMITS.length - 1]}`;
}

function sanitizeEndpoint(endpoint) {
  return String(endpoint || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/\|/g, ':')
    .replace(/\/+/g, '.')
    .replace(/:+/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.|\.$/g, '')
    .slice(0, 180);
}

function normalizeHttpMethod(method) {
  return String(method || '').trim().toUpperCase();
}

function inferReadWriteEstimate({ method, endpoint }) {
  const safeMethod = normalizeHttpMethod(method);
  const endpointName = String(endpoint || '');

  if (safeMethod === 'GET' || safeMethod === 'HEAD') {
    return { reads: 1, writes: 0 };
  }

  if (safeMethod === 'POST' || safeMethod === 'PUT' || safeMethod === 'PATCH' || safeMethod === 'DELETE') {
    // Better estimate for order create/payment style writes.
    if (endpointName.includes('order.create')) return { reads: 3, writes: 6 };
    if (endpointName.includes('order.cancel')) return { reads: 2, writes: 2 };
    if (endpointName.includes('payment')) return { reads: 2, writes: 2 };
    return { reads: 1, writes: 1 };
  }

  return { reads: 1, writes: 0 };
}

async function trackOpsRequestTelemetry({
  endpoint,
  method,
  durationMs,
  statusCode = 200,
  errorMessage = null,
}) {
  if (!config.telemetry.enabled) return;
  if (!redis) return;
  if (Math.random() > config.telemetry.sampleRate) return;

  const endpointName = sanitizeEndpoint(endpoint);
  if (!endpointName) return;

  const safeDuration = Math.max(0, toInt(durationMs, 0));
  const safeStatus = Math.max(0, toInt(statusCode, 0));
  const day = getTelemetryDay();
  const latencyBucket = getLatencyBucket(safeDuration);

  const reqKey = `telemetry:ops:req:${day}`;
  const errKey = `telemetry:ops:err:${day}`;
  const durKey = `telemetry:ops:dur:${day}`;
  const bucketKey = `telemetry:ops:bucket:${day}`;
  const readsKey = `telemetry:reads:${day}`;
  const readRequestsKey = `telemetry:requests:${day}`;
  const writesKey = `telemetry:writes:${day}`;
  const writeRequestsKey = `telemetry:write_requests:${day}`;

  const { reads, writes } = inferReadWriteEstimate({
    method,
    endpoint: endpointName,
  });

  const ops = [
    redis.hincrby(reqKey, endpointName, 1),
    redis.hincrby(durKey, endpointName, safeDuration),
    redis.hincrby(bucketKey, `${endpointName}|${latencyBucket}`, 1),
    redis.hincrby(readsKey, endpointName, reads),
    redis.hincrby(readRequestsKey, endpointName, 1),
    redis.expire(reqKey, TELEMETRY_TTL_SECONDS),
    redis.expire(errKey, TELEMETRY_TTL_SECONDS),
    redis.expire(durKey, TELEMETRY_TTL_SECONDS),
    redis.expire(bucketKey, TELEMETRY_TTL_SECONDS),
    redis.expire(readsKey, TELEMETRY_TTL_SECONDS),
    redis.expire(readRequestsKey, TELEMETRY_TTL_SECONDS),
    redis.expire(writesKey, TELEMETRY_TTL_SECONDS),
    redis.expire(writeRequestsKey, TELEMETRY_TTL_SECONDS),
  ];

  if (writes > 0) {
    ops.push(
      redis.hincrby(writesKey, endpointName, writes),
      redis.hincrby(writeRequestsKey, endpointName, 1)
    );
  }

  if (safeStatus >= 500) {
    const errorEntry = {
      at: new Date().toISOString(),
      day,
      endpoint: endpointName,
      statusCode: safeStatus,
      message: String(errorMessage || 'Server error').slice(0, 300),
    };

    ops.push(
      redis.hincrby(errKey, endpointName, 1),
      redis.lpush(RECENT_ERRORS_KEY, JSON.stringify(errorEntry)),
      redis.ltrim(RECENT_ERRORS_KEY, 0, MAX_RECENT_ERRORS - 1),
      redis.expire(RECENT_ERRORS_KEY, TELEMETRY_TTL_SECONDS)
    );
  }

  try {
    await Promise.all(ops);
  } catch {
    // Best effort telemetry; do not break request flow.
  }
}

module.exports = {
  trackOpsRequestTelemetry,
};
