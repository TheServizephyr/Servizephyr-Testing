
'use client';

import { useState, useEffect, Suspense } from "react";
import Sidebar from "@/components/OwnerDashboard/Sidebar";
import Navbar from "@/components/OwnerDashboard/Navbar";
import styles from "@/components/OwnerDashboard/OwnerDashboard.module.css";
import { motion } from "framer-motion";
import { ThemeProvider } from "@/components/ThemeProvider";
import ThemeColorUpdater from "@/components/ThemeColorUpdater";
import GlobalHapticHandler from "@/components/GlobalHapticHandler";
import "../globals.css";
import { AlertTriangle, HardHat, ShieldOff, Salad, Lock, Mail, Phone, MessageSquare, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/firebase";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import GoldenCoinSpinner from "@/components/GoldenCoinSpinner";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import EmployeeBanner from "@/components/EmployeeBanner";

export const dynamic = 'force-dynamic';

function FeatureLockScreen({ remark, featureId }) {
  const supportPhone = "919027872803";
  const supportEmail = "contact@servizephyr.com";

  const whatsappText = encodeURIComponent(`Hello ServiZephyr Team,\n\nMy access to the '${featureId}' feature has been restricted. The remark says: "${remark}".\n\nPlease help me resolve this.`);
  const emailSubject = encodeURIComponent(`Issue: Access Restricted for '${featureId}' Feature`);
  const emailBody = encodeURIComponent(`Hello ServiZephyr Team,\n\nI am writing to you because my access to the '${featureId}' feature on my dashboard has been restricted.\n\nThe remark provided is: "${remark}"\n\nCould you please provide more details or guide me on the steps to resolve this?\n\nThank you.`);


  return (
    <div className="flex flex-col items-center justify-center text-center h-full p-8 bg-card border border-border rounded-xl">
      <Lock className="h-16 w-16 text-yellow-400" />
      <h2 className="mt-6 text-2xl font-bold">Feature Restricted</h2>
      <p className="mt-2 max-w-md text-muted-foreground">Access to this feature has been temporarily restricted by the platform administrator.</p>
      {remark && (
        <div className="mt-4 p-4 bg-muted/50 rounded-lg w-full max-w-md">
          <p className="font-semibold">Admin Remark:</p>
          <p className="text-muted-foreground italic">&quot;{remark}&quot;</p>
        </div>
      )}
      <div className="mt-6 pt-6 border-t border-border w-full max-w-md">
        <p className="text-sm font-semibold mb-4">Need help? Contact support.</p>
        <div className="flex justify-center gap-4">
          <a href={`https://wa.me/${supportPhone}?text=${whatsappText}`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline"><MessageSquare className="mr-2 h-4 w-4" /> WhatsApp</Button>
          </a>
          <a href={`mailto:${supportEmail}?subject=${emailSubject}&body=${emailBody}`}>
            <Button variant="outline"><Mail className="mr-2 h-4 w-4" /> Email</Button>
          </a>
          <a href={`tel:${supportPhone}`}>
            <Button variant="outline"><Phone className="mr-2 h-4 w-4" /> Call Us</Button>
          </a>
        </div>
      </div>
    </div>
  );
}


function OwnerDashboardContent({ children }) {
  const [isMobile, setIsMobile] = useState(true); // FIX: Default to true
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [restaurantStatus, setRestaurantStatus] = useState({
    status: null,
    restrictedFeatures: [],
    suspensionRemark: ''
  });
  const [restaurantName, setRestaurantName] = useState('My Dashboard');
  const [restaurantLogo, setRestaurantLogo] = useState(null);
  const [userRole, setUserRole] = useState(null); // For employee role-based access
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
  const employeeOfOwnerId = searchParams.get('employee_of'); // Employee accessing owner's data

  // Use either impersonation or employee context for fetching owner's data
  const effectiveOwnerId = impersonatedOwnerId || employeeOfOwnerId;

  const { user, isUserLoading } = useUser();

  // CRITICAL: Role detection - prevent owner from being blocked
  useEffect(() => {
    async function fetchEmployeeRole() {
      if (employeeOfOwnerId && user) {
        if (user.uid === employeeOfOwnerId) {
          console.log('[Layout] Owner detected, full access');
          setUserRole(null);
          return;
        }

        // Fetch employee role from Firestore linkedOutlets
        console.log('[Layout] Employee detected, checking Firestore...');
        try {
          // Force token refresh before Direct Firestore Access to prevent permission errors
          await user.getIdToken(true);

          const userDocRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userDocRef);

          if (userSnap.exists()) {
            const userData = userSnap.data();
            const linkedOutlets = userData.linkedOutlets || [];

            const outlet = linkedOutlets.find(
              o => o.ownerId === employeeOfOwnerId && o.status === 'active'
            );

            if (outlet) {
              console.log('[Layout] Employee role found:', outlet.employeeRole);
              setUserRole(outlet.employeeRole);

              // For custom roles, store the allowed pages in localStorage
              if (outlet.employeeRole === 'custom' && outlet.customAllowedPages) {
                localStorage.setItem('customAllowedPages', JSON.stringify(outlet.customAllowedPages));
                console.log('[Layout] Custom role pages stored:', outlet.customAllowedPages);
              } else {
                // Clear custom pages if not a custom role
                localStorage.removeItem('customAllowedPages');
              }
            } else {
              console.error('[Layout] No matching outlet');
              setUserRole(null);
              localStorage.removeItem('customAllowedPages');
            }
          } else {
            console.error('[Layout] User doc not found');
            setUserRole(null);
            localStorage.removeItem('customAllowedPages');
          }
        } catch (err) {
          console.error('[Layout] Firestore error:', err);
          setUserRole(null);
          localStorage.removeItem('customAllowedPages');
        }
      } else {
        setUserRole(null);
        // Owner accessing own dashboard - clear any custom pages
        localStorage.removeItem('customAllowedPages');
      }
    }

    fetchEmployeeRole();
  }, [employeeOfOwnerId, user]);

  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Track if we've given auth time to settle
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    // Wait for loading to complete
    if (isUserLoading) {
      return;
    }

    // Simple check - just mark as ready, no redirect
    const timer = setTimeout(() => {
      setAuthChecked(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [isUserLoading]);

  useEffect(() => {
    console.log('[Layout] 🔄 useEffect triggered', { authChecked, hasUser: !!user, isUserLoading });

    // Only redirect after auth has been properly checked
    if (!authChecked) {
      console.log('[Layout] ⏸️ Auth not checked yet, waiting...');
      return;
    }

    if (!isUserLoading && !user) {
      const nextPath = pathname || '/owner-dashboard';
      router.replace(`/?redirect=${encodeURIComponent(nextPath)}`);
      return;
    }

    // Log impersonation when detected
    if (user && impersonatedOwnerId) {
      user.getIdToken().then(idToken => {
        fetch('/api/admin/log-impersonation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            targetUserId: impersonatedOwnerId,
            targetUserEmail: user.email,
            targetUserRole: 'Owner',
            action: 'start_impersonation_owner'
          })
        }).catch(err => console.error('Failed to log impersonation:', err));
      });
    }

    const fetchRestaurantData = async () => {
      console.log('[Layout] 🚀 fetchRestaurantData started');
      try {
        const idToken = await user.getIdToken();
        console.log('[Layout] ✅ Got ID token');

        let statusUrl = '/api/owner/status';
        let settingsUrl = '/api/owner/settings';

        // Use correct param based on context
        if (impersonatedOwnerId) {
          statusUrl += `?impersonate_owner_id=${impersonatedOwnerId}`;
          settingsUrl += `?impersonate_owner_id=${impersonatedOwnerId}`;
          console.log('[Layout] 🔄 Using impersonation for owner:', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
          statusUrl += `?employee_of=${employeeOfOwnerId}`;
          settingsUrl += `?employee_of=${employeeOfOwnerId}`;
          console.log('[Layout] 👤 Using employee access for owner:', employeeOfOwnerId);
        } else {
          console.log('[Layout] 👑 Owner accessing own dashboard');
        }

        console.log('[Layout] 📡 Fetching from:', { statusUrl, settingsUrl });

        const [statusRes, settingsRes] = await Promise.all([
          fetch(statusUrl, { headers: { 'Authorization': `Bearer ${idToken}` } }),
          fetch(settingsUrl, { headers: { 'Authorization': `Bearer ${idToken}` } })
        ]);

        console.log('[Layout] 📊 API Response Status:', {
          status: statusRes.status,
          settings: settingsRes.status
        });

        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          console.log('[Layout] ✅ Settings loaded:', {
            restaurantName: settingsData.restaurantName,
            hasLogo: !!settingsData.logoUrl
          });
          if (settingsData.businessType) {
            const normalizedBusinessType = settingsData.businessType === 'street_vendor'
              ? 'street-vendor'
              : (settingsData.businessType === 'shop' ? 'store' : settingsData.businessType);
            localStorage.setItem('businessType', normalizedBusinessType);
          }
          setRestaurantName(settingsData.restaurantName || 'My Dashboard');
          setRestaurantLogo(settingsData.logoUrl || null);
        } else {
          console.warn('[Layout] ⚠️ Settings API failed:', settingsRes.status);
        }

        if (statusRes.ok) {
          const statusData = await statusRes.json();
          console.log('[Layout] ✅ Status loaded:', {
            status: statusData.status,
            restrictedFeatures: statusData.restrictedFeatures?.length || 0
          });
          setRestaurantStatus({
            status: statusData.status,
            restrictedFeatures: statusData.restrictedFeatures || [],
            suspensionRemark: statusData.suspensionRemark || '',
          });
        } else if (statusRes.status === 404) {
          console.log('[Layout] ⚠️ Status 404 - Setting to pending');
          setRestaurantStatus({ status: 'pending', restrictedFeatures: [], suspensionRemark: '' });
        } else if (statusRes.status === 403) {
          // Unauthorized access - redirect to select-role for employees or homepage
          console.error("[Layout] ❌ User not authorized (403), redirecting to select-role...");
          router.push('/select-role');
          return;
        } else {
          const errorData = await statusRes.json();
          console.error("[Layout] ❌ Error fetching status:", errorData.message);
          setRestaurantStatus({ status: 'error', restrictedFeatures: [], suspensionRemark: '' });
        }

      } catch (e) {
        console.error("[DEBUG] OwnerLayout: CRITICAL error fetching owner data:", e);
        setRestaurantStatus({ status: 'error', restrictedFeatures: [], suspensionRemark: '' });
      }
    }

    // Fetch user role (check if user is an employee)
    const fetchUserRole = async () => {
      // If accessing via employee_of, use role from localStorage (set by select-role page)
      if (employeeOfOwnerId) {
        const storedRole = localStorage.getItem('employeeRole');
        if (storedRole) {
          setUserRole(storedRole);
          return;
        }
      }

      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/employee/me', {
          headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.role && data.role !== 'owner') {
            setUserRole(data.role);
          }
        }
      } catch (err) {
        // User is not an employee, use default (owner) access
        console.log('User role check:', err.message);
      }
    };

    if (user) {
      console.log('[Layout] ✅ Calling fetch functions...');
      fetchRestaurantData();
      fetchUserRole();
    }

  }, [user, isUserLoading, authChecked, effectiveOwnerId, router, pathname, employeeOfOwnerId, impersonatedOwnerId]);

  if ((isUserLoading || !authChecked) && !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <GoldenCoinSpinner />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <GoldenCoinSpinner />
      </div>
    );
  }

  const renderStatusScreen = () => {
    const featureId = pathname.split('/').pop();

    if (restaurantStatus.status === 'approved') {
      return null;
    }

    if (restaurantStatus.status === 'suspended') {
      if (restaurantStatus.restrictedFeatures.includes(featureId)) {
        return <FeatureLockScreen remark={restaurantStatus.suspensionRemark} featureId={featureId} />;
      }
      return null;
    }

    if (restaurantStatus.status === 'error') {
      return (
        <main className={styles.mainContent} style={{ padding: '1rem' }}>
          <div className="flex flex-col items-center justify-center text-center h-full p-8 bg-card border border-border rounded-xl">
            <AlertTriangle className="h-16 w-16 text-red-500" />
            <h2 className="mt-6 text-2xl font-bold">Could Not Verify Status</h2>
            <p className="mt-2 max-w-md text-muted-foreground">We couldn&apos;t verify your outlet&apos;s status. This could be a temporary issue. Please refresh or contact support.</p>
            <div className="mt-6 flex gap-4">
              <Button onClick={() => window.location.reload()} variant="default">Refresh</Button>
              <Button variant="default" onClick={() => router.push('/contact')}>Contact Support</Button>
            </div>
          </div>
        </main>
      );
    }

    const alwaysEnabled = ['menu', 'settings', 'connections', 'payout-settings', 'dine-in', 'bookings', 'whatsapp-direct', 'location'];
    const isDisabled = !alwaysEnabled.includes(featureId);

    if ((restaurantStatus.status === 'pending' || restaurantStatus.status === 'rejected') && isDisabled) {
      return (
        <main className={styles.mainContent} style={{ padding: '1rem' }}>
          <div className="flex flex-col items-center justify-center text-center h-full p-8 bg-card border border-border rounded-xl">
            <HardHat className="h-16 w-16 text-yellow-400" />
            <h2 className="mt-6 text-2xl font-bold">Account {restaurantStatus.status.charAt(0).toUpperCase() + restaurantStatus.status.slice(1)}</h2>
            <p className="mt-2 max-w-md text-muted-foreground">
              Your account is currently {restaurantStatus.status}. Full access will be granted upon approval. You can still set up your menu and settings.
            </p>
            <div className="mt-6 flex gap-4">
              <Button onClick={() => router.push('/owner-dashboard/menu')}>
                <Salad className="mr-2 h-4 w-4" /> Go to Menu
              </Button>
              <Button variant="outline" onClick={() => router.push('/contact')}>Contact Support</Button>
            </div>
          </div>
        </main>
      )
    }

    return null;
  }

  const blockedContent = renderStatusScreen();
  const isCollapsed = !isSidebarOpen && !isMobile;

  return (
    <>
      <ImpersonationBanner vendorName={restaurantName} />
      <div className="flex h-screen bg-background text-foreground">
        <motion.aside
          key={isMobile ? "mobile" : "desktop"}
          className="fixed md:relative h-full z-50 bg-card border-r border-border flex flex-col"
          animate={isMobile ? (isSidebarOpen ? { x: 0 } : { x: '-100%' }) : { width: isCollapsed ? '80px' : '260px' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          initial={false}
        >
          <Sidebar
            isOpen={isSidebarOpen}
            setIsOpen={setSidebarOpen}
            isMobile={isMobile}
            isCollapsed={isCollapsed}
            restrictedFeatures={restaurantStatus.restrictedFeatures}
            status={restaurantStatus.status}
            userRole={userRole}
          />
        </motion.aside>

        {isMobile && isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setSidebarOpen(false)}
          />
        )}


        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="flex items-center justify-between h-[65px] px-4 md:px-6 bg-card border-b border-border shrink-0">
            <Navbar
              isSidebarOpen={isSidebarOpen}
              setSidebarOpen={setSidebarOpen}
              restaurantName={restaurantName}
              restaurantLogo={restaurantLogo}
              userRole={userRole}
            />
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            {blockedContent || children}
          </main>
        </div>
      </div>
    </>
  );
}


export default function OwnerDashboardRootLayout({ children }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorUpdater />
      <GlobalHapticHandler />
      <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><GoldenCoinSpinner /></div>}>
        <OwnerDashboardContent>{children}</OwnerDashboardContent>
      </Suspense>
    </ThemeProvider>
  );
}
