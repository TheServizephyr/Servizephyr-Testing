
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Calendar,
    CalendarDays,
    CalendarRange,
    Coins,
    ListOrdered,
    Loader2,
    RefreshCw,
    Sparkles,
    Store,
    Trophy,
    UtensilsCrossed,
    Wallet,
} from 'lucide-react';
import {
    endOfDay,
    endOfMonth,
    endOfWeek,
    endOfYear,
    format,
    isWithinInterval,
    parseISO,
    startOfDay,
    startOfMonth,
    startOfWeek,
    startOfYear,
    subDays,
} from 'date-fns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useUser } from '@/firebase';
import InfoDialog from '@/components/InfoDialog';

const ANALYTICS_CACHE_TTL_MS = 4 * 60 * 1000;

const PERIOD_OPTIONS = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'yearly', label: 'Yearly' },
    { key: 'custom', label: 'Custom Range' },
];

const formatCurrency = (value, decimals = 0) =>
    `₹${Number(value || 0).toLocaleString('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    })}`;

const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');

const toAmount = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const getPercent = (value, maxValue) => {
    if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
    return Math.max(0, Math.min(100, (value / maxValue) * 100));
};

const parseOrderDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    try {
        const parsed = parseISO(String(value));
        if (!Number.isNaN(parsed.getTime())) return parsed;
    } catch {
        // Ignore parse error and fallback to Date below.
    }
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const getPresetRange = (periodKey) => {
    const now = new Date();
    switch (periodKey) {
    case 'daily':
        return { from: startOfDay(now), to: endOfDay(now) };
    case 'weekly':
        return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'monthly':
        return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'yearly':
        return { from: startOfYear(now), to: endOfYear(now) };
    default:
        return null;
    }
};

const normalizeCustomRange = (range) => {
    if (!range?.from) return null;
    const from = startOfDay(range.from);
    const toSeed = range?.to || range?.from;
    const toCandidate = startOfDay(toSeed);
    const to = endOfDay(toCandidate < from ? from : toCandidate);
    return { from, to };
};

const toRangeLabel = (range) => {
    if (!range?.from || !range?.to) return 'Select date range';
    return `${format(range.from, 'dd MMM yyyy')} - ${format(range.to, 'dd MMM yyyy')}`;
};

const toPreviewItems = (items = []) => {
    if (!Array.isArray(items) || items.length === 0) return 'Item details not available';
    const preview = items.slice(0, 3).map((item) => {
        const qty = Math.max(1, toAmount(item?.quantity, 1));
        return `${qty}x ${item?.name || 'Item'}`;
    });
    const moreCount = items.length - preview.length;
    return `${preview.join(', ')}${moreCount > 0 ? ` +${moreCount} more` : ''}`;
};

const SectionCard = ({ title, subtitle, icon: Icon, children, rightSlot }) => (
    <section className="rounded-2xl border border-border/70 bg-card/65 p-5 shadow-[0_24px_48px_-36px_rgba(2,6,23,0.95)]">
        <div className="mb-4 flex items-start justify-between gap-3">
            <div>
                <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
                    {Icon ? <Icon className="h-5 w-5 text-primary" /> : null}
                    {title}
                </h2>
                {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
            {rightSlot || null}
        </div>
        {children}
    </section>
);

const MetricCard = ({ label, value, helper, icon: Icon }) => (
    <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
        <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            {Icon ? (
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                </span>
            ) : null}
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
        {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
    </div>
);

const RowBar = ({ label, valueText, percent, caption }) => (
    <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-sm">
            <p className="font-semibold text-foreground truncate">{label}</p>
            <p className="text-muted-foreground whitespace-nowrap">{valueText}</p>
        </div>
        <div className="h-2.5 rounded-full bg-muted/60 overflow-hidden">
            <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400 transition-all duration-500"
                style={{ width: `${percent}%` }}
            />
        </div>
        {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </div>
);

const EmptyState = ({ text }) => (
    <div className="rounded-xl border border-dashed border-border/70 bg-background/35 p-8 text-center text-sm text-muted-foreground">
        {text}
    </div>
);

export default function CustomerAnalyticsPage() {
    const { user, isUserLoading } = useUser();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [analytics, setAnalytics] = useState(null);
    const [activePeriod, setActivePeriod] = useState('monthly');
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
    const [customRange, setCustomRange] = useState({
        from: subDays(new Date(), 6),
        to: new Date(),
    });
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const fetchAnalytics = useCallback(async (forceRefresh = false) => {
        if (!user) return;

        try {
            if (forceRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const cacheKey = `customer_analytics_v2:${user.uid}`;
            if (!forceRefresh) {
                const cachedRaw = sessionStorage.getItem(cacheKey);
                if (cachedRaw) {
                    const parsed = JSON.parse(cachedRaw);
                    if (parsed?.ts && (Date.now() - parsed.ts) < ANALYTICS_CACHE_TTL_MS && parsed?.payload) {
                        setAnalytics(parsed.payload);
                        setLoading(false);
                        return;
                    }
                }
            } else {
                sessionStorage.removeItem(cacheKey);
            }

            const idToken = await user.getIdToken();
            const response = await fetch('/api/customer/analytics', {
                headers: { Authorization: `Bearer ${idToken}` },
                cache: 'no-store',
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to fetch customer analytics.');
            }

            setAnalytics(data);
            sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload: data }));
        } catch (error) {
            setInfoDialog({
                isOpen: true,
                title: 'Analytics Error',
                message: error.message || 'Unable to load customer analytics right now.',
            });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user]);

    useEffect(() => {
        if (isUserLoading) return;
        if (!user) {
            setLoading(false);
            return;
        }
        fetchAnalytics(false);
    }, [user, isUserLoading, fetchAnalytics]);

    const summary = analytics?.summary || {};
    const savings = analytics?.savings || {};
    const loyalty = analytics?.loyalty || {};

    const successfulOrders = useMemo(() => {
        const all = Array.isArray(analytics?.orderTimeline) ? analytics.orderTimeline : [];
        return all.filter((order) => !order?.isLost);
    }, [analytics?.orderTimeline]);

    const selectedRange = useMemo(() => {
        if (activePeriod === 'custom') return normalizeCustomRange(customRange);
        return getPresetRange(activePeriod);
    }, [activePeriod, customRange]);

    const selectedRangeLabel = useMemo(() => toRangeLabel(selectedRange), [selectedRange]);

    const filteredOrders = useMemo(() => {
        if (!selectedRange?.from || !selectedRange?.to) return [];
        return successfulOrders.filter((order) => {
            const orderDate = parseOrderDate(order?.orderDate);
            if (!orderDate) return false;
            return isWithinInterval(orderDate, { start: selectedRange.from, end: selectedRange.to });
        });
    }, [successfulOrders, selectedRange]);

    const rangeSummary = useMemo(() => {
        let spend = 0;
        let saved = 0;
        const activeDays = new Set();
        const restaurants = new Set();

        filteredOrders.forEach((order) => {
            spend += Math.max(0, toAmount(order?.amount, 0));
            saved += Math.max(0, toAmount(order?.savings, 0));
            restaurants.add(String(order?.restaurantId || 'unknown'));
            const date = parseOrderDate(order?.orderDate);
            if (date) activeDays.add(format(date, 'yyyy-MM-dd'));
        });

        const totalOrders = filteredOrders.length;
        return {
            totalSpend: Number(spend.toFixed(2)),
            totalOrders,
            avgOrderValue: Number((totalOrders > 0 ? spend / totalOrders : 0).toFixed(2)),
            totalSaved: Number(saved.toFixed(2)),
            activeDays: activeDays.size,
            uniqueRestaurants: restaurants.size,
        };
    }, [filteredOrders]);

    const topRestaurantsInRange = useMemo(() => {
        const restaurantMap = new Map();
        filteredOrders.forEach((order) => {
            const id = String(order?.restaurantId || 'unknown');
            const row = restaurantMap.get(id) || {
                restaurantId: id,
                restaurantName: String(order?.restaurantName || 'Unknown Restaurant'),
                spend: 0,
                orders: 0,
            };
            row.spend += Math.max(0, toAmount(order?.amount, 0));
            row.orders += 1;
            restaurantMap.set(id, row);
        });
        return Array.from(restaurantMap.values()).sort((a, b) => b.spend - a.spend).slice(0, 8);
    }, [filteredOrders]);

    const topDishesInRange = useMemo(() => {
        const dishMap = new Map();
        filteredOrders.forEach((order) => {
            const items = Array.isArray(order?.items) ? order.items : [];
            items.forEach((item) => {
                const name = String(item?.name || '').trim();
                if (!name) return;
                const row = dishMap.get(name) || { name, quantity: 0, spend: 0 };
                row.quantity += Math.max(1, toAmount(item?.quantity, 1));
                row.spend += Math.max(0, toAmount(item?.spend, 0));
                dishMap.set(name, row);
            });
        });
        return Array.from(dishMap.values())
            .sort((a, b) => (b.quantity !== a.quantity ? b.quantity - a.quantity : b.spend - a.spend))
            .slice(0, 8);
    }, [filteredOrders]);

    const orderJournal = useMemo(() => {
        const dayMap = new Map();
        filteredOrders.forEach((order) => {
            const date = parseOrderDate(order?.orderDate);
            if (!date) return;
            const key = format(date, 'yyyy-MM-dd');
            const row = dayMap.get(key) || {
                key,
                label: format(date, 'dd MMM yyyy, EEEE'),
                totalOrders: 0,
                totalSpend: 0,
                orders: [],
            };
            row.totalOrders += 1;
            row.totalSpend += Math.max(0, toAmount(order?.amount, 0));
            row.orders.push(order);
            dayMap.set(key, row);
        });

        return Array.from(dayMap.values())
            .sort((a, b) => b.key.localeCompare(a.key))
            .map((row) => ({
                ...row,
                totalSpend: Number(row.totalSpend.toFixed(2)),
                orders: row.orders.sort((a, b) => {
                    const at = parseOrderDate(a?.orderDate)?.getTime() || 0;
                    const bt = parseOrderDate(b?.orderDate)?.getTime() || 0;
                    return bt - at;
                }),
            }));
    }, [filteredOrders]);

    const maxRestaurantSpend = useMemo(() => {
        if (!topRestaurantsInRange.length) return 0;
        return Math.max(...topRestaurantsInRange.map((row) => Number(row.spend || 0)));
    }, [topRestaurantsInRange]);

    const maxDishQty = useMemo(() => {
        if (!topDishesInRange.length) return 0;
        return Math.max(...topDishesInRange.map((row) => Number(row.quantity || 0)));
    }, [topDishesInRange]);

    if (loading) {
        return (
            <div className="min-h-[70vh] flex items-center justify-center">
                <Loader2 className="h-11 w-11 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <>
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <div className="px-4 py-5 md:px-6 md:py-7 space-y-5">
                <motion.header
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card/80 to-indigo-500/10 p-5 md:p-6"
                >
                    <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
                    <div className="relative flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                                <Sparkles className="h-3.5 w-3.5" />
                                Personal Spending Intelligence
                            </div>
                            <h1 className="mt-3 font-[family-name:var(--font-customer-display)] text-3xl md:text-4xl font-bold tracking-tight">
                                My Analytics
                            </h1>
                            <p className="mt-2 max-w-2xl text-sm md:text-base text-muted-foreground">
                                Daily, monthly, yearly, and custom date-range analytics with date-wise order history.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            className="rounded-xl border-primary/30 text-primary hover:bg-primary/10"
                            onClick={() => fetchAnalytics(true)}
                            disabled={refreshing}
                        >
                            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Refresh
                        </Button>
                    </div>
                </motion.header>

                <SectionCard
                    title="Analytics View"
                    subtitle="Use buttons for daily/weekly/monthly/yearly or pick a custom date range."
                    icon={Calendar}
                    rightSlot={(
                        <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    onClick={() => setActivePeriod('custom')}
                                    className={cn(
                                        'rounded-xl border-border/70 text-sm',
                                        activePeriod === 'custom' && 'border-primary/30 text-primary'
                                    )}
                                >
                                    <CalendarDays className="mr-2 h-4 w-4" />
                                    {activePeriod === 'custom' ? selectedRangeLabel : 'Pick Custom Range'}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-auto p-0 border-border/70">
                                <CalendarPicker
                                    mode="range"
                                    selected={customRange}
                                    defaultMonth={customRange?.from}
                                    onSelect={(range) => {
                                        setCustomRange({ from: range?.from || null, to: range?.to || null });
                                        setActivePeriod('custom');
                                    }}
                                    numberOfMonths={1}
                                />
                            </PopoverContent>
                        </Popover>
                    )}
                >
                    <div className="flex flex-wrap gap-2">
                        {PERIOD_OPTIONS.map((option) => (
                            <Button
                                key={option.key}
                                variant={activePeriod === option.key ? 'default' : 'outline'}
                                onClick={() => setActivePeriod(option.key)}
                                className={cn(
                                    'rounded-xl',
                                    activePeriod === option.key
                                        ? 'bg-primary text-primary-foreground border-primary'
                                        : 'border-border/70 text-muted-foreground hover:text-foreground'
                                )}
                            >
                                {option.label}
                            </Button>
                        ))}
                    </div>
                    <div className="mt-4 rounded-xl border border-border/70 bg-background/45 p-3 text-sm">
                        <p className="text-muted-foreground">
                            <span className="font-semibold text-foreground">Selected Window:</span> {selectedRangeLabel}
                        </p>
                    </div>
                </SectionCard>

                <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <MetricCard
                        label="Selected Range Spend"
                        value={formatCurrency(rangeSummary.totalSpend)}
                        helper={`${formatNumber(rangeSummary.uniqueRestaurants)} restaurants`}
                        icon={Wallet}
                    />
                    <MetricCard
                        label="Selected Range Orders"
                        value={formatNumber(rangeSummary.totalOrders)}
                        helper={`${formatNumber(rangeSummary.activeDays)} active day(s)`}
                        icon={ListOrdered}
                    />
                    <MetricCard
                        label="Average Order Value"
                        value={formatCurrency(rangeSummary.avgOrderValue)}
                        helper="Based on selected range"
                        icon={Coins}
                    />
                    <MetricCard
                        label="Savings In Range"
                        value={formatCurrency(rangeSummary.totalSaved)}
                        helper="Discounts + loyalty savings"
                        icon={Trophy}
                    />
                </section>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <SectionCard title="Top Restaurants In Range" subtitle="Where you spent most in selected period" icon={Store}>
                        {topRestaurantsInRange.length === 0 ? (
                            <EmptyState text="No restaurant data found in selected range." />
                        ) : (
                            <div className="space-y-3">
                                {topRestaurantsInRange.map((row) => (
                                    <RowBar
                                        key={row.restaurantId}
                                        label={row.restaurantName}
                                        valueText={`${formatCurrency(row.spend)} • ${formatNumber(row.orders)} orders`}
                                        percent={getPercent(Number(row.spend || 0), maxRestaurantSpend)}
                                        caption={`Share: ${rangeSummary.totalSpend > 0 ? ((row.spend / rangeSummary.totalSpend) * 100).toFixed(1) : '0'}%`}
                                    />
                                ))}
                            </div>
                        )}
                    </SectionCard>

                    <SectionCard title="Top Dishes In Range" subtitle="Most repeated dishes in selected period" icon={UtensilsCrossed}>
                        {topDishesInRange.length === 0 ? (
                            <EmptyState text="No dish data found in selected range." />
                        ) : (
                            <div className="space-y-3">
                                {topDishesInRange.map((row) => (
                                    <RowBar
                                        key={row.name}
                                        label={row.name}
                                        valueText={`${formatNumber(row.quantity)} qty`}
                                        percent={getPercent(Number(row.quantity || 0), maxDishQty)}
                                        caption={`Spend: ${formatCurrency(row.spend)}`}
                                    />
                                ))}
                            </div>
                        )}
                    </SectionCard>
                </div>

                <SectionCard
                    title="Date-Wise Order Journal"
                    subtitle="Check exactly what you ordered on each day for the selected window."
                    icon={CalendarRange}
                    rightSlot={(
                        <span className="rounded-full border border-border/70 bg-background/45 px-3 py-1 text-xs font-semibold text-muted-foreground">
                            {formatNumber(orderJournal.length)} day(s)
                        </span>
                    )}
                >
                    {orderJournal.length === 0 ? (
                        <EmptyState text="No orders found in this date range." />
                    ) : (
                        <div className="space-y-4">
                            {orderJournal.slice(0, 45).map((day) => (
                                <div key={day.key} className="rounded-2xl border border-border/70 bg-background/45 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="font-semibold text-foreground">{day.label}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {formatNumber(day.totalOrders)} orders • {formatCurrency(day.totalSpend)}
                                        </p>
                                    </div>
                                    <div className="mt-3 space-y-2.5">
                                        {day.orders.map((order) => {
                                            const orderDate = parseOrderDate(order?.orderDate);
                                            const shortId = String(order?.customerOrderId || order?.id || 'N/A').replace('#', '');
                                            return (
                                                <div key={order.id} className="rounded-xl border border-border/60 bg-card/60 p-3">
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <div>
                                                            <p className="font-semibold text-foreground">{order.restaurantName || 'Restaurant'}</p>
                                                            <p className="text-xs text-muted-foreground">
                                                                #{shortId} • {orderDate ? format(orderDate, 'hh:mm a') : 'Time N/A'}
                                                            </p>
                                                        </div>
                                                        <p className="text-sm font-semibold text-foreground">{formatCurrency(order.amount)}</p>
                                                    </div>
                                                    <p className="mt-2 text-xs text-muted-foreground">
                                                        {toPreviewItems(order.items)}
                                                    </p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                            {orderJournal.length > 45 ? (
                                <p className="text-xs text-muted-foreground">Showing latest 45 days. Narrow range to inspect older days.</p>
                            ) : null}
                        </div>
                    )}
                </SectionCard>

                <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <MetricCard
                        label="Lifetime Spend"
                        value={formatCurrency(summary.totalSpendAllTime)}
                        helper={`${formatNumber(summary.totalOrdersAllTime)} successful orders`}
                        icon={Wallet}
                    />
                    <MetricCard
                        label="All-Time Savings"
                        value={formatCurrency(savings.totalSaved)}
                        helper={`${formatNumber(savings.couponUses)} offers used`}
                        icon={Sparkles}
                    />
                    <MetricCard
                        label="Loyalty Wallet"
                        value={`${formatNumber(loyalty.totalPoints)} pts`}
                        helper="Across all linked restaurants"
                        icon={Trophy}
                    />
                </section>
            </div>
        </>
    );
}
