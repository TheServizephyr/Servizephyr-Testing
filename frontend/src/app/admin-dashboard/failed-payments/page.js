"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { motion } from "framer-motion";
import { RefreshCw, AlertTriangle, CheckCircle, Clock, XCircle } from "lucide-react";
import { auth } from '@/lib/firebase';
import { getFirestore, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import InfoDialog from "@/components/InfoDialog";

// ADMIN DASHBOARD - Shows ALL failed payments across ALL restaurants
export const dynamic = 'force-dynamic';

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
        },
    },
};

function FailedPaymentsPageContent() {
    const [failedWebhooks, setFailedWebhooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState(null);
    const [filter, setFilter] = useState('pending'); // pending | dead_letter | all
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();

    const loadData = async (isManualRefresh = false) => {
        if (!isManualRefresh) {
            setLoading(true);
        }

        try {
            const firestore = getFirestore();
            let q = query(
                collection(firestore, 'failed_webhooks'),
                orderBy('createdAt', 'desc')
            );

            // Apply filter
            if (filter !== 'all') {
                q = query(
                    collection(firestore, 'failed_webhooks'),
                    where('status', '==', filter),
                    orderBy('createdAt', 'desc')
                );
            }

            const snapshot = await getDocs(q);
            const webhooks = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate(),
                lastTriedAt: doc.data().lastTriedAt?.toDate()
            }));

            setFailedWebhooks(webhooks);
        } catch (error) {
            console.error("Error fetching failed webhooks:", error);
            setInfoDialog({
                isOpen: true,
                title: "Error",
                message: `Could not load failed payments: ${error.message}`
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) loadData();
            else setLoading(false);
        });
        return () => unsubscribe();
    }, [filter]);

    const handleRetry = async (webhookId) => {
        setRetrying(webhookId);

        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required");

            const idToken = await user.getIdToken();

            const res = await fetch('/api/admin/retry-webhook', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ webhookId })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || data.details || 'Retry failed');
            }

            setInfoDialog({
                isOpen: true,
                title: "Success",
                message: `Payment processed successfully! ${data.orderId ? `Order ID: ${data.orderId}` : ''}`
            });

            // Reload data
            await loadData(true);

        } catch (error) {
            console.error("Retry error:", error);
            setInfoDialog({
                isOpen: true,
                title: "Retry Failed",
                message: error.message
            });
        } finally {
            setRetrying(null);
        }
    };

    const getStatusBadge = (status, retryCount) => {
        switch (status) {
            case 'pending':
                return (
                    <span className="flex items-center gap-1 text-xs font-medium text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 rounded-full">
                        <Clock size={12} />
                        Pending ({retryCount}/5)
                    </span>
                );
            case 'processing':
                return (
                    <span className="flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded-full">
                        <RefreshCw size={12} className="animate-spin" />
                        Processing
                    </span>
                );
            case 'resolved':
                return (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full">
                        <CheckCircle size={12} />
                        Resolved
                    </span>
                );
            case 'dead_letter':
                return (
                    <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-full">
                        <XCircle size={12} />
                        Needs Attention
                    </span>
                );
            default:
                return <span className="text-xs text-gray-500">{status}</span>;
        }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-6 p-4 md:p-6 bg-background text-foreground min-h-screen"
        >
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <AlertTriangle className="text-yellow-500" size={32} />
                        Failed Payments (All Restaurants)
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Admin view - Monitor and retry failed webhook payments across all vendors
                    </p>
                </div>
                <motion.button
                    whileTap={{ scale: 0.95, rotate: -15 }}
                    whileHover={{ scale: 1.05 }}
                    className="flex items-center bg-card text-foreground border border-border p-2 rounded-lg font-medium text-sm disabled:opacity-50"
                    onClick={() => loadData(true)}
                    disabled={loading}
                >
                    <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                    <span className="ml-2">{loading ? "Refreshing..." : "Refresh"}</span>
                </motion.button>
            </div>

            {/* Filters */}
            <div className="flex gap-2">
                <button
                    onClick={() => setFilter('all')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${filter === 'all'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-foreground border border-border hover:bg-accent'
                        }`}
                >
                    All
                </button>
                <button
                    onClick={() => setFilter('pending')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${filter === 'pending'
                        ? 'bg-yellow-500 text-white'
                        : 'bg-card text-foreground border border-border hover:bg-accent'
                        }`}
                >
                    Pending
                </button>
                <button
                    onClick={() => setFilter('dead_letter')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${filter === 'dead_letter'
                        ? 'bg-red-500 text-white'
                        : 'bg-card text-foreground border border-border hover:bg-accent'
                        }`}
                >
                    Needs Attention
                </button>
            </div>

            {/* Table */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-muted-foreground">Loading...</div>
                ) : failedWebhooks.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        <CheckCircle className="mx-auto mb-2 text-green-500" size={48} />
                        <p>No failed payments found!</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-muted">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        Customer
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        Payment Details
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        Amount
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        Restaurant
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        Error Details
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        Status / Retries
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        Action
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {failedWebhooks.map((webhook) => (
                                    <tr key={webhook.id} className="hover:bg-accent/50 transition-colors">
                                        <td className="px-4 py-4">
                                            <div className="text-sm">
                                                <div className="font-medium">{webhook.customerName || 'Unknown'}</div>
                                                <div className="text-muted-foreground text-xs">{webhook.customerPhone || 'N/A'}</div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="text-xs space-y-1">
                                                <div className="font-mono text-[10px] text-muted-foreground">
                                                    Pay: {webhook.paymentId?.substring(0, 12)}...
                                                </div>
                                                <div className="font-mono text-[10px] text-muted-foreground">
                                                    Ord: {webhook.orderId?.substring(0, 12) || 'N/A'}
                                                </div>
                                                <div className="text-[10px]">
                                                    <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                                        {webhook.paymentMethod || 'unknown'}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold">
                                            ₹{webhook.amount?.toFixed(2) || '0.00'}
                                        </td>
                                        <td className="px-4 py-4 text-sm">
                                            <div className="max-w-[120px] truncate" title={webhook.restaurantId}>
                                                {webhook.restaurantId || 'Unknown'}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-xs max-w-xs">
                                            <div className="space-y-1">
                                                <div className="font-semibold text-red-600 dark:text-red-400">
                                                    {webhook.errorType || 'Error'}
                                                </div>
                                                <div className="text-muted-foreground truncate" title={webhook.error}>
                                                    {webhook.error || 'Unknown error'}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground">
                                                    {webhook.lastTriedAt?.toLocaleString() || 'Never'}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <div className="space-y-1">
                                                {getStatusBadge(webhook.status, webhook.retryCount)}
                                                <div className="text-[10px] text-muted-foreground">
                                                    {webhook.retryCount || 0} / 5 attempts
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-right text-sm">
                                            {webhook.status === 'pending' && (
                                                <motion.button
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={() => handleRetry(webhook.id)}
                                                    disabled={retrying === webhook.id}
                                                    className="inline-flex items-center px-3 py-1.5 bg-blue-500 text-white rounded-lg font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {retrying === webhook.id ? (
                                                        <>
                                                            <RefreshCw size={12} className="animate-spin mr-1" />
                                                            Retrying...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <RefreshCw size={12} className="mr-1" />
                                                            Retry
                                                        </>
                                                    )}
                                                </motion.button>
                                            )}
                                            {webhook.status === 'dead_letter' && (
                                                <span className="text-xs text-red-600 font-medium">
                                                    Max retries reached
                                                </span>
                                            )}
                                            {webhook.status === 'resolved' && (
                                                <span className="text-xs text-green-600 font-medium">
                                                    ✓ Fixed
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

export default function FailedPaymentsPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <FailedPaymentsPageContent />
        </Suspense>
    );
}
