import { kv } from '@vercel/kv';

const TELEMETRY_ENABLED = process.env.ENABLE_OPS_TELEMETRY !== 'false';
const TELEMETRY_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days
const RECENT_ERRORS_KEY = 'telemetry:ops:errors:recent';
const MAX_RECENT_ERRORS = 250;
const RECENT_ORDER_CREATES_KEY = 'telemetry:ops:order_create:recent';
const MAX_RECENT_ORDER_CREATES = 400;
const DEFAULT_TELEMETRY_TIMEZONE = 'Asia/Kolkata';

const LATENCY_BUCKET_LIMITS = [100, 250, 500, 1000, 2000, 3000, 5000, 8000, 12000];
const LATENCY_BUCKETS = [
    ...LATENCY_BUCKET_LIMITS.map((limit) => `le_${limit}`),
    `gt_${LATENCY_BUCKET_LIMITS[LATENCY_BUCKET_LIMITS.length - 1]}`
];

const ALLOWED_FLOWS = new Set(['delivery', 'pickup', 'dine-in', 'car-order', 'other']);
const ALLOWED_EVENTS = new Set([
    'order_page_opened',
    'checkout_opened',
    'order_create_attempt',
    'order_create_success',
    'order_create_failed',
]);

export function getTelemetryTimeZone() {
    const configured = String(process.env.OPS_TELEMETRY_TIMEZONE || DEFAULT_TELEMETRY_TIMEZONE).trim();
    return configured || 'UTC';
}

function getExpiryTouchCache() {
    if (!globalThis.__opsTelemetryExpiryTouchCache) {
        globalThis.__opsTelemetryExpiryTouchCache = new Set();
    }
    return globalThis.__opsTelemetryExpiryTouchCache;
}

function pushExpireIfFirstTouch(ops, key) {
    const cache = getExpiryTouchCache();
    if (cache.size > 1200) {
        cache.clear();
    }
    if (cache.has(key)) return;
    cache.add(key);
    ops.push(kv.expire(key, TELEMETRY_TTL_SECONDS));
}

function toInt(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
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

export function getTelemetryDay(date = new Date()) {
    const timeZone = getTelemetryTimeZone();
    if (timeZone) {
        const zonedDay = formatDayWithTimeZone(date, timeZone);
        if (zonedDay) return zonedDay;
    }
    return date.toISOString().slice(0, 10);
}

export function isOpsTelemetryConfigured() {
    return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function sanitizeEndpoint(endpoint) {
    return String(endpoint || '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/\|/g, ':')
        .slice(0, 160);
}

export function normalizeFlow(flow) {
    const raw = String(flow || '').trim().toLowerCase();
    if (!raw) return 'other';
    if (raw === 'dine_in') return 'dine-in';
    if (raw === 'car' || raw === 'carorder') return 'car-order';
    if (raw === 'street-vendor-pre-order' || raw === 'pre-order') return 'delivery';
    if (ALLOWED_FLOWS.has(raw)) return raw;
    return 'other';
}

export function normalizeFunnelEvent(eventName) {
    const normalized = String(eventName || '').trim().toLowerCase();
    if (!ALLOWED_EVENTS.has(normalized)) return null;
    return normalized;
}

function getLatencyBucket(durationMs) {
    const safeMs = Math.max(0, toInt(durationMs, 0));
    for (const limit of LATENCY_BUCKET_LIMITS) {
        if (safeMs <= limit) return `le_${limit}`;
    }
    return `gt_${LATENCY_BUCKET_LIMITS[LATENCY_BUCKET_LIMITS.length - 1]}`;
}

function parseBucketUpper(bucket) {
    if (!bucket) return 0;
    if (bucket.startsWith('le_')) {
        return toInt(bucket.slice(3), 0);
    }
    if (bucket.startsWith('gt_')) {
        return toInt(bucket.slice(3), 0) + 1;
    }
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
    try {
        return JSON.parse(value);
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

async function loadTelemetryDayMaps(day, safeLimit) {
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
        kv.hgetall(reqKey),
        kv.hgetall(errKey),
        kv.hgetall(durKey),
        kv.hgetall(bucketKey),
        kv.hgetall(funnelKey),
        kv.hgetall(readsKey),
        kv.hgetall(readRequestsKey),
        kv.hgetall(writesKey),
        kv.hgetall(writeRequestsKey),
        kv.lrange(RECENT_ERRORS_KEY, 0, safeLimit - 1),
        kv.lrange(RECENT_ORDER_CREATES_KEY, 0, recentOrderCreateLimit - 1),
    ]);

    return {
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
    };
}

function hasTelemetryData(dayMaps = {}) {
    return (
        hasPositiveValueMapData(dayMaps.reqMap) ||
        hasPositiveValueMapData(dayMaps.errMap) ||
        hasPositiveValueMapData(dayMaps.durMap) ||
        hasPositiveValueMapData(dayMaps.funnelMap) ||
        hasPositiveValueMapData(dayMaps.readsMap) ||
        hasPositiveValueMapData(dayMaps.readRequestsMap) ||
        hasPositiveValueMapData(dayMaps.writesMap) ||
        hasPositiveValueMapData(dayMaps.writeRequestsMap)
    );
}

export async function trackApiTelemetry({
    endpoint,
    durationMs,
    statusCode = 200,
    errorMessage = null,
    context = null,
}) {
    if (!TELEMETRY_ENABLED) return;
    if (!isOpsTelemetryConfigured()) return;

    const endpointName = sanitizeEndpoint(endpoint);
    if (!endpointName) return;

    const safeDuration = Math.max(0, toInt(durationMs, 0));
    const safeStatus = Math.max(0, toInt(statusCode, 0));
    const day = getTelemetryDay();
    const isServerError = safeStatus >= 500;
    const latencyBucket = getLatencyBucket(safeDuration);

    const reqKey = `telemetry:ops:req:${day}`;
    const errKey = `telemetry:ops:err:${day}`;
    const durKey = `telemetry:ops:dur:${day}`;
    const bucketKey = `telemetry:ops:bucket:${day}`;

    const ops = [
        kv.hincrby(reqKey, endpointName, 1),
        kv.hincrby(durKey, endpointName, safeDuration),
        kv.hincrby(bucketKey, `${endpointName}|${latencyBucket}`, 1),
    ];
    pushExpireIfFirstTouch(ops, reqKey);
    pushExpireIfFirstTouch(ops, errKey);
    pushExpireIfFirstTouch(ops, durKey);
    pushExpireIfFirstTouch(ops, bucketKey);

    if (isServerError) {
        ops.push(kv.hincrby(errKey, endpointName, 1));
        const errorEntry = {
            at: new Date().toISOString(),
            day,
            endpoint: endpointName,
            statusCode: safeStatus,
            message: String(errorMessage || 'Server error').slice(0, 300),
            context: context && typeof context === 'object' ? context : null,
        };
        ops.push(
            kv.lpush(RECENT_ERRORS_KEY, JSON.stringify(errorEntry)),
            kv.ltrim(RECENT_ERRORS_KEY, 0, MAX_RECENT_ERRORS - 1),
        );
        pushExpireIfFirstTouch(ops, RECENT_ERRORS_KEY);
    }

    if (endpointName === 'api.order.create') {
        const orderCreateEntry = {
            at: new Date().toISOString(),
            day,
            endpoint: endpointName,
            durationMs: safeDuration,
            statusCode: safeStatus,
            ok: safeStatus < 400,
            message: errorMessage ? String(errorMessage).slice(0, 300) : null,
            context: context && typeof context === 'object' ? context : null,
        };
        ops.push(
            kv.lpush(RECENT_ORDER_CREATES_KEY, JSON.stringify(orderCreateEntry)),
            kv.ltrim(RECENT_ORDER_CREATES_KEY, 0, MAX_RECENT_ORDER_CREATES - 1),
        );
        pushExpireIfFirstTouch(ops, RECENT_ORDER_CREATES_KEY);
    }

    try {
        await Promise.all(ops);
    } catch {
        // Best-effort; never block request flow.
    }
}

export async function trackFunnelEvent(eventName, flow = 'other') {
    if (!TELEMETRY_ENABLED) return;
    if (!isOpsTelemetryConfigured()) return;

    const event = normalizeFunnelEvent(eventName);
    if (!event) return;

    const normalizedFlow = normalizeFlow(flow);
    const day = getTelemetryDay();
    const funnelKey = `telemetry:ops:funnel:${day}`;
    const field = `${normalizedFlow}|${event}`;
    const ops = [kv.hincrby(funnelKey, field, 1)];
    pushExpireIfFirstTouch(ops, funnelKey);

    try {
        await Promise.all(ops);
    } catch {
        // Best-effort; never block request flow.
    }
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

export async function getOpsTelemetrySnapshot({
    day = getTelemetryDay(),
    errorLimit = 30,
    fallbackToPreviousDay = false,
} = {}) {
    const telemetryTimeZone = getTelemetryTimeZone();
    const serverDay = getTelemetryDay();

    if (!isOpsTelemetryConfigured()) {
        return {
            day,
            generatedAt: new Date().toISOString(),
            configured: false,
            telemetryTimeZone,
            serverDay,
            totals: { requests: 0, errors: 0, errorRate: 0, estimatedReads: 0, estimatedWrites: 0 },
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
        const avgReadsPerRequest = readTrackedRequests > 0
            ? Number((readEstimate / readTrackedRequests).toFixed(2))
            : 0;
        const writeEstimate = Math.max(0, toInt(writesMap?.[endpoint], 0));
        const writeTrackedRequests = Math.max(0, toInt(writeRequestsMap?.[endpoint], 0));
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
