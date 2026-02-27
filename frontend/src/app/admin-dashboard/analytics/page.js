'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Calendar as CalendarIcon, Download, RefreshCw, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function exportTopTablesAsCsv(topRestaurants, topItems, range) {
  const lines = [];
  lines.push(`Analytics Export,${range?.start || ''} to ${range?.end || ''}`);
  lines.push('');
  lines.push('Top Listings');
  lines.push('Name,Revenue');
  (topRestaurants || []).forEach((row) => {
    lines.push(`"${String(row.name || '').replace(/"/g, '""')}",${Number(row.revenue || 0)}`);
  });

  lines.push('');
  lines.push('Top Items');
  lines.push('Item,Orders');
  (topItems || []).forEach((row) => {
    lines.push(`"${String(row.name || '').replace(/"/g, '""')}",${Number(row.orders || 0)}`);
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `admin-analytics-${range?.start || 'start'}-to-${range?.end || 'end'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminAnalyticsPage() {
  const [date, setDate] = useState({
    from: new Date(new Date().setDate(new Date().getDate() - 40)),
    to: new Date(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState({
    range: null,
    revenueData: [],
    userData: [],
    topRestaurants: [],
    topItems: [],
    totals: { orderCount: 0, userSignups: 0 },
  });

  const fetchAnalytics = useCallback(async () => {
    if (!date?.from || !date?.to) return;

    setLoading(true);
    setError('');
    try {
      const headers = {};
      const currentUser = auth.currentUser;
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const start = format(date.from, 'yyyy-MM-dd');
      const end = format(date.to, 'yyyy-MM-dd');
      const res = await fetch(`/api/admin/analytics?start=${start}&end=${end}`, {
        headers,
        cache: 'no-store',
      });

      if (!res.ok) {
        const text = await res.text();
        let message = 'Could not load analytics';
        try {
          message = JSON.parse(text).message || message;
        } catch {
          message = text || message;
        }
        throw new Error(message);
      }

      const data = await res.json();
      setPayload({
        range: data.range || null,
        revenueData: Array.isArray(data.revenueData) ? data.revenueData : [],
        userData: Array.isArray(data.userData) ? data.userData : [],
        topRestaurants: Array.isArray(data.topRestaurants) ? data.topRestaurants : [],
        topItems: Array.isArray(data.topItems) ? data.topItems : [],
        totals: data.totals || { orderCount: 0, userSignups: 0 },
      });
    } catch (err) {
      setError(err.message || 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }, [date?.from, date?.to]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 },
  };

  const canExport = useMemo(() => {
    return payload.topRestaurants.length > 0 || payload.topItems.length > 0;
  }, [payload.topRestaurants.length, payload.topItems.length]);

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Platform Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real data from Firestore (Orders: {payload.totals.orderCount || 0}, Signups: {payload.totals.userSignups || 0})
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
                variant="outline"
                className={cn(
                  'w-full sm:w-[300px] justify-start text-left font-normal',
                  !date && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, 'LLL dd, y')} - {format(date.to, 'LLL dd, y')}
                    </>
                  ) : (
                    format(date.from, 'LLL dd, y')
                  )
                ) : (
                  <span>Pick a date</span>
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

          <Button variant="outline" onClick={fetchAnalytics} disabled={loading} className="w-full sm:w-auto">
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>

          <Button
            variant="outline"
            className="w-full sm:w-auto"
            disabled={!canExport}
            onClick={() => exportTopTablesAsCsv(payload.topRestaurants, payload.topItems, payload.range)}
          >
            <Download className="mr-2 h-4 w-4" /> Export Data
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Error Loading Analytics</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader><CardTitle>Platform Revenue Trend</CardTitle></CardHeader>
            <CardContent className="h-[300px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : (
                <ResponsiveContainer>
                  <LineChart data={payload.revenueData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'MMM dd')} />
                    <YAxis tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader><CardTitle>New User Growth</CardTitle></CardHeader>
            <CardContent className="h-[300px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : (
                <ResponsiveContainer>
                  <LineChart data={payload.userData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'MMM dd')} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="customers" name="Customers" stroke="hsl(var(--primary))" />
                    <Line type="monotone" dataKey="owners" name="Owners" stroke="hsl(var(--secondary-foreground))" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader><CardTitle>Top 10 Performing Restaurants</CardTitle></CardHeader>
            <CardContent className="h-[300px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : payload.topRestaurants.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">No data for this range.</div>
              ) : (
                <ResponsiveContainer>
                  <BarChart data={payload.topRestaurants} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader><CardTitle>Top 10 Ordered Items</CardTitle></CardHeader>
            <CardContent className="h-[300px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : payload.topItems.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">No data for this range.</div>
              ) : (
                <ResponsiveContainer>
                  <BarChart data={payload.topItems} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="orders" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
