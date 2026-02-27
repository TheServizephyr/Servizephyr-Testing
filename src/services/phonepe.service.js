const { config } = require('../config/env');
const { HttpError } = require('../utils/httpError');

const PHONEPE_BASE_URL = process.env.PHONEPE_BASE_URL;
const PHONEPE_AUTH_URL = process.env.PHONEPE_AUTH_URL;
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || '1';
const SUCCESS_STATES = new Set(['COMPLETED', 'PAYMENT_SUCCESS']);
const TOKEN_SKEW_SEC = 60;

const tokenCache = {
  accessToken: '',
  expiresAtSec: 0,
};

function ensurePhonePeConfig() {
  if (!PHONEPE_BASE_URL || !PHONEPE_AUTH_URL || !CLIENT_ID || !CLIENT_SECRET) {
    throw new HttpError(500, 'PhonePe not configured');
  }
}

function safeMessage(payload, fallback) {
  return (
    payload?.message ||
    payload?.error?.message ||
    payload?.code ||
    fallback
  );
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function parseExpiresAtSec(payload) {
  const expiresAtRaw = Number(payload?.expires_at);
  if (Number.isFinite(expiresAtRaw) && expiresAtRaw > 0) {
    // Some gateways return ms; normalize to seconds.
    return expiresAtRaw > 1e12 ? Math.floor(expiresAtRaw / 1000) : Math.floor(expiresAtRaw);
  }

  const expiresInRaw = Number(payload?.expires_in);
  if (Number.isFinite(expiresInRaw) && expiresInRaw > 0) {
    return nowSec() + Math.floor(expiresInRaw);
  }

  return nowSec() + 900;
}

async function getPhonePeAccessTokenDetails(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  ensurePhonePeConfig();

  const now = nowSec();
  if (!forceRefresh && tokenCache.accessToken && tokenCache.expiresAtSec > now + TOKEN_SKEW_SEC) {
    return {
      accessToken: tokenCache.accessToken,
      expiresAtSec: tokenCache.expiresAtSec,
    };
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_version: CLIENT_VERSION,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
  }).toString();

  const response = await fetch(PHONEPE_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new HttpError(502, safeMessage(payload, 'PhonePe auth failed'));
  }

  tokenCache.accessToken = String(payload.access_token || '').trim();
  tokenCache.expiresAtSec = parseExpiresAtSec(payload);

  return {
    accessToken: tokenCache.accessToken,
    expiresAtSec: tokenCache.expiresAtSec,
  };
}

async function getPhonePeAccessToken(options = {}) {
  const details = await getPhonePeAccessTokenDetails(options);
  return details.accessToken;
}

async function initiatePhonePePayment({ amount, orderId }) {
  if (!amount || !orderId) {
    throw new HttpError(400, 'Amount and Order ID are required');
  }

  const accessToken = await getPhonePeAccessToken();
  const amountInPaise = Math.round(Number(amount) * 100);
  if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
    throw new HttpError(400, 'Invalid amount');
  }

  const baseUrl = config.publicBaseUrl || config.legacy.baseUrl || 'https://www.servizephyr.com';
  const redirectUrl = `${baseUrl}/track/${encodeURIComponent(String(orderId))}?payment_status=success`;

  const paymentPayload = {
    merchantOrderId: String(orderId),
    amount: amountInPaise,
    expireAfter: 1200,
    paymentFlow: {
      type: 'PG_CHECKOUT',
      message: 'Payment for your order',
      merchantUrls: {
        redirectUrl,
      },
    },
  };

  const paymentRes = await fetch(`${PHONEPE_BASE_URL}/checkout/v2/pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `O-Bearer ${accessToken}`,
    },
    body: JSON.stringify(paymentPayload),
  });

  const paymentData = await paymentRes.json().catch(() => ({}));
  if (!paymentRes.ok || !paymentData?.redirectUrl) {
    throw new HttpError(502, safeMessage(paymentData, 'PhonePe payment initiation failed'));
  }

  return {
    success: true,
    url: paymentData.redirectUrl,
    orderId: paymentData.orderId || null,
    state: paymentData.state || null,
  };
}

function isPhonePePaymentSuccess(state) {
  return SUCCESS_STATES.has(String(state || '').toUpperCase());
}

async function getPhonePeOrderStatus({ orderId }) {
  const safeOrderId = String(orderId || '').trim();
  if (!safeOrderId) {
    throw new HttpError(400, 'Order ID is required');
  }

  const accessToken = await getPhonePeAccessToken();
  const endpoint = `${PHONEPE_BASE_URL}/checkout/v2/order/${encodeURIComponent(safeOrderId)}/status`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `O-Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, safeMessage(payload, 'PhonePe status fetch failed'));
  }
  return payload;
}

module.exports = {
  getPhonePeAccessToken,
  getPhonePeAccessTokenDetails,
  getPhonePeOrderStatus,
  isPhonePePaymentSuccess,
  initiatePhonePePayment,
};
