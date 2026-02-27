import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const DAYS_TO_KEEP = 7;

async function deleteByRefs(firestore, refs) {
    if (!refs.length) return 0;
    const chunkSize = 450;
    let deleted = 0;

    for (let i = 0; i < refs.length; i += chunkSize) {
        const chunk = refs.slice(i, i + chunkSize);
        const batch = firestore.batch();
        for (const ref of chunk) {
            batch.delete(ref);
        }
        await batch.commit();
        deleted += chunk.length;
    }

    return deleted;
}

function toMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export async function GET(req) {
    try {
        const secret = process.env.CRON_SECRET;
        const auth = req.headers.get('authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

        if (!secret || token !== secret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const firestore = await getFirestore();
        const cutoffMs = Date.now() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000;
        const cutoffDate = new Date(cutoffMs);

        // 1) rate_limits cleanup by createdAt
        const rateSnap = await firestore
            .collection('rate_limits')
            .where('createdAt', '<', cutoffDate)
            .get();
        const rateDeleted = await deleteByRefs(firestore, rateSnap.docs.map((d) => d.ref));

        // 2) idempotency_keys cleanup by completedAt/failedAt/createdAt
        const idemSnap = await firestore.collection('idempotency_keys').get();
        const idemRefsToDelete = [];
        for (const doc of idemSnap.docs) {
            const data = doc.data() || {};
            const ts =
                toMillis(data.completedAt) ??
                toMillis(data.failedAt) ??
                toMillis(data.createdAt);

            if (ts && ts < cutoffMs) {
                idemRefsToDelete.push(doc.ref);
            }
        }
        const idempotencyDeleted = await deleteByRefs(firestore, idemRefsToDelete);

        // 3) auth_tokens cleanup by expiresAt (fallback createdAt)
        const authTokenSnap = await firestore.collection('auth_tokens').get();
        const authTokenRefsToDelete = [];
        for (const doc of authTokenSnap.docs) {
            const data = doc.data() || {};
            const ts = toMillis(data.expiresAt) ?? toMillis(data.createdAt);
            if (ts && ts < cutoffMs) {
                authTokenRefsToDelete.push(doc.ref);
            }
        }
        const authTokensDeleted = await deleteByRefs(firestore, authTokenRefsToDelete);

        // 4) audit_logs cleanup by createdAt (fallback timestamp)
        const auditSnap = await firestore.collection('audit_logs').get();
        const auditRefsToDelete = [];
        for (const doc of auditSnap.docs) {
            const data = doc.data() || {};
            const ts = toMillis(data.createdAt) ?? toMillis(data.timestamp);
            if (ts && ts < cutoffMs) {
                auditRefsToDelete.push(doc.ref);
            }
        }
        const auditLogsDeleted = await deleteByRefs(firestore, auditRefsToDelete);

        return NextResponse.json({
            success: true,
            retentionDays: DAYS_TO_KEEP,
            rateLimits: {
                scannedByQuery: rateSnap.size,
                deleted: rateDeleted,
            },
            idempotencyKeys: {
                scanned: idemSnap.size,
                deleted: idempotencyDeleted,
            },
            authTokens: {
                scanned: authTokenSnap.size,
                deleted: authTokensDeleted,
            },
            auditLogs: {
                scanned: auditSnap.size,
                deleted: auditLogsDeleted,
            },
        });
    } catch (error) {
        console.error('[Cron cleanup-retention] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Cleanup failed',
            },
            { status: 500 }
        );
    }
}
