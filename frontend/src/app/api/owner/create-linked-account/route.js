
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import https from 'https';

// Helper to make Razorpay API requests
async function makeRazorpayRequest(options, payload = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedData);
                    } else {
                        reject(parsedData);
                    }
                } catch (e) {
                    reject({ error: { description: `Failed to parse Razorpay response. Raw data: ${data}` } });
                }
            });
        });

        req.on('error', (e) => {
            reject({ error: { description: e.message } });
        });

        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}


// Helper to verify owner and get their business details
async function verifyOwnerAndGetBusiness(req, auth) {
    const uid = await verifyAndGetUid(req); 
    
    const firestore = await getFirestore();
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists) {
        throw { message: 'Owner user profile not found.', status: 404 };
    }
    const userData = userDoc.data();

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const querySnapshot = await firestore.collection(collectionName).where('ownerId', '==', uid).limit(1).get();
        if (!querySnapshot.empty) {
            const businessDoc = querySnapshot.docs[0];
            return {
                businessRef: businessDoc.ref,
                businessData: businessDoc.data(),
                userData: userData
            };
        }
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}

export async function POST(req) {
    const auth = await getAuth();
    
    try {
        const { businessRef, businessData, userData } = await verifyOwnerAndGetBusiness(req, auth);
        const { beneficiaryName, accountNumber, ifsc } = await req.json();
        
        if (!userData.email || !businessData.name || !userData.name || !userData.phone || !businessData.address || !businessData.address.street) {
             return NextResponse.json({ message: 'User email, name, phone, restaurant name, and a structured address are required.' }, { status: 400 });
        }
        if (!beneficiaryName || !accountNumber || !ifsc) {
            return NextResponse.json({ message: 'Bank Account Holder Name, Account Number, and IFSC code are required.' }, { status: 400 });
        }

        const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
        const key_secret = process.env.RAZORPAY_KEY_SECRET;

        if (!key_id || !key_secret) {
            console.error("CRITICAL: Razorpay credentials are not configured on the server.");
            return NextResponse.json({ message: 'Payment gateway is not fully configured on the server.' }, { status: 500 });
        }
        
        const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
        const baseOptions = {
            hostname: 'api.razorpay.com',
            port: 443,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${credentials}`,
            }
        };

        // --- START FIX: Check for existing account by email first ---
        let accountId;
        const searchAccountOptions = { ...baseOptions, path: `/v2/accounts?email=${encodeURIComponent(userData.email)}`, method: 'GET' };
        
        console.log(`[RAZORPAY] Searching for existing account with email: ${userData.email}`);
        const existingAccounts = await makeRazorpayRequest(searchAccountOptions);
        
        if (existingAccounts && existingAccounts.items && existingAccounts.items.length > 0) {
            // Account with this email already exists, use it.
            accountId = existingAccounts.items[0].id;
            console.log(`[RAZORPAY] Found existing Linked Account for email ${userData.email}. ID: ${accountId}. Skipping creation steps.`);
        } else {
            // No account found, create a new one.
            console.log(`[RAZORPAY] No existing Linked Account found for email ${userData.email}. Creating a new one.`);
            const accountPayload = JSON.stringify({
                type: "route", 
                email: userData.email,
                legal_business_name: businessData.name,
                business_type: "proprietorship", 
                contact_name: userData.name,
                phone: userData.phone,
                profile: {
                    category: "food_and_beverage",
                    subcategory: "food_and_beverage", // General subcategory
                    addresses: {
                        registered: {
                            street1: businessData.address.street,
                            street2: businessData.address.street,
                            city: businessData.address.city,
                            state: businessData.address.state,
                            postal_code: businessData.address.postalCode,
                            country: businessData.address.country || "IN"
                        }
                    }
                }
            });
            
            const createAccountOptions = { ...baseOptions, path: '/v2/accounts', method: 'POST' };
            const linkedAccount = await makeRazorpayRequest(createAccountOptions, accountPayload);
            accountId = linkedAccount.id;
            console.log(`[RAZORPAY] New account created. ID: ${accountId}`);

            console.log(`[RAZORPAY] Creating stakeholder for account ${accountId}...`);
            const stakeholderPayload = JSON.stringify({ name: userData.name, email: userData.email });
            const createStakeholderOptions = { ...baseOptions, path: `/v2/accounts/${accountId}/stakeholders`, method: 'POST' };
            await makeRazorpayRequest(createStakeholderOptions, stakeholderPayload);
            console.log(`[RAZORPAY] Stakeholder created.`);

            console.log(`[RAZORPAY] Requesting 'route' product for account ${accountId}...`);
            const productRequestPayload = JSON.stringify({ product_name: "route", tnc_accepted: true });
            const requestProductOptions = { ...baseOptions, path: `/v2/accounts/${accountId}/products`, method: 'POST' };
            const product = await makeRazorpayRequest(requestProductOptions, productRequestPayload);
            const productId = product.id;
            console.log(`[RAZORPAY] Product request created. Product ID: ${productId}`);

            console.log(`[RAZORPAY] Updating product with bank details...`);
            const updateProductPayload = JSON.stringify({ tnc_accepted: true, settlements: { account_number: accountNumber, ifsc_code: ifsc, beneficiary_name: beneficiaryName } });
            const updateProductOptions = { ...baseOptions, path: `/v2/accounts/${accountId}/products/${productId}`, method: 'PATCH' };
            await makeRazorpayRequest(updateProductOptions, updateProductPayload);
            console.log(`[RAZORPAY] Bank details added successfully.`);
        }
        // --- END FIX ---

        await businessRef.update({ razorpayAccountId: accountId });
        console.log(`[FIRESTORE] Updated business document with Razorpay Account ID: ${accountId}`);

        return NextResponse.json({ message: 'Linked account created/retrieved successfully!', accountId: accountId }, { status: 200 });

    } catch (error) {
        const errorDetail = error.error ? JSON.stringify(error.error, null, 2) : error.message;
        console.error("Failed to complete Razorpay Linked Account setup:", errorDetail);
        
        const errorMessageForUser = error.error?.description || error.message || 'Failed to create linked account.';
        return NextResponse.json({ message: `Razorpay Error: ${errorMessageForUser}` }, { status: 500 });
    }
}
