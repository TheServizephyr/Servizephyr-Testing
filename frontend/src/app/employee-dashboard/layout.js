'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
    ChefHat,
    UtensilsCrossed,
    CreditCard,
    LogOut,
    Menu as MenuIcon,
    X,
    Home,
    ClipboardList,
    User,
    Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PERMISSIONS } from '@/lib/permissions';

// Navigation items based on role/permissions
const getNavItems = (permissions, role) => {
    const items = [];

    // Dashboard/Home for everyone
    items.push({
        name: 'Dashboard',
        nameHi: 'डैशबोर्ड',
        href: '/employee-dashboard',
        icon: Home,
    });

    // Kitchen (Chef)
    if (permissions.includes(PERMISSIONS.VIEW_KITCHEN_ORDERS) ||
        permissions.includes(PERMISSIONS.MARK_ORDER_READY) ||
        role === 'chef' || role === 'manager') {
        items.push({
            name: 'Kitchen',
            nameHi: 'रसोई',
            href: '/employee-dashboard/kitchen',
            icon: ChefHat,
        });
    }

    // Dine-in (Waiter)
    if (permissions.includes(PERMISSIONS.MANAGE_DINE_IN) ||
        permissions.includes(PERMISSIONS.VIEW_DINE_IN_ORDERS) ||
        role === 'waiter' || role === 'manager') {
        items.push({
            name: 'Dine-in',
            nameHi: 'डाइन-इन',
            href: '/employee-dashboard/dine-in',
            icon: UtensilsCrossed,
        });
    }

    // Billing (Cashier)
    if (permissions.includes(PERMISSIONS.GENERATE_BILL) ||
        permissions.includes(PERMISSIONS.PROCESS_PAYMENT) ||
        role === 'cashier' || role === 'manager') {
        items.push({
            name: 'Billing',
            nameHi: 'बिलिंग',
            href: '/employee-dashboard/billing',
            icon: CreditCard,
        });
    }

    // All Orders (if can view all orders)
    if (permissions.includes(PERMISSIONS.VIEW_ALL_ORDERS) || role === 'manager') {
        items.push({
            name: 'All Orders',
            nameHi: 'सभी ऑर्डर',
            href: '/employee-dashboard/orders',
            icon: ClipboardList,
        });
    }

    return items;
};

export default function EmployeeDashboardLayout({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const { user, firestore, auth } = useFirebase();

    const [loading, setLoading] = useState(true);
    const [employeeData, setEmployeeData] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Fetch employee data on mount
    useEffect(() => {
        if (!user) {
            router.push('/login');
            return;
        }

        async function fetchEmployeeData() {
            try {
                const userDoc = await getDoc(doc(firestore, 'users', user.uid));

                if (!userDoc.exists()) {
                    router.push('/login');
                    return;
                }

                const userData = userDoc.data();

                // Check if user has employee role
                if (!userData.linkedOutlets || userData.linkedOutlets.length === 0) {
                    // Not an employee, redirect
                    router.push('/select-role');
                    return;
                }

                // Get active outlet (or first one)
                const activeOutlet = userData.linkedOutlets.find(o => o.isActive) || userData.linkedOutlets[0];

                setEmployeeData({
                    name: userData.name,
                    email: userData.email,
                    role: activeOutlet.employeeRole,
                    permissions: activeOutlet.permissions || [],
                    outletId: activeOutlet.outletId,
                    outletName: activeOutlet.outletName,
                });

            } catch (error) {
                console.error('Error fetching employee data:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchEmployeeData();
    }, [user, firestore, router]);

    // Handle logout
    async function handleLogout() {
        try {
            await auth.signOut();
            router.push('/login');
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    // Subtle haptic feedback
    const vibrateOnClick = () => {
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        );
    }

    if (!employeeData) {
        return null;
    }

    const navItems = getNavItems(employeeData.permissions, employeeData.role);

    const roleColors = {
        manager: 'text-purple-400',
        chef: 'text-orange-400',
        waiter: 'text-blue-400',
        cashier: 'text-green-400',
        order_taker: 'text-slate-400',
    };

    return (
        <div className="min-h-screen bg-background">
            {/* Mobile Header */}
            <header className="lg:hidden bg-card border-b border-border px-4 py-3 flex items-center justify-between">
                <button
                    onClick={() => { setSidebarOpen(true); vibrateOnClick(); }}
                    className="text-foreground p-2"
                >
                    <MenuIcon className="w-6 h-6" />
                </button>
                <div className="text-center">
                    <h1 className="text-foreground font-semibold">{employeeData.outletName}</h1>
                    <p className={cn("text-xs capitalize", roleColors[employeeData.role] || 'text-muted-foreground')}>
                        {employeeData.role}
                    </p>
                </div>
                <div className="w-10" /> {/* Spacer */}
            </header>

            {/* Mobile Sidebar Overlay */}
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="lg:hidden fixed inset-0 bg-black/50 z-40"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={cn(
                "fixed top-0 left-0 h-full w-64 bg-card border-r border-border z-50",
                "transform transition-transform duration-300 ease-in-out",
                sidebarOpen ? 'translate-x-0' : '-translate-x-full',
                "lg:translate-x-0"
            )}>
                {/* Sidebar Header */}
                <div className="p-4 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-foreground font-bold">{employeeData.outletName}</h2>
                            <p className={cn("text-sm capitalize", roleColors[employeeData.role] || 'text-muted-foreground')}>
                                {employeeData.role}
                            </p>
                        </div>
                        <button
                            onClick={() => { setSidebarOpen(false); vibrateOnClick(); }}
                            className="lg:hidden text-muted-foreground hover:text-foreground"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="p-4 space-y-2">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <button
                                key={item.href}
                                onClick={() => {
                                    vibrateOnClick();
                                    router.push(item.href);
                                    setSidebarOpen(false);
                                }}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl",
                                    "transition-all duration-200",
                                    isActive
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                )}
                            >
                                <item.icon className="w-5 h-5" />
                                <span>{item.name}</span>
                                {item.nameHi && (
                                    <span className="text-xs opacity-60">({item.nameHi})</span>
                                )}
                            </button>
                        );
                    })}
                </nav>

                {/* User Section */}
                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                            <User className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-foreground font-medium truncate">{employeeData.name}</p>
                            <p className="text-muted-foreground text-xs truncate">{employeeData.email}</p>
                        </div>
                    </div>
                    <Button
                        onClick={() => { vibrateOnClick(); handleLogout(); }}
                        variant="ghost"
                        className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                        <LogOut className="w-4 h-4 mr-2" />
                        Logout
                    </Button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="lg:ml-64 min-h-screen">
                {children}
            </main>
        </div>
    );
}
