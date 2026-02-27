/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import qrcode from 'qr.js';
import { promises as fs } from 'fs';
import path from 'path';

let cachedLogoDataUri = null;

function sanitizeUpiId(value) {
    return String(value || '').trim();
}

function safeText(value, fallback = '', maxLen = 80) {
    const normalized = String(value || fallback || '').replace(/\s+/g, ' ').trim();
    return normalized.slice(0, maxLen);
}

function sanitizePayeeName(value) {
    const cleaned = safeText(value, 'ServiZephyr', 48)
        .replace(/[^a-zA-Z0-9 .,&()/-]/g, '')
        .trim();
    return cleaned || 'ServiZephyr';
}

function buildUpiQuery(params = {}) {
    return Object.entries(params)
        .filter(([, value]) => String(value || '').trim())
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value).trim())}`)
        .join('&');
}

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return amount.toFixed(2);
}

function buildQrSvgDataUri(value) {
    const qrData = qrcode(value, qrcode.ErrorCorrectLevel.H);
    const modules = qrData?.modules || [];
    const moduleCount = Number(qrData?.moduleCount || 0);
    if (!Array.isArray(modules) || moduleCount <= 0) {
        throw new Error('QR generation failed.');
    }

    const quietZone = 4;
    const svgSize = moduleCount + (quietZone * 2);
    const darkCellsPath = [];

    for (let row = 0; row < moduleCount; row += 1) {
        for (let col = 0; col < moduleCount; col += 1) {
            if (!modules[row]?.[col]) continue;
            const x = col + quietZone;
            const y = row + quietZone;
            darkCellsPath.push(`M${x} ${y}h1v1H${x}z`);
        }
    }

    if (!darkCellsPath.length) {
        throw new Error('QR matrix is empty.');
    }

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" shape-rendering="crispEdges">`,
        `<rect width="${svgSize}" height="${svgSize}" fill="#ffffff" />`,
        `<path d="${darkCellsPath.join('')}" fill="#111111" />`,
        '</svg>'
    ].join('');

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function getLogoDataUri() {
    if (cachedLogoDataUri) return cachedLogoDataUri;
    try {
        const logoPath = path.join(process.cwd(), 'public', 'logo.png');
        const fileBuffer = await fs.readFile(logoPath);
        cachedLogoDataUri = `data:image/png;base64,${fileBuffer.toString('base64')}`;
        return cachedLogoDataUri;
    } catch (error) {
        console.warn('[UPI QR Card] Could not load logo.png:', error?.message || error);
        return null;
    }
}

export function buildUpiLinkForQrCard({
    upiId,
    payeeName,
    amountFixed,
    note,
    transactionRef
}) {
    const cleanedUpiId = sanitizeUpiId(upiId);
    if (!cleanedUpiId || !cleanedUpiId.includes('@')) return null;
    const normalizedAmount = normalizeAmount(amountFixed);
    if (!normalizedAmount) return null;

    const cleanTr = safeText(transactionRef, '', 35).replace(/[^a-zA-Z0-9]/g, '');
    const upiQuery = buildUpiQuery({
        pa: cleanedUpiId,
        pn: sanitizePayeeName(payeeName),
        am: normalizedAmount,
        cu: 'INR',
        tn: safeText(note, 'Order Payment', 40),
        tr: cleanTr
    });

    return `upi://pay?${upiQuery}`;
}

export async function createUpiQrCardImageResponse({
    upiId,
    payeeName,
    restaurantName,
    amountFixed,
    orderDisplayId = '',
    note = '',
    transactionRef = ''
}) {
    const upiLink = buildUpiLinkForQrCard({
        upiId,
        payeeName,
        amountFixed,
        note,
        transactionRef
    });
    if (!upiLink) {
        throw new Error('Invalid UPI QR card payload.');
    }

    const logoDataUri = await getLogoDataUri();
    const safeRestaurantName = safeText(restaurantName || payeeName || 'Restaurant', 'Restaurant', 64);
    const safeOrderId = safeText(orderDisplayId, '', 20);
    const safeAmount = normalizeAmount(amountFixed);
    const safeUpiId = sanitizeUpiId(upiId);
    const qrSvgDataUri = buildQrSvgDataUri(upiLink);
    const qrSize = 480;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(180deg, #4f46e5 0%, #6366f1 45%, #818cf8 100%)',
                    padding: 20,
                    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
                }}
            >
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        borderRadius: 32,
                        background: '#ffffff',
                        padding: '36px 32px',
                        boxShadow: '0 25px 50px rgba(0, 0, 0, 0.25)',
                    }}
                >
                    {/* Header */}
                    <div
                        style={{
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                            borderRadius: 20,
                            padding: '24px 20px',
                            marginBottom: 28
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                fontSize: 38,
                                fontWeight: 900,
                                color: '#ffffff',
                                letterSpacing: '1.2px',
                                textAlign: 'center',
                                lineHeight: 1.1
                            }}
                        >
                            SCAN TO PAY
                        </div>
                        <div
                            style={{
                                marginTop: 8,
                                display: 'flex',
                                fontSize: 16,
                                color: 'rgba(255, 255, 255, 0.95)',
                                textAlign: 'center'
                            }}
                        >
                            Open any UPI app to pay
                        </div>
                    </div>

                    {/* QR Code - Large & Centered */}
                    <div
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: 32
                        }}
                    >
                        <div
                            style={{
                                position: 'relative',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 24,
                                padding: 20,
                                border: '4px solid #e5e7eb',
                                background: '#f8fafc'
                            }}
                        >
                            <div
                                style={{
                                    width: qrSize,
                                    height: qrSize,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 16,
                                    background: '#ffffff',
                                    overflow: 'hidden'
                                }}
                            >
                                <img
                                    src={qrSvgDataUri}
                                    alt="UPI QR"
                                    width={qrSize}
                                    height={qrSize}
                                    style={{ objectFit: 'contain' }}
                                />
                            </div>

                            <div
                                style={{
                                    position: 'absolute',
                                    width: 110,
                                    height: 110,
                                    borderRadius: 22,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#000000',
                                    border: '6px solid #ffffff',
                                    overflow: 'hidden'
                                }}
                            >
                                {logoDataUri ? (
                                    <img
                                        src={logoDataUri}
                                        alt="ServiZephyr"
                                        width={80}
                                        height={80}
                                        style={{ objectFit: 'contain' }}
                                    />
                                ) : (
                                    <div
                                        style={{
                                            display: 'flex',
                                            color: '#facc15',
                                            fontSize: 38,
                                            fontWeight: 800
                                        }}
                                    >
                                        SZ
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Amount - Large */}
                    <div
                        style={{
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            marginBottom: 24
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                fontSize: 20,
                                color: '#6b7280',
                                textTransform: 'uppercase',
                                letterSpacing: '1.2px',
                                marginBottom: 8
                            }}
                        >
                            Amount to Pay
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 92,
                                fontWeight: 900,
                                color: '#047857',
                                textAlign: 'center',
                                lineHeight: 1
                            }}
                        >
                            Rs {safeAmount}
                        </div>
                    </div>

                    {/* Restaurant Name */}
                    <div
                        style={{
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            paddingTop: 20,
                            borderTop: '2px dashed #e5e7eb',
                            marginBottom: 18
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                fontSize: 16,
                                color: '#9ca3af',
                                textTransform: 'uppercase',
                                letterSpacing: '0.8px',
                                marginBottom: 6
                            }}
                        >
                            Restaurant
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                fontSize: 32,
                                lineHeight: 1.1,
                                fontWeight: 800,
                                color: '#111827',
                                textAlign: 'center'
                            }}
                        >
                            {safeRestaurantName}
                        </div>
                    </div>

                    {/* UPI ID */}
                    <div
                        style={{
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            marginBottom: safeOrderId ? 16 : 0
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                fontSize: 14,
                                color: '#9ca3af',
                                textTransform: 'uppercase',
                                letterSpacing: '0.6px',
                                marginBottom: 4
                            }}
                        >
                            UPI ID
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                fontSize: 20,
                                color: '#1f2937',
                                lineHeight: 1.2,
                                fontWeight: 600
                            }}
                        >
                            {safeText(safeUpiId, 'Not Set', 48)}
                        </div>
                    </div>

                    {/* Order ID */}
                    {safeOrderId ? (
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 18,
                                color: '#374151',
                                background: '#f3f4f6',
                                padding: '10px 20px',
                                borderRadius: 999,
                                fontWeight: 600
                            }}
                        >
                            Order: {safeOrderId}
                        </div>
                    ) : null}

                    {/* Footer */}
                    <div
                        style={{
                            marginTop: 'auto',
                            paddingTop: 20,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 16,
                            color: '#9ca3af',
                            fontWeight: 500
                        }}
                    >
                        Powered by ServiZephyr
                    </div>
                </div>
            </div>
        ),
        {
            width: 700,
            height: 1200
        }
    );
}

export async function generateUpiQrCardPngBuffer(params) {
    const response = await createUpiQrCardImageResponse(params);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
