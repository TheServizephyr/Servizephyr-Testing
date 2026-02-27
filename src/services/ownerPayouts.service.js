const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

function resolveRazorpayCredentials() {
  const keyId = String(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (!keyId || !keySecret) {
    throw new HttpError(500, 'Payment gateway not configured');
  }
  return {
    keyId,
    keySecret,
    credentials: Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
  };
}

async function makeRazorpayRequest({ path, credentials, accountId = '', method = 'GET' }) {
  const headers = {
    Authorization: `Basic ${credentials}`,
    Accept: 'application/json',
  };
  if (accountId) {
    headers['X-Razorpay-Account'] = accountId;
  }

  const response = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.description || payload?.error?.reason || 'Razorpay request failed';
    throw new HttpError(response.status || 502, message);
  }
  return payload;
}

async function getOwnerPayouts(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_PAYMENTS],
  });

  const razorpayAccountId = String(owner.businessData?.razorpayAccountId || '').trim();
  if (!razorpayAccountId) {
    throw new HttpError(404, 'Razorpay account is not linked.');
  }

  const { credentials } = resolveRazorpayCredentials();

  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const paymentQueryParams = new URLSearchParams();
  if (from) paymentQueryParams.append('from', from);
  if (to) paymentQueryParams.append('to', to);

  const paymentsPath = paymentQueryParams.toString()
    ? `/v1/payments?${paymentQueryParams.toString()}`
    : '/v1/payments';

  const paymentsData = await makeRazorpayRequest({
    path: paymentsPath,
    credentials,
    accountId: razorpayAccountId,
  });

  if (!Array.isArray(paymentsData.items) || paymentsData.items.length === 0) {
    return {
      payouts: [],
      summary: {
        total: 0,
        lastPayout: 0,
        pending: 0,
      },
    };
  }

  const transferPromises = paymentsData.items.map(async (payment) => {
    if (payment.status !== 'captured') return { items: [] };
    try {
      return await makeRazorpayRequest({
        path: `/v1/payments/${payment.id}/transfers`,
        credentials,
      });
    } catch {
      return { items: [] };
    }
  });

  const transfersResults = await Promise.all(transferPromises);
  const allTransfers = transfersResults.flatMap((result) => (
    Array.isArray(result?.items) ? result.items : []
  ));

  const relevantTransfers = allTransfers.filter((transfer) => transfer.recipient === razorpayAccountId);

  const payouts = relevantTransfers.map((transfer) => ({
    id: transfer.id,
    amount: transfer.amount,
    currency: transfer.currency,
    status: transfer.status,
    utr: transfer.settlement_utr,
    created_at: transfer.created_at,
  }));

  const total = payouts
    .filter((payout) => payout.status === 'processed')
    .reduce((sum, payout) => sum + Number(payout.amount || 0), 0);

  payouts.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  const lastPayout = payouts.length > 0 ? Number(payouts[0].amount || 0) : 0;
  const pending = payouts
    .filter((payout) => payout.status === 'pending')
    .reduce((sum, payout) => sum + Number(payout.amount || 0), 0);

  return {
    payouts,
    summary: {
      total: total / 100,
      lastPayout: lastPayout / 100,
      pending: pending / 100,
    },
  };
}

module.exports = {
  getOwnerPayouts,
};
