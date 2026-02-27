'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useUser } from '@/firebase';
import { Building2, Users, ChefHat, Store, ShoppingCart, User, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import { ROLE_DISPLAY_NAMES } from '@/lib/permissions';

export default function SelectRolePage() {
    const router = useRouter();
    const { user, isUserLoading } = useUser();
    const [loading, setLoading] = useState(true);
    const [roleData, setRoleData] = useState(null);
    const [selectedRole, setSelectedRole] = useState(null);

    useEffect(() => {
        if (isUserLoading) return;

        if (!user) {
            router.push('/');
            return;
        }

        async function fetchRoles() {
            try {
                const idToken = await user.getIdToken();
                const res = await fetch('/api/auth/check-role', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                    },
                });

                const data = await res.json();

                if (!res.ok) {
                    router.push('/');
                    return;
                }

                // If user doesn't have multiple roles, redirect to appropriate dashboard
                if (!data.hasMultipleRoles) {
                    redirectToDashboard(data);
                    return;
                }

                setRoleData(data);
                setLoading(false);
            } catch (err) {
                console.error('Error fetching roles:', err);
                router.push('/');
            }
        }

        fetchRoles();
    }, [user, isUserLoading, router]);

    const setRoleContext = (role, businessType = null) => {
        localStorage.setItem('role', role);
        if (businessType) {
            const rawBusinessType = String(businessType).trim().toLowerCase();
            const normalizedBusinessType = rawBusinessType === 'street_vendor'
                ? 'street-vendor'
                : (rawBusinessType === 'shop' ? 'store' : rawBusinessType);
            localStorage.setItem('businessType', normalizedBusinessType);
        } else {
            localStorage.removeItem('businessType');
        }
    };

    const redirectToDashboard = (data) => {
        const { role, businessType, redirectTo } = data;

        const resolvedBusinessType =
            (businessType
                ? (businessType === 'street_vendor' ? 'street-vendor' : (businessType === 'shop' ? 'store' : businessType))
                : null) ||
            (role === 'shop-owner'
                ? 'store'
                : role === 'street-vendor'
                    ? 'street-vendor'
                    : (role === 'owner' || role === 'restaurant-owner')
                        ? 'restaurant'
                        : null);

        if (redirectTo) {
            setRoleContext(data.role || 'employee', null);
            router.push(redirectTo);
            return;
        }

        if (role === 'owner' || role === 'restaurant-owner' || role === 'shop-owner') {
            setRoleContext(role, resolvedBusinessType);
            router.push('/owner-dashboard');
        } else if (role === 'street-vendor') {
            setRoleContext(role, resolvedBusinessType || 'street-vendor');
            router.push('/street-vendor-dashboard');
        } else if (role === 'admin') {
            setRoleContext(role, null);
            router.push('/admin-dashboard');
        } else if (role === 'rider') {
            setRoleContext(role, null);
            router.push('/rider-dashboard');
        } else {
            setRoleContext(role || 'customer', null);
            router.push('/customer-dashboard');
        }
    };

    const handleSelectRole = async (roleType, outlet = null) => {
        setSelectedRole(roleType);

        // Small delay for visual feedback
        await new Promise(r => setTimeout(r, 300));

        if (roleType === 'owner') {
            const { businessType, role } = roleData;
            // Clear any employee context
            localStorage.removeItem('activeOutletId');
            localStorage.removeItem('activeOwnerId');
            localStorage.removeItem('activeOutletName');
            localStorage.removeItem('employeeRole');

            if (role === 'street-vendor') {
                setRoleContext('street-vendor', businessType || 'street-vendor');
                router.push('/street-vendor-dashboard');
            } else {
                const resolvedBusinessType =
                    (businessType
                        ? (businessType === 'street_vendor' ? 'street-vendor' : (businessType === 'shop' ? 'store' : businessType))
                        : null) ||
                    (role === 'shop-owner' ? 'store' : 'restaurant');
                setRoleContext(role || 'owner', resolvedBusinessType);
                router.push('/owner-dashboard');
            }
        } else if (roleType === 'admin') {
            // Clear any employee context
            localStorage.removeItem('activeOutletId');
            localStorage.removeItem('activeOwnerId');
            localStorage.removeItem('activeOutletName');
            localStorage.removeItem('employeeRole');
            setRoleContext('admin', null);
            router.push('/admin-dashboard');
        } else if (roleType === 'customer') {
            // Clear any employee context
            localStorage.removeItem('activeOutletId');
            localStorage.removeItem('activeOwnerId');
            localStorage.removeItem('activeOutletName');
            localStorage.removeItem('employeeRole');

            setRoleContext('customer', null);
            router.push('/customer-dashboard');
        } else if (roleType === 'employee' && outlet) {
            // Store active outlet info in localStorage for API calls
            localStorage.setItem('activeOutletId', outlet.outletId);
            localStorage.setItem('activeOwnerId', outlet.ownerId);
            localStorage.setItem('activeOutletName', outlet.outletName);
            localStorage.setItem('employeeRole', outlet.employeeRole);
            setRoleContext('employee', null);

            // Redirect to outlet's dashboard with owner ID as query param
            // This allows APIs to fetch owner's data instead of employee's
            if (outlet.collectionName === 'street_vendors') {
                router.push(`/street-vendor-dashboard?employee_of=${outlet.ownerId}`);
            } else if (outlet.employeeRole === 'manager') {
                router.push(`/owner-dashboard?employee_of=${outlet.ownerId}`);
            } else {
                router.push(`/owner-dashboard/live-orders?employee_of=${outlet.ownerId}`);
            }
        }
    };

    const getRoleIcon = (role) => {
        switch (role) {
            case 'owner':
            case 'street-vendor':
            case 'restaurant-owner':
            case 'shop-owner':
                return Store;
            case 'manager':
                return Users;
            case 'chef':
                return ChefHat;
            case 'customer':
                return ShoppingCart;
            default:
                return User;
        }
    };

    if (loading || isUserLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-yellow-500 mx-auto mb-4" />
                    <p className="text-slate-500 dark:text-slate-400">Loading your accounts...</p>
                </div>
            </div>
        );
    }

    if (!roleData) return null;

    const { role: primaryRole, businessType, linkedOutlets } = roleData;
    const isOwnerOrVendor = primaryRole === 'owner' || primaryRole === 'street-vendor' || primaryRole === 'restaurant-owner' || primaryRole === 'shop-owner';

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-xl"
            >
                {/* Logo */}
                <div className="flex justify-center mb-6">
                    <Image src="/logo.png" alt="ServiZephyr" width={48} height={48} />
                </div>

                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Multiple Accounts Detected
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Choose which account to access
                    </p>
                </div>

                {/* Role Options */}
                <div className="space-y-3">
                    {/* Owner/Vendor Account */}
                    {isOwnerOrVendor && (
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleSelectRole('owner')}
                            disabled={selectedRole}
                            className={`w-full bg-gradient-to-r from-yellow-500 to-amber-500 text-black rounded-xl p-4 flex items-center gap-4 transition-all ${selectedRole === 'owner' ? 'ring-2 ring-yellow-500 ring-offset-2' : ''
                                }`}
                        >
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                <Store className="w-6 h-6" />
                            </div>
                            <div className="flex-1 text-left">
                                <p className="font-bold text-lg">My Business</p>
                                <p className="text-sm opacity-80">
                                    {primaryRole === 'street-vendor' ? 'Street Vendor Dashboard' : 'Owner Dashboard'}
                                </p>
                            </div>
                            {selectedRole === 'owner' ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <ArrowRight className="w-5 h-5" />
                            )}
                        </motion.button>
                    )}

                    {/* Admin Account */}
                    {primaryRole === 'admin' && (
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleSelectRole('admin')}
                            disabled={selectedRole}
                            className={`w-full bg-gradient-to-r from-purple-500 to-violet-500 text-white rounded-xl p-4 flex items-center gap-4 transition-all ${selectedRole === 'admin' ? 'ring-2 ring-purple-500 ring-offset-2' : ''
                                }`}
                        >
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                <User className="w-6 h-6" />
                            </div>
                            <div className="flex-1 text-left">
                                <p className="font-bold text-lg">Admin Dashboard</p>
                                <p className="text-sm opacity-80">Manage the platform</p>
                            </div>
                            {selectedRole === 'admin' ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <ArrowRight className="w-5 h-5" />
                            )}
                        </motion.button>
                    )}

                    {/* Customer Account */}
                    {primaryRole === 'customer' && (
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleSelectRole('customer')}
                            disabled={selectedRole}
                            className={`w-full bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl p-4 flex items-center gap-4 transition-all ${selectedRole === 'customer' ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                                }`}
                        >
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                <ShoppingCart className="w-6 h-6" />
                            </div>
                            <div className="flex-1 text-left">
                                <p className="font-bold text-lg">Customer</p>
                                <p className="text-sm opacity-80">Order from restaurants</p>
                            </div>
                            {selectedRole === 'customer' ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <ArrowRight className="w-5 h-5" />
                            )}
                        </motion.button>
                    )}

                    {/* Divider */}
                    {linkedOutlets?.length > 0 && (
                        <div className="flex items-center gap-3 py-2">
                            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                            <span className="text-sm text-slate-400">Employee at</span>
                            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                        </div>
                    )}

                    {/* Employee Outlets */}
                    {linkedOutlets?.map((outlet, index) => {
                        const RoleIcon = getRoleIcon(outlet.employeeRole);
                        const roleDisplay = ROLE_DISPLAY_NAMES[outlet.employeeRole] || outlet.employeeRole;
                        const isSelected = selectedRole === `employee-${index}`;

                        return (
                            <motion.button
                                key={outlet.outletId}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => {
                                    setSelectedRole(`employee-${index}`);
                                    setTimeout(() => handleSelectRole('employee', outlet), 300);
                                }}
                                disabled={selectedRole}
                                className={`w-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-xl p-4 flex items-center gap-4 transition-all ${isSelected ? 'ring-2 ring-green-500 ring-offset-2' : ''
                                    }`}
                            >
                                <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center">
                                    <RoleIcon className="w-6 h-6 text-green-500" />
                                </div>
                                <div className="flex-1 text-left">
                                    <p className="font-bold">{outlet.outletName}</p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        {roleDisplay}
                                    </p>
                                </div>
                                {isSelected ? (
                                    <Loader2 className="w-5 h-5 animate-spin text-green-500" />
                                ) : (
                                    <ArrowRight className="w-5 h-5 text-slate-400" />
                                )}
                            </motion.button>
                        );
                    })}
                </div>

                {/* Footer */}
                <p className="text-slate-400 text-xs text-center mt-6">
                    You can switch accounts anytime from settings
                </p>
            </motion.div>
        </div>
    );
}
