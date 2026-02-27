
'use client';

import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Store,
  Users,
  BarChart2,
  Activity,
  Settings,
  MessageSquare,
  ChevronLeft,
  Menu,
  Bell,
  Sun,
  Moon,
  Mail, // Changed from MessageSquare
  List, // Import List for Waitlist
  FileText, // Import FileText for Audit Logs
  Hash, // Import Hash for Check IDs
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { ThemeProvider } from '@/components/ThemeProvider';
import ThemeColorUpdater from '@/components/ThemeColorUpdater';
import GlobalHapticHandler from '@/components/GlobalHapticHandler';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWindowSize } from 'react-use';
import { useUser } from '@/firebase';
import InfoDialog from '@/components/InfoDialog';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';


const SidebarLink = ({ href, icon: Icon, children, isCollapsed }) => {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link href={href} passHref>
      <div
        className={`flex items-center p-3 my-1 rounded-lg cursor-pointer transition-colors ${isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          } ${isCollapsed ? 'justify-center' : ''}`}
      >
        <Icon size={22} />
        {!isCollapsed && <span className="ml-4 font-medium">{children}</span>}
      </div>
    </Link>
  );
};

const useIsMobile = () => {
  const { width } = useWindowSize();
  const [isMobile, setIsMobile] = useState(true); // FIX: Default to true

  useEffect(() => {
    setIsMobile(width < 768);
  }, [width]);

  return isMobile;
};


function AdminLayoutContent({ children }) {
  const isMobile = useIsMobile();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

  const { user, isUserLoading } = useUser();

  // Track if auth has settled
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (isUserLoading) return;

    // Give auth time to settle (race condition fix)
    const timer = setTimeout(() => {
      setAuthChecked(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [isUserLoading]);

  useEffect(() => {
    if (!authChecked) return;

    if (!user) {
      console.log('[Admin Layout] No user after auth check, redirecting');
      router.push('/');
    }
  }, [user, authChecked, router]);

  useEffect(() => {
    if (!isMobile) {
      setSidebarOpen(true);
    } else {
      setSidebarOpen(false);
    }
  }, [isMobile]);


  const isCollapsed = !isSidebarOpen && !isMobile;

  const handleLogout = async () => {
    const { auth } = await import('@/lib/firebase'); // Import auth here
    try {
      await auth.signOut();
      localStorage.clear();
      router.push('/');
    } catch (error) {
      console.error("Logout failed:", error);
      setInfoDialog({ isOpen: true, title: "Logout Failed", message: "Could not log out. Please try again." });
    }
  };

  if (isUserLoading || !authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <GoldenCoinSpinner />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <>
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />
      <div className="flex h-screen bg-background text-foreground">
        {/* Sidebar */}
        <AnimatePresence>
          {(isSidebarOpen || !isMobile) && (
            <motion.aside
              key="sidebar"
              initial={isMobile ? { x: '-100%' } : { width: '260px' }}
              animate={isMobile ? (isSidebarOpen ? { x: 0 } : { x: '-100%' }) : { width: isCollapsed ? '80px' : '260px' }}
              exit={isMobile ? { x: '-100%' } : { width: '80px' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={`fixed md:relative h-full z-50 bg-card border-r border-border flex flex-col ${isMobile && !isSidebarOpen ? 'hidden' : ''
                }`}
            >
              <div
                className={`flex items-center shrink-0 border-b border-border justify-between ${isCollapsed ? 'h-[65px] justify-center' : 'h-[65px] px-6'
                  }`}
              >
                {!isCollapsed && <h1 className="text-xl font-bold text-primary">ServiZephyr</h1>}
                <Button variant="ghost" size="icon" className="hidden md:flex" onClick={() => setSidebarOpen(!isSidebarOpen)}>
                  <ChevronLeft className={`transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
                </Button>
              </div>
              <nav className="flex-grow p-4 space-y-2">
                <SidebarLink href="/admin-dashboard" icon={LayoutDashboard} isCollapsed={isCollapsed}>
                  Dashboard
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/restaurants" icon={Store} isCollapsed={isCollapsed}>
                  Listings
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/users" icon={Users} isCollapsed={isCollapsed}>
                  Users
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/check-ids" icon={Hash} isCollapsed={isCollapsed}>
                  Check IDs
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/waitlist" icon={List} isCollapsed={isCollapsed}>
                  Waitlist
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/analytics" icon={BarChart2} isCollapsed={isCollapsed}>
                  Analytics
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/ops-analytics" icon={Activity} isCollapsed={isCollapsed}>
                  Ops Analytics
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/audit-logs" icon={FileText} isCollapsed={isCollapsed}>
                  Audit Logs
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/mailbox" icon={Mail} isCollapsed={isCollapsed}>
                  Mailbox
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/whatsapp-direct" icon={MessageSquare} isCollapsed={isCollapsed}>
                  WhatsApp Direct
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/community" icon={MessageSquare} isCollapsed={isCollapsed}>
                  Community
                </SidebarLink>
                <SidebarLink href="/admin-dashboard/settings" icon={Settings} isCollapsed={isCollapsed}>
                  Settings
                </SidebarLink>
              </nav>
            </motion.aside>
          )}
        </AnimatePresence>
        {isMobile && isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setSidebarOpen(false)}
          />
        )}


        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Bar */}
          <header className="flex items-center justify-between h-16 px-4 md:px-6 bg-card border-b border-border shrink-0">
            <div className="flex items-center gap-2 md:gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu />
              </Button>
              <h2 className="text-md md:text-lg font-semibold">Admin Panel</h2>
            </div>
            <div className="flex items-center gap-2 md:gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
              <Button variant="ghost" size="icon">
                <Bell />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src="https://picsum.photos/seed/admin/100/100" alt="@admin" />
                      <AvatarFallback>AD</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">Admin</p>
                      <p className="text-xs leading-none text-muted-foreground">admin@servizephyr.com</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Profile</DropdownMenuItem>
                  <DropdownMenuItem>Settings</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>Log out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </>
  );
}

export default function AdminRootLayout({ children }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorUpdater />
      <GlobalHapticHandler />
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </ThemeProvider>
  )
}
