import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { logImpersonation, getClientIP, getUserAgent } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/log-impersonation
 * Log when admin starts impersonating a user (Customer/Rider)
 */
export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req);

        // Verify admin role
        const userDoc = await firestore.collection('users').doc(uid).get();
        if (!userDoc.exists || userDoc.data().role !== 'admin') {
            return NextResponse.json({ message: 'Access Denied: Admin only' }, { status: 403 });
        }

        const { targetUserId, targetUserEmail, targetUserRole, action } = await req.json();

        if (!targetUserId || !action) {
            return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
        }

        // Log the impersonation
        await logImpersonation({
            adminId: uid,
            adminEmail: userDoc.data().email,
            targetOwnerId: targetUserId,
            targetOwnerEmail: targetUserEmail || null,
            action,
            metadata: { userRole: targetUserRole },
            ipAddress: getClientIP(req),
            userAgent: getUserAgent(req)
        });

        return NextResponse.json({ success: true }, { status: 200 });

    } catch (error) {
        console.error('[API ERROR] POST /api/admin/log-impersonation:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
