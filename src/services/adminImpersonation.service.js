const { HttpError } = require('../utils/httpError');
const { resolveAdminContext } = require('./adminAccess.service');


function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) return forwarded.split(',')[0].trim();

  const realIp = String(req.headers['x-real-ip'] || '').trim();
  if (realIp) return realIp;

  const cloudflareIp = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cloudflareIp) return cloudflareIp;

  return null;
}

function getUserAgent(req) {
  return String(req.headers['user-agent'] || '').trim() || null;
}

async function logAdminImpersonation(req) {
  const { uid, firestore, userData } = await resolveAdminContext(req, {
    checkRevoked: false,
  });

  const body = req.body || {};
  const targetUserId = String(body.targetUserId || '').trim();
  const targetUserEmail = String(body.targetUserEmail || '').trim() || null;
  const targetUserRole = String(body.targetUserRole || '').trim() || null;
  const action = String(body.action || '').trim();

  if (!targetUserId || !action) {
    throw new HttpError(400, 'Missing required fields');
  }

  await firestore.collection('audit_logs').add({
    adminId: uid,
    adminEmail: userData.email || null,
    targetOwnerId: targetUserId,
    targetOwnerEmail: targetUserEmail,
    action,
    metadata: {
      userRole: targetUserRole,
    },
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
    timestamp: new Date(),
    timestampISO: new Date().toISOString(),
  });

  return {
    success: true,
  };
}

module.exports = {
  logAdminImpersonation,
};
