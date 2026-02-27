const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext } = require('./accessControl.service');

function canManageLinkedAccount(owner) {
  if (owner.isAdminImpersonation) return true;
  const role = String(owner.callerRole || '').toLowerCase();
  return role === 'owner' || role === 'street-vendor';
}

function getCredentials() {
  const keyId = String(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();

  if (!keyId || !keySecret) {
    throw new HttpError(500, 'Payment gateway is not configured on the server.');
  }

  const encoded = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  return {
    keyId,
    keySecret,
    authorization: `Basic ${encoded}`,
  };
}

function normalizeText(value) {
  return String(value || '').trim();
}

async function razorpayRequest({ method, path, body, authHeader }) {
  const response = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let parsedBody = null;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    const description = parsedBody?.error?.description
      || parsedBody?.error?.reason
      || parsedBody?.message
      || `Razorpay request failed with status ${response.status}.`;
    throw new HttpError(502, `Razorpay Error: ${description}`);
  }

  return parsedBody || {};
}

async function createOwnerLinkedAccount(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    allowEmployee: false,
    allowAdminImpersonation: true,
  });

  if (!canManageLinkedAccount(owner)) {
    throw new HttpError(403, 'Access denied: only owner can configure payout account.');
  }

  const beneficiaryName = normalizeText(req.body?.beneficiaryName);
  const accountNumber = normalizeText(req.body?.accountNumber);
  const ifsc = normalizeText(req.body?.ifsc).toUpperCase();

  if (!beneficiaryName || !accountNumber || !ifsc) {
    throw new HttpError(400, 'Bank Account Holder Name, Account Number, and IFSC code are required.');
  }

  const ownerUserDoc = await owner.firestore.collection('users').doc(owner.ownerUid).get();
  if (!ownerUserDoc.exists) {
    throw new HttpError(404, 'Owner user profile not found.');
  }

  const ownerUserData = ownerUserDoc.data() || {};
  const businessData = owner.businessData || {};
  const businessRef = owner.businessSnap.ref;

  const ownerEmail = normalizeText(ownerUserData.email);
  const ownerName = normalizeText(ownerUserData.name);
  const ownerPhone = normalizeText(ownerUserData.phone);
  const businessName = normalizeText(businessData.name);
  const address = businessData.address && typeof businessData.address === 'object' ? businessData.address : {};
  const addressStreet = normalizeText(address.street);

  if (!ownerEmail || !ownerName || !ownerPhone || !businessName || !addressStreet) {
    throw new HttpError(
      400,
      'User email, name, phone, business name, and business address are required for linked account setup.'
    );
  }

  const credentials = getCredentials();
  const { authorization } = credentials;

  const searchResult = await razorpayRequest({
    method: 'GET',
    path: `/v2/accounts?email=${encodeURIComponent(ownerEmail)}`,
    authHeader: authorization,
  });

  let accountId = '';

  if (Array.isArray(searchResult?.items) && searchResult.items.length > 0) {
    accountId = String(searchResult.items[0]?.id || '').trim();
  }

  if (!accountId) {
    const linkedAccount = await razorpayRequest({
      method: 'POST',
      path: '/v2/accounts',
      authHeader: authorization,
      body: {
        type: 'route',
        email: ownerEmail,
        legal_business_name: businessName,
        business_type: 'proprietorship',
        contact_name: ownerName,
        phone: ownerPhone,
        profile: {
          category: 'food_and_beverage',
          subcategory: 'food_and_beverage',
          addresses: {
            registered: {
              street1: addressStreet,
              street2: normalizeText(address.street2 || addressStreet),
              city: normalizeText(address.city),
              state: normalizeText(address.state),
              postal_code: normalizeText(address.postalCode),
              country: normalizeText(address.country || 'IN'),
            },
          },
        },
      },
    });

    accountId = String(linkedAccount?.id || '').trim();
    if (!accountId) {
      throw new HttpError(502, 'Razorpay account creation failed.');
    }

    await razorpayRequest({
      method: 'POST',
      path: `/v2/accounts/${accountId}/stakeholders`,
      authHeader: authorization,
      body: {
        name: ownerName,
        email: ownerEmail,
      },
    });

    const product = await razorpayRequest({
      method: 'POST',
      path: `/v2/accounts/${accountId}/products`,
      authHeader: authorization,
      body: {
        product_name: 'route',
        tnc_accepted: true,
      },
    });

    const productId = String(product?.id || '').trim();
    if (!productId) {
      throw new HttpError(502, 'Razorpay route product setup failed.');
    }

    await razorpayRequest({
      method: 'PATCH',
      path: `/v2/accounts/${accountId}/products/${productId}`,
      authHeader: authorization,
      body: {
        tnc_accepted: true,
        settlements: {
          account_number: accountNumber,
          ifsc_code: ifsc,
          beneficiary_name: beneficiaryName,
        },
      },
    });
  }

  await businessRef.update({
    razorpayAccountId: accountId,
    updatedAt: new Date(),
  });

  return {
    message: 'Linked account created/retrieved successfully!',
    accountId,
  };
}

module.exports = {
  createOwnerLinkedAccount,
};
