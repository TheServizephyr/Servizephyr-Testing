import { getStorage } from 'firebase-admin/storage';
import { nanoid } from 'nanoid';
import crypto from 'crypto';

function getStorageBucket() {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'studio-6552995429-8bffe';
    const explicitBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
    const bucketName = explicitBucket || `${projectId}.firebasestorage.app`;
    return getStorage().bucket(bucketName);
}

function extensionFromMime(contentType = 'image/jpeg') {
    const normalized = contentType.toLowerCase();
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('heic')) return 'heic';
    if (normalized.includes('heif')) return 'heif';
    return 'jpg';
}

export function isDataUrlImage(value) {
    return typeof value === 'string' && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

export async function uploadMenuImageFromDataUrl(dataUrl, businessId, itemIdHint = '') {
    if (!isDataUrlImage(dataUrl)) return dataUrl;

    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid image data URL format');

    const [, contentType, base64Data] = match;
    const buffer = Buffer.from(base64Data, 'base64');
    const ext = extensionFromMime(contentType);
    const token = crypto.randomUUID();
    const safeItemId = (itemIdHint || '').toString().replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `${Date.now()}_${safeItemId || nanoid(10)}.${ext}`;
    const filePath = `business_media/menu_items/${businessId}/${fileName}`;

    const bucket = getStorageBucket();
    const file = bucket.file(filePath);

    await file.save(buffer, {
        resumable: false,
        metadata: {
            contentType,
            cacheControl: 'public,max-age=31536000,immutable',
            metadata: {
                firebaseStorageDownloadTokens: token,
                ownerBusinessId: businessId
            }
        }
    });

    const encodedPath = encodeURIComponent(filePath);
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
    return publicUrl;
}

export async function normalizeMenuItemImageUrl(imageUrl, businessId, itemIdHint = '') {
    if (!imageUrl || typeof imageUrl !== 'string') return imageUrl || '';
    if (!isDataUrlImage(imageUrl)) return imageUrl;
    return uploadMenuImageFromDataUrl(imageUrl, businessId, itemIdHint);
}
