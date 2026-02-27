import { NextResponse } from 'next/server';
import { normalizeFlow, normalizeFunnelEvent, trackFunnelEvent } from '@/lib/opsTelemetry';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const payload = await req.json();
        const event = normalizeFunnelEvent(payload?.event);

        if (!event) {
            return NextResponse.json({ message: 'Ignored: unsupported event' }, { status: 202 });
        }

        const flow = normalizeFlow(payload?.flow || payload?.deliveryType || 'other');

        // Best-effort tracking only; do not block user flow.
        void trackFunnelEvent(event, flow);
        return NextResponse.json({ ok: true }, { status: 202 });
    } catch {
        // Ignore malformed payloads to keep endpoint lightweight.
        return NextResponse.json({ ok: true }, { status: 202 });
    }
}
