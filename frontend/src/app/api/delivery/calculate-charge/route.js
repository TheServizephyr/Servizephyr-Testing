/**
 * DELIVERY CHARGE CALCULATION API
 * Calculate delivery charge and validate delivery distance
 */

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { calculateHaversineDistance, calculateDeliveryCharge } from '@/lib/distance';
import { findBusinessById } from '@/services/business/businessService';

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function getBusinessLabel(businessType = 'restaurant') {
    if (businessType === 'store' || businessType === 'shop') return 'store';
    if (businessType === 'street-vendor') return 'stall';
    return 'restaurant';
}

export async function POST(req) {
    try {
        const body = await req.json();
        const { restaurantId, addressLat, addressLng, subtotal } = body;
        const subtotalNum = Number(subtotal) || 0;
        const addressLatNum = toFiniteNumber(addressLat);
        const addressLngNum = toFiniteNumber(addressLng);

        if (!restaurantId || addressLatNum === null || addressLngNum === null || subtotal === undefined) {
            return NextResponse.json(
                { error: 'Missing required fields: restaurantId, addressLat, addressLng, subtotal' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();
        const business = await findBusinessById(firestore, restaurantId);

        if (!business) {
            return NextResponse.json(
                { error: 'Business not found' },
                { status: 404 }
            );
        }
        const restaurantRef = business.ref;
        const restaurantData = business.data;
        const businessLabel = getBusinessLabel(business.type);

        // ✅ FIXED: Support all possible coordinate field structures
        // Priority: coordinates.lat/lng → address.latitude/longitude → businessAddress.latitude/longitude
        const restaurantLat = toFiniteNumber(
            restaurantData.coordinates?.lat ??
            restaurantData.address?.latitude ??
            restaurantData.businessAddress?.latitude
        );
        const restaurantLng = toFiniteNumber(
            restaurantData.coordinates?.lng ??
            restaurantData.address?.longitude ??
            restaurantData.businessAddress?.longitude
        );

        console.log('[API /delivery/calculate-charge] 📍 Restaurant:', { lat: restaurantLat, lng: restaurantLng });
        console.log('[API /delivery/calculate-charge] 📍 Customer:', { lat: addressLatNum, lng: addressLngNum });

        if (restaurantLat === null || restaurantLng === null) {
            console.error('[API /delivery/calculate-charge] ❌ Restaurant coordinates not found');
            return NextResponse.json(
                { error: `${businessLabel.charAt(0).toUpperCase() + businessLabel.slice(1)} coordinates not configured` },
                { status: 400 }
            );
        }

        // Calculate aerial distance
        const aerialDistance = calculateHaversineDistance(
            restaurantLat,
            restaurantLng,
            addressLatNum,
            addressLngNum
        );

        // ✅ CRITICAL: Read delivery settings from subcollection (where owner dashboard saves them)
        const deliveryConfigSnap = await restaurantRef.collection('delivery_settings').doc('config').get();
        const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};

        console.log('[API /delivery/calculate-charge] 📋 Delivery Config from subcollection:', deliveryConfig);

        // Fallback helper: subcollection → restaurant doc → default
        const getSetting = (key, defaultVal) => deliveryConfig[key] ?? restaurantData[key] ?? defaultVal;

        // Get delivery settings - use migrated field names with subcollection priority
        const settings = {
            deliveryEnabled: getSetting('deliveryEnabled', true),
            deliveryRadius: getSetting('deliveryRadius', 10),
            deliveryChargeType: getSetting('deliveryFeeType', getSetting('deliveryChargeType', 'fixed')),
            fixedCharge: getSetting('deliveryFixedFee', getSetting('fixedCharge', 0)),
            perKmCharge: getSetting('deliveryPerKmFee', getSetting('perKmCharge', 0)),
            baseDistance: getSetting('deliveryBaseDistance', getSetting('baseDistance', 0)), // NEW: Included KM
            freeDeliveryThreshold: getSetting('deliveryFreeThreshold', getSetting('freeDeliveryThreshold', 0)),
            freeDeliveryRadius: getSetting('freeDeliveryRadius', 0),
            freeDeliveryMinOrder: getSetting('freeDeliveryMinOrder', 0),
            roadDistanceFactor: getSetting('roadDistanceFactor', 1.0),
            deliveryTiers: getSetting('deliveryTiers', []),
            orderSlabRules: getSetting('deliveryOrderSlabRules', getSetting('orderSlabRules', [])),
            orderSlabAboveFee: getSetting('deliveryOrderSlabAboveFee', getSetting('orderSlabAboveFee', 0)),
            orderSlabBaseDistance: getSetting('deliveryOrderSlabBaseDistance', getSetting('orderSlabBaseDistance', 1)),
            orderSlabPerKmFee: getSetting('deliveryOrderSlabPerKmFee', getSetting('orderSlabPerKmFee', 15)),
        };

        console.log('[API /delivery/calculate-charge] ⚙️ Settings:', JSON.stringify(settings));

        if (settings.deliveryEnabled === false) {
            return NextResponse.json({
                success: true,
                allowed: false,
                charge: 0,
                aerialDistance: 0,
                roadDistance: 0,
                roadFactor: settings.roadDistanceFactor,
                message: `Delivery is currently disabled for this ${businessLabel}.`
            });
        }

        const result = calculateDeliveryCharge(aerialDistance, subtotalNum, settings);
        console.log('[API /delivery/calculate-charge] 📊 Result:', JSON.stringify(result));

        return NextResponse.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('[Delivery Charge Calculation Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to calculate delivery charge' },
            { status: 500 }
        );
    }
}
