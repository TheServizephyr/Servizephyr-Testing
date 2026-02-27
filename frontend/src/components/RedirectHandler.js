"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { getRedirectResult, onAuthStateChanged } from "firebase/auth";
import { Loader2 } from "lucide-react";

export default function RedirectHandler() {
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");
    const [error, setError] = useState(null);
    const router = useRouter();

    useEffect(() => {
        // Skip if we're on /login page or any dashboard page - let them handle their own auth
        if (typeof window !== 'undefined') {
            const pathname = window.location.pathname;
            const isDashboard = pathname.startsWith('/owner-dashboard') ||
                pathname.startsWith('/admin-dashboard') ||
                pathname.startsWith('/rider-dashboard') ||
                pathname.startsWith('/street-vendor-dashboard') ||
                pathname.startsWith('/customer-dashboard') ||
                pathname.startsWith('/employee-dashboard');

            if (pathname === '/login' || isDashboard) {
                console.log("[RedirectHandler] On", pathname, "- skipping global handler");
                return;
            }
        }

        let unsubscribe = () => { };

        const handleRedirectResult = async () => {
            // Check if we are expecting a login immediately to show loader
            // Use localStorage instead of sessionStorage - iPhone clears sessionStorage during OAuth!
            const initialFlag = localStorage.getItem('isLoggingIn');
            if (initialFlag) {
                setLoading(true);
                setMsg("Finishing login...");
            }

            console.log("[RedirectHandler] Starting redirect check...");
            console.log("[RedirectHandler] Current user:", auth.currentUser?.email || "null");
            try {
                console.log("[RedirectHandler] Calling getRedirectResult...");
                const result = await getRedirectResult(auth);
                console.log("[RedirectHandler] getRedirectResult returned:", result ? `User: ${result.user.email}` : "null");

                if (result && result.user) {
                    console.log("[RedirectHandler] User returned from redirect:", result.user.email);
                    localStorage.removeItem('isLoggingIn'); // Cleanup
                    setLoading(true);
                    setMsg("Verifying login details...");
                    await processLogin(result.user);
                } else {
                    console.log("[RedirectHandler] No redirect result found. Checking fallback...");

                    // CRITICAL FIX FOR iPHONE: Check auth.currentUser FIRST
                    // On iPhone, getRedirectResult often returns null but Firebase has already restored the session
                    const loginFlagData = localStorage.getItem('isLoggingIn');
                    if (loginFlagData && auth.currentUser) {
                        console.log("[RedirectHandler] ✓ iPhone/Chrome fallback: User already authenticated:", auth.currentUser.email);
                        localStorage.removeItem('isLoggingIn');
                        setLoading(true);
                        setMsg("Completing login...");
                        await processLogin(auth.currentUser);
                        return;
                    }

                    // PWA/Session Restoration Logic - DISABLED per user request
                    // The user wants to land on the landing page even if they have an active session
                    // if (window.location.pathname === '/') {
                    //     const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
                    //         if (user) {
                    //             console.log("[RedirectHandler] User session restored on Landing Page. Auto-redirecting...");
                    //             setLoading(true);
                    //             setMsg("Restoring session...");
                    //             await processLogin(user);
                    //         }
                    //     });
                    // }

                    // Fallback: Check if we are in a 'logging in' state but redirect result was lost
                    // Use timestamp-based validation to avoid stale flags
                    const isDashboard = window.location.pathname.includes('dashboard');

                    if (loginFlagData) {
                        let shouldProceed = false;
                        let flagAge = 0;

                        // Try to parse timestamp
                        try {
                            if (loginFlagData === 'true') {
                                // Old format - treat as stale
                                console.log("[RedirectHandler] Old format flag detected. Clearing.");
                                localStorage.removeItem('isLoggingIn');
                                setLoading(false);
                                return;
                            }

                            const { timestamp } = JSON.parse(loginFlagData);
                            flagAge = (Date.now() - timestamp) / 1000;

                            // If flag is older than 3 minutes, it's stale
                            // Increased from 30s to 180s to account for slow Google redirects
                            if (flagAge > 180) {
                                console.log(`[RedirectHandler] Stale login flag (${flagAge.toFixed(0)}s old). Clearing.`);
                                localStorage.removeItem('isLoggingIn');
                                setLoading(false);
                                return;
                            }

                            shouldProceed = true;
                        } catch (e) {
                            // Invalid format - clear it
                            console.log("[RedirectHandler] Invalid flag format. Clearing.");
                            localStorage.removeItem('isLoggingIn');
                            setLoading(false);
                            return;
                        }

                        // If already logged in or on dashboard, clear flag
                        if (shouldProceed && (auth.currentUser || isDashboard)) {
                            console.log("[RedirectHandler] Already authenticated/on dashboard. Clearing flag.");
                            localStorage.removeItem('isLoggingIn');
                            setLoading(false);
                            return;
                        }

                        if (shouldProceed) {
                            // Check if user is already authenticated (Firebase restored the session)
                            if (auth.currentUser) {
                                console.log(`[RedirectHandler] ✓ User already authenticated: ${auth.currentUser.email}`);
                                localStorage.removeItem('isLoggingIn');
                                setLoading(true);
                                setMsg("Completing login...");
                                await processLogin(auth.currentUser);
                                return;
                            }

                            console.log(`[RedirectHandler] Fresh login flag (${flagAge.toFixed(0)}s old). Waiting for auth state...`);

                            // Longer timeout for slow networks and Firebase auth restoration
                            const timeoutId = setTimeout(() => {
                                console.log("[RedirectHandler] Auth state timeout (15s). No user authenticated.");
                                setLoading(false);
                                localStorage.removeItem('isLoggingIn');
                            }, 15000); // 15 seconds

                            unsubscribe = onAuthStateChanged(auth, async (user) => {
                                if (user) {
                                    console.log("[RedirectHandler] ✓ User authenticated:", user.email);
                                    clearTimeout(timeoutId);
                                    localStorage.removeItem('isLoggingIn');
                                    setLoading(true);
                                    setMsg("Recovering login session...");
                                    await processLogin(user);
                                } else {
                                    console.log("[RedirectHandler] Auth state: null (waiting for Firebase to restore session...)");
                                }
                            });
                        } else {
                            setLoading(false);
                        }
                    } else {
                        setLoading(false);
                    }
                }
            } catch (error) {
                console.error("[RedirectHandler] Redirect error:", error);
                if (error.code !== 'auth/popup-closed-by-user') {
                    setError(`Login failed: ${error.message}`);
                    setMsg("An error occurred.");
                } else {
                    setLoading(false);
                }
            }
        };

        handleRedirectResult();

        return () => unsubscribe();
    }, []);

    const processLogin = async (user) => {
        try {
            setMsg("Checking account permissions...");
            const idToken = await user.getIdToken();
            console.log("[RedirectHandler] Got ID Token, calling API...");

            const res = await fetch('/api/auth/check-role', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}` },
            });

            const data = await res.json();
            console.log("[RedirectHandler] Role check response:", data);

            if (!res.ok) {
                if (res.status === 404) {
                    setMsg("New user detected! Redirecting...");
                    console.log("[RedirectHandler] 404 - New User. Redirecting to /complete-profile");
                    localStorage.setItem("role", "none");
                    window.location.href = "/complete-profile";
                    return;
                }
                throw new Error(data.message || 'Failed to verify user role.');
            }

            if (data.hasMultipleRoles) {
                setMsg("Multiple accounts found. Redirecting...");
                console.log("[RedirectHandler] Multiple roles. Redirecting to /select-role");
                window.location.href = "/select-role";
                return;
            }

            if (data.redirectTo) {
                setMsg(`Welcome back! Redirecting to ${data.outletName || 'dashboard'}...`);
                console.log(`[RedirectHandler] specific redirectTo found: ${data.redirectTo}`);
                localStorage.setItem("role", data.role || 'employee');
                localStorage.removeItem("businessType");
                window.location.href = data.redirectTo;
                return;
            }

            const { role, businessType } = data;
            setMsg(`Login successful! Entering ${role} dashboard...`);
            console.log(`[RedirectHandler] Role: ${role}, Business: ${businessType}`);

            const resolvedBusinessType =
                (businessType
                    ? (
                        businessType === 'street_vendor'
                            ? 'street-vendor'
                            : (businessType === 'shop' ? 'store' : businessType)
                    )
                    : null) ||
                (role === 'shop-owner'
                    ? 'store'
                    : role === 'street-vendor'
                        ? 'street-vendor'
                        : (role === 'owner' || role === 'restaurant-owner')
                            ? 'restaurant'
                            : null);

            localStorage.setItem("role", role);
            if (resolvedBusinessType) localStorage.setItem("businessType", resolvedBusinessType);
            else localStorage.removeItem("businessType");

            if (role === "owner" || role === "restaurant-owner" || role === "shop-owner") {
                window.location.href = "/owner-dashboard";
            } else if (role === "admin") {
                window.location.href = "/admin-dashboard";
            } else if (role === "rider") {
                window.location.href = "/rider-dashboard";
            } else if (role === "street-vendor") {
                window.location.href = "/street-vendor-dashboard";
            } else {
                window.location.href = "/customer-dashboard";
            }

        } catch (err) {
            console.error("[RedirectHandler] Logic error:", err);
            setError(`Login processing error: ${err.message}`);
            setMsg("Failed to process login.");
            // Do NOT setLoading(false) so the user sees the error
        }
    };

    if (!loading && !error) return null;

    if (error) {
        return (
            <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90 text-white p-4">
                <div className="bg-red-500/10 border border-red-500 rounded-lg p-6 max-w-md w-full text-center">
                    <h2 className="text-xl font-bold mb-2 text-red-500">Login Issue</h2>
                    <p className="mb-4">{error}</p>
                    <button
                        onClick={() => { setError(null); setLoading(false); }}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                    >
                        Close & Continue
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm text-white">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <h2 className="text-xl font-semibold">{msg || "Finishing login..."}</h2>
        </div>
    );
}
