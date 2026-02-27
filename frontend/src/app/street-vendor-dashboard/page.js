'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardList, QrCode, CookingPot, PackageCheck, Check, X, Loader2, User, Phone, History, Wallet, IndianRupee, Calendar as CalendarIcon, Search, Filter, AlertTriangle, ConciergeBell, Clock, Package, PlusCircle, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser, useMemoFirebase, useCollection } from '@/firebase';
import { db, auth, storage } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, Timestamp, getDocs, updateDoc, deleteDoc, getDoc, limit, orderBy } from 'firebase/firestore';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { startOfDay, endOfDay, format } from 'date-fns';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import InfoDialog from '@/components/InfoDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import QrScanner from '@/components/QrScanner';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';


import { usePolling } from '@/lib/usePolling';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDateTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return format(date, 'dd/MM, p'); // e.g., 25/12, 1:33 PM
};

const RejectOrderModal = ({ order, isOpen, onClose, onConfirm, onMarkOutOfStock, showInfoDialog }) => {
    const [reason, setReason] = useState('');
    const [otherReason, setOtherReason] = useState('');
    const [shouldRefund, setShouldRefund] = useState('true');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmRestaurantClosure, setConfirmRestaurantClosure] = useState(false);

    const [isOutOfStockModalOpen, setIsOutOfStockModalOpen] = useState(false);

    // Calculate online payment amount
    const paymentDetailsArray = Array.isArray(order?.paymentDetails) ? order.paymentDetails : [order?.paymentDetails].filter(Boolean);
    const amountPaidOnlineDetails = paymentDetailsArray
        .filter(p => (p?.method === 'razorpay' || p?.method === 'phonepe' || p?.method === 'online') && p?.status === 'paid')
        .reduce((sum, p) => sum + (p?.amount || 0), 0);
    const isPaidViaRoot = order?.paymentStatus === 'paid' && (order?.paymentMethod === 'razorpay' || order?.paymentMethod === 'phonepe' || order?.paymentMethod === 'online');
    const amountPaidOnline = isPaidViaRoot ? (order?.totalAmount || 0) : amountPaidOnlineDetails;
    const hasOnlinePayment = amountPaidOnline > 0;

    useEffect(() => {
        if (isOpen) {
            setReason('');
            setOtherReason('');
            setShouldRefund('true'); // Default to refund
            setIsSubmitting(false);
            setIsOutOfStockModalOpen(false);
            setConfirmRestaurantClosure(false); // Reset confirmation
        }
    }, [isOpen]);

    // Smart pre-selection based on reason
    useEffect(() => {
        if (reason === 'item_unavailable') {
            setShouldRefund('true'); // Vendor's fault = refund
        } else if (reason === 'customer_request') {
            setShouldRefund('false'); // Customer's fault = no refund
        }
    }, [reason]);

    const handleConfirm = async () => {
        if (reason === 'item_unavailable') {
            setIsOutOfStockModalOpen(true);
            return;
        }

        const finalReason = reason === 'other' ? otherReason : reason;
        if (!finalReason) {
            showInfoDialog({ isOpen: true, title: 'Validation Error', message: 'Please select or enter a reason for rejection.' });
            return;
        }
        setIsSubmitting(true);
        try {
            await onConfirm(order.id, finalReason, shouldRefund === 'true');
            onClose();
        } catch (error) {
            showInfoDialog({ isOpen: true, title: 'Error', message: `Could not reject order: ${error.message}` });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOutOfStockConfirm = async (outOfStockItems) => {
        setIsSubmitting(true);
        try {
            if (outOfStockItems.length > 0) {
                await onMarkOutOfStock(outOfStockItems);
            }
            await onConfirm(order.id, "Item(s) out of stock");
            setIsOutOfStockModalOpen(false);
            onClose();
            showInfoDialog({ isOpen: true, title: 'Success', message: 'Item(s) marked as out of stock and order rejected.' });

        } catch (error) {
            showInfoDialog({ isOpen: true, title: 'Error', message: `Could not perform action: ${error.message}` });
        } finally {
            setIsSubmitting(false);
        }
    };

    const rejectionReasons = [
        { value: "item_unavailable", label: "Item(s) out of stock" },
        { value: "customer_request", label: "Customer requested cancellation" },
        { value: "other", label: "Other" },
    ];

    if (!isOpen) return null;

    return (
        <>
            <Dialog open={isOpen && !isOutOfStockModalOpen} onOpenChange={onClose}>
                <DialogContent className="bg-background border-border text-foreground">
                    <DialogHeader>
                        <DialogTitle>Reject Order #{order?.id.substring(0, 5)}</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to reject this order? This action cannot be undone. The customer will be notified.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div>
                            <Label htmlFor="rejection-reason">Reason for Rejection</Label>
                            <select
                                id="rejection-reason"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                className="mt-1 w-full p-2 border rounded-md bg-input border-border focus:ring-primary focus:border-primary"
                            >
                                <option value="" disabled>Select a reason...</option>
                                {rejectionReasons.map(r => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                            </select>
                        </div>
                        {reason === 'other' && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                            >
                                <Label htmlFor="other-reason">Please specify the reason</Label>
                                <Textarea
                                    id="other-reason"
                                    value={otherReason}
                                    onChange={(e) => setOtherReason(e.target.value)}
                                    className="mt-1"
                                    placeholder="e.g., Unable to process payment, weather conditions, etc."
                                />
                            </motion.div>
                        )}

                        {/* Refund Policy Selection */}
                        {hasOnlinePayment && reason && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/10 space-y-3"
                            >
                                <p className="font-semibold text-sm text-yellow-400">⚠️ Refund Policy</p>
                                <div className="space-y-2">
                                    <label className="flex items-start space-x-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="refund-policy"
                                            value="true"
                                            checked={shouldRefund === 'true'}
                                            onChange={(e) => setShouldRefund(e.target.value)}
                                            className="mt-1"
                                        />
                                        <div className="flex-1">
                                            <p className="font-semibold text-sm">Cancel WITH Refund</p>
                                            <p className="text-xs text-muted-foreground">
                                                Customer will receive full refund (₹{amountPaidOnline})
                                            </p>
                                        </div>
                                    </label>
                                    <label className="flex items-start space-x-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="refund-policy"
                                            value="false"
                                            checked={shouldRefund === 'false'}
                                            onChange={(e) => setShouldRefund(e.target.value)}
                                            className="mt-1"
                                        />
                                        <div className="flex-1">
                                            <p className="font-semibold text-sm">Cancel WITHOUT Refund</p>
                                            <p className="text-xs text-muted-foreground">
                                                No refund - customer fault/duplicate order
                                            </p>
                                        </div>
                                    </label>
                                </div>
                            </motion.div>
                        )}
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="secondary" disabled={isSubmitting}>Cancel</Button></DialogClose>
                        <Button variant="destructive" onClick={handleConfirm} disabled={isSubmitting || !reason || (reason === 'other' && !otherReason.trim())}>
                            {isSubmitting ? "Rejecting..." : (reason === 'item_unavailable' ? "Next" : "Confirm Rejection")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {order && <OutOfStockModal isOpen={isOutOfStockModalOpen} onClose={() => setIsOutOfStockModalOpen(false)} orderItems={order.items} onConfirm={handleOutOfStockConfirm} />}
        </>
    );
};

const OutOfStockModal = ({ isOpen, onClose, orderItems, onConfirm }) => {
    const [selectedItems, setSelectedItems] = useState([]);
    const [isConfirming, setIsConfirming] = useState(false);

    const handleToggleItem = (itemId) => {
        setSelectedItems(prev =>
            prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
        );
    };

    const handleConfirm = async () => {
        setIsConfirming(true);
        await onConfirm(selectedItems);
        setIsConfirming(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Mark Items Out of Stock</DialogTitle>
                    <DialogDescription>
                        Select the items that are out of stock. This will update your menu automatically.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-2 max-h-60 overflow-y-auto">
                    {orderItems.map(item => (
                        <div key={item.id || item.name} className="flex items-center space-x-3 p-3 rounded-lg bg-muted border border-border">
                            <Checkbox
                                id={`stock-${item.id}`}
                                checked={selectedItems.includes(item.id)}
                                onCheckedChange={() => handleToggleItem(item.id)}
                            />
                            <Label htmlFor={`stock-${item.id}`} className="font-semibold text-foreground cursor-pointer flex-grow">
                                {item.name}
                            </Label>
                        </div>
                    ))}
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={onClose} disabled={isConfirming}>Skip</Button>
                    <Button variant="destructive" onClick={handleConfirm} disabled={isConfirming}>
                        {isConfirming ? "Updating..." : `Confirm & Reject Order`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

const OrderCard = ({ order, onMarkReady, onCancelClick, onMarkCollected, onRevertToPending, onMarkCashRefunded, userRole }) => {
    const token = order.dineInToken;
    const isPending = order.status === 'pending';
    const isReady = order.status === 'Ready';

    let statusClass = 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
    let borderClass = 'border-yellow-500';
    if (isReady) {
        statusClass = 'text-green-500 bg-green-500/10 border-green-500/20';
        borderClass = 'border-green-500';
    } else if (order.status === 'delivered' || order.status === 'picked_up') {
        statusClass = 'text-blue-500 bg-blue-500/10 border-blue-500/20';
        borderClass = 'border-blue-500';
    } else if (order.status === 'rejected') {
        statusClass = 'text-red-500 bg-red-500/10 border-red-500/20';
        borderClass = 'border-red-500';
    }

    const paymentDetailsArray = Array.isArray(order.paymentDetails) ? order.paymentDetails : [order.paymentDetails].filter(Boolean);

    // Calculate paid amount from paymentDetails array (legacy/Razorpay flow)
    const amountPaidOnlineDetails = paymentDetailsArray
        .filter(p => (p.method === 'razorpay' || p.method === 'phonepe' || p.method === 'online') && p.status === 'paid')
        .reduce((sum, p) => sum + (p.amount || 0), 0);

    // Check root-level payment status (PhonePe webhook updates these)
    const isPaidViaRoot = order.paymentStatus === 'paid' && (order.paymentMethod === 'razorpay' || order.paymentMethod === 'phonepe' || order.paymentMethod === 'online');

    // Determine final paid status
    const isFullyPaidOnline = isPaidViaRoot || amountPaidOnlineDetails >= (order.totalAmount || 0);

    // Calculate due amount (if not fully paid via root)
    const amountPaidOnline = isPaidViaRoot ? (order.totalAmount || 0) : amountPaidOnlineDetails;
    const amountDueAtCounter = (order.totalAmount || 0) - amountPaidOnline;

    const isPartiallyPaid = !isFullyPaidOnline && amountPaidOnline > 0 && amountDueAtCounter > 0.01;

    return (
        <motion.div
            layout
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className={cn("rounded-lg p-4 flex flex-col justify-between border-l-4 bg-card shadow-lg hover:shadow-primary/20 hover:-translate-y-1 transition-all duration-300", borderClass)}
        >
            <div>
                <div className="flex justify-between items-start">
                    <div>
                        <p className="text-4xl font-bold text-foreground">{token}</p>
                        {order.diningPreference === 'takeaway' && (
                            <div className="mt-2 flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-600 border-2 border-orange-500 w-fit">
                                <PackageCheck size={18} /> PACK THIS ORDER
                            </div>
                        )}
                        {order.diningPreference === 'dine-in' && (
                            <div className="mt-2 flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-600 border-2 border-cyan-500 w-fit">
                                <ConciergeBell size={18} /> SERVE ON PLATE
                            </div>
                        )}
                        {!order.diningPreference && (
                            <div className="mt-2 flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg bg-gray-500/20 text-gray-600 border-2 border-gray-500 w-fit">
                                <ClipboardList size={18} /> STANDARD ORDER
                            </div>
                        )}
                    </div>
                    <div className="text-right">
                        <div className={cn('px-2 py-1 text-xs font-semibold rounded-full border bg-opacity-20 capitalize', statusClass)}>{order.status}</div>
                        <p className="text-xs text-muted-foreground mt-1">{formatDateTime(order.orderDate)}</p>
                    </div>
                </div>
                <div className="flex justify-between items-center mt-2 border-b border-dashed border-border pb-3 mb-3">
                    <p className="text-3xl font-bold text-green-500">{formatCurrency(order.totalAmount)}</p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {isFullyPaidOnline ? (
                            <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                                <Wallet size={14} /> PAID ONLINE
                            </div>
                        ) : isPartiallyPaid ? (
                            <div className="text-right">
                                <span className="block text-xs font-semibold text-green-500">Paid: {formatCurrency(amountPaidOnline)}</span>
                                <span className="block text-xs font-semibold text-yellow-400">Due: {formatCurrency(amountDueAtCounter)}</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                                <IndianRupee size={14} /> PAY AT COUNTER
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-2 text-muted-foreground space-y-1">
                    <div className="flex items-center gap-2">
                        <User size={14} />
                        <span className="font-semibold text-foreground text-base">{order.customerName || 'Guest'}</span>
                    </div>
                    {order.customerPhone && (
                        <div className="flex items-center gap-2 text-xs">
                            <Phone size={12} />
                            <span>{order.customerPhone}</span>
                        </div>
                    )}
                </div>
                <div className="mt-3 pt-3 border-t border-dashed border-border">
                    <p className="font-semibold text-foreground text-sm mb-1.5">Items:</p>
                    <ul className="list-disc list-inside text-muted-foreground text-base space-y-2">
                        {order.items.map((item, idx) => {
                            const portionName = item.portion?.name;
                            const addOns = (item.selectedAddOns || [])
                                .map(addon => `${addon.quantity}x ${addon.name}`)
                                .join(', ');

                            return (
                                <li key={idx} className="flex items-start gap-2">
                                    <span className="flex-1">
                                        {item.quantity || item.qty}x {item.name}
                                        {portionName && portionName.toLowerCase() !== 'full' && ` - ${portionName}`}
                                        {addOns && <span className="text-xs text-primary block pl-4">({addOns})</span>}
                                    </span>
                                    {item.addedAt && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-semibold whitespace-nowrap">
                                            🆕 Added {format(new Date(item.addedAt?.seconds ? item.addedAt.seconds * 1000 : item.addedAt), 'hh:mm a')}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
                {order.status === 'rejected' && order.rejectionReason && (
                    <div className="mt-3 pt-3 border-t border-dashed border-red-500/30">
                        <p className="font-semibold text-red-400">Rejection Reason:</p>
                        <p className="text-sm text-red-400/90">{order.rejectionReason}</p>
                    </div>
                )}
            </div>
            <div className="mt-4">
                {isPending && (
                    <div className="grid grid-cols-2 gap-2">
                        {hasPermission(userRole, PERMISSIONS.CANCEL_ORDER) && (
                            <Button onClick={() => onCancelClick(order)} variant="destructive" className="h-12 text-base">
                                <X className="mr-2" /> Cancel
                            </Button>
                        )}
                        {hasPermission(userRole, PERMISSIONS.MARK_ORDER_READY) && (
                            <Button onClick={() => onMarkReady(order.id)} className="bg-green-600 hover:bg-green-700 h-12 text-base">
                                <CookingPot className="mr-2" /> Mark Ready
                            </Button>
                        )}
                    </div>
                )}
                {isReady && (
                    <div className="grid grid-cols-2 gap-2">
                        {hasPermission(userRole, PERMISSIONS.UPDATE_ORDER_STATUS) && (
                            <Button onClick={() => onRevertToPending(order.id)} variant="outline" className="h-12 text-base font-semibold">
                                <Undo2 size={18} className="mr-2" /> Undo
                            </Button>
                        )}
                        {hasPermission(userRole, PERMISSIONS.UPDATE_ORDER_STATUS) && (
                            <Button onClick={() => onMarkCollected(order.id)} className="bg-green-600 hover:bg-green-700 text-white font-bold text-base h-12">
                                <PackageCheck size={18} className="mr-2" /> Collected
                            </Button>
                        )}
                    </div>
                )}
                {order.status === 'rejected' && (
                    <div className="space-y-3">
                        {/* Refund Status Card */}
                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                            <p className="text-xs font-semibold text-red-400 mb-2">💰 Refund Status</p>

                            {/* Online Payment Refund */}
                            {amountPaidOnline > 0 && (
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs text-muted-foreground">Online Payment:</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-foreground">₹{amountPaidOnline}</span>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                            Auto-Refund
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Cash Payment Refund */}
                            {amountDueAtCounter > 0 && (
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-muted-foreground">Cash Payment:</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-foreground">₹{amountDueAtCounter}</span>
                                        {order.cashRefunded ? (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                                                ✓ Refunded
                                            </span>
                                        ) : (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                                                ⚠ Pending
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="grid grid-cols-2 gap-2">
                            <Button onClick={() => onRevertToPending(order.id)} variant="outline" className="h-12 text-base font-semibold">
                                <Undo2 size={18} className="mr-2" /> Undo
                            </Button>
                            {amountDueAtCounter > 0 && !order.cashRefunded && hasPermission(userRole, PERMISSIONS.REFUND_ORDER) && (
                                <Button
                                    onClick={() => onMarkCashRefunded && onMarkCashRefunded(order.id)}
                                    className="bg-green-600 hover:bg-green-700 h-12 text-base font-semibold"
                                >
                                    <Check size={18} className="mr-2" /> Mark Refunded
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );
};

const ScannedOrderModal = ({ order, isOpen, onClose, onConfirm }) => {
    if (!order) return null;
    const paymentDetailsArray = Array.isArray(order.paymentDetails) ? order.paymentDetails : [order.paymentDetails].filter(Boolean);
    const amountPaidOnline = paymentDetailsArray.filter(p => p.method === 'razorpay' && p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);
    const amountDueAtCounter = order.totalAmount - amountPaidOnline;
    const orderDate = order?.orderDate;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Confirm Collection for Order <span className="font-mono text-primary">{order.dineInToken}</span></DialogTitle>
                    <DialogDescription>
                        Hand over the following items to the customer. This will automatically mark the order as collected.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="p-4 bg-muted rounded-lg border border-border">
                        <div className="flex justify-between items-center font-bold">
                            <span>TOTAL BILL:</span>
                            <span className="text-2xl text-primary">{formatCurrency(order.totalAmount)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs mt-1">
                            <span>Payment Status:</span>
                            {amountDueAtCounter <= 0 ? (
                                <span className="font-semibold text-green-500">FULLY PAID ONLINE</span>
                            ) : (
                                <span className="font-semibold text-yellow-400">COLLECT {formatCurrency(amountDueAtCounter)} AT COUNTER</span>
                            )}
                        </div>
                    </div>
                    <div>
                        <h4 className="font-semibold text-muted-foreground mb-2">Customer Details:</h4>
                        <p><strong>Name:</strong> {order.customerName}</p>
                        {order.customerPhone && <p><strong>Phone:</strong> {order.customerPhone}</p>}
                        {orderDate && <p><strong>Time:</strong> {format(new Date(orderDate.seconds * 1000), 'hh:mm a')}</p>}
                    </div>
                    <div>
                        <h4 className="font-semibold text-muted-foreground mb-2">Items:</h4>
                        <ul className="list-disc list-inside text-muted-foreground text-sm space-y-1">
                            {order.items.map((item, index) => {
                                const portionName = item.portion?.name;
                                const addOns = (item.selectedAddOns || [])
                                    .map(addon => `${addon.quantity}x ${addon.name}`)
                                    .join(', ');

                                return (
                                    <li key={index}>
                                        {item.quantity || item.qty}x {item.name}
                                        {portionName && portionName.toLowerCase() !== 'full' && ` - ${portionName}`}
                                        {addOns && <span className="text-xs text-primary block pl-4">({addOns})</span>}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button onClick={onConfirm} className="bg-primary hover:bg-primary/90">Confirm & Handover</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const StreetVendorDashboardContent = () => {
    const { user, isUserLoading } = useUser();
    const [vendorId, setVendorId] = useState(null);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isScannerOpen, setScannerOpen] = useState(false);
    const [scannedOrder, setScannedOrder] = useState(null);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const effectiveOwnerId = impersonatedOwnerId || employeeOfOwnerId;
    const queryParam = impersonatedOwnerId ? `?impersonate_owner_id=${impersonatedOwnerId}` : employeeOfOwnerId ? `?employee_of=${employeeOfOwnerId}` : '';
    const [userRole, setUserRole] = useState(null);

    // Fetch User Role
    useEffect(() => {
        const fetchRole = async () => {
            if (!user) return;
            try {
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    let effectiveRole = userData.role || 'owner';

                    // Employee access uses `employee_of` owner context.
                    if (employeeOfOwnerId) {
                        const storedRole = localStorage.getItem('employeeRole');
                        if (storedRole) {
                            effectiveRole = storedRole;
                        } else {
                            const linkedOutlets = userData.linkedOutlets || [];
                            const matchedOutlet = linkedOutlets.find(
                                (o) => o.ownerId === employeeOfOwnerId && o.status === 'active'
                            );
                            if (matchedOutlet?.employeeRole) {
                                effectiveRole = matchedOutlet.employeeRole;
                            }
                        }
                    }

                    setUserRole(effectiveRole);
                }
            } catch (err) {
                console.error("Error fetching user role:", err);
            }
        };
        fetchRole();
    }, [user, employeeOfOwnerId]);
    const [date, setDate] = useState(null);
    const [error, setError] = useState(null);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [rejectModalState, setRejectModalState] = useState({ isOpen: false, order: null });
    const audioRef = useRef(null);
    const audioUnlockedRef = useRef(false);

    // Unlock audio on first user interaction (mobile browsers block autoplay)
    useEffect(() => {
        const unlockAudio = () => {
            if (!audioUnlockedRef.current && audioRef.current) {
                // Create a short silent play to unlock audio context
                audioRef.current.volume = 0;
                audioRef.current.play()
                    .then(() => {
                        audioRef.current.pause();
                        audioRef.current.currentTime = 0;
                        audioRef.current.volume = 1;
                        audioUnlockedRef.current = true;
                        console.log('[Audio] Unlocked successfully');
                    })
                    .catch(() => console.log('[Audio] Unlock attempt - will try on interaction'));
            }
        };

        // Try to unlock on any user interaction
        const handleInteraction = () => {
            unlockAudio();
            // Remove listeners after unlock
            if (audioUnlockedRef.current) {
                document.removeEventListener('click', handleInteraction);
                document.removeEventListener('touchstart', handleInteraction);
            }
        };

        document.addEventListener('click', handleInteraction);
        document.addEventListener('touchstart', handleInteraction);

        return () => {
            document.removeEventListener('click', handleInteraction);
            document.removeEventListener('touchstart', handleInteraction);
        };
    }, []);

    const playNotificationSound = () => {
        if (!audioRef.current) return;

        // Vibrate for new order alert (strong pattern)
        if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200]); // vibrate-pause-vibrate
        }

        // Reset to start and play
        audioRef.current.currentTime = 0;
        audioRef.current.volume = 1;
        audioRef.current.play()
            .then(() => console.log('[Audio] ✅ Notification sound played'))
            .catch(err => {
                console.error('[Audio] ❌ Play failed:', err.message);
                // Try to unlock and retry once
                if (!audioUnlockedRef.current) {
                    console.log('[Audio] Attempting to unlock audio...');
                }
            });
    };

    // Subtle haptic feedback for button clicks (10ms - smooth)
    const vibrateOnClick = () => {
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
    };

    const handleApiCall = useCallback(async (endpoint, method = 'PATCH', body = {}) => {
        if (!user) throw new Error('Authentication Error');
        const idToken = await user.getIdToken();
        let url = endpoint;
        // Add impersonation or employee_of param
        if (impersonatedOwnerId) {
            const separator = url.includes('?') ? '&' : '?';
            url += `${separator}impersonate_owner_id=${impersonatedOwnerId}`;
        } else if (employeeOfOwnerId) {
            const separator = url.includes('?') ? '&' : '?';
            url += `${separator}employee_of=${employeeOfOwnerId}`;
        }
        const fetchOptions = {
            method,
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            }
        };
        // Only add body for non-GET methods
        if (method !== 'GET' && method !== 'HEAD') {
            fetchOptions.body = JSON.stringify(body);
        }
        const response = await fetch(url, fetchOptions);
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || 'An API error occurred.');
        }
        return await response.json();
    }, [user, impersonatedOwnerId, employeeOfOwnerId]);

    const handleScanSuccess = useCallback(async (scannedUrl) => {
        setScannerOpen(false);
        try {
            const url = new URL(scannedUrl);
            const orderId = url.searchParams.get('collect_order');

            if (!orderId) {
                throw new Error('This QR code does not contain a valid order ID.');
            }

            // If impersonating, use API to fetch order details
            if (impersonatedOwnerId) {
                const orderData = await handleApiCall(`/api/owner/orders?id=${orderId}`, 'GET');
                if (!orderData || !orderData.order) throw new Error('Order not found or access denied.');
                setScannedOrder({ id: orderId, ...orderData.order });
                return;
            }

            const orderRef = doc(db, 'orders', orderId);
            const orderSnap = await getDoc(orderRef);
            if (!orderSnap.exists()) {
                throw new Error('Order not found in the system.');
            }

            if (!vendorId) {
                throw new Error('Vendor information not yet loaded. Please try again in a moment.');
            }

            if (orderSnap.data().restaurantId !== vendorId) {
                throw new Error('This order does not belong to your stall.');
            }
            setScannedOrder({ id: orderSnap.id, ...orderSnap.data() });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Invalid QR', message: error.message });
        }
    }, [vendorId, impersonatedOwnerId, handleApiCall]);


    useEffect(() => {
        const orderToCollect = searchParams.get('collect_order');
        if (orderToCollect) {
            const fullUrl = `${window.location.origin}${window.location.pathname}?collect_order=${orderToCollect}`;
            handleScanSuccess(fullUrl);
        }
    }, [searchParams, handleScanSuccess]);

    const confirmCollection = async () => {
        if (!scannedOrder) return;
        const tempOrder = { ...scannedOrder };
        try {
            await handleUpdateStatus(tempOrder.id, 'delivered');
            setInfoDialog({ isOpen: true, title: 'Success', message: `Order for ${tempOrder.customerName} marked as collected!` });
            setScannedOrder(null);
            // Refresh orders if impersonating (since no listener)
            if (impersonatedOwnerId) fetchOrdersViaApi();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not mark order as collected: ${error.message}` });
        }
    };

    // Fetch Vendor ID (or use impersonated/employee ID)
    useEffect(() => {
        if (isUserLoading || !user) {
            if (!isUserLoading) setLoading(false);
            return;
        }

        // For impersonation or employee access, use the target owner ID directly
        if (effectiveOwnerId) {
            setVendorId(effectiveOwnerId);
            return;
        }

        // Only for owner's own access - use Firestore
        const q = query(collection(db, 'street_vendors'), where('ownerId', '==', user.uid));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            if (!querySnapshot.empty) {
                const vendorDoc = querySnapshot.docs[0];
                setVendorId(vendorDoc.id);
            } else {
                setLoading(false);
            }
        }, (err) => {
            const contextualError = new FirestorePermissionError({ path: `street_vendors`, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Error fetching vendor ID:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, isUserLoading, effectiveOwnerId]);

    const fetchOrdersViaApi = useCallback(async () => {
        if (!effectiveOwnerId) return;
        setLoading(true);
        try {
            const data = await handleApiCall('/api/owner/orders', 'GET');
            setOrders(data.orders || []);
        } catch (error) {
            console.error("Error fetching orders via API:", error);
            // Don't show dialog on every poll, maybe just log
        } finally {
            setLoading(false);
        }
    }, [effectiveOwnerId, handleApiCall]);

    // POLL: For impersonation/employee access (Optimized)
    usePolling(fetchOrdersViaApi, {
        interval: 30000,
        enabled: !!effectiveOwnerId,
        deps: [effectiveOwnerId]
    });

    // LISTENER: For owner's own access (Real-time)
    useEffect(() => {
        if (effectiveOwnerId) return; // Handled by polling above

        if (!vendorId) {
            console.log('[Orders Debug] No vendorId yet, skipping Firestore query');
            return;
        }

        setLoading(true);
        let isInitialLoad = true;

        const ordersQuery = query(
            collection(db, "orders"),
            where("restaurantId", "==", vendorId),
            where("status", "in", ['pending', 'confirmed', 'preparing', 'Ready', 'awaiting_payment']),
            orderBy("orderDate", "desc")
        );

        const unsubscribe = onSnapshot(ordersQuery, (querySnapshot) => {
            let hasNewPendingOrder = false;
            const fetchedOrders = [];

            // Only check for new orders AFTER initial load
            if (!isInitialLoad) {
                querySnapshot.docChanges().forEach((change) => {
                    if (change.type === 'added' && change.doc.data().status === 'pending') {
                        hasNewPendingOrder = true;
                    }
                });

                if (hasNewPendingOrder) {
                    playNotificationSound();
                }
            }

            querySnapshot.forEach((doc) => {
                fetchedOrders.push({ id: doc.id, ...doc.data() });
            });

            setOrders(fetchedOrders);
            setLoading(false);
            isInitialLoad = false;
        }, (err) => {
            const contextualError = new FirestorePermissionError({ path: `orders`, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Firestore Error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [vendorId, effectiveOwnerId]);

    // 🔧 FIX: Page Visibility API - Auto-refresh when tab becomes active again
    // Prevents "Failed to fetch" errors when user returns after leaving tab inactive
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('[StreetVendor] Tab became visible, refreshing data...');
                // Refresh data immediately when user returns to tab
                if (impersonatedOwnerId) {
                    fetchOrdersViaApi();
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [impersonatedOwnerId, fetchOrdersViaApi]); // Deps needed for the refresh function

    const handleUpdateStatus = async (orderId, newStatus, reason = null, shouldRefund = undefined) => {
        try {
            await handleApiCall('/api/owner/orders', 'PATCH', {
                orderIds: [orderId],
                newStatus,
                rejectionReason: reason,
                shouldRefund,
            });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: error.message });
            throw error;
        }
    };

    const handleMarkOutOfStock = async (itemIds) => {
        if (!vendorId || itemIds.length === 0) return;
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication failed");
            const idToken = await user.getIdToken();
            await fetch('/api/owner/menu', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ itemIds: itemIds, action: 'outOfStock' })
            });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not mark item as out of stock: ${error.message}` });
            throw error;
        }
    };

    const handleMarkReady = (orderId) => { vibrateOnClick(); handleUpdateStatus(orderId, 'Ready'); };
    const handleMarkCollected = (orderId) => { vibrateOnClick(); handleUpdateStatus(orderId, 'delivered'); };
    const handleRevertToPending = (orderId) => { vibrateOnClick(); handleUpdateStatus(orderId, 'pending'); };
    const handleOpenRejectModal = (order) => { vibrateOnClick(); setRejectModalState({ isOpen: true, order }); };

    const handleRejectOrder = (orderId, reason, shouldRefund) => {
        handleUpdateStatus(orderId, 'rejected', reason, shouldRefund);
    };

    const handleMarkCashRefunded = async (orderId) => {
        try {
            await handleApiCall('/api/owner/orders', 'PATCH', {
                orderIds: [orderId],
                action: 'markCashRefunded'
            });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: error.message });
        }
    };

    const filteredOrders = useMemo(() => {
        let items = [...orders];

        if (date?.from) {
            const start = startOfDay(date.from);
            const end = date.to ? endOfDay(date.to) : endOfDay(date.from);
            items = items.filter(order => {
                const orderDate = order.orderDate.toDate();
                return orderDate >= start && orderDate <= end;
            });
        }

        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            items = items.filter(order =>
                order.dineInToken?.toLowerCase().includes(lowerQuery) ||
                order.customerName?.toLowerCase().includes(lowerQuery) ||
                order.customerPhone?.includes(lowerQuery) ||
                order.totalAmount?.toString().includes(lowerQuery)
            );
        }

        return items;
    }, [orders, searchQuery, date]);

    const pendingOrders = useMemo(() => filteredOrders.filter(o => o.status === 'pending'), [filteredOrders]);
    const readyOrders = useMemo(() => filteredOrders.filter(o => o.status === 'Ready'), [filteredOrders]);
    const collectedOrders = useMemo(() => filteredOrders.filter(o => o.status === 'delivered' || o.status === 'picked_up'), [filteredOrders]);
    const cancelledOrders = useMemo(() => filteredOrders.filter(o => o.status === 'rejected'), [filteredOrders]);

    const handleSetDateFilter = (selectedRange) => {
        setDate(selectedRange);
        if (selectedRange?.to || !selectedRange?.from) {
            setIsCalendarOpen(false);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground font-body p-4 pb-24">
            <audio ref={audioRef} src="/notification.mp3" preload="auto" />
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <RejectOrderModal
                isOpen={rejectModalState.isOpen}
                onClose={() => setRejectModalState({ isOpen: false, order: null })}
                order={rejectModalState.order}
                onConfirm={handleRejectOrder}
                onMarkOutOfStock={handleMarkOutOfStock}
                showInfoDialog={setInfoDialog}
            />

            {isScannerOpen && (
                <QrScanner onClose={() => setScannerOpen(false)} onScanSuccess={handleScanSuccess} />
            )}
            {scannedOrder && <ScannedOrderModal isOpen={!!scannedOrder} onClose={() => setScannedOrder(null)} order={scannedOrder} onConfirm={confirmCollection} />}

            <header className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold font-headline">Live Pre-Orders</h1>
                <div className="flex gap-2">
                    <Link href={`/street-vendor-dashboard/history${queryParam}`}>
                        <Button variant="outline" className="flex">
                            <History className="mr-2" /> History
                        </Button>
                    </Link>
                    <Button onClick={() => setScannerOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground hidden md:flex">
                        <QrCode className="mr-2" /> Scan to Collect
                    </Button>
                </div>
            </header>

            <div className="flex items-center gap-4 mb-6">
                <div className="relative flex-grow">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search by token, name, phone..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border"
                    />
                </div>
                <div className="flex-shrink-0">
                    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant={"outline"}
                                className={cn(
                                    "w-auto justify-start text-left font-normal h-10",
                                    !date && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className={cn("h-4 w-4", date && "text-primary")} />
                                <span className={cn("truncate hidden md:inline-block ml-2", date && "text-primary")}>
                                    {date?.from ? (
                                        date.to ? (
                                            <>
                                                {format(date.from, "LLL dd")} - {format(date.to, "LLL dd, y")}
                                            </>
                                        ) : (
                                            format(date.from, "LLL dd, y")
                                        )
                                    ) : (
                                        "Filter by Date"
                                    )}
                                </span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                                initialFocus
                                mode="range"
                                selected={date}
                                onSelect={handleSetDateFilter}
                                numberOfMonths={1}
                                disabled={(d) => d > new Date() || d < new Date("2024-01-01")}
                            />
                        </PopoverContent>
                    </Popover>
                    {date && <Button variant="ghost" size="sm" onClick={() => setDate(null)} className="ml-2">Clear</Button>}
                </div>
            </div>

            <main>
                {(loading || isUserLoading || !vendorId) && !error ? (
                    <div className="text-center py-20 text-muted-foreground">
                        <Loader2 className="mx-auto animate-spin" size={48} />
                        <p className="mt-4">Loading your dashboard...</p>
                    </div>
                ) : error ? (
                    <div className="text-center py-20 text-red-500">{error}</div>
                ) : (
                    <Tabs defaultValue="new_orders" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="new_orders">New ({pendingOrders.length})</TabsTrigger>
                            <TabsTrigger value="ready">Ready ({readyOrders.length})</TabsTrigger>
                        </TabsList>
                        <TabsContent value="new_orders" className="mt-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                <AnimatePresence>
                                    {pendingOrders.map(order => (
                                        <OrderCard key={order.id} order={order} onMarkReady={handleMarkReady} onCancelClick={handleOpenRejectModal} onMarkCashRefunded={handleMarkCashRefunded} userRole={userRole} />
                                    ))}
                                </AnimatePresence>
                                {pendingOrders.length === 0 && <p className="text-muted-foreground text-center py-10 col-span-full">No new orders for the selected date.</p>}
                            </div>
                        </TabsContent>
                        <TabsContent value="ready" className="mt-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                <AnimatePresence>
                                    {readyOrders.map(order => (
                                        <OrderCard key={order.id} order={order} onMarkCollected={handleMarkCollected} onRevertToPending={handleRevertToPending} onMarkCashRefunded={handleMarkCashRefunded} userRole={userRole} />
                                    ))}
                                </AnimatePresence>
                                {readyOrders.length === 0 && <p className="text-muted-foreground text-center py-10 col-span-full">No orders are ready for pickup.</p>}
                            </div>
                        </TabsContent>
                    </Tabs>
                )}
            </main>
            <div className="md:hidden fixed bottom-6 right-6 z-40">
                <Button onClick={() => setScannerOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground h-16 w-16 rounded-full shadow-lg">
                    <QrCode size={32} />
                </Button>
            </div>
        </div >
    );
}

const StreetVendorDashboard = () => (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
        <StreetVendorDashboardContent />
    </Suspense>
);

export default StreetVendorDashboard;
