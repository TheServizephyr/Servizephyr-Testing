const { FieldValue, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveAdminContext } = require('./adminAccess.service');

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) return forwarded.split(',')[0].trim();

  const realIp = String(req.headers['x-real-ip'] || '').trim();
  if (realIp) return realIp;

  const cloudflareIp = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cloudflareIp) return cloudflareIp;

  return 'unknown';
}

function minuteKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}-${min}`;
}

function toIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function checkIpRateLimit({ firestore, ip, limitPerMinute = 5 }) {
  const safeIp = String(ip || 'unknown').replace(/[:.]/g, '_');
  const key = minuteKey();
  const ref = firestore.collection('rate_limits').doc(`ip_${safeIp}_${key}`);

  try {
    return await firestore.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) {
        transaction.set(ref, {
          ip,
          minute: key,
          count: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { allowed: true };
      }

      const currentCount = Number(snap.data()?.count || 0);
      if (currentCount >= limitPerMinute) {
        return { allowed: false };
      }

      transaction.update(ref, {
        count: FieldValue.increment(1),
      });
      return { allowed: true };
    });
  } catch {
    return { allowed: false };
  }
}

async function getAdminMailboxReports(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });
  let snapshot;
  try {
    snapshot = await firestore.collection('adminMailbox').orderBy('timestamp', 'desc').get();
  } catch {
    snapshot = await firestore.collection('adminMailbox').get();
  }

  const reports = snapshot.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        ...data,
        timestamp: toIso(data.timestamp),
      };
    })
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

  return { reports };
}

async function postAdminMailboxReport(req) {
  const firestore = await getFirestore();
  const ip = getClientIp(req);
  const rateLimit = await checkIpRateLimit({
    firestore,
    ip,
    limitPerMinute: 5,
  });

  if (!rateLimit.allowed) {
    throw new HttpError(429, 'Too many reports. Please wait.');
  }

  const body = req.body || {};
  const {
    errorTitle,
    errorMessage,
    description,
    pathname,
    user,
    context,
    timestamp,
    localTime,
  } = body;

  if (!errorTitle || !errorMessage) {
    throw new HttpError(400, 'Missing required report data.');
  }

  const newReportRef = firestore.collection('adminMailbox').doc();
  const newReportData = {
    id: newReportRef.id,
    title: errorTitle,
    message: errorMessage,
    description: description || '',
    path: pathname || 'Unknown',
    user: {
      uid: user?.uid || 'Guest',
      email: user?.email || 'N/A',
      name: user?.displayName || user?.name || 'Guest User',
      phone: user?.phoneNumber || 'N/A',
      type: user?.type || 'Unknown',
    },
    context: context || {},
    timestamp: FieldValue.serverTimestamp(),
    exactTimestamp: timestamp || null,
    localTime: localTime || null,
    status: 'new',
  };

  await newReportRef.set(newReportData);
  return {
    status: 201,
    payload: {
      message: 'Error report sent successfully!',
      id: newReportRef.id,
    },
  };
}

async function patchAdminMailboxReport(req) {
  const { firestore } = await resolveAdminContext(req, { checkRevoked: false });
  const body = req.body || {};
  const reportId = String(body.reportId || '').trim();
  const status = String(body.status || '').trim();

  if (!reportId || !status) {
    throw new HttpError(400, 'Report ID and status are required.');
  }

  await firestore.collection('adminMailbox').doc(reportId).set(
    {
      status,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    message: 'Report status updated successfully.',
  };
}

module.exports = {
  getAdminMailboxReports,
  postAdminMailboxReport,
  patchAdminMailboxReport,
};
