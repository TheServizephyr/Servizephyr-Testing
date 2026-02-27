'use client';

import { useState, useEffect } from 'react';
import { onSnapshot, doc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser } from '@/firebase';
import { Wallet, IndianRupee, Loader2, Bike, Route, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const StatCard = ({ title, value, icon: Icon, isLoading }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
            <Icon className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
            {isLoading ? (
                <div className="h-8 bg-muted rounded w-3/4 animate-pulse mt-1"></div>
            ) : (
                <div className="text-3xl font-bold">{value}</div>
            )}
        </CardContent>
    </Card>
);

export default function WalletPage() {
    const { user, isUserLoading } = useUser();
    const [stats, setStats] = useState({
        balance: 0,
        totalEarnings: 0,
        totalDeliveries: 0,
    });
    const [loading, setLoading] = useState(true);
    const [timeFilter, setTimeFilter] = useState('all');

    const fetchStats = async (filter) => {
        if (!user) return;
        setLoading(true);
        
        try {
            // Always fetch the main stats from the driver document
            const driverDocRef = doc(db, 'drivers', user.uid);
            const driverDoc = await getDoc(driverDocRef);
            
            const currentBalance = driverDoc.exists() ? driverDoc.data().walletBalance || 0 : 0;
            const totalEarningsAllTime = driverDoc.exists() ? driverDoc.data().totalEarnings || 0 : 0;
            const totalDeliveriesAllTime = driverDoc.exists() ? driverDoc.data().totalDeliveries || 0 : 0;

            // If the filter is 'all', we already have everything we need.
            if (filter === 'all') {
                setStats({
                    balance: currentBalance,
                    totalEarnings: totalEarningsAllTime,
                    totalDeliveries: totalDeliveriesAllTime,
                });
                setLoading(false);
                return;
            }

            // For other filters, we calculate historical data based on orders
            const ordersRef = collection(db, 'orders');
            let q = query(ordersRef, where('deliveryBoyId', '==', user.uid), where('status', '==', 'delivered'));

            const now = new Date();
            let startDate;
            if (filter === 'day') {
                startDate = new Date(now.setHours(0, 0, 0, 0));
            } else if (filter === 'week') {
                const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
                firstDayOfWeek.setHours(0, 0, 0, 0);
                startDate = firstDayOfWeek;
            } else if (filter === 'month') {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            }

            if (startDate) {
                q = query(q, where('orderDate', '>=', startDate));
            }

            const querySnapshot = await getDocs(q);
            
            let filteredEarnings = 0;
            let filteredDeliveries = 0;

            querySnapshot.forEach(doc => {
                const orderData = doc.data();
                filteredDeliveries += 1;
                filteredEarnings += orderData.tipAmount || 0; 
            });

            setStats({
                balance: currentBalance, // Balance is always the current total
                totalEarnings: filteredEarnings,
                totalDeliveries: filteredDeliveries,
            });

        } catch (error) {
            console.error("Error fetching rider stats:", error);
        } finally {
            setLoading(false);
        }
    };
    
    useEffect(() => {
        if (!isUserLoading && user) {
            fetchStats(timeFilter);
        } else if (!isUserLoading && !user) {
            setLoading(false);
        }
    }, [user, isUserLoading, timeFilter]);

    return (
        <div className="p-4 md:p-6 space-y-6">
            <header>
                <h1 className="text-3xl font-bold tracking-tight">Earnings & Stats</h1>
                <p className="text-muted-foreground mt-1">View your performance and current balance.</p>
            </header>

            <Card className="bg-primary/10 border-primary/30">
                <CardHeader className="flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-primary"><Wallet/> Current Balance</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <Loader2 className="animate-spin text-primary" />
                    ) : (
                        <p className="text-5xl font-bold text-primary">₹{stats.balance.toFixed(2)}</p>
                    )}
                     <p className="text-xs text-muted-foreground mt-2">This is your withdrawable balance.</p>
                </CardContent>
            </Card>

            <div>
                <div className="flex items-center justify-between mb-4">
                     <h2 className="text-xl font-bold">Performance</h2>
                     <div className="flex items-center bg-card p-1 rounded-lg border border-border">
                        {['day', 'week', 'month', 'all'].map(filter => (
                            <Button 
                                key={filter}
                                variant={timeFilter === filter ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => setTimeFilter(filter)}
                                className="capitalize"
                            >
                                {filter === 'day' ? 'Today' : filter}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <StatCard title="Total Earnings" value={`₹${stats.totalEarnings.toFixed(2)}`} icon={IndianRupee} isLoading={loading} />
                    <StatCard title="Total Deliveries" value={stats.totalDeliveries} icon={Bike} isLoading={loading} />
                </div>
            </div>

             <Card>
                <CardHeader>
                    <CardTitle>Transaction History</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center text-muted-foreground py-10">
                        <p>Transaction history coming soon.</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
