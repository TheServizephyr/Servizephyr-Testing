
'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Banknote, IndianRupee, Clock, CheckCircle, RefreshCw, Search, Calendar as CalendarIcon, ChevronDown, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { format, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { auth } from '@/lib/firebase';
import { useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

export const dynamic = 'force-dynamic';

const formatCurrency = (value, currency = 'INR') => {
    if (value === null || value === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
};

const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    // Razorpay gives timestamp in seconds, so multiply by 1000
    return format(new Date(dateString * 1000), 'dd MMM, yyyy - hh:mm a');
};

const StatCard = ({ title, value, icon: Icon, isLoading }) => {
    if (isLoading) {
        return (
            <Card className="animate-pulse">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-6 w-6 bg-muted rounded-full"></div>
                </CardHeader>
                <CardContent>
                    <div className="h-8 bg-muted rounded w-1/2 mt-2"></div>
                </CardContent>
            </Card>
        )
    }
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
                <Icon className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
            </CardContent>
        </Card>
    );
};

const PayoutStatusBadge = ({ status }) => {
    const config = {
        processed: {
            text: 'Processed',
            icon: <CheckCircle className="h-3 w-3 text-green-500" />,
            className: 'bg-green-500/10 text-green-400 border-green-500/20',
        },
        pending: {
            text: 'Pending',
            icon: <Clock className="h-3 w-3 text-yellow-500" />,
            className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
        },
        // Add other statuses as needed
        default: {
            text: status,
            icon: null,
            className: 'bg-muted text-muted-foreground border-border',
        }
    };

    const { text, icon, className } = config[status] || config.default;

    return (
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border', className)}>
            {icon}
            <span className="capitalize">{text}</span>
        </span>
    );
};


function PayoutsPageContent() {
    const [payouts, setPayouts] = useState([]);
    const [summary, setSummary] = useState({ total: 0, lastPayout: 0, pending: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [date, setDate] = useState({ from: addDays(new Date(), -90), to: new Date() });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    const fetchPayouts = async () => {
        setLoading(true);
        setError(null);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required.");
            const idToken = await user.getIdToken();

            let url = new URL('/api/owner/payouts', window.location.origin);
            if (impersonatedOwnerId) {
                url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            }
            if (date.from) url.searchParams.append('from', Math.floor(date.from.getTime() / 1000));
            if (date.to) url.searchParams.append('to', Math.floor(date.to.getTime() / 1000));


            const response = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || "Failed to fetch payouts.");
            }

            const data = await response.json();
            setPayouts(data.payouts || []);
            setSummary(data.summary || { total: 0, lastPayout: 0, pending: 0 });

        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchPayouts();
            else setLoading(false);
        });
        return () => unsubscribe();
    }, [date, impersonatedOwnerId]);


    const filteredPayouts = useMemo(() => {
        if (!searchQuery) return payouts;
        const lowerCaseQuery = searchQuery.toLowerCase();
        return payouts.filter(p =>
            p.id.toLowerCase().includes(lowerCaseQuery) ||
            p.utr?.toLowerCase().includes(lowerCaseQuery)
        );
    }, [payouts, searchQuery]);

    return (
        <div className="p-4 md:p-6 space-y-6 bg-background text-foreground min-h-screen">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Payouts Overview</h1>
                    <p className="text-muted-foreground mt-1 text-sm">Track your earnings and transfers from Razorpay.</p>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <Button onClick={fetchPayouts} variant="outline" disabled={loading}>
                        <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Refresh
                    </Button>
                    <Button variant="outline" disabled={loading}>
                        <Download className="mr-2 h-4 w-4" /> Export Report
                    </Button>
                </div>
            </header>

            <motion.div
                className="grid gap-6 md:grid-cols-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ staggerChildren: 0.1, delayChildren: 0.2 }}
            >
                <StatCard title="Total Payouts" value={formatCurrency(summary.total)} icon={Banknote} isLoading={loading} />
                <StatCard title="Last Payout" value={formatCurrency(summary.lastPayout)} icon={CheckCircle} isLoading={loading} />
                <StatCard title="Pending Amount" value={formatCurrency(summary.pending)} icon={Clock} isLoading={loading} />
            </motion.div>

            <Card>
                <CardHeader>
                    <CardTitle>Payout History</CardTitle>
                    <div className="mt-4 flex flex-col md:flex-row items-center gap-4">
                         <div className="relative w-full md:max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                placeholder="Search by Transaction ID or UTR..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border"
                            />
                        </div>
                        <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                id="date"
                                variant={"outline"}
                                className={cn(
                                  "w-full md:w-[300px] justify-start text-left font-normal",
                                  !date && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date?.from ? (
                                  date.to ? (
                                    <>
                                      {format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}
                                    </>
                                  ) : (
                                    format(date.from, "LLL dd, y")
                                  )
                                ) : (
                                  <span>Pick a date range</span>
                                )}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="end">
                              <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={date?.from}
                                selected={date}
                                onSelect={setDate}
                                numberOfMonths={2}
                              />
                            </PopoverContent>
                          </Popover>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Transaction ID</TableHead>
                                    <TableHead>Amount</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>UTR</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    [...Array(5)].map((_, i) => (
                                        <TableRow key={i} className="animate-pulse">
                                            <TableCell><div className="h-4 bg-muted rounded w-full"></div></TableCell>
                                            <TableCell><div className="h-4 bg-muted rounded w-20"></div></TableCell>
                                            <TableCell><div className="h-4 bg-muted rounded w-40"></div></TableCell>
                                            <TableCell><div className="h-6 bg-muted rounded-full w-24"></div></TableCell>
                                            <TableCell><div className="h-4 bg-muted rounded w-full"></div></TableCell>
                                        </TableRow>
                                    ))
                                ) : error ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center text-destructive py-10">
                                            Error: {error}
                                        </TableCell>
                                    </TableRow>
                                ) : filteredPayouts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                                            No payouts found for the selected criteria.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredPayouts.map((payout) => (
                                        <TableRow key={payout.id} className="hover:bg-muted/50 cursor-pointer">
                                            <TableCell className="font-mono text-xs">{payout.id}</TableCell>
                                            <TableCell className="font-semibold text-foreground">
                                                {formatCurrency(payout.amount / 100, payout.currency)}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-xs">{formatDate(payout.created_at)}</TableCell>
                                            <TableCell><PayoutStatusBadge status={payout.status} /></TableCell>
                                            <TableCell className="font-mono text-xs text-muted-foreground">{payout.utr || 'N/A'}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default function PayoutsPage() {
    return (
        <Suspense fallback={<div className="flex h-full items-center justify-center"><GoldenCoinSpinner /></div>}>
            <PayoutsPageContent />
        </Suspense>
    )
}
