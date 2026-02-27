'use client';

import { AlertTriangle, LogOut, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useImpersonationSession } from '@/hooks/useImpersonationSession';

/**
 * Impersonation Banner Component
 * Shows a prominent warning banner when admin is impersonating a user
 */
export default function ImpersonationBanner({ vendorName }) {
    const {
        isImpersonating,
        showWarning,
        formatTimeRemaining,
        exitImpersonation
    } = useImpersonationSession();

    if (!isImpersonating) return null;

    return (
        <div className={`w-full ${showWarning ? 'bg-red-500' : 'bg-yellow-500'} text-black px-4 py-3 flex items-center justify-between shadow-lg z-50`}>
            <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                    <span className="font-bold text-sm sm:text-base">
                        ⚠️ ADMIN MODE
                    </span>
                    <span className="text-xs sm:text-sm">
                        Viewing as: <span className="font-semibold">{vendorName || 'Vendor'}</span>
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2 text-xs font-medium">
                    <Clock className="h-4 w-4" />
                    <span>Session: {formatTimeRemaining()}</span>
                </div>
                <Button
                    onClick={exitImpersonation}
                    variant="outline"
                    size="sm"
                    className="bg-black text-white hover:bg-gray-800 border-none text-xs sm:text-sm"
                >
                    <LogOut className="h-4 w-4 mr-1" />
                    Exit
                </Button>
            </div>
        </div>
    );
}
