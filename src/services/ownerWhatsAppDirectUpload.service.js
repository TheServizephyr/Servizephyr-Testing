const { randomUUID } = require('crypto');
const { getStorage } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

const ALLOWED_MIME_TYPES = {
  images: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'],
  videos: ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm'],
  documents: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4'],
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function isFileTypeAllowed(mimeType) {
  return Object.values(ALLOWED_MIME_TYPES).flat().includes(mimeType);
}

function getMediaType(mimeType) {
  if (ALLOWED_MIME_TYPES.images.includes(mimeType)) return 'image';
  if (ALLOWED_MIME_TYPES.videos.includes(mimeType)) return 'video';
  if (ALLOWED_MIME_TYPES.documents.includes(mimeType)) return 'document';
  if (ALLOWED_MIME_TYPES.audio.includes(mimeType)) return 'audio';
  return 'unknown';
}

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

function getFileExtension(fileName, mimeType) {
  const safeName = String(fileName || '').trim();
  const nameExt = safeName.includes('.') ? safeName.split('.').pop() : '';
  if (nameExt) return nameExt;

  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('video/mp4')) return 'mp4';
  if (mimeType.includes('audio/mpeg')) return 'mp3';
  if (mimeType.includes('audio/ogg')) return 'ogg';
  return 'bin';
}

async function postOwnerWhatsAppDirectUploadUrl(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.VIEW_CUSTOMERS],
  });

  const fileName = String(body.fileName || '').trim();
  const fileType = String(body.fileType || '').trim();
  const fileSize = Number(body.fileSize || 0);

  if (!fileName || !fileType) {
    throw new HttpError(400, 'Missing required parameters (fileName, fileType).');
  }

  const baseMimeType = fileType.split(';')[0].trim().toLowerCase();
  if (!isFileTypeAllowed(baseMimeType)) {
    throw new HttpError(400, 'File type not allowed. Supported: images, videos, documents and audio files.');
  }
  if (fileSize > 0 && fileSize > MAX_FILE_SIZE) {
    throw new HttpError(400, 'File size exceeds limit. Maximum allowed: 25MB');
  }

  const bucketName = resolveBucketName();
  const storage = await getStorage();
  const bucket = storage.bucket(bucketName);

  const extension = getFileExtension(fileName, baseMimeType);
  const uniqueFileName = `${randomUUID().replace(/-/g, '')}.${extension}`;
  const mediaType = getMediaType(baseMimeType);
  const filePath = `business_media/MESSAGE_MEDIA/${owner.businessId}/${Date.now()}_${uniqueFileName}`;
  const file = bucket.file(filePath);

  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + (15 * 60 * 1000),
    contentType: baseMimeType,
  });

  const [readUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + (7 * 24 * 60 * 60 * 1000),
  });

  return {
    success: true,
    presignedUrl: uploadUrl,
    publicUrl: readUrl,
    mediaType,
    fileName: uniqueFileName,
    storagePath: filePath,
    finalMimeType: baseMimeType,
  };
}

module.exports = {
  postOwnerWhatsAppDirectUploadUrl,
};
