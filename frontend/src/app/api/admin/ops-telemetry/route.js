import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { getOpsTelemetrySnapshot, getTelemetryDay } from '@/lib/opsTelemetry';

export const dynamic = 'force-dynamic';

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizeDayParam(input) {
    const raw = String(input || '').trim();
    if (!raw) return getTelemetryDay();

    // yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    // dd-mm-yyyy -> yyyy-mm-dd
    const ddmmyyyy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
        const [, dd, mm, yyyy] = ddmmyyyy;
        return `${yyyy}-${mm}-${dd}`;
    }

    // Date parse fallback
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
    }

    return getTelemetryDay();
}

export async function GET(req) {
    try {
        const uid = await verifyAndGetUid(req);
        const firestore = await getFirestore();
        const userDoc = await firestore.collection('users').doc(uid).get();
        const role = String(userDoc.data()?.role || '').toLowerCase();

        if (role !== 'admin') {
            return NextResponse.json({ message: 'Access denied' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const rawRequestedDay = searchParams.get('day');
        const day = normalizeDayParam(rawRequestedDay);
        const errorLimit = clamp(searchParams.get('errors') || 30, 1, 100);
        const snapshot = await getOpsTelemetrySnapshot({
            day,
            errorLimit,
            fallbackToPreviousDay: false,
        });

        return NextResponse.json(
            { ...snapshot, requestedDay: day, rawRequestedDay },
            { status: 200 }
        );
    } catch (error) {
        return NextResponse.json(
            { message: error.message || 'Failed to load ops telemetry' },
            { status: error.status || 500 }
        );
    }
}
