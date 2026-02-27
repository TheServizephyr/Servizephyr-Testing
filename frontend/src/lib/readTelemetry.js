import { kv } from '@vercel/kv';

const TELEMETRY_ENABLED = process.env.ENABLE_READ_TELEMETRY === 'true';
const TELEMETRY_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days
const DEFAULT_TELEMETRY_TIMEZONE = 'Asia/Kolkata';

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

function getDayKeySuffix(date = new Date()) {
    const timeZone = String(process.env.OPS_TELEMETRY_TIMEZONE || DEFAULT_TELEMETRY_TIMEZONE).trim();
    if (timeZone) {
        const zonedDay = formatDayWithTimeZone(date, timeZone);
        if (zonedDay) return zonedDay;
    }
    return date.toISOString().slice(0, 10);
}

/**
 * Best-effort endpoint telemetry for estimated Firestore read pressure.
 * Disabled by default; enable with ENABLE_READ_TELEMETRY=true.
 */
export async function trackEndpointRead(endpointName, estimatedReads = 0) {
    if (!TELEMETRY_ENABLED) return;
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
    if (!endpointName) return;

    const reads = Number.isFinite(Number(estimatedReads)) ? Math.max(0, Math.floor(Number(estimatedReads))) : 0;
    const dayKey = `telemetry:reads:${getDayKeySuffix()}`;
    const reqKey = `telemetry:requests:${getDayKeySuffix()}`;

    try {
        await Promise.all([
            kv.hincrby(dayKey, endpointName, reads),
            kv.hincrby(reqKey, endpointName, 1),
            kv.expire(dayKey, TELEMETRY_TTL_SECONDS),
            kv.expire(reqKey, TELEMETRY_TTL_SECONDS),
        ]);
    } catch {
        // Never fail request path because of telemetry.
    }
}

/**
 * Best-effort endpoint telemetry for estimated Firestore write pressure.
 * Disabled by default; enable with ENABLE_READ_TELEMETRY=true.
 */
export async function trackEndpointWrite(endpointName, estimatedWrites = 0) {
    if (!TELEMETRY_ENABLED) return;
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
    if (!endpointName) return;

    const writes = Number.isFinite(Number(estimatedWrites)) ? Math.max(0, Math.floor(Number(estimatedWrites))) : 0;
    const dayKey = `telemetry:writes:${getDayKeySuffix()}`;
    const reqKey = `telemetry:write_requests:${getDayKeySuffix()}`;

    try {
        await Promise.all([
            kv.hincrby(dayKey, endpointName, writes),
            kv.hincrby(reqKey, endpointName, 1),
            kv.expire(dayKey, TELEMETRY_TTL_SECONDS),
            kv.expire(reqKey, TELEMETRY_TTL_SECONDS),
        ]);
    } catch {
        // Never fail request path because of telemetry.
    }
}
