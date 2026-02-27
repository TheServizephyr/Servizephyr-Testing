import { NextResponse } from 'next/server';

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeIp(rawIp = '') {
    const ip = String(rawIp || '').trim();
    if (!ip) return '';
    // Handle "client, proxy1, proxy2"
    const first = ip.split(',')[0].trim();
    // Strip IPv6 prefix for IPv4
    return first.replace(/^::ffff:/, '');
}

function parseProviderResult(payload) {
    if (!payload || typeof payload !== 'object') return null;

    const lat = toFiniteNumber(payload.latitude ?? payload.lat);
    const lng = toFiniteNumber(payload.longitude ?? payload.lon ?? payload.lng);
    if (lat === null || lng === null) return null;

    return {
        lat,
        lng,
        city: payload.city || '',
        region: payload.region || payload.regionName || '',
        country: payload.country_name || payload.country || '',
    };
}

export async function GET(req) {
    try {
        const h = req.headers;

        // Prefer hosting headers if available (fast path).
        const headerLat = toFiniteNumber(h.get('x-vercel-ip-latitude'));
        const headerLng = toFiniteNumber(h.get('x-vercel-ip-longitude'));
        if (headerLat !== null && headerLng !== null) {
            return NextResponse.json({
                lat: headerLat,
                lng: headerLng,
                city: h.get('x-vercel-ip-city') || '',
                region: h.get('x-vercel-ip-country-region') || '',
                country: h.get('x-vercel-ip-country') || '',
                source: 'vercel_headers',
            });
        }

        const ipFromHeader = normalizeIp(
            h.get('x-forwarded-for') ||
            h.get('x-real-ip') ||
            ''
        );

        const providers = [
            ipFromHeader
                ? `https://ipapi.co/${encodeURIComponent(ipFromHeader)}/json/`
                : 'https://ipapi.co/json/',
            ipFromHeader
                ? `https://ipwho.is/${encodeURIComponent(ipFromHeader)}`
                : 'https://ipwho.is/',
        ];

        for (const url of providers) {
            try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) continue;
                const data = await res.json().catch(() => null);
                const parsed = parseProviderResult(data);
                if (parsed) {
                    return NextResponse.json({
                        ...parsed,
                        source: url.includes('ipapi.co') ? 'ipapi' : 'ipwhois',
                    });
                }
            } catch {
                // Try next provider
            }
        }

        return NextResponse.json(
            { message: 'Unable to resolve IP location.' },
            { status: 404 }
        );
    } catch (error) {
        return NextResponse.json(
            { message: error.message || 'Failed to resolve IP location.' },
            { status: 500 }
        );
    }
}
