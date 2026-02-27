import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit-logs
 * Fetch audit logs with filtering and pagination
 * Admin only
 */
export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req);

        // Verify admin role
        const userDoc = await firestore.collection('users').doc(uid).get();
        if (!userDoc.exists || userDoc.data().role !== 'admin') {
            return NextResponse.json({ message: 'Access Denied: Admin only' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const adminFilter = searchParams.get('adminId');
        const actionFilter = searchParams.get('action');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');

        let query = firestore.collection('audit_logs');

        // Apply filters
        if (adminFilter) {
            query = query.where('adminId', '==', adminFilter);
        }
        if (actionFilter) {
            query = query.where('action', '==', actionFilter);
        }
        if (startDate) {
            query = query.where('timestamp', '>=', new Date(startDate));
        }
        if (endDate) {
            query = query.where('timestamp', '<=', new Date(endDate));
        }

        // Order by timestamp descending (most recent first)
        query = query.orderBy('timestamp', 'desc');

        // Get total count (for pagination)
        const countSnapshot = await query.get();
        const totalCount = countSnapshot.size;

        // Apply pagination
        query = query.limit(limit);
        if (offset > 0) {
            const offsetSnapshot = await firestore.collection('audit_logs')
                .orderBy('timestamp', 'desc')
                .limit(offset)
                .get();
            if (!offsetSnapshot.empty) {
                const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.get();
        const logs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || doc.data().timestampISO
        }));

        return NextResponse.json({
            logs,
            totalCount,
            limit,
            offset,
            hasMore: offset + limit < totalCount
        }, { status: 200 });

    } catch (error) {
        console.error('[API ERROR] GET /api/admin/audit-logs:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
