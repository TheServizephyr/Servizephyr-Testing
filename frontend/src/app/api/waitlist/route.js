
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { name, businessName, phone, email, address } = await req.json();

        // --- VALIDATION ---
        if (!name || !businessName || !phone || !address) {
            return NextResponse.json({ message: 'Name, Business Name, Phone, and Address are required.' }, { status: 400 });
        }
        
        const normalizedPhone = phone.length > 10 ? phone.slice(-10) : phone;
        if (!/^\d{10}$/.test(normalizedPhone)) {
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }

        const waitlistRef = firestore.collection('waitlist_entries');

        // Check if phone number already exists to prevent duplicate entries
        const existingEntryQuery = await waitlistRef.where('phone', '==', normalizedPhone).limit(1).get();
        if (!existingEntryQuery.empty) {
            return NextResponse.json({ message: 'This phone number is already on the waitlist.' }, { status: 409 }); // 409 Conflict
        }
        
        const newEntryRef = waitlistRef.doc();

        await newEntryRef.set({
            id: newEntryRef.id,
            name,
            businessName,
            phone: normalizedPhone,
            email: email || null,
            address,
            createdAt: FieldValue.serverTimestamp(),
            status: 'pending' // You can use this status later
        });

        console.log(`[API Waitlist] New entry added for ${businessName} by ${name}.`);
        return NextResponse.json({ message: 'Successfully joined the waitlist!' }, { status: 201 });

    } catch (error) {
        console.error('WAITLIST API ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
