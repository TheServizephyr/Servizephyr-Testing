import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

function getDayKeySuffix(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const uid = await verifyAndGetUid(req);
        const firestore = await getFirestore();
        const userDoc = await firestore.collection('users').doc(uid).get();
        const role = String(userDoc.data()?.role || '').toLowerCase();

        if (role !== 'admin') {
            return NextResponse.json({ message: 'Access denied' }, { status: 403 });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            return NextResponse.json({ message: 'KV not configured' }, { status: 503 });
        }

        const { searchParams } = new URL(req.url);
        const day = searchParams.get('day') || getDayKeySuffix();
        const readsKey = `telemetry:reads:${day}`;
        const requestsKey = `telemetry:requests:${day}`;

        const [readsMap, requestsMap] = await Promise.all([
            kv.hgetall(readsKey),
            kv.hgetall(requestsKey),
        ]);

        const endpoints = new Set([
            ...Object.keys(readsMap || {}),
            ...Object.keys(requestsMap || {}),
        ]);

        const summary = Array.from(endpoints).map((endpoint) => {
            const reads = Number(readsMap?.[endpoint] || 0);
            const requests = Number(requestsMap?.[endpoint] || 0);
            const avgReadsPerRequest = requests > 0 ? Number((reads / requests).toFixed(2)) : 0;
            return {
                endpoint,
                reads,
                requests,
                avgReadsPerRequest,
            };
        }).sort((a, b) => b.reads - a.reads);

        return NextResponse.json({ day, summary }, { status: 200 });
    } catch (error) {
        return NextResponse.json({ message: error.message || 'Failed to load telemetry' }, { status: error.status || 500 });
    }
}

