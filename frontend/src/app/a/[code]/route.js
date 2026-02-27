import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const CODE_REGEX = /^[A-Za-z0-9_-]{6,32}$/;

function coerceDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') {
        return value.toDate();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTargetPath(targetPath) {
    if (typeof targetPath !== 'string') return null;
    if (!targetPath.startsWith('/')) return null;
    if (!targetPath.startsWith('/add-address')) return null;
    return targetPath;
}

export async function GET(request, { params }) {
    try {
        const code = String(params?.code || '').trim();
        if (!CODE_REGEX.test(code)) {
            return new NextResponse('Invalid link.', { status: 400 });
        }

        const firestore = await getFirestore();
        const linkRef = firestore.collection('short_links').doc(code);
        const linkSnap = await linkRef.get();

        if (!linkSnap.exists) {
            return new NextResponse('This link is invalid or expired.', { status: 404 });
        }

        const linkData = linkSnap.data() || {};
        const expiresAt = coerceDate(linkData.expiresAt);
        if (expiresAt && expiresAt.getTime() < Date.now()) {
            await linkRef.set({
                status: 'expired',
                expiredAt: new Date(),
                lastAccessedAt: new Date(),
                accessCount: FieldValue.increment(1),
            }, { merge: true });
            return new NextResponse('This link has expired. Please request a new link.', { status: 410 });
        }

        const targetPath = normalizeTargetPath(linkData.targetPath);
        if (!targetPath) {
            return new NextResponse('Invalid link target.', { status: 400 });
        }

        await linkRef.set({
            status: 'used',
            lastAccessedAt: new Date(),
            accessCount: FieldValue.increment(1),
        }, { merge: true });

        const requestUrl = new URL(request.url);
        const redirectUrl = new URL(targetPath, requestUrl.origin);
        return NextResponse.redirect(redirectUrl, 302);
    } catch (error) {
        console.error('[Short Link Redirect] Error:', error);
        return new NextResponse('Unable to open link right now. Please try again.', { status: 500 });
    }
}

