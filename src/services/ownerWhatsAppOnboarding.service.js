const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext } = require('./accessControl.service');

async function graphGet(pathname, params = {}) {
  const url = new URL(`https://graph.facebook.com/v19.0/${pathname.replace(/^\/+/, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), { method: 'GET' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || 'Failed to communicate with Facebook API.';
    throw new HttpError(response.status || 502, message);
  }
  return payload;
}

async function postOwnerWhatsAppOnboarding(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
  });

  const code = String(body.code || '').trim();
  if (!code) {
    throw new HttpError(400, 'Authorization code is missing.');
  }

  const appId = String(process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || '').trim();
  const appSecret = String(process.env.FACEBOOK_APP_SECRET || '').trim();
  if (!appId || !appSecret) {
    throw new HttpError(500, 'Server configuration error. Please contact support.');
  }

  const tokenResponse = await graphGet('oauth/access_token', {
    client_id: appId,
    client_secret: appSecret,
    code,
  });
  const userAccessToken = String(tokenResponse?.access_token || '').trim();
  if (!userAccessToken) {
    throw new HttpError(502, 'Could not retrieve User Access Token from Facebook.');
  }

  const debugResponse = await graphGet('debug_token', {
    input_token: userAccessToken,
    access_token: `${appId}|${appSecret}`,
  });

  const scopes = Array.isArray(debugResponse?.data?.granular_scopes)
    ? debugResponse.data.granular_scopes
    : [];
  const embeddedSignupData = scopes.find(
    (scope) => scope?.scope === 'whatsapp_business_management'
  )?.target_ids;
  if (!Array.isArray(embeddedSignupData) || embeddedSignupData.length === 0) {
    throw new HttpError(
      502,
      'Could not retrieve WhatsApp Business Account details from session.'
    );
  }

  const wabaId = embeddedSignupData[0];
  const phoneNumbersResponse = await graphGet(`${wabaId}/phone_numbers`, {
    access_token: userAccessToken,
  });

  if (!Array.isArray(phoneNumbersResponse?.data) || phoneNumbersResponse.data.length === 0) {
    throw new HttpError(502, `No phone numbers found for WABA ID: ${wabaId}`);
  }

  const phoneNumberInfo = phoneNumbersResponse.data[0] || {};
  const phoneNumberId = String(phoneNumberInfo.id || '').trim();
  const displayPhoneNumber = String(phoneNumberInfo.display_phone_number || '')
    .replace(/\s+/g, '')
    .trim();
  if (!phoneNumberId) {
    throw new HttpError(502, 'Could not resolve phone number id from WABA.');
  }

  await owner.businessSnap.ref.set({
    botPhoneNumberId: phoneNumberId,
    botDisplayNumber: displayPhoneNumber || null,
    wabaId,
    botStatus: 'Connected',
  }, { merge: true });

  return {
    message: 'WhatsApp bot connected successfully!',
  };
}

module.exports = {
  postOwnerWhatsAppOnboarding,
};
