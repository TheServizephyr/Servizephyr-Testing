
'use client';

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { User, Sun, Moon, Menu, UserCheck, ShieldCheck, Clock3 } from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import { useTheme } from "next-themes";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import InfoDialog from "@/components/InfoDialog";
import SystemStatusDialog from "@/components/SystemStatusDialog";
import { getEffectiveBusinessOpenStatus } from '@/lib/businessSchedule';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUser } from '@/firebase';
import AppNotificationCenter from '@/components/AppNotificationCenter';


const MotionDiv = motion.div;

export default function Navbar({ isSidebarOpen, setSidebarOpen, restaurantName, restaurantLogo, userRole }) {
  const [restaurantStatus, setRestaurantStatus] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [isMobileView, setIsMobileView] = useState(false);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [autoScheduleEnabled, setAutoScheduleEnabled] = useState(false);
  const [openingTime, setOpeningTime] = useState('09:00');
  const [closingTime, setClosingTime] = useState('22:00');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
  const [isSystemStatusOpen, setSystemStatusOpen] = useState(false);
  const { user } = useUser();

  const normalizeTime = (value, fallback) => {
    const timeValue = String(value || '').trim();
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeValue) ? timeValue : fallback;
  };

  const fetchOwnerSettings = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch('/api/owner/settings', { headers: { 'Authorization': `Bearer ${idToken}` } });
      if (res.ok) {
        const data = await res.json();
        setRestaurantStatus(data.isOpen !== false);
        setAutoScheduleEnabled(data.autoScheduleEnabled === true);
        setOpeningTime(normalizeTime(data.openingTime, '09:00'));
        setClosingTime(normalizeTime(data.closingTime, '22:00'));
      }
    } catch (error) {
      console.error("Failed to fetch owner settings:", error);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchOwnerSettings();
  }, [fetchOwnerSettings]);

  // Real-time UI evaluation for Auto-Schedule (updates toggle without refreshing page)
  useEffect(() => {
    if (!autoScheduleEnabled) return;

    // Evaluate immediately when enabled/changed
    const evaluatedStatus = getEffectiveBusinessOpenStatus({
      autoScheduleEnabled,
      openingTime,
      closingTime,
      isOpen: restaurantStatus
    });
    if (evaluatedStatus !== restaurantStatus) {
      setRestaurantStatus(evaluatedStatus);
    }

    const interval = setInterval(() => {
      const isNowOpen = getEffectiveBusinessOpenStatus({
        autoScheduleEnabled,
        openingTime,
        closingTime,
        isOpen: restaurantStatus
      });
      if (isNowOpen !== restaurantStatus) {
        setRestaurantStatus(isNowOpen);
      }
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [autoScheduleEnabled, openingTime, closingTime, restaurantStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 767.98px)');
    const applyView = (event) => setIsMobileView(event.matches);
    setIsMobileView(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', applyView);
      return () => mediaQuery.removeEventListener('change', applyView);
    }
    mediaQuery.addListener(applyView);
    return () => mediaQuery.removeListener(applyView);
  }, []);

  const handleLogout = async () => {
    try {
      // 🔒 CRITICAL: Clear ALL storage to prevent cross-account leakage
      localStorage.clear();
      sessionStorage.clear();

      // Sign out from Firebase
      await auth.signOut();

      // 🔥 CRITICAL: Redirect to clean URL (no query params)
      // This prevents old ?employee_of=X params from persisting
      window.location.href = '/';
    } catch (error) {
      console.error("Logout failed:", error);
      setInfoDialog({ isOpen: true, title: "Error", message: "Could not log out. Please try again." });
    }
  };

  // ... (rest of the functions remain the same) ...

  const handleStatusToggle = async (newStatus) => {
    setLoadingStatus(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Not authenticated");
      const idToken = await currentUser.getIdToken();

      const payload = { isOpen: newStatus };
      let overridingSchedule = false;

      // If they manually toggle while auto-schedule is ON, we must disable auto-schedule
      if (autoScheduleEnabled) {
        payload.autoScheduleEnabled = false;
        overridingSchedule = true;
      }

      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Failed to update status");

      setRestaurantStatus(newStatus);
      if (overridingSchedule) {
        setAutoScheduleEnabled(false);
        setInfoDialog({ isOpen: true, title: "Schedule Disabled", message: `Auto-schedule has been turned OFF because you manually set the status to ${newStatus ? 'Open' : 'Closed'}.` });
      }
    } catch (error) {
      setInfoDialog({ isOpen: true, title: "Error", message: `Error updating status: ${error.message}` });
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Not authenticated");
      const idToken = await currentUser.getIdToken();

      const payload = {
        autoScheduleEnabled,
        openingTime: normalizeTime(openingTime, '09:00'),
        closingTime: normalizeTime(closingTime, '22:00')
      };

      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to save schedule");
      }

      setInfoDialog({ isOpen: true, title: "Saved", message: "Schedule updated successfully." });
      setShowScheduleEditor(false);
      fetchOwnerSettings();
    } catch (error) {
      setInfoDialog({ isOpen: true, title: "Error", message: `Could not save schedule: ${error.message}` });
    } finally {
      setSavingSchedule(false);
    }
  };

  return (
    <>
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />

      <SystemStatusDialog
        isOpen={isSystemStatusOpen}
        onClose={() => setSystemStatusOpen(false)}
      />

      <div className="flex items-center justify-between w-full gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* ... (existing logo code) ... */}
          <button
            className={`${styles.iconButton} md:hidden`}
            onClick={() => setSidebarOpen(!isSidebarOpen)}
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            {restaurantLogo && (
              <div className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-border flex-shrink-0">
                <Image src={restaurantLogo} alt="Restaurant Logo" layout="fill" objectFit="cover" />
              </div>
            )}
            <h2 className="text-lg md:text-2xl font-bold text-foreground tracking-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-[92px] sm:max-w-[180px] md:max-w-none">
              {restaurantName}
            </h2>
          </div>
          {/* Role Badge - Owner or Employee */}
          <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full ${userRole ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
            <UserCheck className={`h-4 w-4 ${userRole ? 'text-blue-500' : 'text-amber-500'}`} />
            <span className={`hidden md:inline text-xs md:text-sm font-semibold capitalize ${userRole ? 'text-blue-500' : 'text-amber-500'}`}>
              {userRole || 'Owner'}
            </span>
          </div>
        </div>

        <div className={`${styles.navActions} shrink-0`}>
          <AppNotificationCenter scope="owner" />

          <button
            onClick={() => setSystemStatusOpen(true)}
            className={`${styles.iconButton} hidden md:flex`}
            title="Check System Permissions"
          >
            <ShieldCheck size={22} className="text-primary hover:text-primary/80 transition-colors" />
          </button>

          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={`${styles.iconButton} hidden md:flex`}
          >
            <AnimatePresence mode="wait">
              <MotionDiv
                key={theme} // ...
                initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                transition={{ duration: 0.2 }}
              >
                {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
              </MotionDiv>
            </AnimatePresence>
          </button>

          <DropdownMenu onOpenChange={(open) => {
            if (open) {
              fetchOwnerSettings();
            }
          }}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar>
                  <AvatarImage src={user?.photoURL} alt={user?.displayName || 'User'} />
                  <AvatarFallback>{user?.displayName?.charAt(0) || 'U'}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="end">
              <DropdownMenuLabel>
                <p className="font-semibold">{user?.displayName}</p>
                <p className="text-xs text-muted-foreground font-normal">{user?.email}</p>
                <p className="text-[11px] text-muted-foreground font-medium mt-1 md:hidden">
                  Role: {userRole || 'Owner'}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="p-2">
                <Label htmlFor="restaurant-status-header" className="flex items-center justify-between cursor-pointer">
                  <div className="flex flex-col">
                    <span className="font-semibold">Restaurant Status</span>
                    <span className={cn("text-xs", restaurantStatus ? 'text-green-500' : 'text-red-500')}>
                      {restaurantStatus ? 'Open for orders' : 'Closed'}
                    </span>
                  </div>
                  <Switch
                    id="restaurant-status-header"
                    checked={restaurantStatus}
                    onCheckedChange={handleStatusToggle}
                    disabled={loadingStatus}
                    aria-label="Toggle restaurant open/closed status"
                  />
                </Label>

                <button
                  type="button"
                  className="mt-2 text-xs text-primary font-semibold hover:underline inline-flex items-center gap-1"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowScheduleEditor((prev) => !prev);
                  }}
                >
                  <Clock3 className="h-3.5 w-3.5" />
                  Make a Schedule
                </button>

                {showScheduleEditor && (
                  <div className="mt-3 p-3 rounded-md border border-border bg-muted/40 space-y-3">
                    <Label htmlFor="auto-schedule-header" className="flex items-center justify-between cursor-pointer">
                      <span className="text-xs font-medium">Enable Auto Schedule</span>
                      <Switch
                        id="auto-schedule-header"
                        checked={autoScheduleEnabled}
                        onCheckedChange={setAutoScheduleEnabled}
                        disabled={savingSchedule}
                        aria-label="Toggle auto schedule"
                      />
                    </Label>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground font-medium">Opening</span>
                        <input
                          type="time"
                          value={openingTime}
                          onChange={(e) => setOpeningTime(e.target.value)}
                          className="h-8 rounded border border-input bg-background px-2 text-xs"
                          disabled={savingSchedule}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground font-medium">Closing</span>
                        <input
                          type="time"
                          value={closingTime}
                          onChange={(e) => setClosingTime(e.target.value)}
                          className="h-8 rounded border border-input bg-background px-2 text-xs"
                          disabled={savingSchedule}
                        />
                      </div>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      className="w-full h-8 text-xs font-semibold"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSaveSchedule();
                      }}
                      disabled={savingSchedule}
                    >
                      {savingSchedule ? 'Saving...' : 'Save Schedule'}
                    </Button>
                  </div>
                )}
              </div>
              <DropdownMenuSeparator />
              <div className="md:hidden">
                {isMobileView && (
                  <>
                    <div className="px-2 py-1">
                      <p className="text-[11px] text-muted-foreground font-medium mb-2">Notifications</p>
                      {/* Notifications are now in the main navbar for all devices */}
                    </div>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => setSystemStatusOpen(true)} className="cursor-pointer">
                  <ShieldCheck className="mr-2 h-4 w-4 text-primary" /> System Permissions
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="cursor-pointer">
                  {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                  Toggle Theme
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </div>
              <DropdownMenuItem onClick={() => router.push('/owner-dashboard/settings')} className="cursor-pointer">
                <User className="mr-2 h-4 w-4" /> Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-500 font-semibold cursor-pointer">
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div >
    </>
  );
}
