'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Trash2, PlusCircle, Minus, Plus, CookingPot, Utensils, Ticket, Check, X, ChevronDown, Lock, Loader2, ShoppingCart, AlertTriangle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import InfoDialog from '@/components/InfoDialog';
import { useUser } from '@/firebase';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { v4 as uuidv4 } from 'uuid';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { safeReadCart, safeWriteCart } from '@/lib/cartStorage';
import { getItemVariantLabel } from '@/lib/itemVariantDisplay';

const ORDER_STATE = {
    IDLE: 'idle',
    CREATING_ORDER: 'creating_order',
    SUCCESS: 'success',
    ERROR: 'error'
};

const ClearCartDialog = ({ isOpen, onClose, onConfirm }) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="text-2xl flex items-center gap-2"><Trash2 className="text-destructive" /> Clear Cart?</DialogTitle>
                    <DialogDescription>Are you sure you want to remove all items from your cart? This action cannot be undone.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                    <Button variant="destructive" onClick={onConfirm}>Yes, Clear It</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">Please scan the QR code again to start a new session.</p>
    </div>
);

const CartPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, isUserLoading } = useUser();

    const restaurantId = searchParams.get('restaurantId');
    const tableId = searchParams.get('table');
    const tabId = searchParams.get('tabId');
    const token = searchParams.get('token');

    const [isTokenValid, setIsTokenValid] = useState(false);
    const [tokenError, setTokenError] = useState('');
    const [cartData, setCartData] = useState(null);
    const [cart, setCart] = useState([]);
    const [notes, setNotes] = useState('');
    const [appliedCoupons, setAppliedCoupons] = useState([]);
    const [isClearCartDialogOpen, setIsClearCartDialogOpen] = useState(false);
    const [isBillExpanded, setIsBillExpanded] = useState(false);
    const [isCouponPopoverOpen, setCouponPopoverOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [loadingPage, setLoadingPage] = useState(true);
    const [outOfStockItems, setOutOfStockItems] = useState([]);
    const [orderState, setOrderState] = useState(ORDER_STATE.IDLE);
    const [orderError, setOrderError] = useState(null);

    // Verify dine-in session
    useEffect(() => {
        // RELAXED SESSION CHECK: Don't hard-block if no session info is found
        // This allows users to view their cart even if they took a indirect link.
        setIsTokenValid(true);
        setTokenError(null);
    }, []);

    // Load cart data
    useEffect(() => {
        if (isTokenValid && restaurantId) {
            console.log("[Cart Page] Loading cart data for restaurant:", restaurantId);
            const parsedData = safeReadCart(restaurantId);

            if (Object.keys(parsedData).length > 0) {
                const now = new Date().getTime();

                if (parsedData.expiryTimestamp && now > parsedData.expiryTimestamp) {
                    console.log("[Cart Page] Cart data expired. Clearing cart.");
                    localStorage.removeItem(`cart_${restaurantId}`);
                    setCartData(null);
                    setCart([]);
                } else {
                    console.log("[Cart Page] Found valid cart data:", parsedData);

                    // Check for out of stock items
                    const menuAvailability = parsedData.menuAvailability || {};
                    const availableItems = [];
                    const unavailableItemIds = [];

                    (parsedData.cart || []).forEach(cartItem => {
                        const isAvailable = menuAvailability[cartItem.id] !== false;
                        if (isAvailable) {
                            availableItems.push(cartItem);
                        } else {
                            unavailableItemIds.push(cartItem.cartItemId);
                        }
                    });

                    setOutOfStockItems(unavailableItemIds);

                    // Fetch fresh settings
                    fetch(`/api/owner/settings?restaurantId=${restaurantId}`)
                        .then(res => res.json())
                        .then(freshSettings => {
                            const updatedData = {
                                ...parsedData,
                                gstEnabled: freshSettings.gstEnabled,
                                gstRate: freshSettings.gstPercentage || freshSettings.gstRate || 0,
                                gstMinAmount: freshSettings.gstMinAmount,
                                coupons: freshSettings.coupons || [],
                            };

                            setCartData(updatedData);
                            setCart(availableItems);
                            setNotes(parsedData.notes || '');
                            setAppliedCoupons(parsedData.appliedCoupons || []);

                            safeWriteCart(restaurantId, updatedData);
                        })
                        .catch(err => {
                            console.error("[Cart Page] Failed to fetch fresh settings:", err);
                            setCartData(parsedData);
                            setCart(availableItems);
                            setNotes(parsedData.notes || '');
                            setAppliedCoupons(parsedData.appliedCoupons || []);
                        })
                        .finally(() => {
                            setLoadingPage(false);
                        });
                }
            } else {
                console.log("[Cart Page] No cart data found in localStorage.");
                setCart([]);
                setCartData(null);
                setLoadingPage(false);
            }
        }
    }, [isTokenValid, restaurantId]);

    const updateCartInStorage = (updates) => {
        const currentData = safeReadCart(restaurantId);
        const expiryTimestamp = new Date().getTime() + (24 * 60 * 60 * 1000);
        const updatedData = { ...currentData, ...updates, expiryTimestamp };

        setCartData(updatedData);
        if (updates.cart !== undefined) setCart(updates.cart);
        if (updates.notes !== undefined) setNotes(updates.notes);
        if (updates.appliedCoupons !== undefined) setAppliedCoupons(updates.appliedCoupons);

        safeWriteCart(restaurantId, updatedData);
    };

    const handleUpdateCart = (item, action) => {
        let newCart = [...cart];
        const cartItemId = item.cartItemId;
        const existingItemIndex = newCart.findIndex(cartItem => cartItem.cartItemId === cartItemId);

        if (existingItemIndex > -1) {
            if (action === 'increment') {
                newCart[existingItemIndex].quantity++;
            } else if (action === 'decrement') {
                if (newCart[existingItemIndex].quantity === 1) {
                    newCart.splice(existingItemIndex, 1);
                } else {
                    newCart[existingItemIndex].quantity--;
                }
            }
        }
        updateCartInStorage({ cart: newCart });
    };

    const handleNotesChange = (e) => {
        const newNotes = e.target.value;
        updateCartInStorage({ notes: newNotes });
    };

    const handleCutleryClick = () => {
        const cutleryNote = "Don't send cutlery.";
        if (!notes.includes(cutleryNote)) {
            const newNotes = notes ? `${notes.trim()} ${cutleryNote}` : cutleryNote;
            updateCartInStorage({ notes: newNotes });
        }
    };

    const handleClearCart = () => {
        setIsClearCartDialogOpen(false);
        updateCartInStorage({ cart: [], appliedCoupons: [] });
    };

    const handleGoBack = () => {
        const params = new URLSearchParams();
        if (restaurantId) params.append('restaurantId', restaurantId);
        if (tableId) params.append('table', tableId);
        if (tabId) params.append('tabId', tabId);
        if (token) params.append('token', token);

        router.push(`/order/${restaurantId}?${params.toString()}`);
    };

    // ✅ NEW: Auto-refresh cart prices on mismatch
    const refreshCartPrices = async () => {
        setInfoDialog({ isOpen: true, title: "Updating Prices...", message: "Menu prices may have changed. syncing with latest menu...", type: 'warning' });
        try {
            // Fetch fresh menu with skip_cache=true
            const res = await fetch(`/api/public/menu/${restaurantId}?skip_cache=true&src=cart_refresh`);
            const menuData = await res.json();

            if (!res.ok) throw new Error("Failed to fetch fresh menu");

            let updatedItemsCount = 0;
            const newCart = cart.map(item => {
                // Find matching item in fresh menu
                let freshItem = null;
                // Search in all categories
                for (const catKey in menuData.menu) {
                    const found = menuData.menu[catKey].find(i => i.id === item.id);
                    if (found) {
                        freshItem = found;
                        break;
                    }
                }

                if (!freshItem) return item; // Item removed? Keep as is or remove (keeping for now to avoid data loss)

                // Recalculate Price
                let newTotalPrice = 0;

                // 1. Base Price (Portion based)
                const freshPortion = freshItem.portions?.find(p => p.name === item.portion.name);
                if (freshPortion) {
                    newTotalPrice = parseFloat(freshPortion.price);
                } else {
                    // Fallback if portion removed/renamed - use base or old (risky but safer than 0)
                    newTotalPrice = parseFloat(freshItem.price || item.totalPrice);
                }

                // 2. Add-ons
                if (item.selectedAddOns && Array.isArray(item.selectedAddOns)) {
                    // We need to re-validate add-on prices too if possible
                    // Simplified: Assume addons names match. 
                    // Deep lookup would require iterating freshItem.addOnGroups
                    item.selectedAddOns.forEach(addon => {
                        // Try to find updated price for this addon
                        let freshAddonPrice = addon.price;

                        // Look in flat addons
                        const flatAddon = freshItem.addons?.find(a => a.name === addon.name);
                        if (flatAddon) freshAddonPrice = flatAddon.price;

                        // Look in groups
                        if (!flatAddon && freshItem.addOnGroups) {
                            freshItem.addOnGroups.forEach(grp => {
                                const grpOpt = grp.options?.find(o => o.name === addon.name);
                                if (grpOpt) freshAddonPrice = grpOpt.price;
                            });
                        }
                        newTotalPrice += parseFloat(freshAddonPrice);
                    });
                }

                if (Math.abs(newTotalPrice - item.totalPrice) > 0.5) {
                    updatedItemsCount++;
                }

                return {
                    ...item,
                    price: freshItem.price, // update base price metadata
                    totalPrice: newTotalPrice
                };
            });

            if (updatedItemsCount > 0) {
                updateCartInStorage({ cart: newCart });
                setInfoDialog({ isOpen: true, title: "Prices Updated", message: "Some items in your cart had outdated prices. They have been updated to the latest menu prices. Please review your total.", type: 'success' });
            } else {
                // Even if no visible diff found by our logic, maybe invisible diff? 
                // Just proceed or tell user to try again.
                setInfoDialog({ isOpen: true, title: "Retry Order", message: "We've refreshed the menu data. Please try placing your order again.", type: 'success' });
            }

        } catch (e) {
            console.error("Failed to refresh prices:", e);
            setInfoDialog({ isOpen: true, title: "Error", message: "Could not auto-update prices. Please refresh the page manually." });
        }
    };

    const handlePlaceOrder = async () => {
        console.log("[Cart Page] Placing dine-in post-paid order.");

        // Haptic feedback
        if (typeof window !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate(50);
        }

        if (orderState !== ORDER_STATE.IDLE) {
            console.log('[Cart Page] ⚠️ Order already in progress');
            return;
        }

        setOrderState(ORDER_STATE.CREATING_ORDER);
        setOrderError(null);
        setInfoDialog({ isOpen: true, title: "Processing...", message: "Placing your order. Please wait." });

        try {
            const idempotencyKey = typeof window !== 'undefined'
                ? (localStorage.getItem('current_order_key') || `order_${uuidv4()}`)
                : `order_${uuidv4()}`;

            if (typeof window !== 'undefined') {
                localStorage.setItem('current_order_key', idempotencyKey);
            }

            const resolvedTableId = String(tableId || cartData?.tableId || '').trim();
            const resolvedTabId = String(tabId || cartData?.dineInTabId || cartData?.tabId || '').trim();

            if (!resolvedTabId) {
                throw new Error('Dine-in session missing. Please reopen your table QR and try again.');
            }

            const orderData = {
                idempotencyKey,
                restaurantId,
                items: cart,
                notes: notes || '',
                subtotal: subtotal,
                cgst: cgst,
                sgst: sgst,
                grandTotal: grandTotal,
                deliveryType: 'dine-in',
                tableId: resolvedTableId || null,
                businessType: cartData?.businessType || 'restaurant',
                pax_count: cartData?.pax_count || 1,
                tab_name: cartData?.tab_name || cartData?.name || 'Guest',
                dineInTabId: resolvedTabId,
                paymentMethod: 'post-paid',
                paymentStatus: 'pending',
                customerName: cartData?.tab_name || cartData?.name || 'Guest',
                customerPhone: cartData?.phone || null,
            };

            console.log("[Cart Page] Sending post-paid order:", orderData);
            const res = await fetch('/api/order/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Failed to place order.");

            console.log("[Cart Page] Order successful:", data);
            setOrderState(ORDER_STATE.SUCCESS);

            if (typeof window !== 'undefined') {
                localStorage.removeItem('current_order_key');
            }

            // Save live order
            const liveOrderData = {
                orderId: data.order_id,
                trackingToken: data.token,
                restaurantId: restaurantId,
                deliveryType: 'dine-in',
                tableId: resolvedTableId || null,
                dineInTabId: data.dine_in_tab_id || resolvedTabId,
                timestamp: Date.now()
            };

            const liveOrderKey = `liveOrder_${restaurantId}`;
            let existingOrders = [];
            try {
                const raw = localStorage.getItem(liveOrderKey);
                const parsed = raw ? JSON.parse(raw) : [];
                existingOrders = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            } catch {
                existingOrders = [];
            }
            const mergedOrders = [
                ...existingOrders.filter((order) => order?.orderId !== liveOrderData.orderId),
                liveOrderData
            ];
            localStorage.setItem(liveOrderKey, JSON.stringify(mergedOrders));
            localStorage.removeItem(`cart_${restaurantId}`);

            // Redirect to tracking
            const trackingParams = new URLSearchParams();
            if (data.token) trackingParams.set('token', data.token);
            if (resolvedTableId) trackingParams.set('table', resolvedTableId);
            trackingParams.set('tabId', data.dine_in_tab_id || resolvedTabId);
            router.push(`/track/dine-in/${data.order_id}?${trackingParams.toString()}`);
        } catch (err) {
            console.error("[Cart Page] Order error:", err.message);
            setOrderState(ORDER_STATE.ERROR);

            let friendlyError = 'Something went wrong. Please try again.';
            if (err.message.includes('network')) {
                friendlyError = 'Connection issue. Please check your internet.';
            } else if (err.message.toLowerCase().includes('price mismatch')) {
                // ✅ AUTO RECCOVERY TRIGGER
                console.log("Triggering price auto-recovery...");
                await refreshCartPrices();
                return; // Exit, don't show generic error
            } else if (err.message) {
                friendlyError = err.message;
            }

            setOrderError(friendlyError);
            setInfoDialog({ isOpen: true, title: "Error", message: friendlyError });

            if (typeof window !== 'undefined' && 'vibrate' in navigator) {
                navigator.vibrate([100, 50, 100]);
            }
        }
    };

    const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.totalPrice * item.quantity, 0), [cart]);

    const { totalDiscount, couponDiscount, specialCouponDiscount } = useMemo(() => {
        let couponDiscount = 0;
        let specialCouponDiscount = 0;

        appliedCoupons.forEach(coupon => {
            if (subtotal < coupon.minOrder) return;
            if (coupon.type === 'free_delivery') return;

            let currentDiscount = 0;
            if (coupon.type === 'flat') {
                currentDiscount = coupon.value;
            } else if (coupon.type === 'percentage') {
                currentDiscount = (subtotal * coupon.value) / 100;
            }

            if (coupon.customerId) {
                specialCouponDiscount += currentDiscount;
            } else {
                couponDiscount += currentDiscount;
            }
        });

        return {
            totalDiscount: couponDiscount + specialCouponDiscount,
            couponDiscount,
            specialCouponDiscount,
        };
    }, [appliedCoupons, subtotal]);

    const { cgst, sgst, grandTotal } = useMemo(() => {
        const taxableAmount = subtotal - totalDiscount;
        let cgstAmount = 0;
        let sgstAmount = 0;

        if (cartData?.gstEnabled && taxableAmount > 0) {
            if (taxableAmount >= (cartData.gstMinAmount || 0)) {
                const totalGstRate = cartData.gstRate || 5;
                const halfGstRate = totalGstRate / 2;
                cgstAmount = taxableAmount * (halfGstRate / 100);
                sgstAmount = taxableAmount * (halfGstRate / 100);
            }
        }

        const total = taxableAmount + cgstAmount + sgstAmount;
        return { cgst: cgstAmount, sgst: sgstAmount, grandTotal: total };
    }, [subtotal, totalDiscount, cartData]);

    const handleToggleCoupon = (couponToToggle) => {
        let newAppliedCoupons;
        const isApplied = appliedCoupons.some(c => c.id === couponToToggle.id);

        if (isApplied) {
            newAppliedCoupons = appliedCoupons.filter(c => c.id !== couponToToggle.id);
        } else {
            if (subtotal < couponToToggle.minOrder) {
                setInfoDialog({
                    isOpen: true,
                    title: "Minimum Order Not Met",
                    message: `You need to spend at least ₹${couponToToggle.minOrder} to use this coupon.`,
                    type: 'error'
                });
                return;
            }
            const isSpecial = !!couponToToggle.customerId;
            let currentAppliedCoupons = [...appliedCoupons];
            if (!isSpecial) {
                currentAppliedCoupons = currentAppliedCoupons.filter(c => !!c.customerId);
            }
            newAppliedCoupons = [...currentAppliedCoupons, couponToToggle];
        }

        updateCartInStorage({ appliedCoupons: newAppliedCoupons });
        setTimeout(() => setCouponPopoverOpen(false), 1000);
    };

    const allCoupons = cartData?.coupons || [];
    const specialCoupons = allCoupons.filter(c => c.customerId);
    const normalCoupons = allCoupons.filter(c => !c.customerId);

    if (loadingPage) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-destructive">Session could not be verified.</p></div>;
    }

    if (!cartData || cart.length === 0) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-muted-foreground p-4">
                <ShoppingCart size={48} className="mb-4" />
                <h1 className="text-2xl font-bold">Your Cart is Empty</h1>
                <p className="mt-2">Looks like you haven&apos;t added anything to your cart yet.</p>
                <Button onClick={handleGoBack} className="mt-6">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Menu
                </Button>
            </div>
        );
    }

    return (
        <>
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
                type={infoDialog.type}
            />
            <ClearCartDialog
                isOpen={isClearCartDialogOpen}
                onClose={() => setIsClearCartDialogOpen(false)}
                onConfirm={handleClearCart}
            />

            <div className="min-h-screen bg-background text-foreground flex flex-col">
                {/* Header */}
                <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                    <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <Button variant="ghost" size="icon" onClick={handleGoBack} className="h-10 w-10">
                                <ArrowLeft />
                            </Button>
                            <div>
                                <p className="text-xs text-muted-foreground">Dine-In Cart</p>
                                <h1 className="text-xl font-bold">{cartData.restaurantName}</h1>
                            </div>
                        </div>
                    </div>
                </header>

                <main className="flex-grow p-4 container mx-auto pb-32">
                    {outOfStockItems.length > 0 && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Items Out of Stock</AlertTitle>
                            <AlertDescription>
                                Some items are no longer available and have been removed from your cart.
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Cart Items */}
                    <div className="bg-card p-4 rounded-lg border border-border mt-4">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-lg">Your Items</h3>
                            <Button variant="destructive" size="sm" onClick={() => setIsClearCartDialogOpen(true)}>
                                <Trash2 className="mr-2 h-4 w-4" /> Clear
                            </Button>
                        </div>

                        <div className="space-y-4">
                            {cart.map(item => (
                                <motion.div
                                    layout
                                    key={item.cartItemId}
                                    className="flex items-center gap-4 p-3 rounded-md"
                                >
                                    <div className={`w-4 h-4 border ${item.isVeg ? 'border-green-500' : 'border-red-500'} flex items-center justify-center flex-shrink-0`}>
                                        <div className={`w-2 h-2 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'} rounded-full`}></div>
                                    </div>
                                    <div className="flex-grow">
                                        <p className="font-semibold text-foreground">{item.name}{getItemVariantLabel(item)}</p>
                                        {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                                            <ul className="mt-1 pl-4">
                                                {item.selectedAddOns.map(addon => (
                                                    <li key={addon.name} className="text-xs text-muted-foreground list-disc">
                                                        {addon.name} (+₹{addon.price})
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-7 w-7 hover:bg-red-500/10 hover:text-red-500"
                                            onClick={() => handleUpdateCart(item, 'decrement')}
                                        >
                                            <Minus className="h-4 w-4" />
                                        </Button>
                                        <span className="font-bold w-5 text-center">{item.quantity}</span>
                                        <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-7 w-7 hover:bg-green-500/10 hover:text-green-500"
                                            onClick={() => handleUpdateCart(item, 'increment')}
                                        >
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <p className="w-20 text-right font-bold">₹{item.totalPrice * item.quantity}</p>
                                </motion.div>
                            ))}
                        </div>

                        <Button variant="outline" onClick={handleGoBack} className="w-full mt-4 border-green-500 text-green-500 bg-green-500/10 hover:bg-green-500/20">
                            <PlusCircle className="mr-2 h-4 w-4" /> Add more items
                        </Button>

                        {/* Cooking Instructions */}
                        <div className="relative mt-4 pt-4 border-t border-dashed border-border">
                            <CookingPot className="absolute left-0 top-7 h-5 w-5 text-muted-foreground" />
                            <textarea
                                value={notes}
                                onChange={handleNotesChange}
                                placeholder="Add cooking instructions... (e.g. No onion, less spicy)"
                                rows={2}
                                className="w-full pl-7 pr-4 py-2 rounded-md bg-input border border-foreground text-sm focus:ring-1 focus:ring-primary"
                            />
                            <div className="mt-2 flex justify-end">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCutleryClick}
                                    className={cn("flex items-center", notes.includes("Don't send cutlery.") && "bg-primary/20 text-primary border-primary")}
                                >
                                    <Utensils className="mr-2 h-4 w-4" />
                                    Don&apos;t send cutlery
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Coupons */}
                    {allCoupons.length > 0 && (
                        <div className="p-4 mt-4 bg-card rounded-lg border border-border">
                            <h3 className="font-bold text-lg mb-2">Coupons & Offers</h3>
                            <Popover open={isCouponPopoverOpen} onOpenChange={setCouponPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                                        {appliedCoupons.length > 0 ? (
                                            <span className="flex items-center text-primary font-semibold">
                                                <Check className="mr-2 h-4 w-4" /> {appliedCoupons.length} Coupon(s) Applied
                                            </span>
                                        ) : (
                                            <span className="flex items-center">
                                                <Ticket className="mr-2 h-4 w-4" /> View Available Coupons
                                            </span>
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 p-0" align="start">
                                    <div className="p-4 border-b border-border">
                                        <h4 className="font-medium">Available Coupons</h4>
                                        <p className="text-sm text-muted-foreground">Select coupons to apply.</p>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto space-y-2 p-4">
                                        {specialCoupons.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-sm font-semibold flex items-center gap-2 text-primary">
                                                    <Sparkles size={16} /> Special for you
                                                </p>
                                                {specialCoupons.map(coupon => {
                                                    const isApplied = appliedCoupons.some(c => c.id === coupon.id);
                                                    return (
                                                        <div
                                                            key={coupon.id}
                                                            onClick={() => handleToggleCoupon(coupon)}
                                                            className={cn(
                                                                "p-2 rounded-md border-2 cursor-pointer",
                                                                isApplied ? "border-primary bg-primary/10" : "border-dashed border-primary/50"
                                                            )}
                                                        >
                                                            <div className="flex justify-between items-center">
                                                                <p className="font-bold">{coupon.code}</p>
                                                                {isApplied && <Check size={16} className="text-primary" />}
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">{coupon.description}</p>
                                                        </div>
                                                    );
                                                })}
                                                <hr className="my-4 border-border" />
                                            </div>
                                        )}

                                        {normalCoupons.length > 0 ? normalCoupons.map(coupon => {
                                            const isApplied = appliedCoupons.some(c => c.id === coupon.id);
                                            return (
                                                <div
                                                    key={coupon.id}
                                                    onClick={() => handleToggleCoupon(coupon)}
                                                    className={cn(
                                                        "p-2 rounded-md border-2 cursor-pointer",
                                                        isApplied ? "border-primary bg-primary/10" : "border-border"
                                                    )}
                                                >
                                                    <div className="flex justify-between items-center">
                                                        <p className="font-bold">{coupon.code}</p>
                                                        {isApplied && <Check size={16} className="text-primary" />}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">{coupon.description}</p>
                                                </div>
                                            );
                                        }) : (specialCoupons.length === 0 && (
                                            <p className="text-xs text-muted-foreground text-center py-4">No coupons available.</p>
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}

                    {/* Bill Summary */}
                    <div className="mt-6 p-4 border-t-2 border-primary bg-card rounded-lg shadow-lg">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-bold">Bill Summary</h3>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsBillExpanded(!isBillExpanded)}
                                className="text-primary"
                            >
                                {isBillExpanded ? 'Hide Details' : 'View Details'}
                                <ChevronDown className={cn("ml-1 h-4 w-4 transition-transform", isBillExpanded && "rotate-180")} />
                            </Button>
                        </div>

                        <AnimatePresence>
                            {isBillExpanded && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    <div className="space-y-1 text-sm mt-4 pt-4 border-t border-dashed">
                                        <div className="flex justify-between">
                                            <span>Subtotal:</span>
                                            <span className="font-medium">₹{subtotal.toFixed(2)}</span>
                                        </div>
                                        {couponDiscount > 0 && (
                                            <div className="flex justify-between text-green-400">
                                                <span>Coupon Discount:</span>
                                                <span className="font-medium">- ₹{couponDiscount.toFixed(2)}</span>
                                            </div>
                                        )}
                                        {specialCouponDiscount > 0 && (
                                            <div className="flex justify-between text-primary">
                                                <span>Special Discount:</span>
                                                <span className="font-medium">- ₹{specialCouponDiscount.toFixed(2)}</span>
                                            </div>
                                        )}
                                        {cgst > 0 && (
                                            <div className="flex justify-between">
                                                <span>CGST ({(cartData?.gstRate || 5) / 2}%):</span>
                                                <span className="font-medium">₹{cgst.toFixed(2)}</span>
                                            </div>
                                        )}
                                        {sgst > 0 && (
                                            <div className="flex justify-between">
                                                <span>SGST ({(cartData?.gstRate || 5) / 2}%):</span>
                                                <span className="font-medium">₹{sgst.toFixed(2)}</span>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="border-t border-dashed my-3"></div>

                        <div className="flex justify-between items-center text-lg font-bold">
                            <span>Total:</span>
                            <span>₹{grandTotal > 0 ? grandTotal.toFixed(2) : '0.00'}</span>
                        </div>

                        {totalDiscount > 0 && (
                            <div className="text-right text-sm font-semibold text-green-400 mt-1">
                                You saved ₹{totalDiscount.toFixed(2)}!
                            </div>
                        )}
                    </div>
                </main>

                {/* Footer - Place Order Button */}
                <div className="fixed bottom-0 left-0 w-full z-30 bg-background/80 backdrop-blur-sm border-t border-border">
                    <div className="container mx-auto p-4">
                        <Button
                            onClick={handlePlaceOrder}
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-lg font-bold"
                            disabled={cart.length === 0 || orderState === ORDER_STATE.CREATING_ORDER || outOfStockItems.length > 0}
                        >
                            {orderState === ORDER_STATE.CREATING_ORDER ? (
                                <>
                                    <Loader2 className="animate-spin mr-2" /> Processing Order...
                                </>
                            ) : (
                                'Place Order'
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
};

const CartPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
        <CartPageInternal />
    </Suspense>
);

export default CartPage;
