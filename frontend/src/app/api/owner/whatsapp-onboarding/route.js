

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import axios from 'axios';

// Helper to verify owner and get their first business Ref
async function verifyOwnerAndGetBusinessRef(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use the central helper
    
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0].ref;
    }
    
    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', uid).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].ref;
    }

    throw { message: 'No business associated with this owner. Please complete your profile first.', status: 404 };
}

export async function POST(req) {
    const auth = await getAuth();
    const firestore = await getFirestore();

    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req, auth, firestore);

        const { code } = await req.json();
        if (!code) {
            return NextResponse.json({ message: 'Authorization code is missing.' }, { status: 400 });
        }

        const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;
        console.log("DEBUG: App ID being used is:", process.env.NEXT_PUBLIC_FACEBOOK_APP_ID);

        if (!appId || !appSecret) {
            console.error("[WhatsApp Onboarding] CRITICAL: NEXT_PUBLIC_FACEBOOK_APP_ID or FACEBOOK_APP_SECRET is not set in environment variables.");
            return NextResponse.json({ message: 'Server configuration error. Please contact support.' }, { status: 500 });
        }

        const tokenResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
            params: {
                client_id: appId,
                client_secret: appSecret,
                code: code,
            }
        });

        const userAccessToken = tokenResponse.data.access_token;
        if (!userAccessToken) {
            throw new Error("Could not retrieve User Access Token from Facebook.");
        }

        const debugResponse = await axios.get('https://graph.facebook.com/debug_token', {
            params: {
                input_token: userAccessToken,
                access_token: `${appId}|${appSecret}`
            }
        });
        
        const embeddedSignupData = debugResponse.data.data?.granular_scopes?.find(s => s.scope === 'whatsapp_business_management')?.target_ids;
        if (!embeddedSignupData || embeddedSignupData.length === 0) {
            console.error("Debug Token Response:", JSON.stringify(debugResponse.data, null, 2));
            throw new Error("Could not retrieve WhatsApp Business Account details from the session. The `target_ids` field is missing or empty.");
        }
        
        const waba_id = embeddedSignupData[0];

        const phoneNumbersResponse = await axios.get(`https://graph.facebook.com/v19.0/${waba_id}/phone_numbers`, {
             params: { access_token: userAccessToken }
        });

        if (!phoneNumbersResponse.data.data || phoneNumbersResponse.data.data.length === 0) {
            throw new Error(`No phone numbers found for WABA ID: ${waba_id}`);
        }

        const phoneNumberInfo = phoneNumbersResponse.data.data[0];
        const phone_number_id = phoneNumberInfo.id;
        const display_phone_number = phoneNumberInfo.display_phone_number.replace(/\s+/g, ''); // Clean up spaces

        const updateData = {
            botPhoneNumberId: phone_number_id,
            botDisplayNumber: display_phone_number,
            wabaId: waba_id,
            botStatus: 'Connected',
        };

        await businessRef.set(updateData, { merge: true });

        return NextResponse.json({ message: 'WhatsApp bot connected successfully!' }, { status: 200 });

    } catch (error) {
        console.error("WHATSAPP ONBOARDING ERROR:", error.response ? error.response.data : error.message);
        
        let errorMessage = 'An internal server error occurred.';
        let statusCode = 500;

        if (error.status) {
            errorMessage = error.message;
            statusCode = error.status;
        } else if (error.response && error.response.data && error.response.data.error) {
            errorMessage = error.response.data.error.message || 'Failed to communicate with Facebook API.';
        } else {
            errorMessage = error.message;
        }

        return NextResponse.json({ message: errorMessage }, { status: statusCode });
    }
}
