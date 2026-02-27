import { createUpiQrCardImageResponse } from '@/lib/upi-qr-card-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return amount.toFixed(2);
}

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const upiId = String(searchParams.get('upi') || '').trim();
        const payeeName = String(searchParams.get('pn') || 'ServiZephyr').trim();
        const amountFixed = normalizeAmount(searchParams.get('am'));
        const restaurantName = String(searchParams.get('rn') || payeeName || 'Restaurant').trim();
        const orderDisplayId = String(searchParams.get('oid') || '').trim();
        const note = String(searchParams.get('tn') || `Order ${orderDisplayId || 'Payment'}`).trim();
        const transactionRef = String(searchParams.get('tr') || '').trim();

        if (!upiId.includes('@')) return new Response('Invalid UPI ID', { status: 400 });
        if (!amountFixed) return new Response('Invalid amount', { status: 400 });

        return await createUpiQrCardImageResponse({
            upiId,
            payeeName,
            restaurantName,
            amountFixed,
            orderDisplayId,
            note,
            transactionRef
        });
    } catch (error) {
        console.error('[UPI QR Card] Failed to generate QR card:', error);
        return new Response('Failed to generate QR', { status: 500 });
    }
}
