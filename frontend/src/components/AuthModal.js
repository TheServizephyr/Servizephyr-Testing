

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./AuthModal.module.css";
import { X } from "lucide-react";

// --- START: CORRECT FIREBASE IMPORT ---
import { auth, googleProvider } from "@/lib/firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, setPersistence, browserLocalPersistence } from "firebase/auth";

export default function AuthModal({ isOpen, onClose }) {
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState(""); // info, success, error
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const [isRedirectCheckDone, setIsRedirectCheckDone] = useState(false);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => (document.body.style.overflow = "auto");
  }, [isOpen]);

  // Redundant check removed. RedirectHandler handles this globally now.

  const resetForm = () => {
    setMsg("");
    setMsgType("");
    setLoading(false);
  };

  const closeModal = () => {
    resetForm();
    onClose();
  };

  const handleAuthSuccess = async (user) => {
    setMsg("Verifying user details...");
    setMsgType("info");

    try {
      // Correctly check the user's role from our backend
      const idToken = await user.getIdToken();
      console.log("[DEBUG] AuthModal: Got ID token. Calling /api/auth/check-role...");
      const res = await fetch('/api/auth/check-role', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      });

      const data = await res.json();
      console.log(`[DEBUG] AuthModal: Received response from check-role API. Status: ${res.status}, Data:`, data);

      if (!res.ok) {
        // If the backend returns a 404, it's a new user.
        if (res.status === 404) {
          console.log("[DEBUG] AuthModal: User not found (404), treating as new user.");
          setMsg("✅ New user detected! Redirecting to complete your profile...");
          setMsgType("success");
          localStorage.setItem("role", "none");

          // Use window.location.href instead of router.push for iPhone/Safari compatibility
          // router.push doesn't work reliably on iPhone after OAuth redirects
          setTimeout(() => {
            closeModal();
            window.location.href = "/complete-profile";
          }, 500);
          return;
        }
        // For any other error, display it.
        throw new Error(data.message || 'Failed to verify user role.');
      }

      // Check if user has multiple roles (owner/customer + employee)
      if (data.hasMultipleRoles) {
        console.log("[DEBUG] AuthModal: Multiple roles detected. Redirecting to select-role page.");
        setMsg("✅ Multiple accounts found! Choose your account...");
        setMsgType("success");
        setTimeout(() => {
          closeModal();
          window.location.href = "/select-role";
        }, 1000);
        return;
      }

      // Check if API provided a specific redirect URL (for employees)
      if (data.redirectTo) {
        console.log(`[DEBUG] AuthModal: Custom redirect provided: ${data.redirectTo}`);
        setMsg(`✅ Welcome back! Redirecting to ${data.outletName || 'dashboard'}...`);
        setMsgType("success");
        localStorage.setItem("role", data.role || 'employee');
        setTimeout(() => {
          closeModal();
          window.location.href = data.redirectTo;
        }, 1500);
        return;
      }

      // If the response is OK, the backend found a role.
      const { role, businessType } = data;
      console.log(`[DEBUG] AuthModal: Role found: '${role}', BusinessType: '${businessType}'. Redirecting...`);
      setMsg(`✅ Login successful! Redirecting to ${role} dashboard...`);
      setMsgType("success");
      localStorage.setItem("role", role);
      if (businessType) {
        localStorage.setItem("businessType", businessType);
      }

      setTimeout(() => {
        closeModal();
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
      }, 1500);

    } catch (err) {
      console.error("Auth Success processing error:", err);
      setMsg(`Error: ${err.message}`);
      setMsgType("error");
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setMsg("Opening Google sign-in...");
    setMsgType("info");
    console.log("[DEBUG] AuthModal: handleGoogleLogin started.");

    try {
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

      if (isLocalhost) {
        console.log("[AuthModal] Localhost detected - using popup...");
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        console.log("[AuthModal] Popup successful, processing...");
        localStorage.removeItem('isLoggingIn');
        await handleAuthSuccess(user);
      } else {
        console.log("[AuthModal] Production - using redirect...");
        await setPersistence(auth, browserLocalPersistence);
        localStorage.setItem('isLoggingIn', JSON.stringify({ timestamp: Date.now() }));
        await signInWithRedirect(auth, googleProvider);
      }
    } catch (err) {
      console.error("[AuthModal] Login error:", err);
      // Ignore user closing popup
      if (err.code !== 'auth/popup-closed-by-user') {
        setMsg(`Login Failed: ${err.message}`);
        setMsgType("error");
      } else {
        setMsg("");
        setMsgType("");
      }
      setLoading(false);
      localStorage.removeItem('isLoggingIn');
    }
  };


  const renderContent = () => {
    return (
      <div className={styles.form}>
        <h2 className={styles.title}>Welcome to ServiZephyr</h2>
        <p className={styles.infoText}>The easiest way to manage your restaurant. Please sign in to continue.</p>

        <button className={styles.btn} onClick={handleGoogleLogin} disabled={loading}>
          Continue with Google
        </button>

        <p className={styles.switchText}>By continuing, you agree to our Terms of Service and Privacy Policy.</p>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className={styles.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeModal}>
          <motion.div className={styles.card} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ duration: 0.3, ease: "easeOut" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={closeModal} className={styles.closeBtn}><X size={24} /></button>

            <AnimatePresence mode="wait">
              <motion.div
                key="google-login"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                {renderContent()}
              </motion.div>
            </AnimatePresence>

            {msg && (
              <motion.p
                className={`${styles.msg} ${msgType === "success" ? styles.msgSuccess : msgType === "error" ? styles.msgError : styles.msgInfo}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {loading && <span className={styles.spinner}></span>}
                {msg}
              </motion.p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
