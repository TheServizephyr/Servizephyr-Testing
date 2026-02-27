
'use client';

import {
  LayoutDashboard,
  ClipboardList,
  Users,
  BarChart2,
  Settings,
  ChevronLeft,
  ChevronRight,
  Salad,
  Truck,
  Ticket,
  Lock,
  Bot,
  MessageSquare,
  Banknote,
  Package as PackageIcon,
  ConciergeBell,
  CalendarClock,
  MapPin,
  QrCode,
  UserCircle,
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, getDocs, collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import Image from 'next/image';
import Link from "next/link";
import { useSearchParams, usePathname } from 'next/navigation';
import { canAccessPage, ROLES } from '@/lib/permissions';
import { emitAppNotification } from '@/lib/appNotifications';

const normalizeBusinessType = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'store' || normalized === 'shop') return 'store';
  if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street-vendor';
  return 'restaurant';
};

const getMenuItems = (businessType, effectiveOwnerId, paramName = 'impersonate_owner_id') => {
  // Use the appropriate param name based on context (impersonate or employee access)
  const appendParam = (href) => effectiveOwnerId ? `${href}?${paramName}=${effectiveOwnerId}` : href;

  if (businessType === 'street-vendor') {
    return [
      { name: "Live Orders", icon: ClipboardList, href: appendParam("/street-vendor-dashboard"), featureId: "live-orders" },
      { name: "My Menu", icon: Salad, href: appendParam("/street-vendor-dashboard/menu"), featureId: "menu" },
      { name: "Team", icon: Users, href: appendParam("/street-vendor-dashboard/employees"), featureId: "employees" },
      { name: "Analytics", icon: BarChart2, href: appendParam("/street-vendor-dashboard/analytics"), featureId: "analytics" },
      { name: "My QR Code", icon: QrCode, href: appendParam("/street-vendor-dashboard/qr"), featureId: "qr" },
      { name: "Coupons", icon: Ticket, href: appendParam("/street-vendor-dashboard/coupons"), featureId: "coupons" },
    ];
  }
  // Default for restaurant/store
  const isStoreBusiness = businessType === 'store' || businessType === 'shop';
  const items = [
    { name: "Dashboard", icon: LayoutDashboard, href: appendParam("/owner-dashboard"), featureId: "dashboard" },
    { name: "Live Orders", icon: ClipboardList, href: appendParam("/owner-dashboard/live-orders"), featureId: "live-orders" },
    isStoreBusiness
      ? { name: "Items", icon: PackageIcon, href: appendParam("/owner-dashboard/menu"), featureId: "menu" }
      : { name: "Menu", icon: Salad, href: appendParam("/owner-dashboard/menu"), featureId: "menu" },
    // { name: "Bookings", icon: CalendarClock, href: appendParam("/owner-dashboard/bookings"), featureId: "bookings" },
    { name: "Team", icon: Users, href: appendParam("/owner-dashboard/employees"), featureId: "employees" },
    { name: "Customers", icon: Users, href: appendParam("/owner-dashboard/customers"), featureId: "customers" },
    { name: "WhatsApp Direct", icon: MessageSquare, href: appendParam("/owner-dashboard/whatsapp-direct"), featureId: "whatsapp-direct" },
    { name: "Analytics", icon: BarChart2, href: appendParam("/owner-dashboard/analytics"), featureId: "analytics" },
    { name: "Delivery", icon: Truck, href: appendParam("/owner-dashboard/delivery"), featureId: "delivery" },
    { name: "Coupons", icon: Ticket, href: appendParam("/owner-dashboard/coupons"), featureId: "coupons" },
  ];

  if (!isStoreBusiness) {
    items.splice(3, 0, { name: "Dine-In", icon: ConciergeBell, href: appendParam("/owner-dashboard/dine-in"), featureId: "dine-in" });
  }

  return items;
};

const getSettingsItems = (businessType, effectiveOwnerId, paramName = 'impersonate_owner_id') => {
  const appendParam = (href) => effectiveOwnerId ? `${href}?${paramName}=${effectiveOwnerId}` : href;

  if (businessType === 'street-vendor') {
    return [
      { name: "My Profile", icon: UserCircle, href: appendParam("/street-vendor-dashboard/my-profile"), featureId: "my-profile" },
      { name: "Profile", icon: Users, href: appendParam("/street-vendor-dashboard/profile"), featureId: "profile" },
      { name: "Payouts", icon: Banknote, href: appendParam("/street-vendor-dashboard/payout-settings"), featureId: "payouts" },
    ];
  }
  return [
    { name: "My Profile", icon: UserCircle, href: appendParam("/owner-dashboard/my-profile"), featureId: "my-profile" },
    { name: "Location", icon: MapPin, href: appendParam("/owner-dashboard/location"), featureId: "location" },
    { name: "Connections", icon: Bot, href: appendParam("/owner-dashboard/connections"), featureId: "connections" },
    // { name: "Payouts", icon: Banknote, href: appendParam("/owner-dashboard/payouts"), featureId: "payouts" },
    // { name: "Onboarding", icon: Banknote, href: appendParam("/owner-dashboard/payout-settings"), featureId: "payout-settings" },
    { name: "Settings", icon: Settings, href: appendParam("/owner-dashboard/settings"), featureId: "settings" },
  ];
};


export default function Sidebar({ isOpen, setIsOpen, isMobile, isCollapsed, restrictedFeatures = [], status, userRole = null }) {
  const [businessType, setBusinessType] = useState('restaurant');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
  const employeeOfOwnerId = searchParams.get('employee_of');

  // Use either impersonation or employee context for links
  const effectiveOwnerId = impersonatedOwnerId || employeeOfOwnerId;
  const paramName = employeeOfOwnerId ? 'employee_of' : 'impersonate_owner_id';

  useEffect(() => {
    const storedBusinessType = normalizeBusinessType(localStorage.getItem('businessType'));

    // If accessing someone else's data (impersonation or employee), infer business type from URL
    if (effectiveOwnerId) {
      if (pathname.includes('/street-vendor-dashboard')) {
        setBusinessType('street-vendor');
        return;
      } else if (pathname.includes('/shop-dashboard')) {
        setBusinessType('store');
        return;
      }

      // owner-dashboard can be restaurant or store, so prefer persisted value from settings/login
      if (storedBusinessType) {
        setBusinessType(storedBusinessType);
      } else {
        setBusinessType('restaurant');
      }
      return;
    }

    // Only use localStorage for owner's own dashboard (not employee access)
    if (!effectiveOwnerId) {
      if (storedBusinessType) {
        setBusinessType(storedBusinessType);
      }

      const fetchBusinessType = async () => {
        const user = auth.currentUser;
        if (user) {
          try {
            // Force token refresh to handle idle states/stale tokens
            await user.getIdToken(true);

            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
              const fetchedType = normalizeBusinessType(userDoc.data().businessType) || 'restaurant';
              if (fetchedType !== storedBusinessType) {
                setBusinessType(fetchedType);
                localStorage.setItem('businessType', fetchedType);
              }
            }
          } catch (error) {
            console.error("Error fetching business type from Firestore:", error);
            if (!storedBusinessType) setBusinessType('restaurant');
          }
        }
      };

      const unsubscribe = auth.onAuthStateChanged((user) => {
        if (user) {
          fetchBusinessType();
        }
      });

      return () => unsubscribe();
    }
  }, [effectiveOwnerId, pathname]);


  const getIsDisabled = (featureId) => {
    // 1. If suspended, explicitly check restricted features first
    if (status === 'suspended') {
      return restrictedFeatures.includes(featureId);
    }

    // 2. Only allow essential setup pages for pending/rejected accounts
    const alwaysEnabled = ['menu', 'settings', 'connections', 'payout-settings', 'location', 'profile', 'qr', 'coupons', 'employees', 'my-profile'];
    if (alwaysEnabled.includes(featureId)) {
      return false;
    }

    if (status === 'pending' || status === 'rejected') {
      return true;
    }

    return false;
  };

  const handleLinkClick = () => {
    if (isMobile) {
      setIsOpen(false);
    }
  };

  // Get all menu items with appropriate owner ID param (for impersonation or employee access)
  const allMenuItems = getMenuItems(businessType, effectiveOwnerId, paramName);
  const allSettingsItems = getSettingsItems(businessType, effectiveOwnerId, paramName);

  // Filter items based on user role
  // null = owner accessing their own dashboard
  // For street-vendor-dashboard, treat null as STREET_VENDOR role
  // IMPORTANT: If employee_of param exists but userRole is null, role is still loading - show nothing
  const isRolePending = employeeOfOwnerId && userRole === null;
  const effectiveRole = userRole || (pathname.includes('/street-vendor-dashboard') ? ROLES.STREET_VENDOR : ROLES.OWNER);

  // Get custom allowed pages from localStorage (set by layout when employee logs in)
  // Using state so sidebar re-renders when role changes
  const [customAllowedPages, setCustomAllowedPages] = useState(() => {
    // Read from localStorage on initial mount to prevent flash
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('customAllowedPages');
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  });

  useEffect(() => {
    // Re-read localStorage when userRole changes (layout stores pages before passing role)
    if (userRole === 'custom') {
      const stored = localStorage.getItem('customAllowedPages');
      if (stored) {
        try {
          setCustomAllowedPages(JSON.parse(stored));
        } catch (e) {
          console.error('[Sidebar] Failed to parse customAllowedPages:', e);
          setCustomAllowedPages(null);
        }
      }
    } else {
      setCustomAllowedPages(null);
    }
  }, [userRole]);

  // If role is still pending for employee, show empty menus to prevent flash
  const menuItems = isRolePending ? [] : allMenuItems.filter(item => canAccessPage(effectiveRole, item.featureId, customAllowedPages));
  const settingsItems = isRolePending ? [] : allSettingsItems.filter(item => canAccessPage(effectiveRole, item.featureId, customAllowedPages));


  // Fetch WhatsApp Unread Count
  const [whatsappUnreadCount, setWhatsappUnreadCount] = useState(0);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const hasBootstrappedPendingNotifRef = useRef(false);
  const prevPendingCountRef = useRef(0);
  const hasBootstrappedWaNotifRef = useRef(false);
  const prevWaUnreadCountRef = useRef(0);
  const isOnWhatsAppDirectPage = pathname?.includes('/owner-dashboard/whatsapp-direct');
  const isOnLiveOrdersPage =
    pathname?.includes('/owner-dashboard/live-orders') ||
    pathname?.includes('/street-vendor-dashboard');

  // Realtime Listener for WhatsApp Unread Count
  useEffect(() => {
    // Only fetch if user is owner or has access (and not impersonating for now to keep it simple/secure in client)
    if (!auth.currentUser) return;
    if (impersonatedOwnerId || employeeOfOwnerId) return; // Skip for now until we handle composite query permissions perfectly
    if (isOnWhatsAppDirectPage) return; // Page has its own realtime pipeline; avoid duplicate reads

    let unsubscribe = () => { };

    const setupListener = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        // 1. Resolve Business ID (Restaurant or Shop)
        // Try Restaurant first
        let businessId = null;
        let businessCollection = 'restaurants';

        const restaurantsQuery = query(
          collection(db, 'restaurants'),
          where('ownerId', '==', user.uid),
          limit(1)
        );
        const restaurantSnapshot = await getDocs(restaurantsQuery);

        if (!restaurantSnapshot.empty) {
          businessId = restaurantSnapshot.docs[0].id;
        } else {
          // Try Shop
          const shopsQuery = query(
            collection(db, 'shops'),
            where('ownerId', '==', user.uid),
            limit(1)
          );
          const shopSnapshot = await getDocs(shopsQuery);
          if (!shopSnapshot.empty) {
            businessId = shopSnapshot.docs[0].id;
            businessCollection = 'shops';
          }
        }

        if (!businessId) return;

        // 2. Listen to Conversations with unreadCount > 0
        const q = query(
          collection(db, businessCollection, businessId, 'conversations'),
          where('unreadCount', '>', 0)
        );

        unsubscribe = onSnapshot(q, (snapshot) => {
          // Notification/badge should only consider active direct-chat support threads.
          const totalUnread = snapshot.docs.reduce((acc, doc) => {
            const data = doc.data() || {};
            if (data.state !== 'direct_chat') return acc;
            return acc + (data.unreadCount || 0);
          }, 0);
          setWhatsappUnreadCount(totalUnread);
        }, (error) => {
          console.error("Error listening to whatsapp conversations:", error);
        });

      } catch (error) {
        console.error("Error setting up whatsapp listener:", error);
      }
    };

    setupListener();

    return () => unsubscribe();
  }, [impersonatedOwnerId, employeeOfOwnerId, isOnWhatsAppDirectPage]);

  // Fetch Pending Orders Count (Real-time)
  useEffect(() => {
    if (businessType === 'street-vendor') return;
    // Skip if impersonating (too complex to handle multiple listeners properly without context)
    // or if not owner
    if (impersonatedOwnerId || employeeOfOwnerId || !auth.currentUser) return;
    if (isOnLiveOrdersPage) return; // Live Orders page already has direct realtime; avoid duplicate listener

    let unsubscribe = () => { };

    const setupListener = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        // 1. Get Restaurant ID
        const restaurantsQuery = query(
          collection(db, 'restaurants'),
          where('ownerId', '==', user.uid),
          limit(1)
        );
        const restaurantSnapshot = await getDocs(restaurantsQuery);

        if (restaurantSnapshot.empty) return;
        const restaurantId = restaurantSnapshot.docs[0].id;

        // 2. Listen for Pending Orders
        const ordersQuery = query(
          collection(db, 'orders'),
          where('restaurantId', '==', restaurantId),
          where('status', '==', 'pending')
        );

        unsubscribe = onSnapshot(ordersQuery, (snapshot) => {
          const count = snapshot.size;
          setPendingOrdersCount(count);

          if (!hasBootstrappedPendingNotifRef.current) {
            hasBootstrappedPendingNotifRef.current = true;
            prevPendingCountRef.current = count;
            return;
          }

          if (count > prevPendingCountRef.current) {
            const delta = count - prevPendingCountRef.current;
            emitAppNotification({
              scope: 'owner',
              title: 'New Live Order',
              message: delta === 1
                ? '1 new order is waiting in Live Orders.'
                : `${delta} new orders are waiting in Live Orders.`,
              dedupeKey: `sidebar_pending_${count}`,
              alarmId: 'live_orders_pending',
              disableAutoStop: true,
              sound: '/notification-owner-manager.mp3',
              href: '/owner-dashboard/live-orders'
            });
          }
          if (count === 0 && prevPendingCountRef.current > 0) {
            emitAppNotification({
              scope: 'owner',
              action: 'stop_alarm',
              alarmId: 'live_orders_pending'
            });
          }
          prevPendingCountRef.current = count;
        }, (error) => {
          console.error("Error listening to pending orders:", error);
        });

      } catch (error) {
        console.error("Error setting up pending orders listener:", error);
      }
    };

    setupListener();

    return () => unsubscribe();
  }, [businessType, impersonatedOwnerId, employeeOfOwnerId, isOnLiveOrdersPage]);

  useEffect(() => {
    if (impersonatedOwnerId || employeeOfOwnerId) return;
    const unread = whatsappUnreadCount || 0;
    if (!hasBootstrappedWaNotifRef.current) {
      hasBootstrappedWaNotifRef.current = true;
      prevWaUnreadCountRef.current = unread;
      return;
    }

    if (unread > prevWaUnreadCountRef.current && !isOnWhatsAppDirectPage) {
      const delta = unread - prevWaUnreadCountRef.current;
      emitAppNotification({
        scope: 'owner',
        title: 'New WhatsApp Message',
        message: delta === 1 ? '1 new customer message received.' : `${delta} new customer messages received.`,
        dedupeKey: `sidebar_wa_${unread}`,
        sound: '/notification-whatsapp-message.mp3',
        href: '/owner-dashboard/whatsapp-direct'
      });
    }

    prevWaUnreadCountRef.current = unread;
  }, [whatsappUnreadCount, impersonatedOwnerId, employeeOfOwnerId, pathname, isOnWhatsAppDirectPage]);


  return (
    <>
      <div className={`flex items-center shrink-0 border-b border-border justify-between ${isCollapsed ? 'h-[65px] justify-center' : 'h-[65px] px-6'}`}>
        <Link href="/" passHref>
          <div className="flex items-center gap-2 cursor-pointer">
            <Image src="/logo.png" alt="Logo" width={isCollapsed ? 32 : 40} height={isCollapsed ? 32 : 40} />
            {!isCollapsed && <h1 className="text-xl font-bold text-primary">ServiZephyr</h1>}
          </div>
        </Link>
        <button className="hidden md:flex p-2 rounded-full hover:bg-muted" onClick={() => setIsOpen(prev => !prev)}>
          <ChevronLeft className={`transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <nav className={styles.sidebarNav}>
        <div className={styles.menuGroup}>
          <span className={`${styles.menuGroupTitle} ${isCollapsed ? styles.collapsedText : ''}`}>Menu</span>
          {menuItems.map((item) => (
            <div key={item.name} onClick={handleLinkClick}>
              <SidebarLink
                item={{
                  ...item,
                  badge: item.featureId === 'whatsapp-direct'
                    ? whatsappUnreadCount
                    : item.featureId === 'live-orders'
                      ? pendingOrdersCount
                      : 0
                }}
                isCollapsed={isCollapsed}
                isDisabled={getIsDisabled(item.featureId)}
                disabledIcon={Lock}
              />
            </div>
          ))}
        </div>
        <div className={styles.menuGroup}>
          <span className={`${styles.menuGroupTitle} ${isCollapsed ? styles.collapsedText : ''}`}>General</span>
          {settingsItems.map((item) => (
            <div key={item.name} onClick={handleLinkClick}>
              <SidebarLink
                item={item}
                isCollapsed={isCollapsed}
                isDisabled={getIsDisabled(item.featureId)}
                disabledIcon={Lock}
              />
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
