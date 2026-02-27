const { Redis } = require('@upstash/redis');
const { HttpError } = require('../utils/httpError');
const { config } = require('../config/env');
const { resolveAdminContext } = require('./adminAccess.service');

const DEFAULT_TELEMETRY_TIMEZONE = 'Asia/Kolkata';
const RECENT_ERRORS_KEY = 'telemetry:ops:errors:recent';
const RECENT_ORDER_CREATES_KEY = 'telemetry:ops:order_create:recent';

const LATENCY_BUCKET_LIMITS = [100, 250, 500, 1000, 2000, 3000, 5000, 8000, 12000];
const LATENCY_BUCKETS = [
  ...LATENCY_BUCKET_LIMITS.map((limit) => `le_${limit}`),
  `gt_${LATENCY_BUCKET_LIMITS[LATENCY_BUCKET_LIMITS.length - 1]}`,
];

const ALLOWED_FLOWS = new Set(['delivery', 'pickup', 'dine-in', 'car-order', 'other']);
const ALLOWED_EVENTS = new Set([
  'order_page_opened',
  'checkout_opened',
  'order_create_attempt',
  'order_create_success',
  'order_create_failed',
]);

let redis = null;
if (config.upstash.url && config.upstash.token) {
  redis = new Redis({
    url: config.upstash.url,
    token: config.upstash.token,
  });
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function getTelemetryTimeZone() {
  const configured = String(process.env.OPS_TELEMETRY_TIMEZONE || DEFAULT_TELEMETRY_TIMEZONE).trim();
  return configured || 'UTC';
}

function formatDayWithTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
    return null;
  } catch {
    return null;
  }
}

function getTelemetryDay(date = new Date()) {
  const timeZone = getTelemetryTimeZone();
  if (timeZone) {
    const zonedDay = formatDayWithTimeZone(date, timeZone);
    if (zonedDay) return zonedDay;
  }
  return date.toISOString().slice(0, 10);
}

function normalizeDayParam(input) {
  const raw = String(input || '').trim();
  if (!raw) return getTelemetryDay();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const ddmmyyyy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return getTelemetryDay();
}

function normalizeFlow(flow) {
  const raw = String(flow || '').trim().toLowerCase();
  if (!raw) return 'other';
  if (raw === 'dine_in') return 'dine-in';
  if (raw === 'car' || raw === 'carorder') return 'car-order';
  if (raw === 'street-vendor-pre-order' || raw === 'pre-order') return 'delivery';
  if (ALLOWED_FLOWS.has(raw)) return raw;
  return 'other';
}

function normalizeFunnelEvent(eventName) {
  const normalized = String(eventName || '').trim().toLowerCase();
  if (!ALLOWED_EVENTS.has(normalized)) return null;
  return normalized;
}

function parseBucketUpper(bucket) {
  if (!bucket) return 0;
  if (bucket.startsWith('le_')) return toInt(bucket.slice(3), 0);
  if (bucket.startsWith('gt_')) return toInt(bucket.slice(3), 0) + 1;
  return 0;
}

function parseBucketLower(bucket) {
  if (!bucket) return 0;
  const index = LATENCY_BUCKETS.indexOf(bucket);
  if (index <= 0) return 0;
  const previous = LATENCY_BUCKETS[index - 1];
  return previous.startsWith('le_') ? toInt(previous.slice(3), 0) + 1 : 0;
}

function toPercent(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function parseJsonSafely(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function shiftDay(day, offset = 0) {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + toInt(offset, 0));
  return parsed.toISOString().slice(0, 10);
}

function hasPositiveValueMapData(mapLike) {
  if (!mapLike || typeof mapLike !== 'object') return false;
  const values = Object.values(mapLike);
  if (!values.length) return false;
  return values.some((value) => toInt(value, 0) > 0);
}

function emptyDayMaps() {
  return {
    reqMap: {},
    errMap: {},
    durMap: {},
    bucketMap: {},
    funnelMap: {},
    readsMap: {},
    readRequestsMap: {},
    writesMap: {},
    writeRequestsMap: {},
    recentErrorRows: [],
    recentOrderCreateRows: [],
  };
}

async function loadTelemetryDayMaps(day, safeLimit) {
  if (!redis) return emptyDayMaps();

  const reqKey = `telemetry:ops:req:${day}`;
  const errKey = `telemetry:ops:err:${day}`;
  const durKey = `telemetry:ops:dur:${day}`;
  const bucketKey = `telemetry:ops:bucket:${day}`;
  const funnelKey = `telemetry:ops:funnel:${day}`;
  const readsKey = `telemetry:reads:${day}`;
  const readRequestsKey = `telemetry:requests:${day}`;
  const writesKey = `telemetry:writes:${day}`;
  const writeRequestsKey = `telemetry:write_requests:${day}`;
  const recentOrderCreateLimit = Math.max(50, safeLimit);

  const [
    reqMap,
    errMap,
    durMap,
    bucketMap,
    funnelMap,
    readsMap,
    readRequestsMap,
    writesMap,
    writeRequestsMap,
    recentErrorRows,
    recentOrderCreateRows,
  ] = await Promise.all([
    redis.hgetall(reqKey),
    redis.hgetall(errKey),
    redis.hgetall(durKey),
    redis.hgetall(bucketKey),
    redis.hgetall(funnelKey),
    redis.hgetall(readsKey),
    redis.hgetall(readRequestsKey),
    redis.hgetall(writesKey),
    redis.hgetall(writeRequestsKey),
    redis.lrange(RECENT_ERRORS_KEY, 0, safeLimit - 1),
    redis.lrange(RECENT_ORDER_CREATES_KEY, 0, recentOrderCreateLimit - 1),
  ]);

  return {
    reqMap: reqMap || {},
    errMap: errMap || {},
    durMap: durMap || {},
    bucketMap: bucketMap || {},
    funnelMap: funnelMap || {},
    readsMap: readsMap || {},
    readRequestsMap: readRequestsMap || {},
    writesMap: writesMap || {},
    writeRequestsMap: writeRequestsMap || {},
    recentErrorRows: recentErrorRows || [],
    recentOrderCreateRows: recentOrderCreateRows || [],
  };
}

function hasTelemetryData(dayMaps = {}) {
  return (
    hasPositiveValueMapData(dayMaps.reqMap)
    || hasPositiveValueMapData(dayMaps.errMap)
    || hasPositiveValueMapData(dayMaps.durMap)
    || hasPositiveValueMapData(dayMaps.funnelMap)
    || hasPositiveValueMapData(dayMaps.readsMap)
    || hasPositiveValueMapData(dayMaps.readRequestsMap)
    || hasPositiveValueMapData(dayMaps.writesMap)
    || hasPositiveValueMapData(dayMaps.writeRequestsMap)
  );
}

function buildEndpointLatencySummary(endpoint, requests, durationTotal, bucketMap = {}) {
  const safeRequests = Math.max(0, toInt(requests, 0));
  const safeDurationTotal = Math.max(0, toInt(durationTotal, 0));
  const avgMs = safeRequests > 0 ? Number((safeDurationTotal / safeRequests).toFixed(1)) : 0;

  const endpointBuckets = {};
  for (const bucket of LATENCY_BUCKETS) {
    endpointBuckets[bucket] = toInt(bucketMap[`${endpoint}|${bucket}`], 0);
  }

  let p95Ms = 0;
  if (safeRequests > 0) {
    const threshold = Math.ceil(safeRequests * 0.95);
    let cumulative = 0;
    for (const bucket of LATENCY_BUCKETS) {
      cumulative += endpointBuckets[bucket] || 0;
      if (cumulative >= threshold) {
        p95Ms = parseBucketUpper(bucket);
        break;
      }
    }
  }

  const nonZeroBuckets = LATENCY_BUCKETS.filter((bucket) => (endpointBuckets[bucket] || 0) > 0);
  const minBucket = nonZeroBuckets[0] || null;
  const maxBucket = nonZeroBuckets[nonZeroBuckets.length - 1] || null;

  const minMs = minBucket ? parseBucketLower(minBucket) : 0;
  const maxMs = maxBucket ? parseBucketUpper(maxBucket) : 0;

  return {
    avgMs,
    p95Ms,
    minMs,
    maxMs,
    maxMsOverflow: maxBucket ? maxBucket.startsWith('gt_') : false,
  };
}

function buildFunnelSummary(funnelMap = {}) {
  const byFlow = {};

  for (const [field, value] of Object.entries(funnelMap || {})) {
    const [rawFlow, rawEvent] = String(field).split('|');
    const flow = normalizeFlow(rawFlow);
    const event = normalizeFunnelEvent(rawEvent);
    if (!event) continue;

    if (!byFlow[flow]) {
      byFlow[flow] = {
        flow,
        orderPageOpened: 0,
        checkoutOpened: 0,
        orderCreateAttempt: 0,
        orderCreateSuccess: 0,
        orderCreateFailed: 0,
        orderToCheckoutRate: 0,
        checkoutToSuccessRate: 0,
        createSuccessRate: 0,
      };
    }

    const count = Math.max(0, toInt(value, 0));
    if (event === 'order_page_opened') byFlow[flow].orderPageOpened += count;
    if (event === 'checkout_opened') byFlow[flow].checkoutOpened += count;
    if (event === 'order_create_attempt') byFlow[flow].orderCreateAttempt += count;
    if (event === 'order_create_success') byFlow[flow].orderCreateSuccess += count;
    if (event === 'order_create_failed') byFlow[flow].orderCreateFailed += count;
  }

  const flows = Object.values(byFlow).map((flowSummary) => {
    const attempts = flowSummary.orderCreateAttempt || (flowSummary.orderCreateSuccess + flowSummary.orderCreateFailed);
    return {
      ...flowSummary,
      orderToCheckoutRate: toPercent(flowSummary.checkoutOpened, flowSummary.orderPageOpened),
      checkoutToSuccessRate: toPercent(flowSummary.orderCreateSuccess, flowSummary.checkoutOpened),
      createSuccessRate: toPercent(flowSummary.orderCreateSuccess, attempts),
    };
  }).sort((a, b) => b.orderPageOpened - a.orderPageOpened);

  const totals = flows.reduce((acc, flow) => ({
    orderPageOpened: acc.orderPageOpened + flow.orderPageOpened,
    checkoutOpened: acc.checkoutOpened + flow.checkoutOpened,
    orderCreateAttempt: acc.orderCreateAttempt + flow.orderCreateAttempt,
    orderCreateSuccess: acc.orderCreateSuccess + flow.orderCreateSuccess,
    orderCreateFailed: acc.orderCreateFailed + flow.orderCreateFailed,
  }), {
    orderPageOpened: 0,
    checkoutOpened: 0,
    orderCreateAttempt: 0,
    orderCreateSuccess: 0,
    orderCreateFailed: 0,
  });

  const totalAttempts = totals.orderCreateAttempt || (totals.orderCreateSuccess + totals.orderCreateFailed);
  const overall = {
    ...totals,
    orderToCheckoutRate: toPercent(totals.checkoutOpened, totals.orderPageOpened),
    checkoutToSuccessRate: toPercent(totals.orderCreateSuccess, totals.checkoutOpened),
    createSuccessRate: toPercent(totals.orderCreateSuccess, totalAttempts),
  };

  return { overall, flows };
}

async function getOpsTelemetrySnapshot({
  day = getTelemetryDay(),
  errorLimit = 30,
  fallbackToPreviousDay = false,
} = {}) {
  const telemetryTimeZone = getTelemetryTimeZone();
  const serverDay = getTelemetryDay();

  if (!redis) {
    return {
      day,
      generatedAt: new Date().toISOString(),
      configured: false,
      telemetryTimeZone,
      serverDay,
      totals: {
        requests: 0,
        errors: 0,
        errorRate: 0,
        avgLatencyMs: 0,
        estimatedReads: 0,
        estimatedWrites: 0,
      },
      endpoints: [],
      funnel: { overall: {}, flows: [] },
      recentErrors: [],
      recentOrderCreates: [],
      fallbackUsed: false,
    };
  }

  const requestedDay = String(day || getTelemetryDay());
  const safeLimit = Math.min(100, Math.max(1, toInt(errorLimit, 30)));
  let activeDay = requestedDay;
  let fallbackUsed = false;
  let fallbackReason = null;
  let dayMaps = await loadTelemetryDayMaps(activeDay, safeLimit);

  if (fallbackToPreviousDay && !hasTelemetryData(dayMaps)) {
    const previousDay = shiftDay(requestedDay, -1);
    if (previousDay) {
      const previousMaps = await loadTelemetryDayMaps(previousDay, safeLimit);
      if (hasTelemetryData(previousMaps)) {
        activeDay = previousDay;
        dayMaps = previousMaps;
        fallbackUsed = true;
        fallbackReason = 'no_data_for_requested_day_using_previous_day';
      }
    }
  }

  const {
    reqMap,
    errMap,
    durMap,
    bucketMap,
    funnelMap,
    readsMap,
    readRequestsMap,
    writesMap,
    writeRequestsMap,
    recentErrorRows,
    recentOrderCreateRows,
  } = dayMaps;

  const endpointNames = new Set([
    ...Object.keys(reqMap || {}),
    ...Object.keys(errMap || {}),
    ...Object.keys(durMap || {}),
    ...Object.keys(readsMap || {}),
    ...Object.keys(writesMap || {}),
  ]);

  const endpoints = Array.from(endpointNames).map((endpoint) => {
    const opsRequests = Math.max(0, toInt(reqMap?.[endpoint], 0));
    const errors = Math.max(0, toInt(errMap?.[endpoint], 0));
    const durationTotalMs = Math.max(0, toInt(durMap?.[endpoint], 0));
    const readEstimate = Math.max(0, toInt(readsMap?.[endpoint], 0));
    const readTrackedRequests = Math.max(0, toInt(readRequestsMap?.[endpoint], 0));
    const writeEstimate = Math.max(0, toInt(writesMap?.[endpoint], 0));
    const writeTrackedRequests = Math.max(0, toInt(writeRequestsMap?.[endpoint], 0));

    const avgReadsPerRequest = readTrackedRequests > 0
      ? Number((readEstimate / readTrackedRequests).toFixed(2))
      : 0;
    const avgWritesPerRequest = writeTrackedRequests > 0
      ? Number((writeEstimate / writeTrackedRequests).toFixed(2))
      : 0;

    const requests = Math.max(opsRequests, readTrackedRequests, writeTrackedRequests);
    const errorRate = toPercent(errors, requests);
    const latency = buildEndpointLatencySummary(endpoint, opsRequests, durationTotalMs, bucketMap || {});

    return {
      endpoint,
      requests,
      opsRequests,
      readTrackedRequests,
      writeTrackedRequests,
      errors,
      errorRate,
      durationTotalMs,
      avgMs: latency.avgMs,
      p95Ms: latency.p95Ms,
      minMs: latency.minMs,
      maxMs: latency.maxMs,
      maxMsOverflow: latency.maxMsOverflow,
      estimatedReads: readEstimate,
      avgReadsPerRequest,
      estimatedWrites: writeEstimate,
      avgWritesPerRequest,
    };
  }).sort((a, b) => {
    if (b.errors !== a.errors) return b.errors - a.errors;
    if (b.p95Ms !== a.p95Ms) return b.p95Ms - a.p95Ms;
    return b.requests - a.requests;
  });

  const hasLegacyReadOnlyRows = endpoints.some(
    (row) => row.requests === 0 && (row.estimatedReads > 0 || row.estimatedWrites > 0)
  );

  const totalRequests = endpoints.reduce((sum, row) => sum + row.requests, 0);
  const totalErrors = endpoints.reduce((sum, row) => sum + row.errors, 0);
  const totalEstimatedReads = endpoints.reduce((sum, row) => sum + row.estimatedReads, 0);
  const totalEstimatedWrites = endpoints.reduce((sum, row) => sum + row.estimatedWrites, 0);
  const totalDurationMs = endpoints.reduce((sum, row) => sum + row.durationTotalMs, 0);
  const avgLatencyMs = totalRequests > 0 ? Number((totalDurationMs / totalRequests).toFixed(1)) : 0;
  const funnel = buildFunnelSummary(funnelMap || {});

  const recentErrors = (recentErrorRows || [])
    .map((row) => parseJsonSafely(row))
    .filter((row) => row && row.day === activeDay)
    .slice(0, safeLimit);

  const recentOrderCreates = (recentOrderCreateRows || [])
    .map((row) => parseJsonSafely(row))
    .filter((row) => row && row.day === activeDay)
    .slice(0, Math.max(1, Math.min(20, safeLimit)));

  return {
    day: activeDay,
    requestedDay,
    generatedAt: new Date().toISOString(),
    configured: true,
    telemetryTimeZone,
    serverDay,
    fallbackUsed,
    fallbackReason,
    totals: {
      requests: totalRequests,
      errors: totalErrors,
      errorRate: toPercent(totalErrors, totalRequests),
      avgLatencyMs,
      estimatedReads: totalEstimatedReads,
      estimatedWrites: totalEstimatedWrites,
    },
    dataQuality: {
      hasLegacyReadOnlyRows,
    },
    endpoints,
    funnel,
    recentErrors,
    recentOrderCreates,
  };
}

async function getAdminOpsTelemetry(req) {
  await resolveAdminContext(req, { checkRevoked: false });

  const rawRequestedDay = req.query?.day;
  const day = normalizeDayParam(rawRequestedDay);
  const errorLimit = clamp(req.query?.errors || 30, 1, 100);

  const snapshot = await getOpsTelemetrySnapshot({
    day,
    errorLimit,
    fallbackToPreviousDay: false,
  });

  return {
    ...snapshot,
    requestedDay: day,
    rawRequestedDay,
  };
}

async function getAdminReadTelemetry(req) {
  await resolveAdminContext(req, { checkRevoked: false });
  if (!redis) {
    throw new HttpError(503, 'KV not configured');
  }

  const day = normalizeDayParam(req.query?.day || getTelemetryDay());
  const readsKey = `telemetry:reads:${day}`;
  const requestsKey = `telemetry:requests:${day}`;

  const [readsMap, requestsMap] = await Promise.all([
    redis.hgetall(readsKey),
    redis.hgetall(requestsKey),
  ]);

  const endpoints = new Set([
    ...Object.keys(readsMap || {}),
    ...Object.keys(requestsMap || {}),
  ]);

  const summary = Array.from(endpoints)
    .map((endpoint) => {
      const reads = Number(readsMap?.[endpoint] || 0);
      const requests = Number(requestsMap?.[endpoint] || 0);
      const avgReadsPerRequest = requests > 0 ? Number((reads / requests).toFixed(2)) : 0;
      return {
        endpoint,
        reads,
        requests,
        avgReadsPerRequest,
      };
    })
    .sort((a, b) => b.reads - a.reads);

  return {
    day,
    summary,
  };
}

module.exports = {
  getAdminOpsTelemetry,
  getAdminReadTelemetry,
};
