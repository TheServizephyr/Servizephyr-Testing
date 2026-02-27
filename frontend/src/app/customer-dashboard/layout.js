'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Home, Map, MessageSquare, User, Sun, Moon, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Suspense, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { ThemeProvider } from '@/components/ThemeProvider';
import ThemeColorUpdater from '@/components/ThemeColorUpdater';
import GlobalHapticHandler from '@/components/GlobalHapticHandler';
import Image from 'next/image';
import { useUser } from '@/firebase';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import ImpersonationBanner from '@/components/ImpersonationBanner';
import { Sora, Space_Grotesk } from 'next/font/google';

const navItems = [
  { href: '/customer-dashboard', icon: Home, label: 'My Hub' },
  { href: '/customer-dashboard/discover', icon: Map, label: 'Discover' },
  { href: '/customer-dashboard/community', icon: MessageSquare, label: 'Community' },
  { href: '/customer-dashboard/profile', icon: User, label: 'Profile' },
];

const displayFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-customer-display',
  weight: ['500', '600', '700'],
});

const bodyFont = Sora({
  subsets: ['latin'],
  variable: '--font-customer-body',
  weight: ['400', '500', '600'],
});

const NavLink = ({ href, icon: Icon, label }) => {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== '/customer-dashboard' && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={cn(
        'group relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl px-3 py-2 transition-all duration-200',
        isActive
          ? 'bg-primary/15 text-primary shadow-[0_12px_30px_-20px_rgba(234,179,8,0.95)]'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      )}
    >
      <Icon className={cn('h-5 w-5 transition-transform duration-200 group-hover:scale-105', isActive && 'scale-110')} />
      <span className={cn('text-[11px] font-semibold tracking-wide', isActive && 'text-primary')}>{label}</span>
      <span
        className={cn(
          'absolute bottom-1 h-1 w-6 rounded-full bg-primary transition-opacity',
          isActive ? 'opacity-100' : 'opacity-0'
        )}
      />
    </Link>
  );
};

const CustomerDashboardContent = ({ children }) => {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isUserLoading } = useUser();

  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (isUserLoading) return;

    const timer = setTimeout(() => {
      setAuthChecked(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [isUserLoading]);

  useEffect(() => {
    if (!authChecked) return;

    if (!user) {
      console.log('[Customer Layout] No user after auth check, redirecting');
      router.push('/');
    }
  }, [user, authChecked, router]);

  useEffect(() => {
    const impersonateUserId = searchParams.get('impersonate_user_id');
    if (user && impersonateUserId) {
      user.getIdToken().then((idToken) => {
        fetch('/api/admin/log-impersonation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            targetUserId: impersonateUserId,
            targetUserEmail: user.email,
            targetUserRole: 'Customer',
            action: 'start_impersonation_customer',
          }),
        }).catch((err) => console.error('Failed to log impersonation:', err));
      });
    }
  }, [user, searchParams]);

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
      <ImpersonationBanner vendorName={user?.displayName || user?.email || 'Customer'} />
      <div className={cn(displayFont.variable, bodyFont.variable, 'relative min-h-screen overflow-x-hidden bg-background text-foreground')}>
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-20 left-[-12rem] h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute top-[30%] right-[-10rem] h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="absolute bottom-[-10rem] left-1/3 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_48%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.04),transparent_50%)]" />
        </div>

        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/70 backdrop-blur-2xl">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="group flex items-center justify-center rounded-xl border border-border/50 bg-card/70 px-3 py-2 shadow-sm transition-colors hover:border-primary/40">
              <Image src="/logo.png" alt="ServiZephyr Logo" width={152} height={40} className="h-8 w-auto md:h-9" priority />
            </Link>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary md:flex">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Premium Customer Mode</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="relative rounded-full border border-border/70 bg-card/70 hover:bg-muted/70"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                <Sun className="h-[1.1rem] w-[1.1rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-[1.1rem] w-[1.1rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 pb-32 md:pb-36">
          <Suspense fallback={<div className="min-h-[80vh] flex items-center justify-center"><GoldenCoinSpinner /></div>}>
            {children}
          </Suspense>
        </main>

        <footer className="fixed bottom-3 left-1/2 z-50 w-[min(96%,760px)] -translate-x-1/2">
          <div className="rounded-[1.6rem] border border-border/60 bg-background/80 p-2 shadow-[0_28px_70px_-40px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
            <div className="grid grid-cols-4 gap-1">
              {navItems.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          </div>
        </footer>
      </div>
    </>
  );
};

export default function CustomerDashboardLayout({ children }) {
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
        <CustomerDashboardContent>{children}</CustomerDashboardContent>
      </Suspense>
    </ThemeProvider>
  );
}
