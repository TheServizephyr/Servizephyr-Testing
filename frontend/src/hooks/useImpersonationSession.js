'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Custom hook to manage admin impersonation session
 * Handles session expiry validation and warnings
 */
export function useImpersonationSession() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [sessionExpiry, setSessionExpiry] = useState(null);
    const [timeRemaining, setTimeRemaining] = useState(null);
    const [showWarning, setShowWarning] = useState(false);

    const impersonateOwnerId = searchParams.get('impersonate_owner_id');
    const sessionExpiryParam = searchParams.get('session_expiry');

    useEffect(() => {
        if (!impersonateOwnerId || !sessionExpiryParam) {
            setSessionExpiry(null);
            setTimeRemaining(null);
            return;
        }

        const expiry = parseInt(sessionExpiryParam);
        setSessionExpiry(expiry);

        // Check expiry every second
        const interval = setInterval(() => {
            const now = Date.now();
            const remaining = expiry - now;

            if (remaining <= 0) {
                // Session expired - redirect to admin dashboard
                clearInterval(interval);
                alert('Your impersonation session has expired. Redirecting to admin dashboard...');
                router.push('/admin-dashboard');
                return;
            }

            setTimeRemaining(remaining);

            // Show warning 5 minutes before expiry
            if (remaining <= 5 * 60 * 1000 && !showWarning) {
                setShowWarning(true);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [impersonateOwnerId, sessionExpiryParam, router, showWarning]);

    const formatTimeRemaining = () => {
        if (!timeRemaining) return '';

        const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
        const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    };

    const exitImpersonation = () => {
        router.push('/admin-dashboard');
    };

    return {
        isImpersonating: !!impersonateOwnerId,
        impersonateOwnerId,
        sessionExpiry,
        timeRemaining,
        showWarning,
        formatTimeRemaining,
        exitImpersonation
    };
}
