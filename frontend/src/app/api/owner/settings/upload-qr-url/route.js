
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { nanoid } from 'nanoid';
import { firebaseConfig } from '@/firebase/config'; // ✅ Import config for explicit bucket name

async function verifyOwnerAndGetBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req); // Use central helper

    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    let targetOwnerId = uid;
    if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    } else if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
        throw { message: 'Access Denied', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0].id;
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].id;
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function POST(req) {
    try {
        const businessId = await verifyOwnerAndGetBusinessRef(req);

        // Handle FormData for Server-Side Upload
        const formData = await req.formData();
        const file = formData.get('file');
        const riderId = formData.get('riderId');

        if (!file) {
            return NextResponse.json({ message: 'No file uploaded.' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // ✅ Use Explicit Bucket Name from Config
        // Fallback to env var if config is missing, but config should exist
        const bucketName = firebaseConfig.storageBucket || `gs://${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
        const bucket = getStorage().bucket(bucketName);

        const extension = file.name.split('.').pop();
        const uniqueFileName = `${nanoid()}.${extension}`;

        // Organization: payment_qr/businessId/riderId/file.jpg or payment_qr/businessId/file.jpg
        const folderPath = riderId ? `payment_qr/${businessId}/${riderId}` : `payment_qr/${businessId}`;
        const filePath = `${folderPath}/${uniqueFileName}`;

        const firebaseFile = bucket.file(filePath);

        await firebaseFile.save(buffer, {
            metadata: {
                contentType: file.type,
            },
            public: true,
        });

        // Use the standard public storage URL format which is generally accessible if object is public
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

        return NextResponse.json({
            success: true,
            publicUrl: publicUrl
        }, { status: 200 });

    } catch (error) {
        console.error("SERVER-SIDE QR UPLOAD ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
