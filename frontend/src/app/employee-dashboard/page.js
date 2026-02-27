'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Building2, ChefHat, UtensilsCrossed, CreditCard, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function EmployeeDashboardHome() {
    const { user, firestore } = useFirebase();
    const [employeeData, setEmployeeData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        async function fetchData() {
            try {
                const userDoc = await getDoc(doc(firestore, 'users', user.uid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    const activeOutlet = userData.linkedOutlets?.find(o => o.isActive) || userData.linkedOutlets?.[0];
                    setEmployeeData({
                        name: userData.name,
                        role: activeOutlet?.employeeRole,
                        outletName: activeOutlet?.outletName,
                        permissions: activeOutlet?.permissions || [],
                    });
                }
            } catch (error) {
                console.error('Error:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [user, firestore]);

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-screen bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    const getRoleIcon = (role) => {
        switch (role) {
            case 'chef': return ChefHat;
            case 'waiter': return UtensilsCrossed;
            case 'cashier': return CreditCard;
            default: return Building2;
        }
    };

    const getRoleGradient = (role) => {
        switch (role) {
            case 'chef': return 'from-orange-500 to-red-500';
            case 'waiter': return 'from-blue-500 to-cyan-500';
            case 'cashier': return 'from-green-500 to-emerald-500';
            case 'manager': return 'from-purple-500 to-pink-500';
            default: return 'from-primary to-primary/70';
        }
    };

    const getRoleMessage = (role) => {
        switch (role) {
            case 'chef': return 'Go to Kitchen to see incoming orders';
            case 'waiter': return 'Go to Dine-in to manage tables';
            case 'cashier': return 'Go to Billing to process payments';
            case 'manager': return 'You have access to all sections';
            default: return 'Select an option from the sidebar';
        }
    };

    const RoleIcon = getRoleIcon(employeeData?.role);

    return (
        <div className="p-4 md:p-6 min-h-screen bg-background">
            {/* Welcome Card */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("bg-gradient-to-r rounded-2xl p-6 mb-6 shadow-lg", getRoleGradient(employeeData?.role))}
            >
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                        <RoleIcon className="w-8 h-8 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">
                            Welcome, {employeeData?.name?.split(' ')[0]}!
                        </h1>
                        <p className="text-white/80">
                            {employeeData?.outletName} • <span className="capitalize">{employeeData?.role}</span>
                        </p>
                    </div>
                </div>
            </motion.div>

            {/* Quick Stats */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
            >
                <div className="bg-card rounded-xl p-4 border border-border">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center">
                            <Clock className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <p className="text-muted-foreground text-xs">Shift Status</p>
                            <p className="text-foreground font-semibold">Active</p>
                        </div>
                    </div>
                </div>

                <div className="bg-card rounded-xl p-4 border border-border">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                            <span className="text-green-400 font-bold">✓</span>
                        </div>
                        <div>
                            <p className="text-muted-foreground text-xs">Today&apos;s Orders</p>
                            <p className="text-foreground font-semibold">-</p>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Role-specific message */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-card/50 rounded-xl p-6 text-center border border-border"
            >
                <p className="text-muted-foreground">
                    {getRoleMessage(employeeData?.role)}
                </p>
            </motion.div>
        </div>
    );
}
