const QRCode = require('qrcode');
const { HttpError } = require('../utils/httpError');

function sanitizeUpiId(value) {
  return String(value || '').trim();
}

function sanitizeText(value, fallback = '', maxLen = 80) {
  const normalized = String(value || fallback || '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maxLen);
}

function sanitizePayeeName(value) {
  const cleaned = sanitizeText(value, 'ServiZephyr', 48)
    .replace(/[^a-zA-Z0-9 .,&()/-]/g, '')
    .trim();
  return cleaned || 'ServiZephyr';
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toFixed(2);
}

function buildUpiQuery(params = {}) {
  return Object.entries(params)
    .filter(([, value]) => String(value || '').trim())
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value).trim())}`)
    .join('&');
}

function buildUpiLink({
  upiId,
  payeeName,
  amountFixed,
  note,
  transactionRef,
}) {
  const cleanTr = sanitizeText(transactionRef, '', 35).replace(/[^a-zA-Z0-9]/g, '');
  const query = buildUpiQuery({
    pa: sanitizeUpiId(upiId),
    pn: sanitizePayeeName(payeeName),
    am: amountFixed,
    cu: 'INR',
    tn: sanitizeText(note, 'Order Payment', 40),
    tr: cleanTr,
  });
  return `upi://pay?${query}`;
}

async function generateUpiQrPng(upiLink) {
  const dataUrl = await QRCode.toDataURL(upiLink, {
    width: 720,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#111111',
      light: '#FFFFFF',
    },
  });

  const encoded = dataUrl.split(',')[1];
  return Buffer.from(encoded, 'base64');
}

async function getUpiQrCardImage(req) {
  const upiId = sanitizeUpiId(req.query.upi || req.query.pa);
  const payeeName = sanitizeText(req.query.pn, 'ServiZephyr', 60);
  const amountFixed = normalizeAmount(req.query.am);
  const restaurantName = sanitizeText(req.query.rn || payeeName || 'Restaurant', 'Restaurant', 80);
  const orderDisplayId = sanitizeText(req.query.oid, '', 32);
  const note = sanitizeText(req.query.tn || `Order ${orderDisplayId || 'Payment'}`, '', 80);
  const transactionRef = sanitizeText(req.query.tr, '', 35);

  if (!upiId.includes('@')) {
    throw new HttpError(400, 'Invalid UPI ID');
  }
  if (!amountFixed) {
    throw new HttpError(400, 'Invalid amount');
  }

  const upiLink = buildUpiLink({
    upiId,
    payeeName,
    amountFixed,
    note,
    transactionRef,
  });

  const pngBuffer = await generateUpiQrPng(upiLink);

  return {
    contentType: 'image/png',
    cacheControl: 'public, max-age=300, stale-while-revalidate=600',
    body: pngBuffer,
    meta: {
      upiId,
      payeeName,
      restaurantName,
      orderDisplayId,
      amountFixed,
      upiLink,
    },
  };
}

module.exports = {
  getUpiQrCardImage,
};
