import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const RESTAURANT_ID = __ENV.RESTAURANT_ID || '';
const ORDER_CREATE_PAYLOAD = __ENV.ORDER_CREATE_PAYLOAD || '';
const WRITE_MIX_PERCENT = Number(__ENV.WRITE_MIX_PERCENT || 0);

export const options = {
  scenarios: {
    customer_read_peak: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '2m', target: 50 },
        { duration: '5m', target: 120 },
        { duration: '2m', target: 200 },
        { duration: '5m', target: 120 },
        { duration: '2m', target: 20 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1200', 'p(99)<2500'],
  },
};

function parsePayload(jsonText) {
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export default function () {
  const createPayload = parsePayload(ORDER_CREATE_PAYLOAD);
  const shouldRunWriteMix = createPayload && WRITE_MIX_PERCENT > 0 && Math.random() * 100 < WRITE_MIX_PERCENT;

  if (shouldRunWriteMix) {
    const createRes = http.post(
      `${BASE_URL}/api/order/create`,
      JSON.stringify(createPayload),
      { headers: { 'Content-Type': 'application/json' } }
    );
    check(createRes, {
      'order create acceptable': (r) => [200, 409, 422].includes(r.status),
    });
    sleep(Math.random() * 0.7);
    return;
  }

  const calls = [
    `${BASE_URL}/healthz`,
    RESTAURANT_ID ? `${BASE_URL}/api/public/menu/${RESTAURANT_ID}` : null,
    RESTAURANT_ID ? `${BASE_URL}/api/public/bootstrap/${RESTAURANT_ID}` : null,
  ].filter(Boolean);

  const target = calls[Math.floor(Math.random() * calls.length)];
  const res = http.get(target);

  check(res, {
    'status acceptable': (r) => r.status >= 200 && r.status < 500,
  });

  sleep(Math.random() * 1.5);
}
