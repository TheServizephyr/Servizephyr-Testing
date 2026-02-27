'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowLeft, Package, MapPin, Calendar, DollarSign, CreditCard, TrendingUp } from 'lucide-react';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

export default function RiderHistoryPage() {
    const router = useRouter();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [deliveries, setDeliveries] = useState([]);
    const [stats, setStats] = useState({
        totalDeliveries: 0,
        totalEarnings: 0,
        todayEarnings: 0,
        weeklyEarnings: 0
    });
    const [filter, setFilter] = useState('all');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                fetchDeliveryHistory(currentUser.uid);
            } else {
                router.push('/rider-auth');
            }
        });
        return () => unsubscribe();
    }, []);

    const fetchDeliveryHistory = async (uid) => {
        try {
            setLoading(true);

            // Fetch completed deliveries (no orderBy to handle missing deliveredAt)
            const ordersQuery = query(
                collection(db, 'orders'),
                where('deliveryBoyId', '==', uid),
                where('status', 'in', ['delivered', 'returned']),
                limit(100)
            );

            const snapshot = await getDocs(ordersQuery);
            const deliveryData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                deliveredAt: doc.data().deliveredAt?.toDate() || doc.data().updatedAt?.toDate() || new Date()
            }));

            // Sort in memory by deliveredAt (newest first)
            deliveryData.sort((a, b) => b.deliveredAt - a.deliveredAt);

            setDeliveries(deliveryData);
            calculateStats(deliveryData);
        } catch (error) {
            console.error('[History] Error fetching deliveries:', error);
        } finally {
            setLoading(false);
        }
    };

    const calculateStats = (deliveries) => {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(now.setDate(now.getDate() - 7));

        const stats = deliveries.reduce((acc, delivery) => {
            const earnings = (delivery.tipAmount || 0) + (delivery.deliveryFee || 0);
            acc.totalEarnings += earnings;

            if (delivery.deliveredAt >= todayStart) {
                acc.todayEarnings += earnings;
            }
            if (delivery.deliveredAt >= weekStart) {
                acc.weeklyEarnings += earnings;
            }
            return acc;
        }, {
            totalDeliveries: deliveries.length,
            totalEarnings: 0,
            todayEarnings: 0,
            weeklyEarnings: 0
        });

        setStats(stats);
    };

    const formatDate = (date) => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return `Today, ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
        } else if (date.toDateString() === yesterday.toDateString()) {
            return `Yesterday, ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
        }
        return date.toLocaleString('en-IN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const filteredDeliveries = deliveries.filter(delivery => {
        if (filter === 'all') return true;

        const now = new Date();
        const deliveryDate = delivery.deliveredAt;

        if (filter === 'today') {
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return deliveryDate >= todayStart;
        }
        if (filter === 'week') {
            const weekStart = new Date(now.setDate(now.getDate() - 7));
            return deliveryDate >= weekStart;
        }
        if (filter === 'month') {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            return deliveryDate >= monthStart;
        }
        return true;
    });

    if (loading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
                <GoldenCoinSpinner />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 pb-20">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 shadow-lg">
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 mb-4 text-white/90 hover:text-white transition-colors"
                >
                    <ArrowLeft size={20} />
                    <span>Back</span>
                </button>

                <h1 className="text-3xl font-black mb-2">📜 Delivery History</h1>
                <p className="text-white/80">Your completed deliveries and earnings</p>
            </div>

            <div className="px-4 py-6 grid grid-cols-2 gap-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl p-4 shadow-lg border-2 border-green-200"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <TrendingUp size={20} className="text-green-600" />
                        <span className="text-xs text-gray-600 font-medium">Total Earnings</span>
                    </div>
                    <h3 className="text-2xl font-black text-green-600">₹{stats.totalEarnings.toFixed(2)}</h3>
                    <p className="text-xs text-gray-500 mt-1">{stats.totalDeliveries} deliveries</p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white rounded-2xl p-4 shadow-lg border-2 border-blue-200"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <Calendar size={20} className="text-blue-600" />
                        <span className="text-xs text-gray-600 font-medium">Today</span>
                    </div>
                    <h3 className="text-2xl font-black text-blue-600">₹{stats.todayEarnings.toFixed(2)}</h3>
                    <p className="text-xs text-gray-500 mt-1">Last 24 hours</p>
                </motion.div>
            </div>

            <div className="px-4 mb-4 flex gap-2 overflow-x-auto pb-2">
                {['all', 'today', 'week', 'month'].map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${filter === f
                            ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg'
                            : 'bg-white text-gray-600 border-2 border-gray-200'
                            }`}
                    >
                        {f === 'all' ? 'All Time' : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                ))}
            </div>

            <div className="px-4 space-y-4">
                <AnimatePresence>
                    {filteredDeliveries.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="bg-white rounded-2xl p-8 text-center shadow-lg"
                        >
                            <Package size={48} className="mx-auto text-gray-300 mb-4" />
                            <h3 className="text-lg font-bold text-gray-600 mb-2">No Deliveries Found</h3>
                            <p className="text-sm text-gray-400">Try changing the filter</p>
                        </motion.div>
                    ) : (
                        filteredDeliveries.map((delivery, index) => (
                            <motion.div
                                key={delivery.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ delay: index * 0.05 }}
                                className="bg-white rounded-2xl p-5 shadow-lg border-2 border-gray-100 hover:border-blue-300 transition-all"
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-800">{delivery.customerName}</h3>
                                        <p className="text-xs text-gray-500">Order #{delivery.customerOrderId || delivery.id.substring(0, 8)}</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xl font-black text-gray-800">
                                            ₹{(delivery.totalAmount || 0).toFixed(2)}
                                        </div>
                                        <div className="text-xs text-gray-400">Order Value</div>
                                        {(delivery.tipAmount > 0 || delivery.deliveryFee > 0) && (
                                            <div className="text-xs text-green-600 font-bold mt-1">
                                                + ₹{((delivery.tipAmount || 0) + (delivery.deliveryFee || 0)).toFixed(2)} Earned
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-start gap-2 mb-3 text-sm text-gray-600">
                                    <MapPin size={16} className="mt-0.5 flex-shrink-0 text-blue-600" />
                                    <span className="line-clamp-2">{delivery.customerAddress}</span>
                                </div>

                                <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                                    <div className="flex items-center gap-2">
                                        <Calendar size={14} className="text-gray-400" />
                                        <span className="text-gray-600">{formatDate(delivery.deliveredAt)}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {delivery.paymentMethod === 'cash' ? (
                                            <>
                                                <DollarSign size={14} className="text-green-600" />
                                                <span className="text-green-600 font-semibold">Cash Collected</span>
                                            </>
                                        ) : (
                                            <>
                                                <CreditCard size={14} className="text-blue-600" />
                                                <span className="text-blue-600 font-semibold">Paid Online</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {(delivery.tipAmount > 0 || delivery.deliveryFee > 0) && (
                                    <div className="pt-3 border-t border-gray-100 space-y-1 text-xs">
                                        {delivery.deliveryFee > 0 && (
                                            <div className="flex justify-between text-gray-600">
                                                <span>Delivery Fee:</span>
                                                <span className="font-semibold">₹{delivery.deliveryFee.toFixed(2)}</span>
                                            </div>
                                        )}
                                        {delivery.tipAmount > 0 && (
                                            <div className="flex justify-between text-green-600">
                                                <span>Tip:</span>
                                                <span className="font-semibold">₹{delivery.tipAmount.toFixed(2)}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="mt-3 flex items-center justify-between">
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${delivery.status === 'delivered'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-100 text-gray-700'
                                        }`}>
                                        {delivery.status === 'delivered' ? '✅ Delivered' : '🔄 Returned'}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                        {delivery.restaurantName || 'Restaurant'}
                                    </span>
                                </div>
                            </motion.div>
                        ))
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
