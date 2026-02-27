
'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AlertCircle, Store, Users, IndianRupee, ShoppingCart, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const StatCard = ({ title, value, icon: Icon, isCurrency = false, className = '', isLoading, href }) => {
  const cardContent = (
    <Card className={cn("hover:border-primary transition-colors h-full", className, href && "cursor-pointer")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {isCurrency ? `₹${Number(value).toLocaleString('en-IN')}` : Number(value).toLocaleString('en-IN')}
        </div>
      </CardContent>
    </Card>
  );

  if (isLoading) {
    return (
      <div className={`animate-pulse bg-card border border-border rounded-xl p-5 h-[108px]`}>
        <div className="flex justify-between items-center">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-5 w-5 bg-muted rounded-full"></div>
        </div>
        <div className="h-8 bg-muted rounded w-1/2 mt-4"></div>
      </div>
    );
  }
  
  if (href) {
    return <Link href={href} className="w-full h-full">{cardContent}</Link>;
  }

  return cardContent;
};

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Attach Firebase ID token for admin-protected endpoints
      const currentUser = auth.currentUser;
      const headers = {};
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/dashboard-stats', { headers });
      if (!res.ok) {
        const text = await res.text();
        let errMsg = 'Failed to fetch dashboard data';
        try { errMsg = JSON.parse(text).message || errMsg; } catch (e) { errMsg = text || errMsg; }
        throw new Error(errMsg);
      }
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 },
  };

  if (error) {
    return (
        <div className="text-center p-8 text-destructive bg-destructive/10 rounded-lg">
            <h2 className="text-lg font-bold">Error Loading Dashboard</h2>
            <p>{error}</p>
            <Button onClick={fetchData} className="mt-4">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
            </Button>
        </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.h1 variants={itemVariants} className="text-3xl font-bold tracking-tight">
        Platform Overview
      </motion.h1>

      <motion.div variants={itemVariants} className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Pending Approvals"
          value={data?.pendingApprovals || 0}
          icon={AlertCircle}
          className="bg-yellow-500/10 border-yellow-500/50"
          isLoading={loading}
          href="/admin-dashboard/restaurants"
        />
        <StatCard title="Total Listings" value={data?.totalListings || 0} icon={Store} isLoading={loading}/>
        <StatCard title="Total Users" value={data?.totalUsers || 0} icon={Users} isLoading={loading}/>
        <StatCard title="Today's Orders" value={data?.todayOrders || 0} icon={ShoppingCart} isLoading={loading}/>
        <StatCard title="Today's Revenue" value={data?.todayRevenue || 0} icon={IndianRupee} isCurrency isLoading={loading}/>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div variants={itemVariants} className="lg:col-span-2">
           <Card className="h-full">
            <CardHeader>
              <CardTitle>Platform-wide Order Volume (Last 7 Days)</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px] w-full">
              {loading ? (
                <div className="flex items-center justify-center h-full"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : (
                <ResponsiveContainer>
                    <LineChart data={data?.weeklyOrderData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)"/>
                        <XAxis dataKey="day" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }}/>
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}/>
                        <Line type="monotone" dataKey="orders" stroke="hsl(var(--primary))" strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Recent Sign-ups</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4 animate-pulse">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted rounded-md"></div>)}
                </div>
              ) : (
              <div className="space-y-4">
                {(data?.recentSignups || []).length > 0 ? data.recentSignups.map((signup, i) => (
                  <div key={i} className="flex items-center">
                    <div className="p-3 bg-muted rounded-full mr-4">
                      {signup.type === 'Restaurant' ? (
                        <Store className="h-5 w-5 text-primary" />
                      ) : signup.type === 'Shop' ? (
                        <ShoppingCart className="h-5 w-5 text-blue-400" />
                      ) : (
                        <Users className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-grow">
                      <p className="text-sm font-medium leading-none">{signup.name}</p>
                      <p className="text-sm text-muted-foreground">{signup.type}</p>
                    </div>
                    <div className="text-sm text-muted-foreground">{format(new Date(signup.time), "p")}</div>
                  </div>
                )) : <p className="text-sm text-muted-foreground text-center pt-8">No recent sign-ups found.</p>}
              </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
