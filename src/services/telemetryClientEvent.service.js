const { Redis } = require('@upstash/redis');
const { config } = require('../config/env');

const TELEMETRY_TTL_SECONDS = 14 * 24 * 60 * 60;
const DEFAULT_TELEMETRY_TIMEZONE = 'Asia/Kolkata';
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
  const zonedDay = formatDayWithTimeZone(date, timeZone);
  if (zonedDay) return zonedDay;
  return date.toISOString().slice(0, 10);
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

async function trackFunnelEvent(eventName, flow = 'other') {
  if (!redis) return false;
  const event = normalizeFunnelEvent(eventName);
  if (!event) return false;

  const normalizedFlow = normalizeFlow(flow);
  const day = getTelemetryDay();
  const funnelKey = `telemetry:ops:funnel:${day}`;
  const field = `${normalizedFlow}|${event}`;

  try {
    await Promise.all([
      redis.hincrby(funnelKey, field, 1),
      redis.expire(funnelKey, TELEMETRY_TTL_SECONDS),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function postClientTelemetryEvent(req) {
  const payload = req.body || {};
  const event = normalizeFunnelEvent(payload.event);

  if (!event) {
    return {
      status: 202,
      payload: { message: 'Ignored: unsupported event' },
    };
  }

  const flow = normalizeFlow(payload.flow || payload.deliveryType || 'other');
  void trackFunnelEvent(event, flow);

  return {
    status: 202,
    payload: { ok: true },
  };
}

module.exports = {
  postClientTelemetryEvent,
};
