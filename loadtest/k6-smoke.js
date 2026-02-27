import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const RESTAURANT_ID = __ENV.RESTAURANT_ID || '';
const ORDER_CREATE_PAYLOAD = __ENV.ORDER_CREATE_PAYLOAD || '';

export const options = {
  vus: 5,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

function authHeaders() {
  if (!AUTH_TOKEN) return { 'Content-Type': 'application/json' };
  return {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function parsePayload(jsonText) {
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export default function () {
  const health = http.get(`${BASE_URL}/healthz`);
  check(health, { 'healthz is 200': (r) => r.status === 200 });

  if (RESTAURANT_ID) {
    const menu = http.get(`${BASE_URL}/api/public/menu/${RESTAURANT_ID}`);
    check(menu, { 'public menu is 200': (r) => r.status === 200 });
  }

  if (AUTH_TOKEN) {
    const ownerStatus = http.get(`${BASE_URL}/api/owner/status`, { headers: authHeaders() });
    check(ownerStatus, { 'owner status is 200/403': (r) => r.status === 200 || r.status === 403 });
  }

  const createPayload = parsePayload(ORDER_CREATE_PAYLOAD);
  if (createPayload) {
    const createRes = http.post(
      `${BASE_URL}/api/order/create`,
      JSON.stringify(createPayload),
      { headers: authHeaders() }
    );
    check(createRes, {
      'order create acceptable': (r) => [200, 409, 422].includes(r.status),
    });
  }

  sleep(1);
}
