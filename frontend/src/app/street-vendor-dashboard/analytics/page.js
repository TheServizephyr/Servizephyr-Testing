'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    TrendingUp, TrendingDown, DollarSign, ShoppingBag, Award, AlertTriangle,
    Calendar, Clock, Users, Sparkles, Package, MessageSquare, XCircle,
    TrendingDown as TrendingDownIcon, Bot, Heart, Zap
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { auth } from '@/lib/firebase';
import { useRouter, useSearchParams } from 'next/navigation';

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export default function StreetVendorAnalyticsPage() {
    const [loading, setLoading] = useState(true);
    const [analyticsData, setAnalyticsData] = useState(null);
    const [dateFilter, setDateFilter] = useState('Today'); // Default to Today
    const searchParams = useSearchParams();
    const router = useRouter();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchAnalytics();
            } else {
                router.push('/');
            }
        });
        return () => unsubscribe();
    }, [dateFilter, router, impersonatedOwnerId]);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please log in to view analytics');

            const idToken = await user.getIdToken();
            let url = `/api/owner/analytics?filter=${encodeURIComponent(dateFilter)}`;
            if (impersonatedOwnerId) url += `&impersonate_owner_id=${impersonatedOwnerId}`;

            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Failed to fetch analytics' }));
                throw new Error(errorData.message || `HTTP ${res.status}: ${res.statusText}`);
            }
            const data = await res.json();
            setAnalyticsData(data);
        } catch (error) {
            console.error('Error fetching analytics:', error);
            setAnalyticsData({ error: error.message });
        } finally {
            setLoading(false);
        }
    };

    const handleToggleItem = async (itemId, currentStatus) => {
        // Optimistic update would be better, but for now just log
        console.log('Toggling item:', itemId, currentStatus);
        // TODO: Implement API call to toggle item availability
        // For now, we'll just show a toast or alert
        alert("Item availability toggle logic to be connected to backend!");
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading analytics...</p>
                </div>
            </div>
        );
    }

    if (!analyticsData || analyticsData.error) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-6">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle className="h-8 w-8 text-destructive" />
                    </div>
                    <h2 className="text-2xl font-bold text-destructive mb-2">Error Loading Analytics</h2>
                    <p className="text-muted-foreground mb-4">{analyticsData?.error || 'No data available'}</p>
                </div>
                <Button onClick={fetchAnalytics} size="lg">Retry</Button>
            </div>
        );
    }

    const { salesData, menuPerformance, customerStats, aiInsights } = analyticsData;
    const topPerformers = menuPerformance.filter(item => item.unitsSold > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 3);
    const lowPerformers = menuPerformance.filter(item => item.unitsSold === 0).slice(0, 5);

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
            <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
                >
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
                            Analytics Dashboard
                        </h1>
                        <p className="text-muted-foreground mt-1 text-sm md:text-base">Aapka business ka poora hisaab</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Select value={dateFilter} onValueChange={setDateFilter}>
                            <SelectTrigger className="w-[160px] border-2 border-border rounded-xl bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow h-11">
                                <div className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-primary" />
                                    <SelectValue placeholder="Select period" />
                                </div>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Today">Today</SelectItem>
                                <SelectItem value="This Week">This Week</SelectItem>
                                <SelectItem value="This Month">This Month</SelectItem>
                                <SelectItem value="This Year">This Year</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </motion.div>

                {/* Section 1: GALLA STATUS (Hero Section) */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 }}
                >
                    <Card className="border-2 border-primary/20 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 shadow-xl">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-2xl">
                                💰 Galla Status
                            </CardTitle>
                            <CardDescription className="text-base">Aaj ka poora hisaab</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* Revenue Hero */}
                            <div className="text-center py-4">
                                <p className="text-sm text-muted-foreground mb-2">Total Revenue</p>
                                <p className="text-5xl md:text-6xl font-bold text-green-600 dark:text-green-400">
                                    ₹{salesData.kpis.totalRevenue.toFixed(0)}
                                </p>
                                <p className={cn("text-sm flex items-center justify-center gap-1 mt-2 font-medium",
                                    salesData.kpis.revenueChange >= 0 ? "text-green-600" : "text-red-600")}>
                                    {salesData.kpis.revenueChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                                    {Math.abs(salesData.kpis.revenueChange).toFixed(1)}% from last period
                                </p>
                            </div>

                            {/* Cash vs Online + AOV */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Cash vs Online */}
                                <div className="p-4 bg-white/50 dark:bg-black/20 rounded-lg border border-border">
                                    <p className="text-sm font-semibold mb-3 text-center">Payment Split</p>
                                    <div className="flex items-center justify-around">
                                        <div className="text-center">
                                            <p className="text-2xl font-bold text-green-600">₹{salesData.kpis.cashRevenue.toFixed(0)}</p>
                                            <p className="text-xs text-muted-foreground">Cash</p>
                                            <p className="text-xs font-medium">{salesData.kpis.totalRevenue > 0 ? ((salesData.kpis.cashRevenue / salesData.kpis.totalRevenue) * 100).toFixed(0) : 0}%</p>
                                        </div>
                                        <div className="h-12 w-px bg-border"></div>
                                        <div className="text-center">
                                            <p className="text-2xl font-bold text-blue-600">₹{salesData.kpis.onlineRevenue.toFixed(0)}</p>
                                            <p className="text-xs text-muted-foreground">Online</p>
                                            <p className="text-xs font-medium">{salesData.kpis.totalRevenue > 0 ? ((salesData.kpis.onlineRevenue / salesData.kpis.totalRevenue) * 100).toFixed(0) : 0}%</p>
                                        </div>
                                    </div>
                                </div>

                                {/* AOV */}
                                <div className="p-4 bg-white/50 dark:bg-black/20 rounded-lg border border-border">
                                    <p className="text-sm font-semibold mb-2 text-center">Average Order Value</p>
                                    <p className="text-3xl font-bold text-center text-purple-600">₹{salesData.kpis.avgOrderValue.toFixed(0)}</p>
                                    <p className="text-xs text-center text-muted-foreground mt-2">
                                        {salesData.kpis.avgOrderValue < 100 ?
                                            "💡 Combo offers se AOV badha sakte ho!" :
                                            "🎉 Badhiya! Customers accha khareed rahe hain"}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Section 2: MENU INTELLIGENCE */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Star Items */}
                    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
                        <Card className="border-2 border-yellow-200 dark:border-yellow-800 h-full">
                            <CardHeader className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10">
                                <CardTitle className="flex items-center gap-2">
                                    <Award className="h-5 w-5 text-yellow-600" />
                                    🔥 Star Items
                                </CardTitle>
                                <CardDescription>Aag laga rahe hain!</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                {topPerformers.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-8">No sales yet</p>
                                ) : (
                                    <div className="space-y-3">
                                        {topPerformers.map((item, index) => (
                                            <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-950/20 dark:to-orange-950/20">
                                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 text-white font-bold text-sm">
                                                    {index + 1}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold truncate text-sm">{item.name}</p>
                                                    <p className="text-xs text-muted-foreground">{item.unitsSold} units</p>
                                                </div>
                                                <p className="font-bold text-green-600 text-sm">₹{item.revenue.toFixed(0)}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </motion.div>

                    {/* Slow Movers */}
                    {lowPerformers.length > 0 && (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                            <Card className="border-2 border-orange-200 dark:border-orange-800 h-full">
                                <CardHeader className="bg-gradient-to-r from-orange-500/10 to-red-500/10">
                                    <CardTitle className="flex items-center gap-2">
                                        <XCircle className="h-5 w-5 text-orange-600" />
                                        🐢 Dead Stock
                                    </CardTitle>
                                    <CardDescription>Nahi bik raha</CardDescription>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="space-y-2">
                                        {lowPerformers.slice(0, 3).map((item) => (
                                            <div key={item.id} className="flex items-center justify-between p-2 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/50">
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-sm truncate">{item.name}</p>
                                                    <p className="text-xs text-muted-foreground">₹{item.portions[0]?.price || 0}</p>
                                                </div>
                                                {/* Replaced Dangerous Remove Button with Toggle Switch (Mock UI for now) */}
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-muted-foreground">Hide</span>
                                                    <div className="relative inline-block w-8 h-4 rounded-full cursor-pointer bg-green-500 transition-colors duration-200 ease-in-out">
                                                        <span className="absolute left-4 top-0.5 bg-white w-3 h-3 rounded-full transition-transform duration-200 ease-in-out transform"></span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    )}

                    {/* MISSED OPPORTUNITY METER (UNIQUE FEATURE) */}
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
                        <Card className="border-2 border-red-200 dark:border-red-800 h-full bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-950/20 dark:to-pink-950/20">
                            <CardHeader className="bg-gradient-to-r from-red-500/10 to-pink-500/10">
                                <CardTitle className="flex items-center gap-2">
                                    <AlertTriangle className="h-5 w-5 text-red-600" />
                                    ❌ Lost Revenue
                                </CardTitle>
                                <CardDescription>Out of stock ka nuksan</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                {salesData.kpis.missedRevenue > 0 ? (
                                    <div className="space-y-4">
                                        <div className="text-center p-4 bg-red-100 dark:bg-red-900/30 rounded-lg">
                                            <p className="text-sm text-muted-foreground mb-1">Total Lost</p>
                                            <p className="text-4xl font-bold text-red-600">₹{salesData.kpis.missedRevenue.toFixed(0)}</p>
                                        </div>
                                        {salesData.missedOpportunities && salesData.missedOpportunities.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-semibold">Top Missed Items:</p>
                                                {salesData.missedOpportunities.slice(0, 3).map((item) => (
                                                    <div key={item.name} className="p-2 bg-white/50 dark:bg-black/20 rounded border border-red-200 dark:border-red-800">
                                                        <p className="font-semibold text-sm">{item.name}</p>
                                                        <p className="text-xs text-muted-foreground">{item.count} orders rejected • ₹{item.revenue.toFixed(0)} lost</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-center py-8">
                                        <p className="text-4xl font-bold text-green-600 mb-2">0</p>
                                        <p className="text-sm font-semibold text-green-700">Orders Rejected</p>
                                        <p className="text-xs text-muted-foreground mt-2">Badhiya! Aapne koi customer khali haath nahi jane diya.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </motion.div>
                </div>

                {/* Section 3: RUSH HOUR HEATMAP */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                    <Card className="border-2">
                        <CardHeader className="bg-gradient-to-r from-blue-500/10 to-purple-500/10">
                            <CardTitle className="flex items-center gap-2">
                                <Clock className="h-6 w-6 text-blue-600" />
                                ⏰ Rush Hour Heatmap
                            </CardTitle>
                            <CardDescription>Kis time sabse zyada orders aate hain</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Peak Hours */}
                                <div>
                                    <p className="text-sm font-semibold mb-4">Peak Hours</p>
                                    {salesData.peakHours && salesData.peakHours.length > 0 ? (
                                        <div className="space-y-2">
                                            {salesData.peakHours.slice(0, 5).map((peak, index) => {
                                                const maxCount = salesData.peakHours[0].count;
                                                const percentage = (peak.count / maxCount) * 100;
                                                const timeLabel = peak.hour >= 12 ? `${peak.hour > 12 ? peak.hour - 12 : peak.hour} PM` : `${peak.hour} AM`;
                                                return (
                                                    <div key={peak.hour} className="space-y-1">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="font-medium">{timeLabel}</span>
                                                            <span className="text-muted-foreground">{peak.count} orders</span>
                                                        </div>
                                                        <div className="w-full bg-muted rounded-full h-2">
                                                            <div
                                                                className={cn("h-full rounded-full transition-all",
                                                                    index === 0 ? "bg-gradient-to-r from-red-500 to-orange-500" : "bg-gradient-to-r from-blue-500 to-purple-500"
                                                                )}
                                                                style={{ width: `${percentage}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">No data yet</p>
                                    )}
                                </div>

                                {/* Prep Time */}
                                <div className="flex flex-col justify-center items-center p-6 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 rounded-lg border border-border">
                                    <Zap className="h-12 w-12 text-purple-600 mb-3" />
                                    <p className="text-sm text-muted-foreground mb-2">Average Prep Time</p>
                                    <p className="text-4xl font-bold text-purple-600">
                                        {salesData.kpis.avgPrepTime > 0 ? `${salesData.kpis.avgPrepTime} min` : "--"}
                                    </p>
                                    <p className="text-xs text-center text-muted-foreground mt-2">
                                        {salesData.kpis.avgPrepTime > 15 ? "⚠️ Thoda slow hai, speed badhao" :
                                            salesData.kpis.avgPrepTime > 0 ? "✅ Badhiya speed hai!" : "Calculating..."}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Section 4: CUSTOMER LOYALTY */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
                    <Card className="border-2">
                        <CardHeader className="bg-gradient-to-r from-green-500/10 to-teal-500/10">
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-6 w-6 text-green-600" />
                                👥 Customer Loyalty
                            </CardTitle>
                            <CardDescription>Kitne log wapas aa rahe hain</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* New vs Returning */}
                                <div className="p-6 bg-gradient-to-br from-green-50 to-teal-50 dark:from-green-950/20 dark:to-teal-950/20 rounded-lg border border-border">
                                    <p className="text-sm font-semibold mb-4 text-center">This Period</p>
                                    <div className="flex items-center justify-around mb-4">
                                        <div className="text-center">
                                            <p className="text-3xl font-bold text-blue-600">{customerStats.newThisPeriod || 0}</p>
                                            <p className="text-xs text-muted-foreground">New</p>
                                        </div>
                                        <div className="h-12 w-px bg-border"></div>
                                        <div className="text-center">
                                            <p className="text-3xl font-bold text-green-600">{customerStats.returningThisPeriod || 0}</p>
                                            <p className="text-xs text-muted-foreground">Returning</p>
                                        </div>
                                    </div>
                                    <div className="text-center p-3 bg-white/50 dark:bg-black/20 rounded">
                                        <p className="text-sm">
                                            {customerStats.repeatRate > 50 ?
                                                `💚 ${customerStats.repeatRate}% customers wapas aa rahe hain!` :
                                                `${customerStats.repeatRate}% repeat rate`
                                            }
                                        </p>
                                    </div>
                                </div>

                                {/* Top Loyal Customers */}
                                <div>
                                    <p className="text-sm font-semibold mb-3">Top 5 Loyal Customers</p>
                                    {customerStats.topLoyalCustomers && customerStats.topLoyalCustomers.length > 0 ? (
                                        <div className="space-y-2">
                                            {customerStats.topLoyalCustomers.map((customer, index) => (
                                                <div key={customer.phone} className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-green-50 to-teal-50 dark:from-green-950/20 dark:to-teal-950/20 border border-border">
                                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                                        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-green-600 text-white font-bold text-xs">
                                                            {index + 1}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-sm truncate">{customer.name}</p>
                                                            <p className="text-xs text-muted-foreground">{customer.orders} orders • ₹{customer.totalSpent?.toFixed(0) || 0}</p>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="text-xs flex-shrink-0"
                                                        onClick={() => window.open(`https://wa.me/91${customer.phone}?text=Thank you for being a loyal customer! Here's a special coupon for you: LOYAL10`, '_blank')}
                                                    >
                                                        <MessageSquare className="h-3 w-3 mr-1" />
                                                        Thank
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground text-center py-8">No customer data yet</p>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Section 5: AI COACH */}
                {aiInsights && aiInsights.length > 0 && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
                        <Card className="border-2 border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardHeader className="bg-gradient-to-r from-purple-500/10 to-pink-500/10">
                                <CardTitle className="flex items-center gap-2">
                                    <Bot className="h-6 w-6 text-purple-600" />
                                    🤖 ServiZephyr AI Coach
                                </CardTitle>
                                <CardDescription>Aapke liye khaas tips aur insights</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="space-y-3">
                                    {aiInsights.map((insight, index) => (
                                        <motion.div
                                            key={index}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 0.8 + index * 0.1 }}
                                            className={cn(
                                                "p-4 rounded-lg border-l-4 flex items-start gap-3",
                                                insight.type === 'warning' && "bg-red-50 dark:bg-red-950/20 border-red-500",
                                                insight.type === 'tip' && "bg-blue-50 dark:bg-blue-950/20 border-blue-500",
                                                insight.type === 'suggestion' && "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-500",
                                                insight.type === 'success' && "bg-green-50 dark:bg-green-950/20 border-green-500"
                                            )}
                                        >
                                            {insight.type === 'warning' && <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />}
                                            {insight.type === 'tip' && <Sparkles className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />}
                                            {insight.type === 'suggestion' && <Zap className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />}
                                            {insight.type === 'success' && <Heart className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />}
                                            <div className="flex-1">
                                                <p className="text-sm font-medium">{insight.message}</p>
                                                {/* Actionable Buttons */}
                                                {insight.type === 'suggestion' && (
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        className="mt-2 h-7 text-xs bg-white/80 hover:bg-white"
                                                        onClick={() => router.push('/owner-dashboard/menu')}
                                                    >
                                                        Create Combo
                                                    </Button>
                                                )}
                                                {insight.type === 'warning' && (
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        className="mt-2 h-7 text-xs bg-white/80 hover:bg-white"
                                                        onClick={() => router.push('/owner-dashboard/inventory')}
                                                    >
                                                        Update Stock
                                                    </Button>
                                                )}
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
