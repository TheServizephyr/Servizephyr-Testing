'use client';

import { UserCheck, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSearchParams, useRouter } from 'next/navigation';

/**
 * Employee Banner Component  
 * Shows a prominent banner when employee is accessing owner's dashboard
 */
export default function EmployeeBanner({ vendorName, employeeRole }) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const employeeOfOwnerId = searchParams.get('employee_of');

    if (!employeeOfOwnerId) return null;

    const getRoleBadge = (role) => {
        switch (role) {
            case 'manager': return '👨‍💼 Manager';
            case 'cashier': return '💰 Cashier';
            case 'chef': return '👨‍🍳 Chef';
            case 'waiter': return '🍽️ Waiter';
            case 'delivery': return '🛵 Delivery';
            default: return '👤 Staff';
        }
    };

    const exitEmployeeMode = () => {
        // Clear employee session and redirect to select-role
        localStorage.removeItem('employeeRole');
        router.push('/select-role');
    };

    return (
        <div className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white px-4 py-3 flex items-center justify-between shadow-lg z-50">
            <div className="flex items-center gap-3">
                <UserCheck className="h-5 w-5 flex-shrink-0" />
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                    <span className="font-bold text-sm sm:text-base flex items-center gap-2">
                        🏪 {getRoleBadge(employeeRole)}
                    </span>
                    <span className="text-xs sm:text-sm">
                        Working at: <span className="font-semibold">{vendorName || 'Restaurant'}</span>
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <Button
                    onClick={exitEmployeeMode}
                    variant="outline"
                    size="sm"
                    className="bg-white/20 text-white hover:bg-white/30 border-white/40 text-xs sm:text-sm"
                >
                    <LogOut className="h-4 w-4 mr-1" />
                    Switch Account
                </Button>
            </div>
        </div>
    );
}
