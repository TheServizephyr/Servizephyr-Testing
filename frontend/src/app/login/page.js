"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { auth, googleProvider } from "@/lib/firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, setPersistence, browserLocalPersistence } from "firebase/auth";

const getSafeRedirectPath = (value) => {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed === "/") return null;
    if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
    return trimmed;
};

function LoginPageContent() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [msg, setMsg] = useState(""); // Message to show user
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectTo = getSafeRedirectPath(searchParams.get("redirect"));
    const hasProcessedRedirect = useRef(false); // Prevent React Strict Mode double call

    // Handle redirect result when user returns from Google
    useEffect(() => {
        // CRITICAL: Prevent double execution in React Strict Mode (dev)
        if (hasProcessedRedirect.current) {
            console.log("[Login] Already processed, skipping duplicate call");
            return;
        }

        const handleRedirectResult = async () => {
            try {
                console.log("[Login] Checking for redirect result...");
                const result = await getRedirectResult(auth);

                if (result && result.user) {
                    console.log("[Login] Redirect result found:", result.user.email);
                    hasProcessedRedirect.current = true; // Mark as processed
                    setLoading(true);
                    setMsg("Verifying user details..."); // ✅ THIS MESSAGE!
                    sessionStorage.removeItem('isLoggingIn'); // Cleanup
                    await handleAuthSuccess(result.user);
                } else {
                    console.log("[Login] No redirect result, checking fallback...");

                    // Only process if user JUST came back from Google (isLoggingIn flag exists)
                    const loginFlag = sessionStorage.getItem('isLoggingIn');

                    if (auth.currentUser && loginFlag) {
                        console.log("[Login] Fallback - User authenticated:", auth.currentUser.email);
                        hasProcessedRedirect.current = true;
                        setLoading(true);
                        setMsg("Verifying user details...");
                        sessionStorage.removeItem('isLoggingIn');
                        await handleAuthSuccess(auth.currentUser);
                    } else if (auth.currentUser) {
                        // iOS/Safari can drop sessionStorage during redirect hops.
                        // If user is already authenticated, continue login flow anyway.
                        console.log("[Login] Auth user exists without login flag (likely iOS/Safari). Continuing...");
                        hasProcessedRedirect.current = true;
                        setLoading(true);
                        setMsg("Restoring login session...");
                        await handleAuthSuccess(auth.currentUser);
                    } else {
                        console.log("[Login] No processing needed");
                    }
                }
            } catch (err) {
                console.error("[Login] Redirect error:", err);
                setError(err.message || "Login failed. Please try again.");
                setLoading(false);
            }
        };
        handleRedirectResult();
    }, []);

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError("");

        try {
            console.log("[Login] Using popup for Google login...");
            const result = await signInWithPopup(auth, googleProvider);
            console.log("[Login] Popup successful, processing...");
            setLoading(true);
            setMsg("Verifying user details...");
            sessionStorage.removeItem('isLoggingIn');
            await handleAuthSuccess(result.user);
        } catch (err) {
            console.error("Login error:", err);
            // Ignore if user closed the popup without signing in
            if (err.code !== 'auth/popup-closed-by-user') {
                setError(err.message || "Login failed. Please try again.");
            }
            setLoading(false);
            sessionStorage.removeItem('isLoggingIn');
        }
    };

    const handleAuthSuccess = async (user) => {
        console.log("[Login] handleAuthSuccess called with user:", user.email);
        try {
            const idToken = await user.getIdToken();
            console.log("[Login] Got ID token, calling check-role API...");

            let res, data;
            try {
                res = await fetch("/api/auth/check-role", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${idToken}`
                    },
                });
                console.log("[Login] Fetch completed, status:", res.status);

                data = await res.json();
                console.log("[Login] API Response:", { status: res.status, data });
            } catch (fetchError) {
                console.error("[Login] Fetch error:", fetchError);
                throw new Error(`API call failed: ${fetchError.message}`);
            }

            if (res.status === 404) {
                // New user - redirect to role selection
                console.log("[Login] New user detected, redirecting to select-role");
                return router.push("/select-role");
            }

            if (data.hasMultipleRoles) {
                console.log("[Login] Multiple roles detected, redirecting to select-role");
                window.location.href = "/select-role";
                return;
            }

            // PRIORITY 1: Check if API returned specific redirectTo (for employees, etc.)
            if (data.redirectTo) {
                console.log("[Login] API returned redirectTo:", data.redirectTo);
                localStorage.setItem("role", data.role || "employee");
                localStorage.removeItem("businessType");
                sessionStorage.setItem('justLoggedIn', JSON.stringify({ timestamp: Date.now() }));
                window.location.href = data.redirectTo;
                return;
            }

            if (data.role) {
                const { role, businessType } = data;
                console.log("[Login] Role found:", role, "Business Type:", businessType);

                const resolvedBusinessType =
                    (businessType
                        ? (
                            businessType === "street_vendor"
                                ? "street-vendor"
                                : (businessType === "shop" ? "store" : businessType)
                        )
                        : null) ||
                    (role === "shop-owner" ? "store"
                        : role === "street-vendor" ? "street-vendor"
                            : (role === "owner" || role === "restaurant-owner") ? "restaurant"
                                : null);

                localStorage.setItem("role", role);
                if (resolvedBusinessType) {
                    localStorage.setItem("businessType", resolvedBusinessType);
                } else {
                    localStorage.removeItem("businessType");
                }

                // Show success message before redirect
                const dashboardName =
                    role === "admin" ? "admin dashboard"
                        : (role === "owner" || role === "restaurant-owner" || role === "shop-owner") ? "owner dashboard"
                            : role === "street-vendor" ? "street-vendor dashboard"
                                : role === "rider" || role === "delivery-boy" ? "rider dashboard"
                                    : role === "employee" ? "employee dashboard"
                                        : "customer dashboard";

                setMsg(`✅ Login successful! Redirecting to ${dashboardName}...`);

                // Redirect based on role - MATCH RedirectHandler logic exactly
                if (role === "owner" || role === "restaurant-owner" || role === "shop-owner") {
                    console.log("[Login] Redirecting to owner dashboard");
                    sessionStorage.setItem('justLoggedIn', JSON.stringify({ timestamp: Date.now() }));
                    window.location.href = redirectTo || "/owner-dashboard";
                    return;
                } else if (role === "admin") {
                    console.log("[Login] Redirecting to admin dashboard");
                    window.location.href = redirectTo || "/admin-dashboard";
                    return;
                } else if (role === "rider" || role === "delivery-boy") {
                    console.log("[Login] Redirecting to rider dashboard");
                    window.location.href = redirectTo || "/rider-dashboard";
                    return;
                } else if (role === "street-vendor") {
                    console.log("[Login] Redirecting to street-vendor dashboard");
                    sessionStorage.setItem('justLoggedIn', JSON.stringify({ timestamp: Date.now() }));
                    window.location.href = redirectTo || "/street-vendor-dashboard";
                    return;
                } else if (role === "employee") {
                    console.log("[Login] Redirecting to employee dashboard");
                    window.location.href = redirectTo || "/employee-dashboard";
                    return;
                } else {
                    // customer or unknown
                    console.log("[Login] Redirecting to customer dashboard");
                    window.location.href = redirectTo || "/customer-dashboard";
                    return;
                }
            }

            // Fallback
            console.log("[Login] No role matched or found, redirecting to home");
            router.push(redirectTo || "/");
        } catch (err) {
            console.error("[Login] Auth error:", err);
            setError("Authentication failed. Please try again.");
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md"
            >
                {/* Logo & Title */}
                <div className="text-center mb-8">
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 200 }}
                        className="inline-block mb-4"
                    >
                        <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-lg">
                            S
                        </div>
                    </motion.div>
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-2">
                        ServiZephyr
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Sign in to continue
                    </p>
                </div>

                {/* Auth Card */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 border border-gray-100 dark:border-gray-700"
                >
                    {/* Error Message */}
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm"
                        >
                            {error}
                        </motion.div>
                    )}

                    {/* Google Sign-In Button */}
                    <button
                        onClick={handleGoogleLogin}
                        disabled={loading}
                        className="w-full flex items-center justify-center gap-3 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 hover:border-purple-500 dark:hover:border-purple-500 rounded-xl px-6 py-4 font-semibold text-gray-700 dark:text-gray-200 transition-all duration-300 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        {loading ? (
                            <div className="w-6 h-6 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <>
                                <svg className="w-6 h-6" viewBox="0 0 24 24">
                                    <path
                                        fill="#4285F4"
                                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                    />
                                    <path
                                        fill="#34A853"
                                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                    />
                                    <path
                                        fill="#FBBC05"
                                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                    />
                                    <path
                                        fill="#EA4335"
                                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                    />
                                </svg>
                                <span className="group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                                    {loading ? "Signing in..." : "Continue with Google"}
                                </span>
                            </>
                        )}
                    </button>

                    {/* Loading/Success Message - Like AuthModal! */}
                    {msg && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-4 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg text-purple-700 dark:text-purple-300 text-sm text-center flex items-center justify-center gap-2"
                        >
                            {loading && (
                                <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                            )}
                            {msg}
                        </motion.div>
                    )}

                    {/* Divider */}
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-4 bg-white dark:bg-gray-800 text-gray-500">
                                Secure authentication
                            </span>
                        </div>
                    </div>

                    {/* Info Text */}
                    <p className="text-xs text-center text-gray-500 dark:text-gray-400">
                        By continuing, you agree to ServiZephyr&apos;s{" "}
                        <a href="/terms-and-conditions" className="text-purple-600 hover:underline">
                            Terms of Service
                        </a>{" "}
                        and{" "}
                        <a href="/privacy" className="text-purple-600 hover:underline">
                            Privacy Policy
                        </a>
                    </p>
                </motion.div>

                {/* Footer */}
                <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-6">
                    Need help?{" "}
                    <a href="/support" className="text-purple-600 dark:text-purple-400 hover:underline font-semibold">
                        Contact Support
                    </a>
                </p>
            </motion.div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        }>
            <LoginPageContent />
        </Suspense>
    );
}
