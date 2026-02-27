'use client';

import { motion } from 'framer-motion';
import {
    ArrowRight,
    RefreshCw,
    ShoppingBag,
    Loader2,
    QrCode,
    X,
    Sparkles,
    Wallet,
    UtensilsCrossed,
    Store,
    BarChart3,
    CalendarRange,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';
import { Html5QrcodeScanner } from 'html5-qrcode';

const CUSTOMER_DASH_CACHE_TTL_MS = 3 * 60 * 1000;

const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
    hidden: { y: 16, opacity: 0 },
    visible: { y: 0, opacity: 1 },
};

const StatCard = ({ title, value, isLoading, icon: Icon, hint }) => (
    <Card className="overflow-hidden border-border/70 bg-card/70 backdrop-blur-xl shadow-[0_22px_45px_-28px_rgba(2,6,23,0.9)]">
        <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                </span>
                {title}
            </CardTitle>
        </CardHeader>
        <CardContent>
            {isLoading ? (
                <div className="space-y-2">
                    <div className="h-9 w-3/4 rounded-md bg-muted animate-pulse" />
                    <div className="h-3 w-1/2 rounded-md bg-muted animate-pulse" />
                </div>
            ) : (
                <>
                    <p className="text-3xl font-bold text-foreground">{value}</p>
                    {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
                </>
            )}
        </CardContent>
    </Card>
);

function CustomerHubContent() {
    const { user, isUserLoading } = useUser();
    const [hubData, setHubData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isNavigating, setIsNavigating] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [showScanner, setShowScanner] = useState(false);
    const scannerRef = useRef(null);
    const router = useRouter();

    const handleNavigation = useCallback(async (restaurantId) => {
        if (!user) {
            setInfoDialog({ isOpen: true, title: 'Authentication Error', message: 'Please log in again to continue.' });
            return;
        }
        setIsNavigating(true);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/auth/generate-session-token', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to create a secure session.');

            const { ref, phone, token } = data;
            const identityParam = ref
                ? `ref=${encodeURIComponent(ref)}`
                : (phone ? `phone=${encodeURIComponent(phone)}` : null);

            if (!identityParam || !token) {
                throw new Error('Session identity could not be generated.');
            }

            router.push(`/order/${restaurantId}?${identityParam}&token=${encodeURIComponent(token)}`);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Navigation Error', message: error.message });
            setIsNavigating(false);
        }
    }, [user, router]);

    const onScanFailure = useCallback(() => {
        // frame-level scan errors ignored intentionally
    }, []);

    const onScanSuccess = useCallback(async (decodedText) => {
        if (scannerRef.current) {
            scannerRef.current.clear();
            setShowScanner(false);
        }

        let vendorId = null;
        try {
            if (decodedText.includes('/order/')) {
                const parts = decodedText.split('/order/');
                if (parts.length > 1) {
                    vendorId = parts[1].split('?')[0];
                }
            } else {
                vendorId = decodedText;
            }

            if (vendorId) {
                await handleNavigation(vendorId);
            } else {
                setInfoDialog({ isOpen: true, title: 'Invalid QR', message: 'This QR code is not a valid ServiZephyr menu code.' });
            }
        } catch (err) {
            console.error('Error parsing QR:', err);
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not process the QR code.' });
        }
    }, [handleNavigation]);

    useEffect(() => {
        const fetchHubData = async () => {
            if (user) {
                try {
                    const cacheKey = `customer_hub_v1:${user.uid}`;
                    const cachedRaw = sessionStorage.getItem(cacheKey);
                    if (cachedRaw) {
                        const parsed = JSON.parse(cachedRaw);
                        if (parsed?.ts && (Date.now() - parsed.ts) < CUSTOMER_DASH_CACHE_TTL_MS && parsed?.payload) {
                            setHubData(parsed.payload);
                            setLoading(false);
                            return;
                        }
                    }

                    setLoading(true);
                    const idToken = await user.getIdToken();
                    const res = await fetch('/api/customer/hub-data', {
                        headers: { Authorization: `Bearer ${idToken}` },
                    });
                    if (!res.ok) throw new Error('Failed to fetch hub data');
                    const data = await res.json();
                    setHubData(data);
                    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload: data }));
                } catch (error) {
                    console.error('Error fetching hub data:', error);
                    setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load your hub data.' });
                } finally {
                    setLoading(false);
                }
            } else {
                setLoading(false);
            }
        };

        if (!isUserLoading) {
            fetchHubData();
        }
    }, [user, isUserLoading]);

    useEffect(() => {
        if (showScanner && !scannerRef.current) {
            const scanner = new Html5QrcodeScanner(
                'reader',
                { fps: 10, qrbox: { width: 250, height: 250 } },
                false
            );

            scanner.render(onScanSuccess, onScanFailure);
            scannerRef.current = scanner;
        }

        return () => {
            if (scannerRef.current) {
                scannerRef.current.clear().catch((error) => console.error('Failed to clear scanner', error));
                scannerRef.current = null;
            }
        };
    }, [showScanner, onScanSuccess, onScanFailure]);

    return (
        <>
            {isNavigating ? (
                <div className="fixed inset-0 bg-black/55 z-50 flex items-center justify-center">
                    <Loader2 className="animate-spin text-white h-12 w-12" />
                </div>
            ) : null}

            {showScanner ? (
                <div className="fixed inset-0 z-50 bg-black/90 p-4 flex items-center justify-center">
                    <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border/80 bg-background/95 shadow-2xl">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-3 top-3 z-10 rounded-full border border-border/70 bg-card/80"
                            onClick={() => setShowScanner(false)}
                        >
                            <X className="h-5 w-5" />
                        </Button>
                        <div className="p-5 text-center">
                            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                                <QrCode className="h-5 w-5" />
                            </div>
                            <h3 className="text-xl font-bold">Scan Menu QR</h3>
                            <p className="mt-1 text-sm text-muted-foreground">Point camera toward restaurant QR to open menu instantly.</p>
                            <div id="reader" className="mt-4 w-full rounded-xl overflow-hidden" />
                        </div>
                    </div>
                </div>
            ) : null}

            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-7 px-4 py-5 md:px-6 md:py-7"
            >
                <motion.header
                    variants={itemVariants}
                    className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/20 via-card/90 to-emerald-500/10 p-5 md:p-7"
                >
                    <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
                    <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                        <div>
                            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                                <Sparkles className="h-3.5 w-3.5" />
                                Welcome Back
                            </div>
                            <h1 className="font-[family-name:var(--font-customer-display)] text-3xl font-bold tracking-tight md:text-4xl">
                                My Hub
                            </h1>
                            <p className="mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
                                Track your food habits, jump to favorite restaurants, and scan any table/menu QR in one tap.
                            </p>
                        </div>

                        <Button
                            onClick={() => setShowScanner(true)}
                            className="h-11 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                            <QrCode className="mr-2 h-4 w-4" />
                            Scan QR
                        </Button>
                    </div>
                </motion.header>

                {(loading || hubData?.quickReorder) ? (
                    <motion.div variants={itemVariants}>
                        <Card className="overflow-hidden border-primary/25 bg-gradient-to-r from-primary/15 via-card/80 to-orange-500/10 backdrop-blur-xl">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-primary">
                                    <RefreshCw className="h-5 w-5" />
                                    Quick Re-Order
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {loading ? (
                                    <div className="space-y-3">
                                        <div className="h-6 w-3/4 rounded-md bg-muted animate-pulse" />
                                        <div className="h-10 w-48 rounded-md bg-muted animate-pulse" />
                                    </div>
                                ) : hubData?.quickReorder ? (
                                    <>
                                        <p className="text-base md:text-lg text-foreground">
                                            Re-order <span className="font-bold">{hubData.quickReorder.dishName}</span> from{' '}
                                            <span className="font-bold">{hubData.quickReorder.restaurantName}</span> in seconds.
                                        </p>
                                        <Button
                                            onClick={() => handleNavigation(hubData.quickReorder.restaurantId)}
                                            className="mt-4 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                                        >
                                            Re-order Now <ArrowRight className="ml-2 h-4 w-4" />
                                        </Button>
                                    </>
                                ) : null}
                            </CardContent>
                        </Card>
                    </motion.div>
                ) : null}

                {(loading || (hubData?.myRestaurants && hubData.myRestaurants.length > 0)) ? (
                    <motion.section variants={itemVariants}>
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="font-[family-name:var(--font-customer-display)] text-xl font-bold">My Restaurants</h2>
                            <p className="text-xs text-muted-foreground">Fast access</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                            {loading ? (
                                [...Array(5)].map((_, i) => (
                                    <div key={i} className="rounded-2xl border border-border/70 bg-card/60 p-4">
                                        <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                                        <div className="mt-3 h-4 w-3/4 rounded bg-muted animate-pulse" />
                                    </div>
                                ))
                            ) : (
                                hubData.myRestaurants.map((resto) => (
                                    <button
                                        onClick={() => handleNavigation(resto.id)}
                                        key={resto.id}
                                        className="group rounded-2xl border border-border/70 bg-card/60 p-4 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
                                    >
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                                            <Store className="h-4 w-4" />
                                        </div>
                                        <p className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-foreground group-hover:text-primary">
                                            {resto.name}
                                        </p>
                                    </button>
                                ))
                            )}
                        </div>
                    </motion.section>
                ) : null}

                <motion.section variants={itemVariants}>
                    <h2 className="mb-3 font-[family-name:var(--font-customer-display)] text-xl font-bold">My Stats</h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <StatCard
                            title="Monthly Savings"
                            value={`₹${hubData?.myStats?.totalSavings?.toFixed(2) || '0.00'}`}
                            isLoading={loading}
                            icon={Wallet}
                            hint="Coupons + loyalty benefits"
                        />
                        <StatCard
                            title="Top Restaurant"
                            value={hubData?.myStats?.topRestaurant || 'N/A'}
                            isLoading={loading}
                            icon={Store}
                            hint="Most ordered this month"
                        />
                        <StatCard
                            title="Top Dish"
                            value={hubData?.myStats?.topDish || 'N/A'}
                            isLoading={loading}
                            icon={UtensilsCrossed}
                            hint="Your current favorite"
                        />
                    </div>
                </motion.section>

                {(loading || hubData?.analyticsPreview) ? (
                    <motion.section variants={itemVariants}>
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="font-[family-name:var(--font-customer-display)] text-xl font-bold">Spending Pulse</h2>
                            <Button
                                variant="outline"
                                className="rounded-xl border-primary/30 text-primary hover:bg-primary/10"
                                onClick={() => router.push('/customer-dashboard/analytics')}
                            >
                                <BarChart3 className="mr-2 h-4 w-4" />
                                Full Analytics
                            </Button>
                        </div>

                        <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-card/80 via-primary/5 to-emerald-500/10 backdrop-blur-xl">
                            <CardContent className="p-5">
                                {loading ? (
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        {[...Array(4)].map((_, i) => (
                                            <div key={i} className="rounded-xl border border-border/70 bg-background/50 p-3">
                                                <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                                                <div className="mt-2 h-6 w-1/2 rounded bg-muted animate-pulse" />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                            <PulseMetric label="This Week" value={`₹${(hubData?.analyticsPreview?.spendThisWeek || 0).toFixed(2)}`} />
                                            <PulseMetric label="This Month" value={`₹${(hubData?.analyticsPreview?.spendThisMonth || 0).toFixed(2)}`} />
                                            <PulseMetric label="This Year" value={`₹${(hubData?.analyticsPreview?.spendThisYear || 0).toFixed(2)}`} />
                                            <PulseMetric label="All Time" value={`₹${(hubData?.analyticsPreview?.totalSpendAllTime || 0).toFixed(2)}`} />
                                        </div>
                                        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/50 px-3 py-1">
                                                <CalendarRange className="h-3.5 w-3.5 text-primary" />
                                                {hubData?.analyticsPreview?.totalOrdersAllTime || 0} total orders
                                            </span>
                                            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/50 px-3 py-1">
                                                <Store className="h-3.5 w-3.5 text-primary" />
                                                {hubData?.analyticsPreview?.activeRestaurants || 0} restaurants explored
                                            </span>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </motion.section>
                ) : null}

                {!loading && !hubData?.quickReorder ? (
                    <motion.div
                        variants={itemVariants}
                        className="rounded-3xl border border-dashed border-border/80 bg-card/40 px-6 py-16 text-center text-muted-foreground"
                    >
                        <ShoppingBag className="mx-auto h-12 w-12 text-primary/70" />
                        <p className="mt-4 text-lg font-semibold text-foreground">Your Hub is waiting for first order data</p>
                        <p className="mt-1 text-sm">Once you place an order, this area will show savings, top dishes, and one-tap shortcuts.</p>
                    </motion.div>
                ) : null}
            </motion.div>
        </>
    );
}

const PulseMetric = ({ label, value }) => (
    <div className="rounded-xl border border-border/70 bg-background/55 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
);

export default function CustomerHubPage() {
    return (
        <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <CustomerHubContent />
        </Suspense>
    );
}
