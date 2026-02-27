

"use client";

import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, Star, AlertTriangle, Sparkles, X, History, Gift, StickyNote, IndianRupee, Mail, Users, UserPlus, Repeat, Crown, Search, Filter, ShieldCheck, User, Trophy, TrendingUp, TrendingDown, Clock3, BarChart3, Medal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from "@/lib/utils";
import { auth } from '@/lib/firebase';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from "@/components/ui/calendar";
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Wand2, Ticket, Percent, Truck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';

export const dynamic = 'force-dynamic';
const CUSTOMER_HUB_CACHE_TTL_MS = 2 * 60 * 1000;

const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    // Handle Firestore Timestamp object if it comes
    if (dateString.seconds) {
        return new Date(dateString.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'N/A'; // Invalid date
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');

const formatWeekRange = (period) => {
    if (!period?.weekStart || !period?.weekEnd) return 'N/A';
    const start = formatDate(period.weekStart);
    const end = formatDate(period.weekEnd);
    return `${start} - ${end}`;
};

const getDateMs = (value) => {
    if (!value) return 0;
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};


// --- HELPER FUNCTIONS FOR STATUS ---
const getCustomerStatus = (customer) => {
    if (!customer) return 'New';

    // Unclaimed is the most base status
    if (customer.status === 'unclaimed') return 'Claimed';

    const lastOrderDate = customer.lastOrderDate?.seconds ? new Date(customer.lastOrderDate.seconds * 1000) : new Date(customer.lastOrderDate);
    if (isNaN(lastOrderDate.getTime())) return 'New';

    const daysSinceLastOrder = (new Date() - lastOrderDate) / (1000 * 60 * 60 * 24);

    if (customer.totalOrders > 10) return 'Loyal';
    if (daysSinceLastOrder > 60) return 'At Risk';
    if (customer.totalOrders <= 2) return 'New';
    return 'Active';
}

// --- SUB-COMPONENTS (Single File) ---

const CustomerBadge = ({ status }) => {
    if (status === 'Loyal') {
        return <span title="Loyal Customer" className="flex items-center gap-1 text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded-full"><Star size={12} /> Loyal</span>;
    }
    if (status === 'At Risk') {
        return <span title="At Risk" className="flex items-center gap-1 text-xs text-red-500 bg-red-500/10 px-2 py-1 rounded-full"><AlertTriangle size={12} /> At Risk</span>;
    }
    if (status === 'New') {
        return <span title="New Customer" className="flex items-center gap-1 text-xs text-blue-500 bg-blue-500/10 px-2 py-1 rounded-full"><Sparkles size={12} /> New</span>;
    }
    if (status === 'Claimed') {
        return <span title="Claimed via Order" className="flex items-center gap-1 text-xs text-indigo-500 bg-indigo-500/10 px-2 py-1 rounded-full"><ShieldCheck size={12} /> Claimed</span>;
    }
    return <span title="Active Customer" className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full"><Users size={12} /> Active</span>;
};

const SortableHeader = ({ children, column, sortConfig, onSort }) => {
    const isSorted = sortConfig.key === column;
    const direction = isSorted ? sortConfig.direction : 'desc';
    const Icon = direction === 'asc' ? ChevronUp : ChevronDown;

    return (
        <th onClick={() => onSort(column)} className="cursor-pointer p-4 text-left text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors">
            <div className="flex items-center gap-2">
                {children}
                {isSorted && <Icon size={16} />}
            </div>
        </th>
    );
};

const CouponModal = ({ isOpen, setIsOpen, onSave, customer }) => {
    const [coupon, setCoupon] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [modalError, setModalError] = useState('');

    useEffect(() => {
        if (isOpen && customer) {
            setModalError('');
            setCoupon({
                code: '',
                description: `Special reward for ${customer.name}`,
                type: 'flat',
                value: '',
                minOrder: '',
                startDate: new Date(),
                expiryDate: new Date(new Date().setDate(new Date().getDate() + 30)),
                status: 'Active',
                customerId: customer.id, // Associate coupon with customer
            });
        }
    }, [isOpen, customer]);

    if (!coupon) return null;

    const handleChange = (field, value) => {
        setCoupon(prev => (prev ? { ...prev, [field]: value } : null));
    };

    const generateRandomCode = () => {
        const code = `VIP-${customer.name.split(' ')[0].toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        handleChange('code', code);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setModalError('');
        if (!coupon.code || !coupon.value || !coupon.minOrder) {
            setModalError("Please fill all fields to create a reward.");
            return;
        }

        setIsSaving(true);
        try {
            await onSave(coupon);
            setIsOpen(false);
        } catch (error) {
            setModalError("Failed to save reward: " + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-lg bg-card border-border text-foreground">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <Ticket /> Create a Reward
                        </DialogTitle>
                        <DialogDescription>Sending a special reward to {customer.name}.</DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-y-4 py-6">
                        <div>
                            <Label htmlFor="code">Coupon Code</Label>
                            <div className="flex items-center gap-2 mt-1">
                                <input id="code" value={coupon.code} onChange={e => handleChange('code', e.target.value.toUpperCase())} placeholder="e.g., SAVE20" className="p-2 border rounded-md bg-input border-border w-full" />
                                <Button type="button" variant="outline" onClick={generateRandomCode}><Wand2 size={16} className="mr-2" /> Generate</Button>
                            </div>
                        </div>
                        <div>
                            <Label htmlFor="description">Description</Label>
                            <textarea id="description" value={coupon.description} onChange={e => handleChange('description', e.target.value)} rows={2} placeholder="e.g., A special thanks for being a loyal customer." className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="value">Discount Value (₹ or %)</Label>
                                <input id="value" type="number" value={coupon.value} onChange={e => handleChange('value', e.target.value)} placeholder="e.g., 100 or 20" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                            </div>
                            <div>
                                <Label htmlFor="minOrder">Minimum Order (₹)</Label>
                                <input id="minOrder" type="number" value={coupon.minOrder} onChange={e => handleChange('minOrder', e.target.value)} placeholder="e.g., 500" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                            </div>
                        </div>
                        <div>
                            <Label>Expiry Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.expiryDate && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {coupon.expiryDate ? format(coupon.expiryDate, 'dd MMM yyyy') : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={coupon.expiryDate} onSelect={(date) => handleChange('expiryDate', date)} initialFocus /></PopoverContent>
                            </Popover>
                        </div>
                    </div>
                    {modalError && <p className="text-destructive text-sm text-center">{modalError}</p>}
                    <DialogFooter className="pt-4">
                        <DialogClose asChild><Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                        <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={isSaving}>
                            {isSaving ? 'Sending...' : 'Send Reward'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const OrderDetailsModal = ({ order, isOpen, onClose }) => {
    if (!order) return null;

    const formatTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    };

    const getAddress = (order) => {
        const addr = order.deliveryAddress || order.address || order.location || order.customerAddress;
        if (!addr) return null;
        if (typeof addr === 'string') return addr;
        if (typeof addr === 'object') {
            return addr.full || addr.street || addr.line1 || Object.values(addr).filter(Boolean).join(', ');
        }
        return 'Invalid Address Format';
    };

    const address = getAddress(order);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md bg-card text-foreground border-border max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Order Details #{order.id.slice(-6).toUpperCase()}</DialogTitle>
                    <DialogDescription>
                        Placed on {formatDate(order.orderDate)} at {formatTime(order.orderDate)}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Status & Payment */}
                    <div className="flex justify-between items-center bg-muted p-3 rounded-lg">
                        <div>
                            <p className="text-xs text-muted-foreground uppercase font-bold">Status</p>
                            <p className="font-medium text-primary capitalize">{order.status.replace(/_/g, ' ')}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-muted-foreground uppercase font-bold">Total</p>
                            <p className="font-bold text-lg">{formatCurrency(order.amount)}</p>
                        </div>
                    </div>

                    {/* Items */}
                    <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2"><Ticket size={16} /> Items</h4>
                        <div className="space-y-2 border rounded-lg p-2 border-border">
                            {order.items?.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-start text-sm">
                                    <span>{item.qty}x {item.name}</span>
                                    <span className="font-medium">
                                        {formatCurrency(
                                            (item.price ? Number(item.price) * Number(item.qty) : 0) ||
                                            Number(item.totalPrice) ||
                                            Number(item.amount) ||
                                            0
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Bill Details */}
                    <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2"><IndianRupee size={16} /> Bill Details</h4>
                        <div className="bg-muted p-3 rounded-lg text-sm space-y-1">
                            <div className="flex justify-between">
                                <span>Subtotal</span>
                                <span>{formatCurrency(order.subtotal || 0)}</span>
                            </div>
                            {(order.discount > 0) && (
                                <div className="flex justify-between text-green-600">
                                    <span>Discount</span>
                                    <span>-{formatCurrency(order.discount)}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span>Taxes (GST)</span>
                                <span>{formatCurrency((order.cgst || 0) + (order.sgst || 0))}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Delivery Charge</span>
                                <span>{formatCurrency(order.deliveryCharge || 0)}</span>
                            </div>
                            <div className="flex justify-between font-bold border-t border-dashed border-gray-400 pt-2 mt-2 text-base">
                                <span>Grand Total</span>
                                <span>{formatCurrency(order.totalAmount || order.amount)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Address / Delivery Info */}
                    <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2"><Truck size={16} /> Delivery Info</h4>
                        <div className="bg-muted p-3 rounded-lg text-sm space-y-1">
                            <p><span className="font-semibold">Type:</span> <span className="capitalize">{order.deliveryType}</span></p>
                            {address ? (
                                <p><span className="font-semibold">Address:</span> {address}</p>
                            ) : (
                                <p className="text-muted-foreground italic">No address provided</p>
                            )}
                            {order.customerPhone && <p><span className="font-semibold">Phone:</span> {order.customerPhone}</p>}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={onClose} className="w-full">Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const CustomerDetailPanel = ({ customer, onClose, onSaveNotes, onSendReward, api }) => {
    const [activeTab, setActiveTab] = useState('history');
    const [notes, setNotes] = useState(customer.notes || '');
    const [isSaving, setIsSaving] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [orders, setOrders] = useState([]);
    const [loadingOrders, setLoadingOrders] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null); // State for selected order

    useEffect(() => {
        setNotes(customer.notes || '');
        // Fetch order history
        const fetchHistory = async () => {
            if (!customer?.id) return;
            setLoadingOrders(true);
            try {
                const data = await api(`/api/owner/orders?customerId=${customer.id}`, 'GET');
                setOrders(data.orders || []);
            } catch (e) {
                console.error("Failed to fetch history", e);
            } finally {
                setLoadingOrders(false);
            }
        };
        fetchHistory();
    }, [customer, api]);

    if (!customer) return null;

    const derivedBestDishes = (() => {
        if (Array.isArray(customer.bestDishes) && customer.bestDishes.length > 0) {
            return customer.bestDishes;
        }
        const stats = customer.dishStats;
        if (!stats || typeof stats !== 'object') return [];
        return Object.entries(stats)
            .map(([name, info]) => ({
                name,
                count: Number(info?.count || 0),
                spend: Number(info?.spend || 0),
            }))
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return b.spend - a.spend;
            })
            .slice(0, 5);
    })();

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSaveNotes(customer.id, notes);
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Notes saved!' });
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to save notes. ' + err.message });
        } finally {
            setIsSaving(false);
        }
    }

    const tabs = [
        { id: 'history', label: 'Order History', icon: History },
        { id: 'actions', label: 'Actions', icon: Gift },
        { id: 'notes', label: 'Notes', icon: StickyNote },
    ];

    return (
        <>
            <OrderDetailsModal
                isOpen={!!selectedOrder}
                onClose={() => setSelectedOrder(null)}
                order={selectedOrder}
            />
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="fixed top-0 right-0 h-full w-full max-w-lg bg-card border-l border-border shadow-2xl z-50 flex flex-col"
            >
                {/* Header */}
                <div className="p-6 border-b border-border flex justify-between items-start">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground">{customer.name}</h2>
                        <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1"><Mail size={14} /> {customer.email}</p>
                        <div className="mt-3"><CustomerBadge status={getCustomerStatus(customer)} /></div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:bg-muted hover:text-foreground">
                        <X size={24} />
                    </Button>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-3 gap-px bg-border">
                    <div className="bg-background p-4 text-center">
                        <p className="text-xs text-muted-foreground">Total Spend</p>
                        <p className="text-xl font-bold text-foreground">{formatCurrency(customer.totalSpend)}</p>
                    </div>
                    <div className="bg-background p-4 text-center">
                        <p className="text-xs text-muted-foreground">Total Orders</p>
                        <p className="text-xl font-bold text-foreground">{customer.totalOrders}</p>
                    </div>
                    <div className="bg-background p-4 text-center">
                        <p className="text-xs text-muted-foreground">Last Order</p>
                        <p className="text-xl font-bold text-foreground">{formatDate(customer.lastOrderDate)}</p>
                    </div>
                </div>

                <div className="px-6 py-4 border-b border-border bg-background/60 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="rounded-md bg-muted/50 p-2">
                            <p className="text-muted-foreground">Joined</p>
                            <p className="font-medium text-foreground">{formatDate(customer.joinedAt || customer.createdAt || customer.firstOrderDate)}</p>
                        </div>
                        <div className="rounded-md bg-muted/50 p-2">
                            <p className="text-muted-foreground">Last Activity</p>
                            <p className="font-medium text-foreground">{formatDate(customer.lastActivityAt || customer.lastOrderDate)}</p>
                        </div>
                    </div>

                    <div>
                        <p className="text-xs text-muted-foreground mb-2">Best Dishes</p>
                        {derivedBestDishes.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {derivedBestDishes.slice(0, 5).map((dish, index) => (
                                    <span
                                        key={`${dish.name || 'dish'}-${index}`}
                                        className="inline-flex items-center rounded-full bg-primary/10 text-primary text-xs px-2 py-1"
                                    >
                                        {dish.name || 'Unnamed'} • {formatNumber(dish.count || 0)}x
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">No dish insights available yet.</p>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-border">
                    <nav className="flex -mb-px">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 py-4 px-1 text-center border-b-2 text-sm font-medium flex items-center justify-center gap-2 ${activeTab === tab.id
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                                    }`}
                            >
                                <tab.icon size={16} /> {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Tab Content */}
                <div className="flex-grow p-6 overflow-y-auto">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            {activeTab === 'history' && (
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-foreground">All Orders ({orders.length || 0})</h3>
                                    {loadingOrders ? (
                                        <p className="text-muted-foreground text-center py-4">Loading history...</p>
                                    ) : (
                                        orders && orders.length > 0 ? orders.map(order => (
                                            <div
                                                key={order.id}
                                                className="bg-muted p-3 rounded-lg flex justify-between items-center cursor-pointer hover:bg-muted/80 transition-colors"
                                                onClick={() => setSelectedOrder(order)}
                                            >
                                                <div>
                                                    <p className="font-semibold text-foreground">#{order.id.slice(-6).toUpperCase()}</p>
                                                    <p className="text-xs text-muted-foreground">{formatDate(order.orderDate)} • {order.status}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-lg text-foreground">{formatCurrency(order.amount)}</p>
                                                    <p className="text-xs text-muted-foreground">{order.items?.length} items</p>
                                                </div>
                                            </div>
                                        )) : <p className="text-muted-foreground text-center py-4">No order history available.</p>
                                    )}
                                </div>
                            )}
                            {activeTab === 'actions' && (
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-foreground">Engage with {customer.name}</h3>
                                    <div className="bg-muted p-4 rounded-lg">
                                        <h4 className="font-semibold text-primary">Send a Custom Discount</h4>
                                        <p className="text-sm text-muted-foreground mt-1 mb-3">Reward their loyalty with a special coupon.</p>
                                        <Button onClick={() => onSendReward(customer)} className="w-full bg-primary hover:bg-primary/90">
                                            <Gift size={16} className="mr-2" /> Create & Send Reward
                                        </Button>
                                    </div>
                                </div>
                            )}
                            {activeTab === 'notes' && (
                                <div>
                                    <h3 className="font-semibold text-foreground mb-2">Private Notes</h3>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        rows={8}
                                        className="w-full p-3 bg-input border border-border rounded-lg text-foreground focus:ring-primary focus:border-primary"
                                        placeholder={`e.g., Prefers window seat, always orders extra sauce...`}
                                    />
                                    <div className="mt-4 flex justify-end">
                                        <Button onClick={handleSave} className="bg-primary hover:bg-primary/90" disabled={isSaving}>
                                            {isSaving ? 'Saving...' : 'Save Notes'}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </motion.div>
        </>
    );
};

const StatCard = ({ icon: Icon, title, value, detail, isLoading }) => (
    <div className={cn("bg-card p-5 rounded-xl border border-border flex items-start gap-4", isLoading && 'animate-pulse')}>
        <div className="bg-muted p-3 rounded-full">
            <Icon className={cn("h-6 w-6 text-primary", isLoading && 'invisible')} />
        </div>
        <div>
            {isLoading ? (
                <>
                    <div className="h-4 bg-muted-foreground/20 rounded w-24 mb-2"></div>
                    <div className="h-8 bg-muted-foreground/20 rounded w-16 mb-2"></div>
                    <div className="h-3 bg-muted-foreground/20 rounded w-32"></div>
                </>
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">{title}</p>
                    <p className="text-2xl font-bold text-foreground">{value}</p>
                    <p className="text-xs text-muted-foreground">{detail}</p>
                </>
            )}
        </div>
    </div>
);

const LeaderboardTable = ({ title, icon: Icon, rows, emptyMessage, rankKey = 'rank', onCustomerClick, scoreTrend = 'up', onRewardClick = null }) => (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
            <div className="flex items-center gap-2">
                <Icon size={18} className="text-primary" />
                <h4 className="font-semibold">{title}</h4>
            </div>
            {scoreTrend === 'up' ? <TrendingUp size={16} className="text-green-500" /> : <TrendingDown size={16} className="text-red-500" />}
        </div>
        <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
                <thead className="bg-muted/20">
                    <tr>
                        <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Rank</th>
                        <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Customer</th>
                        <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Orders</th>
                        <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Avg Order</th>
                        <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Score</th>
                        {onRewardClick && <th className="p-3 text-center text-xs font-semibold text-muted-foreground uppercase">Reward</th>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {rows?.length ? rows.map((row) => (
                        <tr key={`${title}-${row.customerId}`} className="hover:bg-muted/40 transition-colors">
                            <td className="p-3 font-semibold">#{row[rankKey]}</td>
                            <td className="p-3">
                                <button
                                    type="button"
                                    onClick={() => onCustomerClick(row.customerId)}
                                    className="text-left hover:text-primary transition-colors"
                                >
                                    <div className="font-medium">{row.name || 'Guest Customer'}</div>
                                    <div className="text-xs text-muted-foreground">{row.email || row.phone || row.customerId}</div>
                                </button>
                            </td>
                            <td className="p-3 text-right">{formatNumber(row.weeklyOrders)}</td>
                            <td className="p-3 text-right">{formatCurrency(row.avgOrderValue)}</td>
                            <td className="p-3 text-right font-semibold">{Number(row.score || 0).toFixed(2)}</td>
                            {onRewardClick && (
                                <td className="p-3 text-center">
                                    {row.rewardEligible ? (
                                        <Button
                                            size="sm"
                                            onClick={() => onRewardClick(row)}
                                            className="bg-primary hover:bg-primary/90"
                                        >
                                            <Gift size={14} className="mr-1" />
                                            Reward
                                        </Button>
                                    ) : (
                                        <span
                                            className="inline-flex items-center px-2 py-1 rounded-full bg-muted text-xs text-muted-foreground"
                                            title={row.rewardIneligibleReason || 'Not eligible'}
                                        >
                                            Not eligible
                                        </span>
                                    )}
                                </td>
                            )}
                        </tr>
                    )) : (
                        <tr>
                            <td colSpan={onRewardClick ? 6 : 5} className="p-6 text-center text-sm text-muted-foreground">{emptyMessage}</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    </div>
);

const WinnerStrip = ({ title, periodLabel, rows, onCustomerClick }) => (
    <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
            <Medal size={18} className="text-primary" />
            <h4 className="font-semibold">{title}</h4>
        </div>
        <p className="text-xs text-muted-foreground mb-4">{periodLabel}</p>
        {rows?.length ? (
            <div className="flex flex-wrap gap-2">
                {rows.map((row, idx) => (
                    <button
                        key={`winner-${row.customerId}-${idx}`}
                        type="button"
                        onClick={() => onCustomerClick(row.customerId)}
                        className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                    >
                        #{idx + 1} {row.name || 'Guest'}
                    </button>
                ))}
            </div>
        ) : (
            <p className="text-sm text-muted-foreground">No winners recorded in previous week.</p>
        )}
    </div>
);

// --- MAIN PAGE COMPONENT ---
export default function CustomersPage() {
    const [customers, setCustomers] = useState([]);
    const [stats, setStats] = useState({});
    const [leaderboard, setLeaderboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sortConfig, setSortConfig] = useState({ key: 'totalSpend', direction: 'desc' });
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("All");
    const [isCouponModalOpen, setCouponModalOpen] = useState(false);
    const [rewardCustomer, setRewardCustomer] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const router = useRouter();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const handleApiCall = useCallback(async (endpoint, method, body) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();

        let url = new URL(endpoint, window.location.origin)
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
        }

        const res = await fetch(url.toString(), {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const loadCustomers = useCallback(async ({ allowCache = true } = {}) => {
        setLoading(true);
        try {
            const cacheKey = [
                'owner_customers_v1',
                impersonatedOwnerId || 'self',
                employeeOfOwnerId || 'none',
            ].join(':');

            if (allowCache) {
                const cachedRaw = sessionStorage.getItem(cacheKey);
                if (cachedRaw) {
                    const parsed = JSON.parse(cachedRaw);
                    if (parsed?.ts && (Date.now() - parsed.ts) < CUSTOMER_HUB_CACHE_TTL_MS && parsed?.payload) {
                        setCustomers(parsed.payload.customers || []);
                        setStats(parsed.payload.stats || {});
                        setLeaderboard(parsed.payload.leaderboard || null);
                        setLoading(false);
                        return;
                    }
                }
            }

            const data = await handleApiCall('/api/owner/customers', 'GET');
            setCustomers(data.customers || []);
            setStats(data.stats || {});
            setLeaderboard(data.leaderboard || null);
            sessionStorage.setItem(cacheKey, JSON.stringify({
                ts: Date.now(),
                payload: {
                    customers: data.customers || [],
                    stats: data.stats || {},
                    leaderboard: data.leaderboard || null,
                },
            }));
        } catch (error) {
            console.error("Failed to fetch customers:", error);
            setInfoDialog({ isOpen: true, title: "Error", message: "Could not load customer data: " + error.message });
        } finally {
            setLoading(false);
        }
    }, [handleApiCall, impersonatedOwnerId, employeeOfOwnerId]);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                loadCustomers();
            } else {
                setLoading(false);
                router.push('/');
            }
        });
        return () => unsubscribe();
    }, [router, loadCustomers]);

    useEffect(() => {
        if (!auth.currentUser) return undefined;
        const intervalId = setInterval(() => {
            if (!document.hidden) {
                loadCustomers({ allowCache: false });
            }
        }, 5 * 60 * 1000);
        return () => clearInterval(intervalId);
    }, [loadCustomers]);

    // Effect to handle opening customer panel from URL
    useEffect(() => {
        const customerIdFromUrl = searchParams.get('customerId');
        if (customerIdFromUrl && customers.length > 0) {
            const customerToSelect = customers.find(c => c.id === customerIdFromUrl);
            if (customerToSelect) {
                setSelectedCustomer(customerToSelect);
                // Optional: remove the query param from URL without reloading the page
                const newUrl = window.location.pathname;
                window.history.replaceState({}, '', newUrl);
            }
        }
    }, [searchParams, customers]);


    const vipCustomers = useMemo(() => {
        return [...customers].sort((a, b) => (b.totalSpend || 0) - (a.totalSpend || 0)).slice(0, 5);
    }, [customers]);

    const topOrderCountCustomers = useMemo(() => {
        return [...customers].sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0)).slice(0, 10);
    }, [customers]);

    const dormantCustomers = useMemo(() => {
        return [...customers]
            .filter((customer) => getDateMs(customer.lastOrderDate) > 0)
            .sort((a, b) => getDateMs(a.lastOrderDate) - getDateMs(b.lastOrderDate))
            .slice(0, 10);
    }, [customers]);

    const leaderboardTop10 = useMemo(() => leaderboard?.top10 || [], [leaderboard]);
    const leaderboardBottom10 = useMemo(() => leaderboard?.bottom10 || [], [leaderboard]);
    const leaderboardPointTable = useMemo(() => leaderboard?.pointTable || [], [leaderboard]);
    const previousWeekWinners = useMemo(() => leaderboard?.previousWeekWinners?.top10 || [], [leaderboard]);
    const previousWeekEligibleWinners = useMemo(() => leaderboard?.previousWeekWinners?.top10Eligible || [], [leaderboard]);

    const openCustomerById = (customerId) => {
        const customer = customers.find((c) => c.id === customerId);
        if (customer) {
            setSelectedCustomer(customer);
            return;
        }
        setInfoDialog({
            isOpen: true,
            title: 'Customer Profile Not Found',
            message: 'This leaderboard row belongs to a guest or archived profile. Detailed panel is not available.',
        });
    };

    const handleSendReward = (customer) => {
        setRewardCustomer(customer);
        setCouponModalOpen(true);
    };

    const handleSendRewardFromLeaderboard = (row) => {
        if (!row?.rewardEligible) {
            setInfoDialog({
                isOpen: true,
                title: 'Reward Not Eligible',
                message: row?.rewardIneligibleReason || 'This customer is not eligible for weekly reward yet.',
            });
            return;
        }

        const customer = customers.find((c) => c.id === row.customerId);
        if (!customer) {
            setInfoDialog({
                isOpen: true,
                title: 'Profile Missing',
                message: 'Reward can only be sent to mapped customer profiles available in your customer list.',
            });
            return;
        }

        handleSendReward(customer);
    };

    const handleSaveReward = async (couponData) => {
        const payload = {
            ...couponData,
            startDate: couponData.startDate.toISOString(),
            expiryDate: couponData.expiryDate.toISOString(),
        };
        await handleApiCall('/api/owner/coupons', 'POST', { coupon: payload });
        setInfoDialog({ isOpen: true, title: "Success!", message: `Reward coupon "${couponData.code}" created for ${rewardCustomer.name}!` });
    };

    const filteredAndSortedCustomers = useMemo(() => {
        if (loading) return [];
        let filteredItems = [...customers];

        if (activeFilter !== 'All') {
            filteredItems = filteredItems.filter(customer => getCustomerStatus(customer) === activeFilter);
        }
        if (searchQuery) {
            const lowercasedQuery = searchQuery.toLowerCase();
            filteredItems = filteredItems.filter(customer =>
                (customer.name || '').toLowerCase().includes(lowercasedQuery) ||
                (customer.email || '').toLowerCase().includes(lowercasedQuery)
            );
        }
        filteredItems.sort((a, b) => {
            const key = sortConfig.key;
            let valA = a[key];
            let valB = b[key];
            if (key.includes('Date')) {
                valA = a[key]?.seconds ? new Date(a[key].seconds * 1000) : new Date(a[key]);
                valB = b[key]?.seconds ? new Date(b[key].seconds * 1000) : new Date(b[key]);
            }
            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });

        return filteredItems;
    }, [customers, sortConfig, searchQuery, activeFilter, loading]);

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handleSaveNotes = async (customerId, newNotes) => {
        await handleApiCall('/api/owner/customers', 'PATCH', { customerId, notes: newNotes });
        setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, notes: newNotes } : c));
        if (selectedCustomer && selectedCustomer.id === customerId) {
            setSelectedCustomer(prev => ({ ...prev, notes: newNotes }));
        }
        const cacheKey = [
            'owner_customers_v1',
            impersonatedOwnerId || 'self',
            employeeOfOwnerId || 'none',
        ].join(':');
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
            try {
                const parsed = JSON.parse(cachedRaw);
                const updatedCustomers = (parsed?.payload?.customers || []).map((c) =>
                    c.id === customerId ? { ...c, notes: newNotes } : c
                );
                sessionStorage.setItem(cacheKey, JSON.stringify({
                    ts: Date.now(),
                    payload: {
                        ...(parsed?.payload || {}),
                        customers: updatedCustomers,
                    },
                }));
            } catch (_) {
                // Ignore cache corruption and continue with live state.
            }
        }
    };

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setSelectedCustomer(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const filterButtons = [
        { label: 'All', value: 'All' },
        { label: 'Claimed', value: 'Claimed', className: 'bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20' },
        { label: 'Loyal', value: 'Loyal', className: 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20' },
        { label: 'At Risk', value: 'At Risk', className: 'bg-red-500/10 text-red-500 hover:bg-red-500/20' },
        { label: 'New', value: 'New', className: 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20' },
        { label: 'Active', value: 'Active', className: 'bg-green-500/10 text-green-500 hover:bg-green-500/20' }
    ];

    return (
        <div className="p-4 md:p-6 text-foreground relative min-h-screen bg-background">
            {rewardCustomer && <CouponModal isOpen={isCouponModalOpen} setIsOpen={setCouponModalOpen} customer={rewardCustomer} onSave={handleSaveReward} />}
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Customer Hub</h1>
                <p className="text-muted-foreground mt-1">Manage, analyze, and engage with your customers.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 my-6">
                <StatCard isLoading={loading} icon={Users} title="Total Customers" value={formatNumber(stats.totalCustomers)} detail="All-time customers" />
                <StatCard isLoading={loading} icon={UserPlus} title="New This Month" value={formatNumber(stats.newThisMonth)} detail="First activity in current month" />
                <StatCard isLoading={loading} icon={Repeat} title="Repeat Customer Rate" value={`${stats.repeatRate || 0}%`} detail="Customers with >1 orders" />
                <StatCard isLoading={loading} icon={Star} title="Loyal Customers" value={formatNumber(stats.loyalCustomers)} detail="High-frequency regulars" />
                <StatCard isLoading={loading} icon={AlertTriangle} title="At Risk Customers" value={formatNumber(stats.atRiskCustomers)} detail="No activity for long period" />
                <StatCard isLoading={loading} icon={Clock3} title="Inactive (45d+)" value={formatNumber(stats.inactiveCustomers)} detail="Need re-engagement campaign" />
                <StatCard isLoading={loading} icon={Crown} title="Top Spender" value={stats.topSpender?.name || 'N/A'} detail={formatCurrency(stats.topSpender?.totalSpend)} />
                <StatCard isLoading={loading} icon={Trophy} title="Top Order Count" value={stats.topOrderer?.name || 'N/A'} detail={`${formatNumber(stats.topOrderer?.totalOrders)} orders`} />
                <StatCard isLoading={loading} icon={BarChart3} title="Weekly Orders" value={formatNumber(stats.weeklyOrders)} detail={`${formatNumber(stats.activeThisWeek)} active customers this week`} />
                <StatCard isLoading={loading} icon={IndianRupee} title="Weekly Revenue" value={formatCurrency(stats.weeklyRevenue)} detail={`Prev week: ${formatCurrency(stats.previousWeekRevenue)}`} />
            </div>

            <section className="my-8 space-y-4">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
                    <div>
                        <h3 className="text-xl font-bold flex items-center gap-2">
                            <Trophy className="text-primary" size={20} />
                            Weekly Frequency Leaderboard
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Weekly window: {formatWeekRange(leaderboard?.period)} | Updates daily based on latest orders
                        </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Score = Orders (60%) + Avg Order Value (25%) + Repeat Speed (15%)
                    </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg bg-card border border-border">
                        <p className="text-xs text-muted-foreground">Eligibility Rule</p>
                        <p className="font-semibold">
                            Min {leaderboard?.eligibilityRules?.minOrdersPerWeek || 3} orders/week
                        </p>
                    </div>
                    <div className="p-3 rounded-lg bg-card border border-border">
                        <p className="text-xs text-muted-foreground">Eligible in Current Top 10</p>
                        <p className="font-semibold">
                            {formatNumber(leaderboard?.rewardSummary?.currentWeekEligibleInTop10)} / {formatNumber(leaderboard?.rewardSummary?.currentWeekTop10Count)}
                        </p>
                    </div>
                    <div className="p-3 rounded-lg bg-card border border-border">
                        <p className="text-xs text-muted-foreground">Eligible in Previous Winners</p>
                        <p className="font-semibold">
                            {formatNumber(leaderboard?.rewardSummary?.previousWeekEligibleInTop10)} / {formatNumber(leaderboard?.rewardSummary?.previousWeekTop10Count)}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <LeaderboardTable
                        title="Top 10 Customers (This Week)"
                        icon={TrendingUp}
                        rows={leaderboardTop10}
                        emptyMessage="No qualifying customers in the current week."
                        onCustomerClick={openCustomerById}
                        scoreTrend="up"
                        onRewardClick={handleSendRewardFromLeaderboard}
                    />
                    <LeaderboardTable
                        title="Bottom 10 Customers (This Week)"
                        icon={TrendingDown}
                        rows={leaderboardBottom10}
                        emptyMessage="No low-activity list available yet."
                        rankKey="bottomRank"
                        onCustomerClick={openCustomerById}
                        scoreTrend="down"
                    />
                </div>

                <WinnerStrip
                    title="Previous Week Winners (Auto reset every Monday)"
                    periodLabel={`${formatDate(leaderboard?.previousWeekWinners?.weekStart)} - ${formatDate(leaderboard?.previousWeekWinners?.weekEnd)}`}
                    rows={previousWeekWinners}
                    onCustomerClick={openCustomerById}
                />
                <WinnerStrip
                    title="Previous Week Reward-Eligible Winners"
                    periodLabel="These winners matched reward eligibility rules."
                    rows={previousWeekEligibleWinners}
                    onCustomerClick={openCustomerById}
                />

                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
                        <h4 className="font-semibold flex items-center gap-2">
                            <BarChart3 size={18} className="text-primary" />
                            Weekly Point Table
                        </h4>
                        <p className="text-xs text-muted-foreground">
                            Last updated: {formatDate(leaderboard?.period?.lastUpdatedAt)}
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[920px]">
                            <thead className="bg-muted/20">
                                <tr>
                                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Rank</th>
                                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Customer</th>
                                    <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Weekly Orders</th>
                                    <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Weekly Spend</th>
                                    <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Avg Order</th>
                                    <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Avg Gap (hrs)</th>
                                    <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Score</th>
                                    <th className="p-3 text-center text-xs font-semibold text-muted-foreground uppercase">Eligibility</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {leaderboardPointTable?.length ? leaderboardPointTable.slice(0, 50).map((row) => (
                                    <tr key={`point-${row.customerId}`} className="hover:bg-muted/40 transition-colors">
                                        <td className="p-3 font-semibold">#{row.rank}</td>
                                        <td className="p-3">
                                            <button
                                                type="button"
                                                onClick={() => openCustomerById(row.customerId)}
                                                className="text-left hover:text-primary transition-colors"
                                            >
                                                <div className="font-medium">{row.name || 'Guest Customer'}</div>
                                                <div className="text-xs text-muted-foreground">{row.statusTag || 'N/A'}</div>
                                            </button>
                                        </td>
                                        <td className="p-3 text-right">{formatNumber(row.weeklyOrders)}</td>
                                        <td className="p-3 text-right">{formatCurrency(row.weeklySpend)}</td>
                                        <td className="p-3 text-right">{formatCurrency(row.avgOrderValue)}</td>
                                        <td className="p-3 text-right">{row.avgGapHours >= 900 ? 'N/A' : Number(row.avgGapHours).toFixed(1)}</td>
                                        <td className="p-3 text-right font-semibold">{Number(row.score || 0).toFixed(2)}</td>
                                        <td className="p-3 text-center">
                                            {row.rewardEligible ? (
                                                <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-500/10 text-green-500 text-xs">
                                                    Eligible
                                                </span>
                                            ) : (
                                                <span
                                                    className="inline-flex items-center px-2 py-1 rounded-full bg-muted text-xs text-muted-foreground"
                                                    title={row.rewardIneligibleReason || 'Not eligible'}
                                                >
                                                    Not eligible
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={8} className="p-6 text-center text-sm text-muted-foreground">
                                            Point table will appear after orders start coming in this week.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            <section className="my-8">
                <h3 className="text-xl font-bold mb-4">❤️ Your VIP Lounge</h3>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground">Rank</th>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground">Customer</th>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground">Total Spend</th>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground">Total Orders</th>
                                    <th className="p-4 text-sm font-semibold text-muted-foreground text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {loading ? Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-3/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/4"></div></td>
                                        <td className="p-4 flex justify-center"><div className="h-8 bg-muted rounded w-3/4"></div></td>
                                    </tr>
                                )) : vipCustomers.map((cust, i) => (
                                    <tr key={cust.id} className="hover:bg-muted transition-colors">
                                        <td className="p-4"><span className="font-bold text-lg">{i + 1}</span></td>
                                        <td className="p-4 font-semibold">{cust.name}</td>
                                        <td className="p-4 text-green-400 font-bold">{formatCurrency(cust.totalSpend)}</td>
                                        <td className="p-4 text-center">{cust.totalOrders}</td>
                                        <td className="p-4 text-center">
                                            <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={() => handleSendReward(cust)}>
                                                <Gift size={16} className="mr-2" /> Send Reward
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            <section className="my-8 grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center gap-2">
                        <Trophy size={18} className="text-primary" />
                        <h4 className="font-semibold">Most Orders (All-time Top 10)</h4>
                    </div>
                    <div className="p-4 space-y-3">
                        {topOrderCountCustomers.length ? topOrderCountCustomers.map((customer, idx) => (
                            <button
                                key={`top-order-${customer.id}`}
                                type="button"
                                onClick={() => setSelectedCustomer(customer)}
                                className="w-full p-3 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors text-left"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="font-medium">#{idx + 1} {customer.name || 'Guest Customer'}</div>
                                        <div className="text-xs text-muted-foreground">{customer.email || customer.phone || customer.id}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-semibold">{formatNumber(customer.totalOrders)} orders</div>
                                        <div className="text-xs text-muted-foreground">{formatCurrency(customer.totalSpend)}</div>
                                    </div>
                                </div>
                            </button>
                        )) : (
                            <p className="text-sm text-muted-foreground">No order history available.</p>
                        )}
                    </div>
                </div>

                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center gap-2">
                        <AlertTriangle size={18} className="text-yellow-500" />
                        <h4 className="font-semibold">Dormant Customers (Needs Follow-up)</h4>
                    </div>
                    <div className="p-4 space-y-3">
                        {dormantCustomers.length ? dormantCustomers.map((customer) => (
                            <button
                                key={`dormant-${customer.id}`}
                                type="button"
                                onClick={() => setSelectedCustomer(customer)}
                                className="w-full p-3 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors text-left"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="font-medium">{customer.name || 'Guest Customer'}</div>
                                        <div className="text-xs text-muted-foreground">Last order: {formatDate(customer.lastOrderDate)}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-semibold">{formatNumber(customer.totalOrders)} orders</div>
                                        <div className="text-xs text-muted-foreground">{formatCurrency(customer.totalSpend)}</div>
                                    </div>
                                </div>
                            </button>
                        )) : (
                            <p className="text-sm text-muted-foreground">No dormant customers detected.</p>
                        )}
                    </div>
                </div>
            </section>


            <div className="my-6 p-4 bg-card rounded-xl border border-border flex flex-col md:flex-row gap-4 justify-between items-center">
                <div className="relative w-full md:w-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                    <input
                        type="text"
                        placeholder="Search by name or email..."
                        className="bg-input border border-border rounded-lg w-full md:w-80 pl-10 pr-4 py-2 focus:ring-2 focus:ring-primary outline-none"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Filter size={16} className="text-muted-foreground" />
                    <span className="text-sm font-medium">Filter by segment:</span>
                    <div className="flex items-center gap-2 flex-wrap">
                        {filterButtons.map(btn => (
                            <Button
                                key={btn.value}
                                variant="secondary"
                                size="sm"
                                onClick={() => setActiveFilter(btn.value)}
                                className={cn('bg-muted hover:bg-muted/80', btn.className, activeFilter === btn.value && 'ring-2 ring-primary')}
                            >
                                {btn.label}
                            </Button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-muted/50">
                                <SortableHeader column="name" sortConfig={sortConfig} onSort={handleSort}>Customer</SortableHeader>
                                <SortableHeader column="lastOrderDate" sortConfig={sortConfig} onSort={handleSort}>Last Order</SortableHeader>
                                <SortableHeader column="totalOrders" sortConfig={sortConfig} onSort={handleSort}>Total Orders</SortableHeader>
                                <SortableHeader column="totalSpend" sortConfig={sortConfig} onSort={handleSort}>Total Spend</SortableHeader>
                                <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-3/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/4"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/2"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-1/3"></div></td>
                                    </tr>
                                ))
                            ) : filteredAndSortedCustomers.map(customer => (
                                <motion.tr
                                    key={customer.id}
                                    onClick={() => setSelectedCustomer(customer)}
                                    className="cursor-pointer hover:bg-muted transition-colors"
                                    whileHover={{ scale: 1.01 }}
                                >
                                    <td className="p-4 font-medium">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                {customer.name}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-primary"
                                                    onClick={(e) => {
                                                        e.stopPropagation(); // Prevent row click
                                                        setSelectedCustomer(customer);
                                                    }}
                                                    title="View Profile"
                                                >
                                                    <User size={14} />
                                                </Button>
                                            </div>
                                            <span className="text-xs text-muted-foreground">{customer.email || customer.phone}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-muted-foreground">{formatDate(customer.lastOrderDate)}</td>
                                    <td className="p-4 text-muted-foreground text-center">{customer.totalOrders}</td>
                                    <td className="p-4 font-semibold text-right">{formatCurrency(customer.totalSpend)}</td>
                                    <td className="p-4"><CustomerBadge status={getCustomerStatus(customer)} /></td>
                                </motion.tr>
                            ))}
                            {!loading && filteredAndSortedCustomers.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="text-center p-8 text-muted-foreground">
                                        No customers found for this filter.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <AnimatePresence>
                {selectedCustomer && (
                    <CustomerDetailPanel
                        customer={selectedCustomer}
                        onClose={() => setSelectedCustomer(null)}
                        onSaveNotes={handleSaveNotes}
                        onSendReward={handleSendReward}
                        api={handleApiCall}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
