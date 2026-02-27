'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, ServerCrash, Timer, Activity, Database } from 'lucide-react';

const DEFAULT_TELEMETRY_TIMEZONE = 'Asia/Kolkata';

function normalizeDayInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const ddmmyyyy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
        const [, dd, mm, yyyy] = ddmmyyyy;
        return `${yyyy}-${mm}-${dd}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
    }
    return raw;
}

function getZonedIsoDay(timeZone = DEFAULT_TELEMETRY_TIMEZONE) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date());
        const year = parts.find((p) => p.type === 'year')?.value;
        const month = parts.find((p) => p.type === 'month')?.value;
        const day = parts.find((p) => p.type === 'day')?.value;
        if (year && month && day) return `${year}-${month}-${day}`;
    } catch {
        // Fallback below.
    }

    const now = new Date();
    const localMs = now.getTime() - now.getTimezoneOffset() * 60 * 1000;
    return new Date(localMs).toISOString().slice(0, 10);
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-IN');
}

function formatMs(value) {
    const safe = Number(value || 0);
    if (!Number.isFinite(safe) || safe <= 0) return '0 ms';
    if (safe >= 1000) return `${(safe / 1000).toFixed(2)} s`;
    return `${Math.round(safe)} ms`;
}

function formatPercent(value) {
    const safe = Number(value || 0);
    if (!Number.isFinite(safe)) return '0%';
    return `${safe.toFixed(2)}%`;
}

function formatErrorTime(isoTime) {
    if (!isoTime) return '-';
    const date = new Date(isoTime);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-IN', {
        hour12: true,
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatStatusCode(statusCode) {
    const safe = Number(statusCode || 0);
    if (!Number.isFinite(safe) || safe <= 0) return '-';
    return String(Math.floor(safe));
}

function KpiCard({ title, value, subtitle, icon: Icon }) {
    return (
        <Card>
            <CardContent className="p-4 md:p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
                        <p className="text-2xl font-bold mt-1">{value}</p>
                        {subtitle ? <p className="text-xs text-muted-foreground mt-1">{subtitle}</p> : null}
                    </div>
                    <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
            </CardContent>
        </Card>
    );
}

export default function AdminAnalyticsPage() {
    const [day, setDay] = useState(() => getZonedIsoDay(DEFAULT_TELEMETRY_TIMEZONE));
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const requestSeqRef = useRef(0);
    const hasUserChangedDayRef = useRef(false);

    const fetchData = useCallback(async ({ silent = false } = {}) => {
        const requestSeq = ++requestSeqRef.current;
        if (silent) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }

        setError('');
        try {
            const headers = {};
            const currentUser = auth.currentUser;
            if (currentUser) {
                const token = await currentUser.getIdToken();
                headers.Authorization = `Bearer ${token}`;
            }

            const response = await fetch(`/api/admin/ops-telemetry?day=${encodeURIComponent(day)}&errors=40`, {
                headers,
                cache: 'no-store',
            });

            if (!response.ok) {
                const text = await response.text();
                let message = 'Failed to load telemetry';
                try {
                    message = JSON.parse(text).message || message;
                } catch {
                    message = text || message;
                }
                throw new Error(message);
            }

            const payload = await response.json();
            if (requestSeq === requestSeqRef.current) {
                setData(payload);
            }
        } catch (err) {
            if (requestSeq === requestSeqRef.current) {
                setError(err.message || 'Failed to load telemetry');
            }
        } finally {
            if (requestSeq === requestSeqRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [day]);

    useEffect(() => {
        setData(null);
        fetchData({ silent: false });
    }, [fetchData]);

    useEffect(() => {
        const interval = setInterval(() => {
            fetchData({ silent: true });
        }, 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const endpointRows = useMemo(() => data?.endpoints || [], [data]);
    const funnelOverall = data?.funnel?.overall || {};
    const funnelFlows = data?.funnel?.flows || [];
    const recentErrors = data?.recentErrors || [];
    const recentOrderCreates = data?.recentOrderCreates || [];
    const latestOrderCreate = recentOrderCreates[0] || null;
    const isKvConfigured = data?.configured !== false;
    const telemetryTimeZone = data?.telemetryTimeZone || DEFAULT_TELEMETRY_TIMEZONE;
    const hasLegacyReadOnlyRows = !!data?.dataQuality?.hasLegacyReadOnlyRows;
    const hasNoDataForSelectedDay =
        Number(data?.totals?.requests || 0) === 0 &&
        Number(data?.totals?.estimatedReads || 0) === 0 &&
        Number(data?.totals?.estimatedWrites || 0) === 0 &&
        Number(funnelOverall.orderPageOpened || 0) === 0 &&
        recentErrors.length === 0;
    const isLocalhost = useMemo(() => {
        if (typeof window === 'undefined') return false;
        return ['localhost', '127.0.0.1'].includes(window.location.hostname);
    }, []);

    useEffect(() => {
        const serverDay = data?.serverDay;
        if (!serverDay) return;
        if (hasUserChangedDayRef.current) return;
        if (day === serverDay) return;
        setDay(serverDay);
    }, [data?.serverDay, day]);

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center min-h-[40vh]">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Production Ops Analytics</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Live API speed, funnel conversion and crash feed (auto-refresh every 30s)
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={day}
                        onChange={(e) => {
                            hasUserChangedDayRef.current = true;
                            setDay(normalizeDayInput(e.target.value));
                        }}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <Button variant="outline" onClick={() => fetchData({ silent: true })} disabled={refreshing}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            <p className="text-xs text-muted-foreground">
                Telemetry timezone: `{telemetryTimeZone}`
            </p>

            {error ? (
                <Card className="border-destructive/50 bg-destructive/5">
                    <CardContent className="p-4 flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                        <div>
                            <p className="font-semibold text-destructive">Could not load analytics</p>
                            <p className="text-sm text-muted-foreground">{error}</p>
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            {!isKvConfigured ? (
                <Card className="border-amber-500/50 bg-amber-500/5">
                    <CardContent className="p-4 text-sm">
                        KV telemetry is not configured. Set `KV_REST_API_URL` and `KV_REST_API_TOKEN` in production.
                    </CardContent>
                </Card>
            ) : null}

            {isLocalhost ? (
                <Card className="border-sky-500/40 bg-sky-500/5">
                    <CardContent className="p-4 text-sm text-muted-foreground">
                        Localhost note: Next.js dev mode (`reactStrictMode`) aur page re-mount ki wajah se API calls production se zyada dikh sakti hain.
                    </CardContent>
                </Card>
            ) : null}

            {data?.fallbackUsed ? (
                <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardContent className="p-4 text-sm text-muted-foreground">
                        Selected day `{data?.requestedDay}` par data nahi mila, isliye previous day `{data?.day}` ka data show kiya gaya.
                    </CardContent>
                </Card>
            ) : null}

            {!data?.fallbackUsed && data?.day && data?.requestedDay && data?.day !== data?.requestedDay ? (
                <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardContent className="p-4 text-sm text-muted-foreground">
                        Requested day `{data?.requestedDay}` aur active data day `{data?.day}` mismatch mila. Refresh karein.
                    </CardContent>
                </Card>
            ) : null}

            {!error && isKvConfigured && hasNoDataForSelectedDay ? (
                <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardContent className="p-4 text-sm text-muted-foreground">
                        Selected day `{day}` par telemetry events abhi zero hain. Fresh order/menu actions run karke 15-30 sec me refresh karein.
                    </CardContent>
                </Card>
            ) : null}

            {!error && hasLegacyReadOnlyRows ? (
                <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardContent className="p-4 text-sm text-muted-foreground">
                        Kuch historical rows me `reads/writes` mil rahe hain but request count `0` hai. Ye legacy telemetry data ho sakta hai.
                    </CardContent>
                </Card>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <KpiCard
                    title="Total API Requests"
                    value={formatNumber(data?.totals?.requests)}
                    subtitle={`Day: ${data?.day || day}`}
                    icon={Activity}
                />
                <KpiCard
                    title="Average API Latency"
                    value={formatMs(data?.totals?.avgLatencyMs)}
                    subtitle={`Error rate ${formatPercent(data?.totals?.errorRate)}`}
                    icon={Timer}
                />
                <KpiCard
                    title="Server Errors (5xx)"
                    value={formatNumber(data?.totals?.errors)}
                    subtitle="Only backend failures"
                    icon={ServerCrash}
                />
                <KpiCard
                    title="Estimated Firestore Reads"
                    value={formatNumber(data?.totals?.estimatedReads)}
                    subtitle="From read telemetry hooks"
                    icon={Database}
                />
                <KpiCard
                    title="Estimated Firestore Writes"
                    value={formatNumber(data?.totals?.estimatedWrites)}
                    subtitle="From write telemetry hooks"
                    icon={Activity}
                />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>API Performance by Endpoint</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    <table className="w-full min-w-[1040px] text-sm">
                        <thead>
                            <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                                <th className="py-2 text-left">Endpoint</th>
                                <th className="py-2 text-right">Requests</th>
                                <th className="py-2 text-right">Errors</th>
                                <th className="py-2 text-right">Error %</th>
                                <th className="py-2 text-right">Avg</th>
                                <th className="py-2 text-right">P95</th>
                                <th className="py-2 text-right">Min~</th>
                                <th className="py-2 text-right">Max~</th>
                                <th className="py-2 text-right">Est. Reads</th>
                                <th className="py-2 text-right">Est. Writes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {endpointRows.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="py-6 text-center text-muted-foreground">No endpoint data for selected day.</td>
                                </tr>
                            ) : endpointRows.map((row) => (
                                <tr key={row.endpoint} className="border-b last:border-0">
                                    <td className="py-2 font-mono text-xs">{row.endpoint}</td>
                                    <td className="py-2 text-right">{formatNumber(row.requests)}</td>
                                    <td className="py-2 text-right">{formatNumber(row.errors)}</td>
                                    <td className="py-2 text-right">{formatPercent(row.errorRate)}</td>
                                    <td className="py-2 text-right">{formatMs(row.avgMs)}</td>
                                    <td className="py-2 text-right">{formatMs(row.p95Ms)}</td>
                                    <td className="py-2 text-right">{formatMs(row.minMs)}</td>
                                    <td className="py-2 text-right">{row.maxMsOverflow ? `${row.maxMs}+ ms` : formatMs(row.maxMs)}</td>
                                    <td className="py-2 text-right">{formatNumber(row.estimatedReads)}</td>
                                    <td className="py-2 text-right">{formatNumber(row.estimatedWrites)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Last Order Create Detail</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!latestOrderCreate ? (
                        <p className="text-sm text-muted-foreground">No order-create event found for selected day.</p>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                            <div className="rounded-lg border p-3">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Time</p>
                                <p className="text-sm font-semibold mt-1">{formatErrorTime(latestOrderCreate.at)}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Latency</p>
                                <p className="text-sm font-semibold mt-1">{formatMs(latestOrderCreate.durationMs)}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                                <p className="text-sm font-semibold mt-1">{formatStatusCode(latestOrderCreate.statusCode)}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Flow</p>
                                <p className="text-sm font-semibold mt-1">{String(latestOrderCreate?.context?.flow || 'other')}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Order Type</p>
                                <p className="text-sm font-semibold mt-1">{latestOrderCreate?.context?.isAddonOrder ? 'Add More' : 'New Order'}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Restaurant</p>
                                <p className="text-sm font-semibold mt-1 break-all">{String(latestOrderCreate?.context?.restaurantId || '-')}</p>
                            </div>
                        </div>
                    )}

                    {recentOrderCreates.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-sm">
                                <thead>
                                    <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                                        <th className="py-2 text-left">At</th>
                                        <th className="py-2 text-right">Latency</th>
                                        <th className="py-2 text-right">Status</th>
                                        <th className="py-2 text-left">Flow</th>
                                        <th className="py-2 text-left">Type</th>
                                        <th className="py-2 text-left">Restaurant</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentOrderCreates.slice(0, 8).map((item, index) => (
                                        <tr key={`${item.at}-${index}`} className="border-b last:border-0">
                                            <td className="py-2 whitespace-nowrap">{formatErrorTime(item.at)}</td>
                                            <td className="py-2 text-right">{formatMs(item.durationMs)}</td>
                                            <td className="py-2 text-right">{formatStatusCode(item.statusCode)}</td>
                                            <td className="py-2 capitalize">{String(item?.context?.flow || 'other')}</td>
                                            <td className="py-2">{item?.context?.isAddonOrder ? 'Add More' : 'New Order'}</td>
                                            <td className="py-2 font-mono text-xs break-all">{String(item?.context?.restaurantId || '-')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Funnel Conversion</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            <div className="rounded-lg border p-3">
                                <p className="text-xs text-muted-foreground uppercase tracking-wide">Order Page Open</p>
                                <p className="text-lg font-semibold mt-1">{formatNumber(funnelOverall.orderPageOpened)}</p>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="text-xs text-muted-foreground uppercase tracking-wide">Checkout Open</p>
                                <p className="text-lg font-semibold mt-1">{formatNumber(funnelOverall.checkoutOpened)}</p>
                                <p className="text-xs text-muted-foreground">{formatPercent(funnelOverall.orderToCheckoutRate)} from order page</p>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="text-xs text-muted-foreground uppercase tracking-wide">Create Success</p>
                                <p className="text-lg font-semibold mt-1">{formatNumber(funnelOverall.orderCreateSuccess)}</p>
                                <p className="text-xs text-muted-foreground">{formatPercent(funnelOverall.createSuccessRate)} success rate</p>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[520px] text-sm">
                                <thead>
                                    <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                                        <th className="py-2 text-left">Flow</th>
                                        <th className="py-2 text-right">Order</th>
                                        <th className="py-2 text-right">Checkout</th>
                                        <th className="py-2 text-right">Success</th>
                                        <th className="py-2 text-right">Order→Checkout</th>
                                        <th className="py-2 text-right">Checkout→Success</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {funnelFlows.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-5 text-center text-muted-foreground">No funnel events yet.</td>
                                        </tr>
                                    ) : funnelFlows.map((flow) => (
                                        <tr key={flow.flow} className="border-b last:border-0">
                                            <td className="py-2 capitalize">{flow.flow}</td>
                                            <td className="py-2 text-right">{formatNumber(flow.orderPageOpened)}</td>
                                            <td className="py-2 text-right">{formatNumber(flow.checkoutOpened)}</td>
                                            <td className="py-2 text-right">{formatNumber(flow.orderCreateSuccess)}</td>
                                            <td className="py-2 text-right">{formatPercent(flow.orderToCheckoutRate)}</td>
                                            <td className="py-2 text-right">{formatPercent(flow.checkoutToSuccessRate)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Recent Backend Crashes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {recentErrors.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No 5xx crashes recorded for this day.</p>
                        ) : (
                            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                                {recentErrors.map((item, index) => (
                                    <div key={`${item.at}-${index}`} className="rounded-lg border p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="font-mono text-xs break-all">{item.endpoint || 'unknown'}</p>
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">{formatErrorTime(item.at)}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">Status: {item.statusCode || 500}</p>
                                        <p className="text-sm mt-2 break-words">{item.message || 'No error message provided'}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
