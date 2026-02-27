'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { Calendar as CalendarIcon, ArrowLeft, RefreshCw, Loader2, RotateCcw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function DineInHistoryPage() {
    const [activeTab, setActiveTab] = useState('completed');
    const [date, setDate] = useState({ from: new Date(), to: new Date() });
    const [historyData, setHistoryData] = useState({ completedOrders: [], cancelledOrders: [] });
    const [loading, setLoading] = useState(true);
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', description: '', onConfirm: null, isLoading: false });

    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const queryParam = impersonatedOwnerId ? `?impersonate_owner_id=${impersonatedOwnerId}` : employeeOfOwnerId ? `?employee_of=${employeeOfOwnerId}` : '';

    const fetchHistory = async (start, end) => {
        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) return;

            const idToken = await user.getIdToken();

            // Extract dates from date object if passed, or use params
            const startDate = start || (date?.from ? format(date.from, 'yyyy-MM-dd') : new Date().toISOString().split('T')[0]);
            const endDate = end || (date?.to ? format(date.to, 'yyyy-MM-dd') : startDate);

            let url = `/api/owner/dine-in-history?startDate=${startDate}&endDate=${endDate}`;

            if (impersonatedOwnerId) {
                url += `&impersonate_owner_id=${impersonatedOwnerId}`;
            } else if (employeeOfOwnerId) {
                url += `&employee_of=${employeeOfOwnerId}`;
            }

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (res.ok) {
                const data = await res.json();
                setHistoryData(data);
            }
        } catch (error) {
            console.error('[History] Fetch error:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHistory();
    }, [date]);

    // Group orders by tab
    const groupedOrders = useMemo(() => {
        const orders = activeTab === 'completed' ? historyData.completedOrders : historyData.cancelledOrders;
        const groups = new Map();

        orders.forEach(order => {
            const tabKey = order.dineInTabId || order.id;
            if (!groups.has(tabKey)) {
                groups.set(tabKey, {
                    tabId: tabKey,
                    tableId: order.tableId,
                    tab_name: order.tab_name || order.customerName,
                    pax_count: order.pax_count,
                    dineInToken: order.dineInToken,
                    orders: []
                });
            }
            groups.get(tabKey).orders.push(order);
        });

        return Array.from(groups.values());
    }, [historyData, activeTab]);

    const handleUndo = (order) => {
        setConfirmDialog({
            isOpen: true,
            title: activeTab === 'completed' ? 'Undo Cleaning' : 'Undo Cancellation',
            description: `Are you sure you want to verify this action? The order will be returned to the live dashboard.`,
            onConfirm: () => executeUndo(order),
            isLoading: false
        });
    };

    const executeUndo = async (order) => {
        setConfirmDialog(prev => ({ ...prev, isLoading: true }));
        try {
            const user = auth.currentUser;
            if (!user) return;

            const idToken = await user.getIdToken();

            let url = '/api/owner/dine-in-history/undo';
            if (impersonatedOwnerId) {
                url += `?impersonate_owner_id=${impersonatedOwnerId}`;
            } else if (employeeOfOwnerId) {
                url += `?employee_of=${employeeOfOwnerId}`;
            }

            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    orderId: order.id,
                    action: activeTab === 'completed' ? 'uncleaned' : 'uncancel'
                })
            });

            if (res.ok) {
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                fetchHistory(); // Refresh
            } else {
                console.error('Undo failed status:', res.status);
            }
        } catch (error) {
            console.error('[Undo] Error:', error);
        } finally {
            setConfirmDialog(prev => ({ ...prev, isLoading: false }));
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground p-4 pb-24">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link href={`/owner-dashboard/dine-in${queryParam}`}>
                    <Button variant="ghost" size="icon">
                        <ArrowLeft />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Dine-In History</h1>
                    <p className="text-sm text-muted-foreground">View completed and cancelled orders</p>
                </div>
            </div>

            {/* Date Range Picker with Calendar */}
            <div className="bg-card border border-border p-4 rounded-xl shadow-sm mb-6 flex justify-center">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className={cn(
                                "justify-start text-left font-normal h-12 text-lg px-6",
                                !date && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-5 w-5" />
                            {date?.from ? (
                                date.to ? (
                                    <>
                                        {format(date.from, "dd MMM")} - {format(date.to, "dd MMM, yyyy")}
                                    </>
                                ) : (
                                    format(date.from, "dd MMM, yyyy")
                                )
                            ) : (
                                <span>Pick a date range</span>
                            )}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <div className="p-3 space-y-3">
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={date?.from}
                                selected={date}
                                onSelect={setDate}
                                numberOfMonths={1}
                            />
                            <Button
                                onClick={() => fetchHistory()}
                                disabled={loading || !date?.from}
                                className="w-full"
                            >
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                Search History
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-2 bg-card p-1 rounded-lg border border-border mb-6">
                <button
                    onClick={() => setActiveTab('completed')}
                    className={cn(
                        'flex-1 px-4 py-2 text-sm font-semibold rounded-md transition-colors',
                        activeTab === 'completed'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                    )}
                >
                    Completed ({historyData.totalCompleted || 0})
                </button>
                <button
                    onClick={() => setActiveTab('cancelled')}
                    className={cn(
                        'flex-1 px-4 py-2 text-sm font-semibold rounded-md transition-colors',
                        activeTab === 'cancelled'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                    )}
                >
                    Cancelled ({historyData.totalCancelled || 0})
                </button>
            </div>

            {/* Grouped Orders List */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="h-64 bg-muted rounded-xl animate-pulse" />
                    ))}
                </div>
            ) : groupedOrders.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groupedOrders.map(group => (
                        <TabCard key={group.tabId} group={group} type={activeTab} onUndo={handleUndo} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                    <p className="text-lg font-semibold">No {activeTab} orders</p>
                    <p className="mt-2">
                        for {date?.from ? format(date.from, 'MMM d') : 'selected date'} - {date?.to ? format(date.to, 'MMM d, yyyy') : 'today'}
                    </p>
                </div>
            )}


            <Dialog open={confirmDialog.isOpen} onOpenChange={(open) => !open && setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{confirmDialog.title}</DialogTitle>
                        <DialogDescription>{confirmDialog.description}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>Cancel</Button>
                        <Button
                            onClick={confirmDialog.onConfirm}
                            disabled={confirmDialog.isLoading}
                        >
                            {confirmDialog.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirm
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}


function TabCard({ group, type, onUndo }) {
    const isCompleted = type === 'completed';
    const totalAmount = group.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    // Safe date extraction with fallback
    const getOrderDate = (order) => {
        try {
            if (!order || !order.orderDate) {
                console.warn('[Date] No orderDate found:', order?.id);
                return new Date();
            }

            // Handle Firestore Timestamp
            if (typeof order.orderDate.toDate === 'function') {
                return order.orderDate.toDate();
            }

            // Handle {_seconds, _nanoseconds} format (Next.js serialized)
            if (order.orderDate._seconds) {
                const date = new Date(order.orderDate._seconds * 1000);
                console.log('[Date] ✅ Parsed from _seconds:', date);
                return date;
            }

            // Handle {seconds, nanoseconds} format
            if (order.orderDate.seconds) {
                const date = new Date(order.orderDate.seconds * 1000);
                console.log('[Date] ✅ Parsed from seconds:', date);
                return date;
            }

            // Handle ISO string or timestamp
            const date = new Date(order.orderDate);
            if (!isNaN(date.getTime())) {
                console.log('[Date] Parsed as ISO/timestamp:', date);
                return date;
            }

            // Fallback to now
            console.warn('[Date] ❌ All parsing failed, using current time for:', order.id);
            return new Date();
        } catch (error) {
            console.error('[Date Parse Error]', order?.id, error);
            return new Date();
        }
    };

    return (
        <div className={cn(
            "p-4 rounded-xl border-2",
            isCompleted ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"
        )}>
            <div className="flex justify-between items-start mb-3">
                <div>
                    <h3 className="font-bold text-2xl">{group.tableId || 'Unknown'}</h3>
                    <p className="text-sm text-muted-foreground">
                        {group.tab_name || 'Guest'} ({group.pax_count || 1} guests)
                    </p>
                </div>
                <div className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold",
                    isCompleted ? "bg-green-500 text-white" : "bg-red-500 text-white"
                )}>
                    {isCompleted ? 'Completed' : 'Cancelled'}
                </div>
            </div>

            {/* Token Display */}
            {group.dineInToken && (
                <div className="bg-muted/30 px-3 py-2 rounded-lg mb-3">
                    <p className="text-xs text-muted-foreground">Token</p>
                    <p className="text-lg font-bold font-mono">{group.dineInToken}</p>
                </div>
            )}

            {/* Multiple orders indicator */}
            {group.orders.length > 1 && (
                <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                    <Users size={14} />
                    <span>{group.orders.length} orders in this tab</span>
                </div>
            )}

            {/* All items from all orders */}
            <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
                {group.orders.map((order, orderIdx) => (
                    <div key={order.id} className={cn(
                        "border-l-2 pl-2",
                        orderIdx > 0 && "border-muted pt-2"
                    )}>
                        {order.items?.map((item, idx) => (
                            <div key={idx} className="text-sm">
                                <span className="font-medium">{item.quantity}× {item.name}</span>
                                {item.selectedAddons?.length > 0 && (
                                    <span className="text-xs text-muted-foreground block pl-4">
                                        + {item.selectedAddons.map(a => a.name).join(', ')}
                                    </span>
                                )}
                            </div>
                        ))}
                        {orderIdx < group.orders.length - 1 && (
                            <div className="text-xs text-muted-foreground mt-1">
                                Order {orderIdx + 1} • {format(getOrderDate(order), 'p')}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Total */}
            <div className="flex justify-between items-center pt-3 border-t border-border">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-2xl font-bold text-green-500">₹{totalAmount}</span>
            </div>

            {/* Time */}
            <div className="text-xs text-muted-foreground mt-2 text-right">
                {format(getOrderDate(group.orders[group.orders.length - 1]), 'dd/MM/yy, p')}
            </div>

            {/* Undo Button */}
            <Button
                variant="outline"
                size="sm"
                onClick={() => onUndo(group.orders[0])}
                className="w-full mt-3 border-orange-500 text-orange-500 hover:bg-orange-500/10"
            >
                <RotateCcw className="mr-2 h-4 w-4" />
                Undo {isCompleted ? 'Cleaning' : 'Cancellation'}
            </Button>
        </div>
    );
}
