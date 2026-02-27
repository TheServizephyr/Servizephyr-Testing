import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const RESTAURANT_ID = __ENV.RESTAURANT_ID || 'ashwani\'s-restaurant';

// Real items from ashwani's-restaurant menu (prices verified from API)
// French Fries Half = ₹63, Chilli Paneer Half = ₹105  → subtotal = ₹168
const ITEMS = [
    {
        id: 'Ee3fqae5Zms1ZALaYljh',
        name: 'French Fries',
        categoryId: 'starters',
        isVeg: true,
        quantity: 1,
        portion: { name: 'Half', price: 63, isDefault: false },
        price: 63,
        totalPrice: 63,
    },
    {
        id: 'ZFqwkV2PFrgeYTWVWRCN',
        name: 'Chilli Paneer',
        categoryId: 'starters',
        isVeg: true,
        quantity: 1,
        portion: { name: 'Half', price: 105, isDefault: false },
        price: 105,
        totalPrice: 105,
    },
];

const SUBTOTAL = 168; // 63 + 105

// ─── OPTIONS ───────────────────────────────────────────────────────────────
export const options = {
    scenarios: {
        order_create: {
            executor: 'ramping-vus',
            startVUs: 1,
            stages: [
                { duration: '30s', target: 5 },  // warm up
                { duration: '2m', target: 10 },  // steady load
                { duration: '30s', target: 0 },  // ramp down
            ],
            gracefulRampDown: '10s',
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],          // < 5% errors
        http_req_duration: ['p(95)<5000'],         // p95 < 5s (Firestore writes expected)
        'http_req_duration{scenario:order_create}': ['p(50)<3000'], // median < 3s
    },
};

// ─── HELPERS ───────────────────────────────────────────────────────────────
function makePhone() {
    // Random 10-digit Indian phone (91xxxxxxxx format used internally)
    const n = Math.floor(7000000000 + Math.random() * 2999999999);
    return `+91${n}`;
}

function makeOrderPayload() {
    return {
        restaurantId: RESTAURANT_ID,
        idempotencyKey: uuidv4(),          // unique per request — no duplicate orders
        paymentMethod: 'cod',              // COD → native backend path
        deliveryType: 'pickup',            // simplest — no address/distance needed
        phone: makePhone(),
        customerName: 'Load Test User',
        items: ITEMS,
        subtotal: SUBTOTAL,
        total: SUBTOTAL,
        grandTotal: SUBTOTAL,  // server validates body.grandTotal explicitly
        deliveryCharge: 0,
        tip: 0,
        gstAmount: 0,
        packagingCharge: 0,
        convenienceFee: 0,
        couponDiscount: 0,
        notes: 'k6 load test order — please ignore',
    };
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
export default function () {
    const payload = JSON.stringify(makeOrderPayload());

    const res = http.post(
        `${BASE_URL}/api/order/create`,
        payload,
        {
            headers: {
                'Content-Type': 'application/json',
                'x-request-id': uuidv4(),
            },
            timeout: '30s',
        }
    );

    const ok = check(res, {
        'status is 200': (r) => r.status === 200,
        'has orderId': (r) => {
            try {
                const body = JSON.parse(r.body);
                return Boolean(body?.orderId || body?.order?.id || body?.id);
            } catch { return false; }
        },
        'native backend': (r) => r.headers['X-Order-Create-Mode']?.startsWith('native') === true,
    });

    if (!ok) {
        console.log(`FAIL [${res.status}]: ${res.body?.slice(0, 200)}`);
    }

    // Real customers don't spam — small think time between orders
    sleep(1 + Math.random() * 2);
}
