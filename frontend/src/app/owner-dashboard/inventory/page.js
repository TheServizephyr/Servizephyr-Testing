'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function OwnerInventoryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    useEffect(() => {
        const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
        const employeeOfOwnerId = searchParams.get('employee_of');

        const nextParams = new URLSearchParams();
        if (impersonatedOwnerId) {
            nextParams.set('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            nextParams.set('employee_of', employeeOfOwnerId);
        }
        const query = nextParams.toString();
        router.replace(query ? `/owner-dashboard/menu?${query}` : '/owner-dashboard/menu');
    }, [router, searchParams]);

    return null;
}
