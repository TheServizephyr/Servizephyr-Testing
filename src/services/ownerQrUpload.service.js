const { randomUUID } = require('crypto');
const { getStorage } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

function resolveBucketName() {
  const explicit = String(
    process.env.FIREBASE_STORAGE_BUCKET
    || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    || ''
  ).trim();
  if (explicit) return explicit.replace(/^gs:\/\//i, '');

  const projectId = String(
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    || process.env.FIREBASE_PROJECT_ID
    || ''
  ).trim();
  if (!projectId) {
    throw new HttpError(500, 'Storage bucket cannot be resolved. Missing Firebase project id.');
  }
  return `${projectId}.firebasestorage.app`;
}

function getFileExtension(file = {}) {
  const originalName = String(file.originalname || '').trim();
  if (originalName.includes('.')) {
    return originalName.split('.').pop();
  }
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('svg')) return 'svg';
  return 'bin';
}

async function postOwnerSettingsUploadQrUrl(req) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.ASSIGN_RIDER, PERMISSIONS.VIEW_PAYMENTS],
  });

  const file = req.file;
  const riderId = String(req.body?.riderId || '').trim();
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new HttpError(400, 'No file uploaded.');
  }

  const bucketName = resolveBucketName();
  const storage = await getStorage();
  const bucket = storage.bucket(bucketName);
  const extension = getFileExtension(file);
  const uniqueFileName = `${randomUUID().replace(/-/g, '')}.${extension}`;
  const folderPath = riderId
    ? `payment_qr/${owner.businessId}/${riderId}`
    : `payment_qr/${owner.businessId}`;
  const filePath = `${folderPath}/${uniqueFileName}`;

  const bucketFile = bucket.file(filePath);
  await bucketFile.save(file.buffer, {
    metadata: {
      contentType: file.mimetype || 'application/octet-stream',
    },
    public: true,
  });

  return {
    success: true,
    publicUrl: `https://storage.googleapis.com/${bucket.name}/${filePath}`,
  };
}

module.exports = {
  postOwnerSettingsUploadQrUrl,
};
