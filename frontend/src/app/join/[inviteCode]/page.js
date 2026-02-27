'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useFirebase } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, Building2, User, Shield } from 'lucide-react';
import Image from 'next/image';

export default function JoinPage() {
    const params = useParams();
    const router = useRouter();
    const { auth, user } = useFirebase();

    const inviteCode = params.inviteCode;

    const [loading, setLoading] = useState(true);
    const [accepting, setAccepting] = useState(false);
    const [inviteData, setInviteData] = useState(null);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const hasAttemptedAccept = useRef(false);

    // Fetch invitation details on mount
    useEffect(() => {
        if (!inviteCode) return;

        async function fetchInviteDetails() {
            try {
                const response = await fetch(`/api/employee/accept-invite?code=${inviteCode}`);
                const data = await response.json();

                if (!response.ok || !data.valid) {
                    setError(data.message || 'Invalid or expired invitation');
                } else {
                    setInviteData(data.invitation);
                }
            } catch (err) {
                console.error('Fetch invite error:', err);
                setError('Failed to load invitation details');
            } finally {
                setLoading(false);
            }
        }

        fetchInviteDetails();
    }, [inviteCode]);

    // Auto-accept ONLY when user is logged in AND email matches
    // If wrong email is logged in, we just sign them out silently and wait for button click
    useEffect(() => {
        if (!user || !inviteData || accepting || success || hasAttemptedAccept.current) {
            return;
        }

        const userEmail = user.email?.toLowerCase();
        const invitedEmail = inviteData.invitedEmail?.toLowerCase();

        if (userEmail === invitedEmail) {
            // Correct email - auto accept
            hasAttemptedAccept.current = true;
            handleAcceptInvite();
        } else {
            // Wrong email logged in - sign out silently so user can choose correct account
            // Don't show error, just let them click button to choose account
            if (auth?.currentUser) {
                auth.signOut();
            }
        }
    }, [user, inviteData, accepting, success]);

    // Handle Google Sign In with account picker (using redirect for mobile compatibility)
    async function handleGoogleSignIn() {
        if (!auth) {
            setError('Authentication not ready. Please refresh the page.');
            return;
        }

        try {
            if (navigator.vibrate) navigator.vibrate(10);
            setAccepting(true);
            setError(null);

            // IMPORTANT: Sign out any existing user first to force fresh Google account picker
            // This ensures user can choose any account in their browser
            if (auth.currentUser) {
                await auth.signOut();
            }

            const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
            const provider = new GoogleAuthProvider();
            // Force account picker to show - this shows all accounts in browser
            provider.setCustomParameters({
                prompt: 'select_account',
                login_hint: inviteData?.invitedEmail || '' // Pre-fill with invited email
            });

            // Use popup with proper error handling
            const result = await signInWithPopup(auth, provider);

            // Check if signed-in email matches invited email
            const signedInEmail = result.user.email?.toLowerCase();
            const invitedEmail = inviteData.invitedEmail?.toLowerCase();

            if (signedInEmail !== invitedEmail) {
                setError(`Please sign in with ${inviteData.invitedEmail}. You signed in as ${result.user.email}.`);
                setAccepting(false);
                // Sign out the wrong account
                await auth.signOut();
                return;
            }

            // Proceed to accept invite
            await acceptInviteAPI(result.user);

        } catch (err) {
            console.error('Google sign in error:', err);
            if (err.code === 'auth/popup-closed-by-user') {
                setError('Sign-in cancelled. Please try again.');
            } else if (err.code === 'auth/popup-blocked') {
                // Try with redirect if popup is blocked
                setError('Popup blocked. Please allow popups or try again.');
            } else {
                setError('Failed to sign in with Google. Please try again.');
            }
            setAccepting(false);
        }
    }

    // Accept invite API call
    async function acceptInviteAPI(currentUser) {
        try {
            setAccepting(true);

            const token = await currentUser.getIdToken();
            const response = await fetch('/api/employee/accept-invite', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    inviteCode,
                    name: currentUser.displayName || '',
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to accept invitation');
            }

            setSuccess(true);

            // Haptic success feedback
            if (navigator.vibrate) {
                navigator.vibrate([100, 50, 100]);
            }

            // Redirect to employee dashboard after 2 seconds
            setTimeout(() => {
                router.push(data.redirectTo || '/employee-dashboard');
            }, 2000);

        } catch (err) {
            console.error('Accept invite error:', err);
            setError(err.message || 'Failed to accept invitation');
            setAccepting(false);
        }
    }

    // Handle Accept Invite (called when user already logged in)
    async function handleAcceptInvite() {
        if (!user) {
            handleGoogleSignIn();
            return;
        }

        // Verify email matches
        const userEmail = user.email?.toLowerCase();
        const invitedEmail = inviteData.invitedEmail?.toLowerCase();

        if (userEmail !== invitedEmail) {
            setError(`Please sign in with ${inviteData.invitedEmail}. You are logged in as ${user.email}.`);
            setAccepting(false);
            return;
        }

        await acceptInviteAPI(user);
    }

    // Loading state
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-yellow-500 mx-auto mb-4" />
                    <p className="text-slate-500 dark:text-slate-400">Loading invitation...</p>
                </div>
            </div>
        );
    }

    // Error state (invalid invite)
    if (error && !inviteData) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8 max-w-md w-full text-center shadow-xl"
                >
                    <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Invalid Invitation</h1>
                    <p className="text-slate-500 dark:text-slate-400 mb-6">{error}</p>
                    <Button
                        onClick={() => router.push('/')}
                        variant="secondary"
                    >
                        Go Home
                    </Button>
                </motion.div>
            </div>
        );
    }

    // Success state
    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-white dark:bg-slate-800 border-2 border-green-500 rounded-2xl p-8 max-w-md w-full text-center shadow-xl"
                >
                    <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Welcome to the Team! 🎉</h1>
                    <p className="text-slate-500 dark:text-slate-400 mb-2">
                        You are now a <strong className="text-slate-900 dark:text-white">{inviteData?.roleDisplay}</strong> at
                    </p>
                    <p className="text-xl font-semibold text-yellow-500 mb-4">
                        {inviteData?.outletName}
                    </p>
                    <div className="flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Redirecting to your dashboard...
                    </div>
                </motion.div>
            </div>
        );
    }

    // Main invite card
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-xl"
            >
                {/* Logo */}
                <div className="flex justify-center mb-6">
                    <Image src="/logo.png" alt="ServiZephyr" width={48} height={48} />
                </div>

                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        You&apos;re Invited! 🎉
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Join the team at <strong className="text-yellow-500">{inviteData?.outletName}</strong>
                    </p>
                </div>

                {/* Invite Details */}
                <div className="space-y-4 mb-8">
                    <div className="bg-slate-100 dark:bg-slate-700/50 rounded-xl p-4 flex items-center gap-4">
                        <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center">
                            <Shield className="w-6 h-6 text-purple-500" />
                        </div>
                        <div>
                            <p className="text-slate-500 dark:text-slate-400 text-sm">Your Role</p>
                            <p className="text-slate-900 dark:text-white font-semibold text-lg">
                                {inviteData?.roleDisplay}
                            </p>
                        </div>
                    </div>

                    <div className="bg-slate-100 dark:bg-slate-700/50 rounded-xl p-4 flex items-center gap-4">
                        <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center">
                            <User className="w-6 h-6 text-green-500" />
                        </div>
                        <div>
                            <p className="text-slate-500 dark:text-slate-400 text-sm">Invited Email</p>
                            <p className="text-slate-900 dark:text-white font-medium">
                                {inviteData?.invitedEmail}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Error message */}
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 mb-4 text-center"
                    >
                        <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                    </motion.div>
                )}

                {/* Sign In / Accept Button */}
                <Button
                    onClick={user ? handleAcceptInvite : handleGoogleSignIn}
                    disabled={accepting}
                    className="w-full py-6 text-lg font-semibold rounded-xl bg-yellow-500 hover:bg-yellow-600 text-black"
                >
                    {accepting ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                            {user ? 'Joining...' : 'Signing in...'}
                        </>
                    ) : (
                        <>
                            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Sign in with Google to Join
                        </>
                    )}
                </Button>

                <p className="text-slate-400 text-xs text-center mt-4">
                    By joining, you agree to the terms of service.
                </p>
            </motion.div>
        </div>
    );
}
