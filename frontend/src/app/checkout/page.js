'use client';

import React, { useState, useEffect, useMemo, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Wallet, IndianRupee, CreditCard, Landmark, Split, Users as UsersIcon, QrCode, PlusCircle, Trash2, Home, Building, MapPin, Lock, Loader2, CheckCircle, Share2, Copy, User, Phone, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Ticket, Minus, Plus, Edit2, Banknote, HandCoins, Percent, ChevronRight, Car } from 'lucide-react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';
import { Input } from '@/components/ui/input';
import { useUser } from '@/firebase';

import AddressSelectionList from '@/components/AddressSelectionList';
import InfoDialog from '@/components/InfoDialog';
import { calculateHaversineDistance, calculateDeliveryCharge } from '@/lib/distance';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import { v4 as uuidv4 } from 'uuid';
import { fetchWithRetry } from '@/lib/fetchWithRetry';
import { safeReadCart, safeWriteCart } from '@/lib/cartStorage';
import { getItemVariantLabel } from '@/lib/itemVariantDisplay';
import { sendClientTelemetryEvent } from '@/lib/clientTelemetry';

const SplitBillInterface = dynamic(() => import('@/components/SplitBillInterface'), { ssr: false });
const CustomizationDrawer = dynamic(() => import('@/components/CustomizationDrawer'), { ssr: false });


const ORDER_STATE = {
    IDLE: 'idle',
    CREATING_ORDER: 'creating_order',
    PAYMENT_PROCESSING: 'payment_processing',
    PAYMENT_PENDING: 'payment_pending',
    SUCCESS: 'success',
    ERROR: 'error'
};

const normalizeCouponType = (couponType) => {
    const normalized = String(couponType || '').trim().toLowerCase();
    if (normalized === 'fixed') return 'flat';
    return normalized;
};

const normalizeCoupon = (coupon) => {
    if (!coupon) return null;
    return {
        ...coupon,
        type: normalizeCouponType(coupon.type),
        value: Number(coupon.value) || 0,
        minOrder: Number(coupon.minOrder) || 0,
        maxDiscount: Number(coupon.maxDiscount) || 0,
    };
};

const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">Please initiate a new session by sending a message to the restaurant on WhatsApp.</p>
    </div>
);

// ✅ NEW: Helper for managing Back Button state for modals
const BackButtonHandler = ({ onClose }) => {
    useEffect(() => {
        // Push state on mount
        const state = { modalOpen: true, timestamp: Date.now() };
        window.history.pushState(state, '', window.location.href);

        const handlePopState = (event) => {
            // If popstate fires, it means user pressed back (or forward)
            // We should close the modal
            onClose();
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            // Parent handles history.back() on manual close
        };
    }, []);

    return null;
};





const CheckoutPageInternal = () => {
    const router = useRouter();
    const { toast } = useToast();
    const searchParams = useSearchParams();
    const { user, isUserLoading } = useUser();
    const restaurantId = searchParams.get('restaurantId');
    const phoneFromUrl = searchParams.get('phone');
    const token = searchParams.get('token');
    const ref = searchParams.get('ref'); // NEW: Guest Ref
    const tableId = searchParams.get('table');
    const tabId = searchParams.get('tabId');
    const isPaymentConfirmed = searchParams.get('payment_confirmed');

    // ... (State hooks unchanged) ...
    const [isTokenValid, setIsTokenValid] = useState(false);
    const [tokenError, setTokenError] = useState('');

    const [cart, setCart] = useState([]);
    const [cartData, setCartData] = useState(null);
    const [appliedCoupons, setAppliedCoupons] = useState([]);
    const [carOrderDetails, setCarOrderDetails] = useState(null);
    const [carTokenPreview, setCarTokenPreview] = useState('');

    const [orderName, setOrderName] = useState('');
    const [orderPhone, setOrderPhone] = useState('');
    const [selectedAddress, setSelectedAddress] = useState(null);

    const [userAddresses, setUserAddresses] = useState([]);
    const [codEnabled, setCodEnabled] = useState(false);
    const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(true);

    const [isOnlinePaymentFlow, setIsOnlinePaymentFlow] = useState(false);
    const [isSplitBillActive, setIsSplitBillActive] = useState(false);
    // const [detailsConfirmed, setDetailsConfirmed] = useState(false); // REMOVED: Two-step flow
    const [isPaymentDrawerOpen, setIsPaymentDrawerOpen] = useState(false); // NEW: Bottom drawer
    const [activeOrderId, setActiveOrderId] = useState(searchParams.get('activeOrderId'));

    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
    const [selectedOnlinePaymentType, setSelectedOnlinePaymentType] = useState('full'); // 'full' or 'split'
    const [paymentGateway, setPaymentGateway] = useState('razorpay'); // 'razorpay', 'phonepe'
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);
    const [orderState, setOrderState] = useState(ORDER_STATE.IDLE);
    const [orderError, setOrderError] = useState('');
    const [retryCount, setRetryCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [idempotencyKey, setIdempotencyKey] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [vendorCharges, setVendorCharges] = useState({
        gstEnabled: false, gstRate: 5, gstMinAmount: 0,
        convenienceFeeEnabled: false, convenienceFeeRate: 2.5, convenienceFeePaidBy: 'customer', convenienceFeeLabel: 'Payment Fee',
        packagingChargeEnabled: false, packagingChargeAmount: 0
    });

    // const [bundlingOrderDetails, setBundlingOrderDetails] = useState(null);
    const [isDineInModalOpen, setDineInModalOpen] = useState(false);

    // NEW: Pro Checkout UI States
    const [cookingInstructions, setCookingInstructions] = useState('');
    const [selectedTipAmount, setSelectedTipAmount] = useState(0);
    const [customTipAmount, setCustomTipAmount] = useState('');
    const [showCustomTipInput, setShowCustomTipInput] = useState(false);
    const [isBillSummaryExpanded, setIsBillSummaryExpanded] = useState(false); // Collapsed by default
    const [isAddressSelectorOpen, setIsAddressSelectorOpen] = useState(false); // Top slide-in drawer for addresses
    const [isCouponDrawerOpen, setIsCouponDrawerOpen] = useState(false); // NEW: Bottom slide-in drawer for coupons
    const [couponCodeInput, setCouponCodeInput] = useState('');

    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
    const [editingItemIndex, setEditingItemIndex] = useState(null);

    const mergeCartDataFromStorage = (storageData) => {
        setCartData((prev) => {
            const normalizedStorageCoupons = (Array.isArray(storageData?.availableCoupons) ? storageData.availableCoupons : [])
                .map(normalizeCoupon)
                .filter(Boolean);
            const preservedCoupons = Array.isArray(prev?.availableCoupons) ? prev.availableCoupons : [];

            return {
                ...(prev || {}),
                ...(storageData || {}),
                availableCoupons: normalizedStorageCoupons.length > 0 ? normalizedStorageCoupons : preservedCoupons,
            };
        });
    };

    const handleEditItem = (index) => {
        setEditingItemIndex(index);
        setIsEditDrawerOpen(true);
    };

    const handleUpdateItem = (updatedItem) => {
        if (editingItemIndex === null) return;

        const newCart = [...cart];
        newCart[editingItemIndex] = updatedItem;
        setCart(newCart);

        // Persist
        const savedData = safeReadCart(restaurantId);
        savedData.cart = newCart;
        safeWriteCart(restaurantId, savedData);
        mergeCartDataFromStorage(savedData);

        setIsEditDrawerOpen(false);
        setEditingItemIndex(null);
        toast({ title: "Item Updated", description: "Your changes have been saved." });
    };

    // ✅ NEW: Dynamic Delivery Validation
    const [deliveryValidation, setDeliveryValidation] = useState(null);
    const [isValidatingDelivery, setIsValidatingDelivery] = useState(false);
    const validationRequestSeqRef = useRef(0);
    const selectedAddressRef = useRef(null);
    const outOfRangeNoticeKeyRef = useRef(null);
    const deliveryValidationCacheRef = useRef({ key: '', result: null, updatedAt: 0 });
    const hasTrackedCheckoutOpenRef = useRef(false);
    const DELIVERY_VALIDATION_CACHE_TTL_MS = 15000;

    useEffect(() => {
        selectedAddressRef.current = selectedAddress;
        if (!selectedAddress) {
            outOfRangeNoticeKeyRef.current = null;
        }
    }, [selectedAddress]);

    const buildDeliveryValidationPayload = (addr, subtotalAmount) => {
        if (!addr || !restaurantId) return null;
        const addressLat = Number(addr.lat ?? addr.latitude);
        const addressLng = Number(addr.lng ?? addr.longitude);
        if (!Number.isFinite(addressLat) || !Number.isFinite(addressLng)) return null;

        return {
            restaurantId,
            addressLat,
            addressLng,
            subtotal: Number(subtotalAmount) || 0,
        };
    };

    const buildDeliveryValidationKey = (payload) => (
        payload
            ? `${payload.restaurantId}:${payload.addressLat.toFixed(6)}:${payload.addressLng.toFixed(6)}:${Number(payload.subtotal).toFixed(2)}`
            : ''
    );

    const getCachedDeliveryValidation = (validationKey) => {
        if (!validationKey) return null;
        const { key, result, updatedAt } = deliveryValidationCacheRef.current;
        if (!result || key !== validationKey) return null;
        if ((Date.now() - updatedAt) > DELIVERY_VALIDATION_CACHE_TTL_MS) return null;
        return result;
    };

    const setCachedDeliveryValidation = (validationKey, result) => {
        if (!validationKey || !result) return;
        deliveryValidationCacheRef.current = {
            key: validationKey,
            result,
            updatedAt: Date.now(),
        };
    };

    const applyDeliveryValidationResult = (result, addr) => {
        setDeliveryValidation(result);
        const lat = Number(addr?.lat ?? addr?.latitude);
        const lng = Number(addr?.lng ?? addr?.longitude);

        if (!result?.allowed) {
            const addressKey = Number.isFinite(lat) && Number.isFinite(lng)
                ? `${lat.toFixed(6)},${lng.toFixed(6)}`
                : '';
            if (addressKey && outOfRangeNoticeKeyRef.current !== addressKey) {
                outOfRangeNoticeKeyRef.current = addressKey;
                setInfoDialog({
                    isOpen: true,
                    title: 'Delivery Not Available',
                    message: `${result.message || 'This address is outside our delivery range.'}\n\nPlease select an address within serviceable distance.`,
                    type: 'warning'
                });
            }
        } else {
            outOfRangeNoticeKeyRef.current = null;
        }
    };

    const validateDelivery = async (addr, currentSubtotal) => {
        if (!addr) {
            console.log('[Checkout] No address provided for validation');
            return;
        }

        const payload = buildDeliveryValidationPayload(addr, currentSubtotal);
        if (!payload) {
            console.warn('[Checkout] Address missing coordinates:', addr?.label, addr);
            return;
        }

        const validationKey = buildDeliveryValidationKey(payload);
        const cachedResult = getCachedDeliveryValidation(validationKey);
        if (cachedResult) {
            applyDeliveryValidationResult(cachedResult, addr);
            return;
        }

        const requestSeq = ++validationRequestSeqRef.current;
        setIsValidatingDelivery(true);
        try {
            const response = await fetch('/api/delivery/calculate-charge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const result = await response.json();
                if (requestSeq !== validationRequestSeqRef.current) {
                    return;
                }
                setCachedDeliveryValidation(validationKey, result);
                applyDeliveryValidationResult(result, addr);
            } else {
                const errData = await response.json();
                console.error('[Checkout] API Error during validation:', errData);
            }
        } catch (error) {
            console.error('[Checkout] Delivery validation failed:', error);
        } finally {
            if (requestSeq === validationRequestSeqRef.current) {
                setIsValidatingDelivery(false);
            }
        }
    };

    // Moved useEffect to later in file after deliveryType initialization




    const updateItemQuantity = (index, delta) => {
        const newCart = [...cart];
        const item = { ...newCart[index] }; // Clone item
        const newQuantity = (item.quantity || 1) + delta;

        if (newQuantity < 1) {
            // Remove item if quantity drops below 1
            newCart.splice(index, 1);
        } else {
            item.quantity = newQuantity;
            // FIXED: Do NOT update item.totalPrice here! 
            // item.totalPrice represents the UNIT PRICE (Base + Addons) coming from OrderPage/CartPage.
            // If we multiply it here, it becomes Line Total, breaking the consistency.
            // Only update if we strictly know we are recalculating unit price (not doing that here).

            // Legacy cleanup: ensure we don't carry over bad data if previously corrupted
            // if (item.price && item.totalPrice && item.totalPrice > item.price * 2 && newQuantity === 1) { 
            //    // Heuristic: If totalPrice was incorrectly scaled previously? Hard to know.
            // }
            newCart[index] = item;
        }

        if (newCart.length === 0) {
            setCart([]);
            const savedData = safeReadCart(restaurantId);
            savedData.cart = [];
            safeWriteCart(restaurantId, savedData);
            mergeCartDataFromStorage(savedData);

            // Redirect to Order Page
            toast({ title: "Cart Empty", description: "Redirecting to menu..." });
            router.replace(`/order/${restaurantId}?${searchParams.toString()}`);
            return;
        }

        setCart(newCart);
        // Persist to LocalStorage
        const savedData = safeReadCart(restaurantId);
        savedData.cart = newCart;
        safeWriteCart(restaurantId, savedData);
        mergeCartDataFromStorage(savedData); // Trigger re-calc without dropping coupons
    };

    const handleAddNewAddress = () => {
        const params = new URLSearchParams(searchParams.toString());
        const currentParamsString = params.toString();
        router.push(`/add-address?${currentParamsString}&useCurrent=true&returnUrl=${encodeURIComponent(`/checkout?${currentParamsString}`)}`);
    };

    const handleUseCurrentLocation = () => {
        const calculateParams = () => {
            const params = {};
            searchParams.forEach((value, key) => {
                params[key] = value;
            });
            return params;
        };
        const currentParams = calculateParams();
        const currentParamsString = new URLSearchParams(currentParams).toString();
        // Direct navigation to Add Address with Geolocation flag, bypassing redundant Location page
        router.push(`/add-address?${currentParamsString}&useCurrent=true&returnUrl=${encodeURIComponent(`/checkout?${currentParamsString}`)}`);
    };


    // Initialize Idempotency Key (Persist across reloads)
    useEffect(() => {
        try {
            const storedKey = localStorage.getItem('current_order_key');
            if (storedKey) {
                setIdempotencyKey(storedKey);
            } else {
                const newKey = uuidv4();
                localStorage.setItem('current_order_key', newKey);
                setIdempotencyKey(newKey);
            }
        } catch (e) {
            // Fallback for private mode or storage errors
            const newKey = uuidv4();
            setIdempotencyKey(newKey);
        }
    }, []);

    useEffect(() => {
        console.log("[Checkout Page] Component mounting. isUserLoading:", isUserLoading);
        const verifyAndFetch = async () => {
            // OPTIMISTIC LOADING: If we already have some cart data, don't show full spinner
            const potentialCachedCart = localStorage.getItem(`cart_${restaurantId}`);
            if (!cartData && !potentialCachedCart) {
                setLoading(true);
            } else {
                console.log("[Checkout Page] Optimistic Load: Skipping full spinner as data exists");
            }

            const isDineIn = !!tableId;
            const isLoggedInUser = !!user;
            // SIMPLIFIED: Ref presence is sufficient - no token validation needed
            const isWhatsAppSession = !!ref;

            const savedCart = safeReadCart(restaurantId);

            let derivedDeliveryType = 'delivery';
            if (tableId) {
                derivedDeliveryType = 'dine-in';
            } else {
                derivedDeliveryType = savedCart.deliveryType || 'delivery';
            }

            const deliveryType = derivedDeliveryType;

            if (!hasTrackedCheckoutOpenRef.current) {
                sendClientTelemetryEvent('checkout_opened', { flow: deliveryType });
                hasTrackedCheckoutOpenRef.current = true;
            }

            // ✅ RESTORE CAR DETAILS if present in saved cart
            if (deliveryType === 'car-order' && (savedCart.carSpot || savedCart.carDetails)) {
                setCarOrderDetails({
                    carSpot: savedCart.carSpot || null,
                    carDetails: savedCart.carDetails || null,
                    phone: savedCart.phone || ''
                });
                if (savedCart.dineInToken) {
                    setCarTokenPreview(savedCart.dineInToken);
                }
            }
            const isAnonymousPreOrder = deliveryType === 'street-vendor-pre-order' && !isDineIn && !isLoggedInUser && !isWhatsAppSession;

            console.log(`[Checkout Page] Checks: isDineIn=${isDineIn}, WS=${isWhatsAppSession}, Ref=${!!ref}`);

            // RELAXED SESSION CHECK: Don't hard-block if no session info is found
            // (Strict validation still happens at the API level during Checkout/Order creation).
            setIsTokenValid(true);
            setTokenError(null);

            // REMOVED: detailsConfirmed logic - unified checkout shows all sections at once

            const phoneToLookup = phoneFromUrl || savedCart.phone || user?.phoneNumber || '';
            setOrderPhone(phoneToLookup);

            if (!restaurantId) { router.push('/'); return; }
            setError('');

            let updatedData = {
                ...savedCart,
                phone: phoneToLookup,
                token,
                tableId,
                dineInTabId: tabId || savedCart.dineInTabId || null,
                deliveryType
            };
            const paymentSettingsPromise = fetch(`/api/owner/settings?restaurantId=${restaurantId}`);
            const menuPromise = fetch(`/api/public/menu/${restaurantId}?src=checkout_page`);

            // ... (Dine-in fetch logic lines 299-324 assume unchanged) ...

            // FETCH EXISTING ORDER DATA for dine-in payment (when coming from track page)
            if (tabId && deliveryType === 'dine-in') {
                console.log('[Checkout] Fetching existing dine-in order data for tabId:', tabId);
                try {
                    const orderRes = await fetch(`/api/order/active?tabId=${tabId}`);
                    if (orderRes.ok) {
                        const orderData = await orderRes.json();
                        console.log('[Checkout] Fetched dine-in order:', orderData);
                        const cartItems = orderData.items || [];
                        const totalAmount = orderData.totalAmount || orderData.grandTotal || 0;
                        updatedData = {
                            ...updatedData,
                            cart: cartItems,
                            tab_name: orderData.tab_name || orderData.customerName,
                            subtotal: orderData.subtotal || totalAmount,
                            grandTotal: totalAmount
                        };
                    }
                } catch (err) {
                    console.error('[Checkout] Failed to fetch dine-in order:', err);
                }
            }

            // ✅ Car-order add-more/session restore: pull token + tab context from active order
            if (deliveryType === 'car-order' && activeOrderId) {
                try {
                    const statusToken = token || updatedData.token || '';
                    const statusUrl = statusToken
                        ? `/api/order/status/${activeOrderId}?token=${encodeURIComponent(statusToken)}&lite=1`
                        : `/api/order/status/${activeOrderId}?lite=1`;
                    const statusRes = await fetch(statusUrl, { cache: 'no-store' });
                    if (statusRes.ok) {
                        const statusPayload = await statusRes.json();
                        const activeOrder = statusPayload?.order || {};
                        updatedData = {
                            ...updatedData,
                            dineInTabId: activeOrder.dineInTabId || updatedData.dineInTabId || null,
                            dineInToken: activeOrder.dineInToken || updatedData.dineInToken || null,
                            carSpot: activeOrder.carSpot || updatedData.carSpot || null,
                            carDetails: activeOrder.carDetails || updatedData.carDetails || null
                        };
                        if (activeOrder.dineInToken) {
                            setCarTokenPreview(activeOrder.dineInToken);
                        }
                    }
                } catch (err) {
                    console.warn('[Checkout] Could not fetch car-order session token:', err?.message || err);
                }
            }


            console.log("[Checkout Page] Setting cart data from localStorage:", updatedData);
            setCart(updatedData.cart || []);
            setAppliedCoupons((updatedData.appliedCoupons || []).map(normalizeCoupon).filter(Boolean));
            setCartData(updatedData);
            if (deliveryType === 'car-order') {
                safeWriteCart(restaurantId, updatedData);
                setCarOrderDetails({
                    carSpot: updatedData.carSpot || null,
                    carDetails: updatedData.carDetails || null,
                    phone: updatedData.phone || ''
                });
                if (updatedData.dineInToken) {
                    setCarTokenPreview(updatedData.dineInToken);
                }
            }


            try {
                const customerNameFromStorage = localStorage.getItem('customerName');
                setOrderName(customerNameFromStorage || user?.displayName || savedCart.tab_name || '');

                // LOOKUP USER DETAILS (Supports Cookie-based lookup for GuestID)
                // LOOKUP USER DETAILS (Uid-first via API)
                if (phoneToLookup || ref || user) {
                    const lookupPayload = {};
                    if (phoneToLookup) lookupPayload.phone = phoneToLookup;
                    if (ref) lookupPayload.ref = ref;

                    const headers = { 'Content-Type': 'application/json' };
                    // Add Auth header if user is logged in
                    if (user) {
                        try {
                            const idToken = await user.getIdToken();
                            headers['Authorization'] = `Bearer ${idToken}`;
                        } catch (e) {
                            console.warn("Failed to get ID token for lookup:", e);
                        }
                    }

                    const lookupRes = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(lookupPayload)
                    });

                    if (lookupRes.ok) {
                        const data = await lookupRes.json();
                        setOrderName(prev => prev || data.name || ''); // Fill name from profile if not set
                        if (deliveryType === 'delivery') {
                            setUserAddresses(data.addresses || []);

                            // 🎯 PRIORITY: Check localStorage for saved address first
                            const savedLocation = localStorage.getItem('customerLocation');
                            if (savedLocation && data.addresses?.length > 0 && !selectedAddress) {
                                try {
                                    const parsedLocation = JSON.parse(savedLocation);
                                    console.log('[Checkout] 📍 Checking saved address:', parsedLocation.label);

                                    // Find matching address by ID
                                    const matchingAddress = data.addresses.find(addr => addr.id === parsedLocation.id);
                                    if (matchingAddress) {
                                        console.log('[Checkout] ✅ Found & selecting saved address:', matchingAddress.label);
                                        setSelectedAddress(matchingAddress);
                                    } else {
                                        console.warn('[Checkout] ⚠️ Saved address not found, selecting first');
                                        setSelectedAddress(data.addresses[0]);
                                    }
                                } catch (e) {
                                    console.error('[Checkout] Failed to parse saved address, selecting first');
                                    setSelectedAddress(data.addresses[0]);
                                }
                            } else if (data.addresses?.length > 0 && !selectedAddress) {
                                // No saved address, select first
                                console.log('[Checkout] No saved address, selecting first');
                                setSelectedAddress(data.addresses[0]);
                            }
                        }
                    } else if (lookupRes.status === 404) {
                        console.log("Customer profile not found (might be new).");
                    }
                }

                // Prioritize payment settings for actionable checkout UI.
                // Menu/coupon enrichment is applied asynchronously to avoid blocking initial render.
                const paymentSettingsRes = await paymentSettingsPromise;
                menuPromise
                    .then(async (menuRes) => {
                        if (!menuRes.ok) return;
                        const menuData = await menuRes.json();
                        console.log('[Checkout] 🎟️ Fetched fresh menu data:', menuData.coupons?.length, 'coupons');
                        setCartData(prev => ({
                            ...prev,
                            availableCoupons: (menuData.coupons || []).map(normalizeCoupon).filter(Boolean),
                            deliveryCharge: menuData.deliveryCharge,
                            deliveryFeeType: menuData.deliveryFeeType,
                            deliveryFixedFee: menuData.deliveryFixedFee,
                            deliveryBaseDistance: menuData.deliveryBaseDistance,
                            deliveryPerKmFee: menuData.deliveryPerKmFee,
                            deliveryRadius: menuData.deliveryRadius,
                            deliveryFreeThreshold: menuData.deliveryFreeThreshold,
                            freeDeliveryRadius: menuData.freeDeliveryRadius,
                            freeDeliveryMinOrder: menuData.freeDeliveryMinOrder,
                            deliveryTiers: menuData.deliveryTiers,
                            deliveryOrderSlabRules: menuData.deliveryOrderSlabRules,
                            deliveryOrderSlabAboveFee: menuData.deliveryOrderSlabAboveFee,
                            deliveryOrderSlabBaseDistance: menuData.deliveryOrderSlabBaseDistance,
                            deliveryOrderSlabPerKmFee: menuData.deliveryOrderSlabPerKmFee,
                            minOrderValue: menuData.minOrderValue,
                            latitude: menuData.latitude,
                            longitude: menuData.longitude,
                            roadDistanceFactor: menuData.roadDistanceFactor || 1.3
                        }));
                    })
                    .catch((menuErr) => {
                        console.warn('[Checkout] Non-blocking menu enrichment failed:', menuErr?.message || menuErr);
                    });

                if (paymentSettingsRes.ok) {
                    const paymentData = await paymentSettingsRes.json();
                    if (deliveryType === 'delivery') {
                        setCodEnabled(paymentData.deliveryCodEnabled);
                        setOnlinePaymentEnabled(paymentData.deliveryOnlinePaymentEnabled);
                    } else if (deliveryType === 'pickup') {
                        setCodEnabled(paymentData.pickupPodEnabled);
                        setOnlinePaymentEnabled(paymentData.pickupOnlinePaymentEnabled);
                    } else if (deliveryType === 'dine-in') {
                        setCodEnabled(paymentData.dineInPayAtCounterEnabled);
                        setOnlinePaymentEnabled(paymentData.dineInOnlinePaymentEnabled);
                    } else if (deliveryType === 'street-vendor-pre-order') {
                        setCodEnabled(paymentData.dineInPayAtCounterEnabled);
                        setOnlinePaymentEnabled(paymentData.dineInOnlinePaymentEnabled);
                    } else if (deliveryType === 'car-order') {
                        // Car orders use dine-in payment settings (no delivery charge)
                        setCodEnabled(paymentData.dineInPayAtCounterEnabled);
                        setOnlinePaymentEnabled(paymentData.dineInOnlinePaymentEnabled);
                    }
                    setVendorCharges({
                        gstEnabled: paymentData.gstEnabled || false,
                        gstRate: paymentData.gstPercentage || paymentData.gstRate || 0,
                        gstMinAmount: paymentData.gstMinAmount || 0,
                        convenienceFeeEnabled: paymentData.convenienceFeeEnabled || false,
                        convenienceFeeRate: paymentData.convenienceFeeRate || 2.5,
                        convenienceFeePaidBy: paymentData.convenienceFeePaidBy || 'customer',
                        convenienceFeeLabel: paymentData.convenienceFeeLabel || 'Payment Processing Fee',
                        packagingChargeEnabled: paymentData.packagingChargeEnabled || false,
                        packagingChargeAmount: paymentData.packagingChargeAmount || 0,
                    });
                }

                if (deliveryType === 'delivery' && !activeOrderId) {
                    // setDetailsConfirmed(false); // FIXED: Removed to prevent resetting Step 2 -> Step 1 on re-renders
                }
            } catch (err) {
                setError('Failed to load checkout details. Please try again.');
            } finally {
                setLoading(false);
            }
        };

        if (!isUserLoading && !isPaymentConfirmed) {
            verifyAndFetch();
        } else if (isPaymentConfirmed) {
            setLoading(false);
        }
    }, [restaurantId, phoneFromUrl, token, ref, tableId, tabId, user, isUserLoading, router, isPaymentConfirmed, activeOrderId, isTokenValid]); // Added isTokenValid to dep array for Ref flow

    // 🎯 NEW: Load saved address from localStorage and pre-select it
    useEffect(() => {
        // Wait for userAddresses to load before trying to select
        if (userAddresses.length === 0) return;

        const savedLocation = localStorage.getItem('customerLocation');
        if (savedLocation && !selectedAddress) {
            try {
                const parsedLocation = JSON.parse(savedLocation);
                console.log('[Checkout] 📍 Restoring saved address from order page:', parsedLocation);
                console.log('[Checkout] 📍 Matching against', userAddresses.length, 'loaded addresses');

                // Find matching address in userAddresses by ID
                const matchingAddress = userAddresses.find(addr => addr.id === parsedLocation.id);
                if (matchingAddress) {
                    console.log('[Checkout] ✅ Found matching address, selecting:', matchingAddress.label);
                    setSelectedAddress(matchingAddress);
                } else {
                    console.warn('[Checkout] ⚠️ Saved address not found in user addresses, using saved version');
                    setSelectedAddress(parsedLocation);
                }
            } catch (e) {
                console.error('[Checkout] Failed to parse saved location:', e);
            }
        }
    }, [userAddresses]); // Run when userAddresses loads

    /*
    useEffect(() => {
        const fetchBundlingInfo = async () => {
            if (deliveryType !== 'delivery' || !selectedAddress) return;
            try {
                const res = await fetch(`/api/order/bundling?phone=${orderPhone}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.activeOrder) setBundlingOrderDetails(data.activeOrder);
                }
            } catch (err) { console.error("Bundling check failed:", err); }
        };
        fetchBundlingInfo();
    }, [deliveryType, selectedAddress, orderPhone]);
    */

    const deliveryType = useMemo(() => {
        if (tableId) return 'dine-in';
        return cartData?.deliveryType || 'delivery';
    }, [tableId, cartData]);

    const currentSubtotal = useMemo(() => {
        return cart.reduce((total, item) => {
            const unitPrice = item.totalPrice ?? item.price ?? 0;
            const quantity = item.quantity ?? 1;
            return total + (unitPrice * quantity);
        }, 0);
    }, [cart]);

    // 🚀 INSTANT SHADOW CALCULATION
    const shadowDeliveryResult = useMemo(() => {
        if (deliveryType !== 'delivery' || !selectedAddress || !cartData?.latitude) return null;

        const custLat = selectedAddress.lat ?? selectedAddress.latitude;
        const custLng = selectedAddress.lng ?? selectedAddress.longitude;

        if (!custLat || !custLng) return null;

        const aerialDist = calculateHaversineDistance(
            cartData.latitude,
            cartData.longitude,
            custLat,
            custLng
        );

        const settings = {
            deliveryRadius: cartData.deliveryRadius || 10,
            deliveryChargeType: cartData.deliveryFeeType || 'fixed',
            fixedCharge: cartData.deliveryFixedFee || 30,
            perKmCharge: cartData.deliveryPerKmFee || 5,
            baseDistance: cartData.deliveryBaseDistance || cartData.baseDistance || 0,
            freeDeliveryThreshold: cartData.deliveryFreeThreshold || 0,
            freeDeliveryRadius: cartData.freeDeliveryRadius || 0,
            freeDeliveryMinOrder: cartData.freeDeliveryMinOrder || 0,
            roadDistanceFactor: cartData.roadDistanceFactor || 1.3,
            deliveryTiers: cartData.deliveryTiers || [],
            orderSlabRules: cartData.deliveryOrderSlabRules || [],
            orderSlabAboveFee: cartData.deliveryOrderSlabAboveFee || 0,
            orderSlabBaseDistance: cartData.deliveryOrderSlabBaseDistance || 1,
            orderSlabPerKmFee: cartData.deliveryOrderSlabPerKmFee || 15
        };

        try {
            const result = calculateDeliveryCharge(aerialDist, currentSubtotal, settings);
            console.log('[Checkout Debug] ⚡ Shadow Calculation result:', result);
            return result;
        } catch (e) {
            console.error('[Checkout Debug] ❌ Shadow Calculation failed:', e);
            return null;
        }
    }, [deliveryType, selectedAddress, cartData, currentSubtotal]);

    const diningPreference = cartData?.diningPreference || 'dine-in';

    // ✅ TRIGGER VALIDATION: When Address or Subtotal changes
    useEffect(() => {
        if (deliveryType === 'delivery' && selectedAddress) {
            // Clear previous address/subtotal validation immediately to avoid stale "allowed" state.
            setDeliveryValidation(null);
            console.log('[Checkout] ⏲️ Setting Validation Timer for:', selectedAddress.label);
            const timer = setTimeout(() => {
                validateDelivery(selectedAddress, currentSubtotal);
            }, 100); // Debounce reduced to 100ms for responsiveness
            return () => {
                console.log('[Checkout] 🧹 Clearing Validation Timer');
                clearTimeout(timer);
            };
        }
    }, [deliveryType, selectedAddress, currentSubtotal]);



    // ... (Price calculation unchanged) ...
    const { subtotal, totalDiscount, finalDeliveryCharge, cgst, sgst, convenienceFee, grandTotal, packagingCharge, isSmartBundlingEligible, tipAmount, isDeliveryFree, deliveryReason, isEstimated, isDeliveryOutOfRange } = useMemo(() => {
        // ... (Same logic as before) ...
        // Re-implementing logic to ensure no regression as I replaced a huge chunk
        if (!cartData) return { subtotal: currentSubtotal, totalDiscount: 0, finalDeliveryCharge: 0, cgst: 0, sgst: 0, convenienceFee: 0, grandTotal: currentSubtotal, packagingCharge: 0, isSmartBundlingEligible: false, tipAmount: 0, isDeliveryFree: false, deliveryReason: '', isEstimated: false, isDeliveryOutOfRange: false };

        const isStreetVendor = deliveryType === 'street-vendor-pre-order';
        const isFreeDeliveryApplied = appliedCoupons.some(c => normalizeCouponType(c?.type) === 'free_delivery' && currentSubtotal >= (Number(c?.minOrder) || 0));
        // REMOVED: isFreeDeliveryThresholdMet override. Tiers/API handle this now.

        let couponDiscountValue = 0;
        appliedCoupons.forEach(coupon => {
            const couponType = normalizeCouponType(coupon?.type);
            const couponMinOrder = Number(coupon?.minOrder) || 0;
            const couponValue = Number(coupon?.value) || 0;
            const couponMaxDiscount = Number(coupon?.maxDiscount) || 0;

            if (currentSubtotal >= couponMinOrder) {
                if (couponType === 'flat') couponDiscountValue += couponValue;
                else if (couponType === 'percentage') {
                    let discount = (currentSubtotal * couponValue) / 100;
                    if (couponMaxDiscount > 0 && discount > couponMaxDiscount) {
                        discount = couponMaxDiscount;
                    }
                    couponDiscountValue += discount;
                }
            }
        });

        // (End of appliedCoupons loop)

        const isSmartBundlingEligibleValue = false; // Internal value for calculation
        // ========== END BUNDLING FEATURE ==========

        let deliveryCharge = 0;
        let deliveryReason = '';
        let isDeliveryOutOfRange = false;

        console.log('[Checkout Debug] Calculating Delivery Charge. Validation:', deliveryValidation);
        console.log('[Checkout Debug] isFreeDeliveryApplied:', isFreeDeliveryApplied);

        if (isStreetVendor || deliveryType !== 'delivery' || deliveryType === 'car-order') {
            deliveryCharge = 0;
        } else if (deliveryValidation && deliveryValidation.allowed === false) {
            deliveryCharge = 0;
            isDeliveryOutOfRange = true;
            deliveryReason = deliveryValidation.message || 'This address is outside delivery range.';
        } else if (isFreeDeliveryApplied) {
            // Coupon overrides everything
            deliveryCharge = 0;
        } else if (deliveryValidation && deliveryValidation.charge !== undefined) {
            // Use validated dynamic charge (handles distance, tiers & free limits)
            deliveryCharge = deliveryValidation.charge;
            deliveryReason = deliveryValidation.reason;
            console.log('[Checkout Debug] Using Dynamic Charge:', deliveryCharge);
        } else if (shadowDeliveryResult && shadowDeliveryResult.allowed === false) {
            deliveryCharge = 0;
            isDeliveryOutOfRange = true;
            deliveryReason = `${shadowDeliveryResult.message || 'This address is outside delivery range.'} (Estimated)`;
        } else if (shadowDeliveryResult) {
            // Instant feedback while waiting for API
            deliveryCharge = shadowDeliveryResult.charge;
            deliveryReason = shadowDeliveryResult.reason + ' (Estimated)';
            console.log('[Checkout Debug] Using Shadow Charge (Estimated):', deliveryCharge);
        } else if (isValidatingDelivery) {
            // While validating, we don't have a final charge yet
            // This prevents "FREE" from flashing if validation hasn't started/finished
            deliveryCharge = 0;
            console.log('[Checkout Debug] Validation in progress...');
        } else {
            // Fallback to static charge (or cart setting)
            // ONLY apply simple threshold if NOT in tiered mode
            const deliveryFeeType = cartData?.deliveryFeeType;
            const isComplexMode = deliveryFeeType === 'tiered' || deliveryFeeType === 'order-slab-distance';
            const isThresholdMet = !isComplexMode && cartData?.deliveryFreeThreshold && currentSubtotal >= cartData.deliveryFreeThreshold;

            // ✅ Robust fallback: Use deliveryFixedFee -> fixedCharge -> deliveryCharge -> 0
            let baseFee = Number(cartData?.deliveryFixedFee ?? cartData?.fixedCharge ?? cartData?.deliveryCharge ?? 0);
            if (deliveryFeeType === 'order-slab-distance') {
                const rules = Array.isArray(cartData?.deliveryOrderSlabRules)
                    ? [...cartData.deliveryOrderSlabRules]
                        .map((rule) => ({
                            maxOrder: Number(rule?.maxOrder) || 0,
                            fee: Number(rule?.fee) || 0
                        }))
                        .filter((rule) => rule.maxOrder > 0)
                        .sort((a, b) => a.maxOrder - b.maxOrder)
                    : [];
                const aboveFee = Number(cartData?.deliveryOrderSlabAboveFee) || 0;
                const matchedRule = rules.find((rule) => currentSubtotal < rule.maxOrder);
                baseFee = matchedRule ? matchedRule.fee : aboveFee;
            }
            deliveryCharge = isThresholdMet ? 0 : baseFee;
            console.log('[Checkout Debug] Using Fallback Charge:', deliveryCharge, 'deliveryFeeType:', deliveryFeeType);
        }

        const isDeliveryFree = deliveryCharge === 0 && deliveryType === 'delivery' && !isDeliveryOutOfRange;

        // Calculate Tip from State
        let currentTip = selectedTipAmount;
        if (showCustomTipInput) {
            currentTip = parseFloat(customTipAmount) || 0;
        }
        const tip = (isStreetVendor || deliveryType !== 'delivery') ? 0 : currentTip;
        const taxableAmount = currentSubtotal - couponDiscountValue;

        let cgstAmount = 0;
        let sgstAmount = 0;
        if (vendorCharges?.gstEnabled && taxableAmount > 0) {
            if (taxableAmount >= (vendorCharges.gstMinAmount || 0)) {
                const totalGstRate = vendorCharges.gstPercentage !== undefined ? vendorCharges.gstPercentage : (vendorCharges.gstRate || 5);
                const halfGstRate = totalGstRate / 2;
                cgstAmount = taxableAmount * (halfGstRate / 100);
                sgstAmount = taxableAmount * (halfGstRate / 100);
            }
        }
        const internalPackagingCharge = (diningPreference === 'takeaway' && vendorCharges?.packagingChargeEnabled) ? (vendorCharges.packagingChargeAmount || 0) : 0;
        const subtotalWithTaxAndCharges = taxableAmount + deliveryCharge + cgstAmount + sgstAmount + tip + internalPackagingCharge;

        let calculatedConvenienceFee = 0;
        if (selectedPaymentMethod === 'online' && vendorCharges?.convenienceFeeEnabled) {
            if (vendorCharges.convenienceFeePaidBy === 'customer') {
                const feeRate = vendorCharges.convenienceFeeRate || 2.5;
                calculatedConvenienceFee = parseFloat((subtotalWithTaxAndCharges * (feeRate / 100)).toFixed(2));
            }
        }

        const finalGrandTotal = subtotalWithTaxAndCharges + calculatedConvenienceFee;
        return {
            subtotal: currentSubtotal,
            totalDiscount: couponDiscountValue,
            finalDeliveryCharge: deliveryCharge,
            cgst: cgstAmount,
            sgst: sgstAmount,
            convenienceFee: calculatedConvenienceFee,
            grandTotal: finalGrandTotal,
            packagingCharge: internalPackagingCharge,
            isSmartBundlingEligible: isSmartBundlingEligibleValue,
            tipAmount: tip,
            isDeliveryFree: isDeliveryFree,
            deliveryReason: deliveryReason,
            isEstimated: !!shadowDeliveryResult && !deliveryValidation,
            isDeliveryOutOfRange: isDeliveryOutOfRange
        };
    }, [cart, cartData, appliedCoupons, deliveryType, selectedPaymentMethod, vendorCharges, activeOrderId, diningPreference, selectedAddress, selectedTipAmount, customTipAmount, showCustomTipInput, deliveryValidation, shadowDeliveryResult, isValidatingDelivery]);

    const maxSavings = useMemo(() => {
        if (!cartData?.availableCoupons?.length) return 0;

        return Math.max(0, ...cartData.availableCoupons.map(coupon => {
            const couponType = normalizeCouponType(coupon?.type);
            const couponMinOrder = Number(coupon?.minOrder) || 0;
            const couponValue = Number(coupon?.value) || 0;
            const couponMaxDiscount = Number(coupon?.maxDiscount) || 0;

            // Check minimum order requirement
            if (couponMinOrder && subtotal < couponMinOrder) return 0;

            if (couponType === 'flat') {
                return couponValue;
            } else if (couponType === 'percentage') {
                const discount = (subtotal * couponValue) / 100;
                // Check for max discount cap
                if (couponMaxDiscount > 0) {
                    return Math.min(discount, couponMaxDiscount);
                }
                return discount;
            }
            return 0;
        }));
    }, [cartData, subtotal]);
    const nextCouponUnlockMessage = useMemo(() => {
        const coupons = (cartData?.availableCoupons || []).map(normalizeCoupon).filter(Boolean);
        if (!coupons.length) return '';

        const upcomingCoupons = coupons
            .filter((coupon) => {
                if (!coupon?.code) return false;
                if (coupon.type === 'free_delivery' && deliveryType !== 'delivery') return false;
                return currentSubtotal < (Number(coupon.minOrder) || 0);
            })
            .map((coupon) => {
                const minOrder = Number(coupon.minOrder) || 0;
                const shortBy = Math.max(0, minOrder - currentSubtotal);
                return { coupon, shortBy };
            });

        if (!upcomingCoupons.length) return '';

        upcomingCoupons.sort((a, b) => {
            if (a.shortBy !== b.shortBy) {
                return a.shortBy - b.shortBy;
            }
            return (Number(b.coupon?.value) || 0) - (Number(a.coupon?.value) || 0);
        });

        const best = upcomingCoupons[0];
        const shortAmount = Math.ceil(best.shortBy);
        const coupon = best.coupon || {};
        const couponType = normalizeCouponType(coupon.type);

        let rewardText = String(coupon.code || 'this offer');
        if (couponType === 'percentage') {
            const percentValue = Number(coupon.value) || 0;
            const normalizedPercent = Number.isInteger(percentValue) ? String(percentValue) : percentValue.toFixed(1).replace(/\.0$/, '');
            rewardText = `${normalizedPercent}% OFF`;
        } else if (couponType === 'flat') {
            const flatValue = Math.max(0, Math.round(Number(coupon.value) || 0));
            rewardText = `Rs ${flatValue} OFF`;
        } else if (couponType === 'free_delivery') {
            rewardText = 'FREE delivery';
        }

        return `Add Rs ${shortAmount} more to get ${rewardText}`;
    }, [cartData, currentSubtotal, deliveryType]);

    const getCouponEligibility = (coupon) => {
        const normalizedCoupon = normalizeCoupon(coupon);
        if (!normalizedCoupon) {
            return { eligible: false, message: 'Invalid coupon data.' };
        }

        if (!normalizedCoupon.code) {
            return { eligible: false, message: 'Coupon code is missing.' };
        }

        if (normalizedCoupon.type === 'free_delivery' && deliveryType !== 'delivery') {
            return { eligible: false, message: 'Free delivery coupon only works for delivery orders.' };
        }

        if (normalizedCoupon.minOrder > 0 && currentSubtotal < normalizedCoupon.minOrder) {
            const shortBy = Math.max(0, normalizedCoupon.minOrder - currentSubtotal);
            return {
                eligible: false,
                message: `Coupon valid on Rs ${normalizedCoupon.minOrder}+ order. Add Rs ${shortBy.toFixed(0)} more.`
            };
        }

        return { eligible: true, message: '', coupon: normalizedCoupon };
    };

    const applyCoupon = (coupon) => {
        const eligibility = getCouponEligibility(coupon);
        if (!eligibility.eligible) {
            toast({
                title: 'Coupon not applicable',
                description: eligibility.message,
                variant: 'destructive'
            });
            return false;
        }

        setAppliedCoupons([eligibility.coupon]);
        toast({
            title: 'Coupon Applied!',
            description: `${eligibility.coupon.code} applied successfully.`
        });
        return true;
    };

    const handleApplyCouponCode = () => {
        const code = couponCodeInput.trim().toUpperCase();
        if (!code) {
            toast({
                title: 'Enter coupon code',
                description: 'Please type a valid coupon code first.',
                variant: 'destructive'
            });
            return;
        }

        const matchedCoupon = (cartData?.availableCoupons || []).find(
            (coupon) => String(coupon?.code || '').trim().toUpperCase() === code
        );

        if (!matchedCoupon) {
            toast({
                title: 'Invalid coupon',
                description: 'This coupon does not exist or is not active right now.',
                variant: 'destructive'
            });
            return;
        }

        const applied = applyCoupon(matchedCoupon);
        if (applied) {
            setIsCouponDrawerOpen(false);
            setCouponCodeInput('');
        }
    };

    const fullOrderDetailsForSplit = useMemo(() => ({
        restaurantId,
        grandTotal,
        items: cart,
        tableId,
        tabId,
        activeOrderId
    }), [restaurantId, grandTotal, cart, tableId, tabId, activeOrderId]);

    const handleAddMoreToTab = () => {
        const params = new URLSearchParams({
            restaurantId,
            phone: phoneFromUrl || '',
            token: token || '',
            table: tableId,
            tabId: cartData.dineInTabId
        });
        if (ref) params.set('ref', ref); // Pass Ref
        router.push(`/order/${restaurantId}?${params.toString()}`);
    };


    const handleViewBill = () => {
        setDineInModalOpen(false);
        setIsOnlinePaymentFlow(true);
    };

    const validateOrderDetails = () => {
        if (!Array.isArray(cart) || cart.length === 0) {
            setError("Cart is empty. Please add at least one item.");
            return false;
        }

        const hasInvalidItem = cart.some((item) => {
            if (!item) return true;
            const qty = parseInt(item.quantity, 10) || 0;
            return qty <= 0;
        });

        if (hasInvalidItem) {
            setError("Cart has invalid item quantity. Please review cart.");
            return false;
        }

        if (activeOrderId) {
            setError('');
            return true;
        }

        if (deliveryType === 'delivery' && !selectedAddress) {
            setError("Please select or add a delivery address.");
            return false;
        }
        if (deliveryType === 'delivery' && deliveryValidation && deliveryValidation.allowed === false) {
            setError(deliveryValidation.message || "Your selected address is outside delivery range.");
            return false;
        }
        if (deliveryType === 'street-vendor-pre-order' && (!orderName || orderName.trim().length === 0)) {
            setError("Please provide a name for the order.");
            return false;
        }
        setError('');
        return true;
    };


    const placeOrder = async (paymentMethod) => {
        // If PhonePe is selected for online payment, use 'phonepe' as payment method
        const effectivePaymentMethod = (paymentMethod === 'online' && paymentGateway === 'phonepe') ? 'phonepe' : paymentMethod;
        console.log(`[Checkout Page] placeOrder called with paymentMethod: ${paymentMethod}, effective: ${effectivePaymentMethod}`);
        if (!validateOrderDetails()) return;

        console.log('[DEBUG] idempotencyKey state:', idempotencyKey);
        console.log('[DEBUG] tabId:', tabId);
        console.log('[DEBUG] deliveryType:', deliveryType);

        const isCarOrder = deliveryType === 'car-order';
        const carSpotKey = String(cartData?.carSpot || carOrderDetails?.carSpot || 'spot')
            .replace(/[^a-zA-Z0-9]/g, '')
            .toLowerCase() || 'spot';
        const carIdentityKey = String(orderPhone || cartData?.phone || 'guest')
            .replace(/\D/g, '')
            .slice(-10) || 'guest';
        const generatedCarSessionTabId = `car_${carSpotKey}_${carIdentityKey}`;
        const resolvedSessionTabId = (
            deliveryType === 'dine-in'
                ? (tabId || cartData?.dineInTabId || null)
                : (isCarOrder ? (tabId || cartData?.dineInTabId || cartData?.tabId || generatedCarSessionTabId) : null)
        );

        const orderData = {
            idempotencyKey,
            name: orderName || selectedAddress?.name || '',
            phone: orderPhone || selectedAddress?.phone || '',
            restaurantId,
            items: cart,
            notes: cartData.notes,
            coupon: appliedCoupons.find(c => !c.customerId) || null,
            loyaltyDiscount: 0, subtotal, cgst, sgst, deliveryCharge: finalDeliveryCharge, grandTotal, paymentMethod: effectivePaymentMethod,
            deliveryType: deliveryType, pickupTime: cartData.pickupTime || '', tipAmount: tipAmount || 0,
            businessType: cartData.businessType || 'restaurant',
            tableId: (deliveryType === 'dine-in') ? (tableId || cartData.tableId) : null,
            dineInTabId: resolvedSessionTabId || null,
            pax_count: isCarOrder ? 1 : (cartData.pax_count || null),
            tab_name: isCarOrder ? (cartData.tab_name || orderName || 'Car Guest') : (cartData.tab_name || null),
            address: selectedAddress,
            // Pass Guest Identity
            guestRef: ref || null, // Pass the obfuscated ref if available
            guestToken: token || null, // Pass the token (can be used to validate ref)

            existingOrderId: activeOrderId || undefined,
            diningPreference: diningPreference,
            packagingCharge: packagingCharge,
            // ✅ Car Order fields
            ...(deliveryType === 'car-order' && {
                carSpot: cartData.carSpot || null,
                carDetails: cartData.carDetails || null,
            }),
        };

        setOrderState(ORDER_STATE.CREATING_ORDER); // New state machine
        setIsProcessingPayment(true);
        setError('');
        setOrderError(''); // Clear previous errors

        try {
            // DINE-IN POST-PAID SETTLEMENT: Use settlement API for existing orders
            if (tabId && deliveryType === 'dine-in') {
                console.log(`[Checkout Page] POST-PAID SETTLEMENT for tabId: ${tabId}`);

                // ... (Settlement logic remains largely same, just check redirects) ...
                // Note: Settlement API might need update too, but let's assume it keeps using tabId mainly.

                // ✅ Using new dine-in settlement endpoint
                const settlementEndpoint = '/api/dine-in/initiate-payment';
                const settlementData = {
                    idempotencyKey,
                    tabId,
                    restaurantId,
                    paymentMethod: effectivePaymentMethod,
                    grandTotal
                };

                console.log(`[Checkout] Settlement endpoint: ${settlementEndpoint}`);

                const res = await fetch(settlementEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settlementData)
                });
                const data = await res.json();
                console.log("[Checkout Page] Settlement API response:", data);
                if (!res.ok) throw new Error(data.message || "Failed to settle payment.");

                // Handle PhonePe Redirect
                if (data.url && (data.method === 'phonepe' || effectivePaymentMethod === 'phonepe')) {
                    console.log("[Checkout] Redirecting to PhonePe:", data.url);
                    window.location.href = data.url;
                    return;
                }

                // Handle Split Bill
                if (data.method === 'split_bill' || effectivePaymentMethod === 'split_bill') {
                    console.log("[Checkout] Split bill approved, returning data for UI");
                    setIsProcessingPayment(false);
                    return data;
                }

                // Handle Razorpay for online payment
                if (data.razorpay_order_id) {
                    console.log("[Checkout] Opening Razorpay for settlement");

                    // Save for recovery if page refreshes
                    setOrderState(ORDER_STATE.PAYMENT_PROCESSING);
                    localStorage.setItem('payment_pending_order', tabId);

                    const options = {
                        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_live_m9PZ4ZL5ItHp9j',
                        amount: grandTotal * 100,
                        currency: "INR",
                        name: cartData.restaurantName || 'Restaurant',
                        description: `Bill Settlement - Table ${tableId} `,
                        order_id: data.razorpay_order_id,
                        handler: async function (response) {
                            console.log("[Checkout Page] Razorpay payment successful:", response);

                            setOrderState(ORDER_STATE.PAYMENT_PENDING);

                            // Redirect to pending screen for webhook confirmation
                            const pendingOrder = localStorage.getItem('payment_pending_order');
                            if (pendingOrder && token) {
                                router.push(`/track/pending/${pendingOrder}?token=${token}`);
                            } else {
                                // Fallback to direct tracking
                                // Ensure Ref is passed if available
                                const params = new URLSearchParams({
                                    token: token || '',
                                    paid: 'counter'
                                });
                                if (ref) params.set('ref', ref);
                                if (phoneFromUrl) params.set('phone', phoneFromUrl); // Legacy support

                                // Actually, for Dine-In, we usually redirect to track/dine-in/[tabId]
                                // So we construct URL:
                                router.push(`/track/dine-in/${tabId}?${params.toString()}`);
                            }
                        },
                        prefill: { name: orderName, phone: orderPhone },
                        modal: {
                            ondismiss: function () {
                                console.log("[Checkout] Razorpay dismissed");
                                setIsProcessingPayment(false);
                            }
                        }
                    };
                    const rzp = new window.Razorpay(options);
                    rzp.on('payment.failed', function (response) {
                        console.error("[Checkout] Razorpay payment failed:", response);
                        setIsProcessingPayment(false);
                        setError('Payment failed: ' + response.error.description);
                    });
                    rzp.open();
                    return;
                }

                // Pay at Counter - redirect to track
                const params = new URLSearchParams({
                    token: token || '',
                    paid: 'counter'
                });
                if (ref) params.set('ref', ref);
                if (phoneFromUrl) params.set('phone', phoneFromUrl);
                router.push(`/track/dine-in/${tabId}?${params.toString()}`);
                return;
            }

            /* ⚠️ TEMPORARILY DISABLED - Blocking orders
            // 🚨 CRITICAL: Validate delivery distance BEFORE creating order
            if (deliveryType === 'delivery' && selectedAddress) {
                console.log('[Checkout] Validating delivery distance...');
                try {
                    const validationRes = await fetch('/api/delivery/calculate-charge', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            restaurantId,
                            addressLat: selectedAddress.lat,
                            addressLng: selectedAddress.lng,
                            subtotal: subtotal
                        })
                    });
                    const validationData = await validationRes.json();

                    if (!validationRes.ok || !validationData.allowed) {
                        const errorMsg = validationData.message || 'Your address is beyond our delivery range.';
                        console.error('[Checkout] Delivery validation failed:', errorMsg);
                        setInfoDialog({
                            isOpen: true,
                            title: '🚫 Delivery Not Available',
                            message: `${errorMsg}\n\nPlease select a different address or choose pickup/dine-in.`
                        });
                        setIsProcessingPayment(false);
                        return; // Block order
                    }

                    // Update delivery charge from validation
                    if (validationData.charge !== undefined) {
                        orderData.deliveryCharge = validationData.charge;
                        orderData.grandTotal = subtotal + cgst + sgst + validationData.charge + (packagingCharge || 0) + (convenienceFee || 0) + (tipAmount || 0);
                    }

                    console.log('[Checkout] ✅ Delivery validated:', validationData);
                } catch (validationErr) {
                    console.error('[Checkout] Delivery validation error:', validationErr);
                    setInfoDialog({
                        isOpen: true,
                        title: 'Validation Error',
                        message: 'Could not verify delivery availability. Please try again or contact support.'
                    });
                    setIsProcessingPayment(false);
                    return;
                }
            }
            */

            // Final delivery validation before order create
            if (deliveryType === 'delivery' && selectedAddress) {
                if (isValidatingDelivery) {
                    setInfoDialog({
                        isOpen: true,
                        title: 'Please Wait',
                        message: 'Delivery range is being validated. Please try again in a moment.'
                    });
                    setIsProcessingPayment(false);
                    return;
                }
                try {
                    const addressAtValidationStart = selectedAddressRef.current;
                    const validationPayload = buildDeliveryValidationPayload(addressAtValidationStart, subtotal);

                    if (!validationPayload) {
                        setInfoDialog({
                            isOpen: true,
                            title: 'Address Error',
                            message: 'Selected address is invalid. Please reselect your delivery address.'
                        });
                        setIsProcessingPayment(false);
                        return;
                    }

                    const validationKey = buildDeliveryValidationKey(validationPayload);
                    let validationData = getCachedDeliveryValidation(validationKey);
                    let validationResponseOk = !!validationData;

                    if (!validationData) {
                        const validationRes = await fetch('/api/delivery/calculate-charge', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(validationPayload)
                        });
                        validationData = await validationRes.json();
                        validationResponseOk = validationRes.ok;

                        if (validationResponseOk) {
                            setCachedDeliveryValidation(validationKey, validationData);
                        }
                    }
                    if (validationData) {
                        setDeliveryValidation(validationData);
                    }

                    const addressAfterValidation = selectedAddressRef.current;
                    const endLat = addressAfterValidation?.lat ?? addressAfterValidation?.latitude;
                    const endLng = addressAfterValidation?.lng ?? addressAfterValidation?.longitude;
                    const addressChangedDuringValidation = Number(validationPayload.addressLat) !== Number(endLat) || Number(validationPayload.addressLng) !== Number(endLng);
                    if (addressChangedDuringValidation) {
                        setInfoDialog({
                            isOpen: true,
                            title: 'Address Updated',
                            message: 'Address changed during validation. Please place order again after review.'
                        });
                        setIsProcessingPayment(false);
                        return;
                    }

                    if (!validationResponseOk || !validationData?.allowed) {
                        const errorMsg = validationData.message || 'Your address is beyond our delivery range.';
                        setInfoDialog({
                            isOpen: true,
                            title: '🚫 Delivery Not Available',
                            message: `${errorMsg}\n\nPlease select a different address or choose pickup/dine-in.`
                        });
                        setIsProcessingPayment(false);
                        return;
                    }

                    if (validationData.charge !== undefined) {
                        orderData.deliveryCharge = validationData.charge;
                        orderData.grandTotal = subtotal + cgst + sgst + validationData.charge + (packagingCharge || 0) + (convenienceFee || 0) + (tipAmount || 0);
                    }
                } catch (validationErr) {
                    console.error('[Checkout] Delivery validation error:', validationErr);
                    setInfoDialog({
                        isOpen: true,
                        title: 'Validation Error',
                        message: 'Could not verify delivery availability. Please try again.'
                    });
                    setIsProcessingPayment(false);
                    return;
                }
            }

            // NEW ORDER CREATION (original flow)
            console.log(`[Checkout Page] Sending order to /api/order/create. PaymentMethod: ${paymentMethod}, ExistingOrderId: ${orderData.existingOrderId}`);
            const res = await fetch('/api/order/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
            const data = await res.json();
            console.log("[Checkout Page] Order API response received:", data);
            setRetryCount(0);

            if (data.razorpay_order_id) {
                console.log(`[Checkout Page] Razorpay ID found: ${data.razorpay_order_id}`);
            } else {
                console.warn(`[Checkout Page] NO Razorpay ID found in response!`);
            }
            if (!res.ok) throw new Error(data.message || "Failed to place order.");

            // If split_bill, return the response for SplitBillInterface
            if (paymentMethod === 'split_bill') {
                setIsProcessingPayment(false);
                return data;
            }

            // Handle PhonePe Payment
            // ... (Continues below, just updating options) ...

            if (paymentGateway === 'phonepe' && selectedOnlinePaymentType === 'full') {
                console.log("[Checkout Page] Initiating PhonePe payment...");
                try {
                    const phonePeRes = await fetch('/api/payment/phonepe/initiate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            amount: grandTotal,
                            orderId: data.firestore_order_id,
                            customerPhone: orderPhone
                        })
                    });
                    const phonePeData = await phonePeRes.json();

                    if (phonePeData.success && phonePeData.url) {
                        console.log("[Checkout Page] Opening PhonePe PayPage in IFrame:", phonePeData.url);

                        // Use PhonePe Checkout SDK to open payment in IFrame
                        if (window.PhonePeCheckout && window.PhonePeCheckout.transact) {
                            window.PhonePeCheckout.transact({
                                tokenUrl: phonePeData.url,
                                type: "IFRAME",
                                callback: (response) => {
                                    console.log("[Checkout Page] PhonePe callback:", response);
                                    if (response === 'USER_CANCEL') {
                                        setInfoDialog({ isOpen: true, title: 'Payment Cancelled', message: 'You cancelled the payment. Please try again.' });
                                        setIsProcessingPayment(false);
                                    } else if (response === 'CONCLUDED') {
                                        // Payment completed, redirect to order placed page (same as Razorpay)
                                        console.log("[Checkout Page] PhonePe payment concluded, redirecting to order placed page");
                                        localStorage.removeItem(`cart_${restaurantId}`);
                                        localStorage.removeItem('current_order_key');

                                        // SAVE ACTIVE ORDER FOR TRACKING (ARRAY SUPPORT)
                                        if (typeof window !== 'undefined') {
                                            const storageKey = `liveOrder_${restaurantId}`;
                                            let existingData = [];
                                            try {
                                                const raw = localStorage.getItem(storageKey);
                                                if (raw) {
                                                    const parsed = JSON.parse(raw);
                                                    existingData = Array.isArray(parsed) ? parsed : [parsed];
                                                }
                                            } catch (e) {
                                                console.error("Error parsing live orders", e);
                                                existingData = [];
                                            }

                                            const newOrder = {
                                                orderId: data.firestore_order_id,
                                                trackingToken: data.token,
                                                restaurantId: restaurantId,
                                                deliveryType: deliveryType,
                                                dineInTabId: data.dineInTabId || data.dine_in_tab_id || orderData.dineInTabId || cartData?.dineInTabId || null,
                                                dineInToken: data.dineInToken || cartData?.dineInToken || null,
                                                status: 'placed',
                                                timestamp: Date.now()
                                            };

                                            // Add new order and ensure uniqueness
                                            const updatedOrders = [...existingData.filter(o => o.orderId !== newOrder.orderId), newOrder];
                                            localStorage.setItem(storageKey, JSON.stringify(updatedOrders));
                                        }

                                        router.push(`/order/placed?orderId=${data.firestore_order_id}&token=${data.token}&restaurantId=${restaurantId}${phoneFromUrl ? `&phone=${phoneFromUrl}` : ''}`);
                                    }
                                }
                            });
                        } else {
                            // Fallback to redirect mode if SDK not loaded
                            console.warn("[Checkout Page] PhonePe SDK not loaded, using redirect mode");
                            window.location.href = phonePeData.url;
                        }
                        return;
                    } else {
                        throw new Error(phonePeData.error || "PhonePe initiation failed");
                    }
                } catch (err) {
                    console.error("[Checkout Page] PhonePe Error:", err);
                    setInfoDialog({ isOpen: true, title: 'Payment Failed', message: 'Could not initiate PhonePe payment. Try Razorpay.' });
                    setIsProcessingPayment(false);
                    return;
                }
            }

            // Handle Razorpay Payment (Default fallback or if selected)
            if (data.razorpay_order_id) {
                console.log("[Checkout Page] Razorpay order ID found. Opening payment gateway.");
                const options = {
                    key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, amount: grandTotal * 100, currency: "INR", name: cartData.restaurantName,
                    description: `Order from ${cartData.restaurantName}`, order_id: data.razorpay_order_id,
                    handler: async (response) => {
                        console.log(`[Checkout Page] Razorpay payment successful:`, response);
                        localStorage.removeItem(`cart_${restaurantId}`);

                        // SAVE ACTIVE ORDER FOR TRACKING (ARRAY SUPPORT)
                        if (typeof window !== 'undefined') {
                            const storageKey = `liveOrder_${restaurantId}`;
                            let existingData = [];
                            try {
                                const raw = localStorage.getItem(storageKey);
                                if (raw) {
                                    const parsed = JSON.parse(raw);
                                    existingData = Array.isArray(parsed) ? parsed : [parsed];
                                }
                            } catch (e) {
                                console.error("Error parsing live orders", e);
                                existingData = [];
                            }

                            const newOrder = {
                                orderId: data.firestore_order_id,
                                trackingToken: data.token,
                                restaurantId: restaurantId,
                                deliveryType: deliveryType,
                                dineInTabId: data.dineInTabId || data.dine_in_tab_id || orderData.dineInTabId || cartData?.dineInTabId || null,
                                dineInToken: data.dineInToken || cartData?.dineInToken || null,
                                status: 'placed',
                                timestamp: Date.now()
                            };

                            // Add new order and ensure uniqueness
                            const updatedOrders = [...existingData.filter(o => o.orderId !== newOrder.orderId), newOrder];
                            localStorage.setItem(storageKey, JSON.stringify(updatedOrders));
                        }

                        // FIXED: Use central router for all flows
                        const phoneParam = phoneFromUrl ? `&phone=${phoneFromUrl}` : '';
                        const refParam = ref ? `&ref=${ref}` : ''; // Checked ref scope
                        const sessionTabId = data.dineInTabId || data.dine_in_tab_id || orderData.dineInTabId || cartData?.dineInTabId || null;
                        const tabParam = sessionTabId ? `&tabId=${encodeURIComponent(sessionTabId)}` : '';
                        const isDineInLike = orderData.deliveryType === 'dine-in' || orderData.deliveryType === 'car-order';
                        const trackingUrl = isDineInLike
                            ? `/track/dine-in/${data.firestore_order_id}?token=${data.token}${tabParam}${phoneParam}${refParam}`
                            : `/track/${data.firestore_order_id}?token=${data.token}${phoneParam}${refParam}`;
                        router.replace(trackingUrl);
                    },
                    prefill: { name: orderName, email: user?.email || "customer@servizephyr.com", contact: orderPhone },
                    redirect: (orderData.deliveryType === 'dine-in' || orderData.deliveryType === 'car-order') ? true : false,
                    modal: {
                        ondismiss: function () {
                            console.log("[Checkout Page] Razorpay modal dismissed.");
                            setInfoDialog({ isOpen: true, title: 'Payment Cancelled', message: 'You can try paying again.' });
                            setIsProcessingPayment(false);
                        }
                    }
                };
                const rzp = new window.Razorpay(options);
                rzp.on('payment.failed', function (response) {
                    console.error("[Checkout Page] Razorpay payment failed:", response);
                    setInfoDialog({ isOpen: true, title: 'Payment Failed', message: response.error.description });
                    setIsProcessingPayment(false);
                });
                rzp.open();
            } else {
                console.warn(`[Checkout Page] NO Razorpay ID found in response!`);
                console.log("[Checkout Page] No Razorpay ID. Clearing cart and handling redirection.");

                // ✅ CRITICAL: Use NEW order ID from response (not activeOrderId!)
                // For street vendors, even if activeOrderId exists, NEW order was created
                const finalOrderId = data.order_id || data.firestore_order_id;

                if (finalOrderId) {
                    localStorage.removeItem(`cart_${restaurantId}`);
                    localStorage.removeItem('current_order_key');
                    console.log(`[Idempotency] Key cleared after successful order creation`);

                    // ✅ Route to NEW order (not old activeOrderId!)
                    const dineInLikeTabId = data.dineInTabId || data.dine_in_tab_id || orderData.dineInTabId || cartData?.dineInTabId || null;
                    const dineInLikeTabParam = dineInLikeTabId ? `&tabId=${encodeURIComponent(dineInLikeTabId)}` : '';
                    const redirectUrl =
                        orderData.deliveryType === 'car-order'
                            ? `/track/dine-in/${finalOrderId}?token=${data.token}${dineInLikeTabParam}${phoneFromUrl ? `&phone=${phoneFromUrl}` : ''}${ref ? `&ref=${ref}` : ''}`
                            : `/track/${cartData.businessType === 'street-vendor' ? 'pre-order' : 'delivery'}/${finalOrderId}?token=${data.token}${phoneFromUrl ? `&phone=${phoneFromUrl}` : ''}${ref ? `&ref=${ref}` : ''}`;

                    // SAVE ACTIVE ORDER FOR TRACKING BUTTON (ARRAY SUPPORT)
                    if (typeof window !== 'undefined') {
                        const storageKey = `liveOrder_${restaurantId}`;
                        let existingData = [];
                        try {
                            const raw = localStorage.getItem(storageKey);
                            if (raw) {
                                const parsed = JSON.parse(raw);
                                existingData = Array.isArray(parsed) ? parsed : [parsed];
                            }
                        } catch (e) {
                            console.error("Error parsing live orders", e);
                            existingData = [];
                        }

                        const newOrder = {
                            orderId: finalOrderId,
                            trackingToken: data.token,
                            restaurantId: restaurantId,
                            deliveryType: deliveryType,
                            dineInTabId: data.dineInTabId || data.dine_in_tab_id || orderData.dineInTabId || cartData?.dineInTabId || null,
                            dineInToken: data.dineInToken || cartData?.dineInToken || null,
                            status: 'placed',
                            timestamp: Date.now()
                        };

                        // Add new order and ensure uniqueness
                        const updatedOrders = [...existingData.filter(o => o.orderId !== newOrder.orderId), newOrder];
                        localStorage.setItem(storageKey, JSON.stringify(updatedOrders));
                        console.log(`[Checkout] Saved liveOrder to storage (Array):`, updatedOrders);
                    }

                    console.log(`[Checkout] Redirecting to NEW order: ${finalOrderId}`);
                    router.replace(redirectUrl); // CHANGED: Replaced push with replace to skip checkout on back
                    return;
                }

                localStorage.removeItem(`cart_${restaurantId}`);
                localStorage.removeItem('current_order_key'); // ← Clear idempotency key
                console.log('[Idempotency] Key cleared after successful order creation');

                if (orderData.deliveryType === 'dine-in') {
                    setInfoDialog({ isOpen: true, title: 'Success', message: 'Tab settled at counter. Thank you!' });
                    setTimeout(() => {
                        const newUrl = `/order/${restaurantId}?table=${tableId}&tabId=${data.dine_in_tab_id || tabId}`;
                        router.replace(newUrl);
                    }, 2000);
                } else if (orderData.deliveryType === 'car-order') {
                    // Redirect to Dine-In tracking page as requested (shows Token Number)
                    const sessionTabId = data.dineInTabId || data.dine_in_tab_id || orderData.dineInTabId || cartData?.dineInTabId || null;
                    const tabParam = sessionTabId ? `&tabId=${encodeURIComponent(sessionTabId)}` : '';
                    const trackingUrl = `/track/dine-in/${data.firestore_order_id}?token=${data.token}${tabParam}`;
                    router.replace(trackingUrl);
                } else {
                    // Direct routing based on business type
                    const trackingPath = cartData.businessType === 'street-vendor' ? 'pre-order' : 'delivery';
                    router.replace(`/track/${trackingPath}/${data.firestore_order_id}?token=${data.token}${phoneFromUrl ? `&phone=${phoneFromUrl}` : ''}${ref ? `&ref=${ref}` : ''}`);
                }
            }
        } catch (err) {
            console.error("[Checkout Page] placeOrder function error:", err);
            setRetryCount((prev) => Math.min(prev + 1, 3));

            // Set ORDER_STATE.ERROR for proper UI handling
            setOrderState(ORDER_STATE.ERROR);
            setIsProcessingPayment(false);

            // Human-friendly error messages (no technical jargon)
            let friendlyError = 'Something went wrong. Please try again.';

            if (err.message.includes('network') || err.message.includes('fetch')) {
                friendlyError = 'Connection issue. Please check your internet and try again.';
            } else if (err.message.includes('429') || err.message.toLowerCase().includes('too many requests')) {
                friendlyError = 'Restaurant is busy right now. Please wait a minute and try again.';
            } else if (err.message.includes('400') || err.message.includes('invalid')) {
                friendlyError = 'Invalid order details. Please check and try again.';
            } else if (err.message.includes('timeout')) {
                friendlyError = 'Request timed out. Please try again.';
            } else if (err.message) {
                // Use backend error if it's user-friendly
                const isUserFriendly = !err.message.match(/[A-Z_]{3,}/) && err.message.length < 100;
                friendlyError = isUserFriendly ? err.message : friendlyError;
            }

            setError(friendlyError);
            setOrderError(friendlyError);
        }
    };

    const handleConfirmDetails = () => {
        if (validateOrderDetails()) {
            localStorage.setItem('customerName', orderName);
            setIsPaymentDrawerOpen(true);
        }
    }

    const handlePayAtCounter = () => {
        if (validateOrderDetails()) {
            placeOrder('cod');
        }
    }

    // Smart CTA step flow:
    // 1) Select address (for delivery)
    // 2) Select payment mode
    // 3) Place order
    const isAddressStepPending = !activeOrderId && deliveryType === 'delivery' && !selectedAddress;
    const isPaymentStepPending = !isAddressStepPending && !selectedPaymentMethod;
    const isOrderReadyToPlace = !isAddressStepPending && !!selectedPaymentMethod;
    const hasOutOfRangeAddress = deliveryType === 'delivery' && deliveryValidation?.allowed === false;
    const ctaLabel = isAddressStepPending
        ? 'Select Address'
        : isPaymentStepPending
            ? 'Payment Mode'
            : 'Place Order';
    const isCtaDisabled = isProcessingPayment ||
        isValidatingDelivery ||
        hasOutOfRangeAddress ||
        (!activeOrderId && (deliveryType !== 'delivery' && deliveryType !== 'car-order') && !orderName.trim()) ||
        (deliveryType === 'car-order' && !orderName.trim() && !String(cartData?.tab_name || cartData?.customerName || '').trim());

    // Debug CTA Disable Reason
    useEffect(() => {
        if (isCtaDisabled) {
            console.log('[Checkout Debug] CTA Disabled Reason:', {
                isProcessingPayment,
                isValidatingDelivery,
                hasOutOfRangeAddress,
                orderName: orderName.trim(),
                deliveryType,
                nameCheck: !orderName.trim()
            });
        }
    }, [isCtaDisabled, isProcessingPayment, isValidatingDelivery, hasOutOfRangeAddress, orderName, deliveryType]);

    const orderPageUrl = useMemo(() => {
        const params = new URLSearchParams(searchParams.toString());
        const qs = params.toString();
        return qs ? `/order/${restaurantId}?${qs}` : `/order/${restaurantId}`;
    }, [restaurantId, searchParams]);

    useEffect(() => {
        if (!restaurantId) return;
        router.prefetch(`/order/${restaurantId}`);
    }, [router, restaurantId]);

    const handleBackToOrder = () => {
        const hasOrderReferrer = typeof document !== 'undefined' &&
            document.referrer.includes(`/order/${restaurantId}`);

        if (hasOrderReferrer && typeof window !== 'undefined' && window.history.length > 1) {
            router.back();
            return;
        }

        router.push(orderPageUrl);
    };



    const renderPaymentOptions = () => {
        if (isSplitBillActive) {
            return <SplitBillInterface totalAmount={grandTotal} onBack={() => setIsSplitBillActive(false)} orderDetails={fullOrderDetailsForSplit} onPlaceOrder={placeOrder} />
        }

        return (
            <div className="space-y-4">
                {isOnlinePaymentFlow && <Button onClick={() => setIsOnlinePaymentFlow(false)} variant="ghost" size="sm" className="mb-4"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>}

                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => placeOrder('online')}
                    disabled={
                        orderState === ORDER_STATE.CREATING_ORDER ||
                        orderState === ORDER_STATE.PAYMENT_PROCESSING ||
                        orderState === ORDER_STATE.PAYMENT_PENDING ||
                        isProcessingPayment
                    }
                    className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {(isProcessingPayment || orderState !== ORDER_STATE.IDLE) && <Loader2 className="animate-spin h-5 w-5" />}
                    {(!isProcessingPayment && orderState === ORDER_STATE.IDLE) && <CreditCard size={40} className="text-primary flex-shrink-0" />}
                    <div>
                        <h3 className="text-xl font-bold">
                            {orderState === ORDER_STATE.CREATING_ORDER
                                ? 'Processing Order...'
                                : orderState === ORDER_STATE.PAYMENT_PROCESSING
                                    ? 'Opening Payment...'
                                    : orderState === ORDER_STATE.PAYMENT_PENDING
                                        ? 'Confirming Payment...'
                                        : 'Pay Full Bill'
                            }
                        </h3>
                        <p className="text-muted-foreground">
                            {orderState === ORDER_STATE.IDLE
                                ? 'Use UPI, Card, or Netbanking'
                                : 'Please wait...'
                            }
                        </p>
                    </div>
                </motion.button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setIsSplitBillActive(true)} className="w-full text-left p-6 bg-card border-2 border-border rounded-lg flex items-center gap-6 hover:border-primary transition-all">
                    <Split size={40} className="text-primary flex-shrink-0" />
                    <div>
                        <h3 className="text-xl font-bold">Split The Bill</h3>
                        <p className="text-muted-foreground">Split equally with your friends.</p>
                    </div>
                </motion.button>

                {/* ERROR STATE WITH RETRY BUTTON */}
                {orderState === ORDER_STATE.ERROR && orderError && (
                    <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg">
                        <div className="flex items-start gap-3 mb-3">
                            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-red-600 dark:text-red-400">Payment Failed</p>
                                <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">{orderError}</p>
                            </div>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                                setOrderState(ORDER_STATE.IDLE);
                                setOrderError('');
                                placeOrder('online'); // Retry with same idempotency key
                            }}
                            className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <RefreshCw size={16} />
                            Try Again ({retryCount}/3)
                        </motion.button>
                    </div>
                )}

                {/* Refund & Cancellation Policy */}
                <div className="mt-6 p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
                    <p className="text-xs font-semibold text-yellow-400 mb-2">⚠️ Refund & Cancellation Policy</p>
                    <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                        <li><span className="font-semibold">Vendor Discretion:</span> Refunds are processed at the vendor&apos;s sole discretion based on the cancellation reason.</li>
                        <li><span className="font-semibold">Fake/Fraudulent Orders:</span> Orders placed with wrong details, duplicate orders, or customer-initiated cancellations may not be eligible for refund.</li>
                        <li><span className="font-semibold">Processing Time:</span> Approved refunds take 5-7 business days to reflect in your account.</li>
                        <li><span className="font-semibold">ServiZephyr&apos;s Role:</span> We facilitate the transaction but do not interfere in refund decisions. Please contact the vendor directly for refund concerns.</li>
                    </ul>
                </div>
            </div >
        );
    }

    const renderDetailsForm = () => {
        return (
            <div className="mb-6 bg-card p-4 rounded-lg border">
                <h3 className="font-bold text-lg mb-2">Confirm Your Details</h3>
                <div className="space-y-4">
                    {deliveryType === 'delivery' ? (
                        <div>
                            <Label htmlFor="address">Select an address</Label>
                            <div className="space-y-2 mt-2">
                                {userAddresses.map(addr => (
                                    <div key={addr.id} className="flex items-start gap-2 p-3 rounded-md bg-muted has-[:checked]:bg-primary/10 has-[:checked]:border-primary border border-transparent">
                                        <input type="radio" id={addr.id} name="address" value={addr.id} checked={selectedAddress?.id === addr.id} onChange={() => setSelectedAddress(addr)} className="h-4 w-4 mt-1 text-primary border-gray-300 focus:ring-primary" />
                                        <Label htmlFor={addr.id} className="flex-1 cursor-pointer">
                                            <p className="font-semibold">{addr.name}{addr.label && <span className="font-normal text-muted-foreground"> ({addr.label})</span>}</p>
                                            <p className="text-xs text-muted-foreground">{addr.full}</p>
                                            <p className="text-xs text-muted-foreground">Ph: {addr.phone}</p>
                                        </Label>
                                    </div>
                                ))}
                                <Button variant="outline" className="w-full" onClick={handleAddNewAddress}><PlusCircle className="mr-2 h-4 w-4" /> Add New Address</Button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <Label htmlFor="name" className="flex items-center gap-2"><User size={16} /> Your Name *</Label>
                            <Input id="name" value={orderName} onChange={(e) => setOrderName(e.target.value)} disabled={loading} required />
                        </div>
                    )}
                    {(deliveryType === 'street-vendor-pre-order') ? (
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={16} /> Phone Number (Optional)</Label>
                            <Input id="phone" value={orderPhone} onChange={(e) => setOrderPhone(e.target.value)} disabled={loading || !!phoneFromUrl} placeholder="For order updates via WhatsApp" />
                        </div>
                    ) : (
                        deliveryType !== 'delivery' && (
                            <div>
                                <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={16} /> Phone Number</Label>
                                <Input id="phone" value={orderPhone} onChange={(e) => setOrderPhone(e.target.value)} disabled={loading || !!phoneFromUrl} />
                            </div>
                        )
                    )}
                </div>
                <Button onClick={handleConfirmDetails} className="w-full mt-4 bg-primary text-primary-foreground">
                    Confirm & Choose Payment
                </Button>
            </div>
        )
    }

    if (loading && !cartData) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }

    const cameToPay = (!cart || cart.length === 0) && tabId;

    // BLOCK NEW ORDERS for post-paid, but ALLOW PAYMENT for existing orders
    if (deliveryType === 'dine-in' && cartData?.dineInModel === 'post-paid' && cart.length > 0 && !tabId) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <Lock size={48} className="text-destructive mb-4" />
                <h1 className="text-2xl font-bold text-foreground">Payment Not Required</h1>
                <p className="mt-2 text-muted-foreground max-w-md">This is a post-paid order. Please place your order from the cart to get a WhatsApp confirmation.</p>
                <Button onClick={() => router.push(`/cart?restaurantId=${restaurantId}&${searchParams.toString()}`)} className="mt-6">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Cart
                </Button>
            </div>
        );
    }

    if (isPaymentConfirmed) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4 green-theme">
                <CheckCircle className="w-24 h-24 text-primary mx-auto" />
                <h1 className="text-4xl font-bold text-foreground mt-6">Payment Successful!</h1>
                <p className="mt-4 text-lg text-muted-foreground max-w-md">Thank you for dining with us. Your bill has been settled.</p>
                <Button onClick={() => router.push(`/order/${restaurantId}?table=${tableId}`)} className="mt-8">
                    Back to Menu
                </Button>
            </div>
        )
    }

    return (
        <>
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <Script src="https://checkout.razorpay.com/v1/checkout.js" />
            <Script src="https://mercury.phonepe.com/web/bundle/checkout.js" />
            <Dialog open={isDineInModalOpen} onOpenChange={setDineInModalOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>What would you like to do?</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-1 gap-4 py-4">
                        <Button onClick={handleAddMoreToTab} variant="outline" className="h-16 text-lg">Add More Items</Button>
                        <Button onClick={handleViewBill} className="h-16 text-lg">View Bill & Pay</Button>
                    </div>
                </DialogContent>
            </Dialog>
            <div className="min-h-screen bg-background text-foreground flex flex-col green-theme">
                <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
                    <div className="container mx-auto px-4 py-3 flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={handleBackToOrder} className="h-10 w-10"><ArrowLeft /></Button>
                        <div>
                            <p className="text-xs text-muted-foreground">{cameToPay ? 'Final Step' : activeOrderId ? 'Add to Order' : 'Step 1 of 1'}</p>
                            <h1 className="text-xl font-bold">{cameToPay ? 'Pay Your Bill' : 'Review Order'}</h1>
                        </div>
                    </div>
                </header>

                <main className="flex-grow p-4 container mx-auto w-full md:max-w-3xl lg:max-w-4xl" style={{ paddingBottom: '120px' }}>
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                        {error && <p className="text-destructive text-sm bg-destructive/10 p-2 rounded-md mb-4">{error}</p>}

                        {/* CAR ORDER SESSION SECTION */}
                        {deliveryType === 'car-order' && (
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-300/60 dark:border-indigo-500/30 p-4 rounded-lg mb-3 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-3">
                                        <div className="bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 p-2.5 rounded-full">
                                            <Car className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <p className="text-xs uppercase tracking-wider font-bold text-indigo-700/80 dark:text-indigo-200/80">Car Order</p>
                                            <p className="font-bold text-indigo-800 dark:text-indigo-100">
                                                Slot: {cartData?.carSpot || carOrderDetails?.carSpot || 'Unassigned'}
                                            </p>
                                            <p className="text-xs text-indigo-700/80 dark:text-indigo-200/80 mt-0.5">
                                                {cartData?.carDetails || carOrderDetails?.carDetails || 'No car details'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase tracking-wider font-bold text-indigo-700/80 dark:text-indigo-200/80">Token</p>
                                        <p className="text-xl font-black text-indigo-800 dark:text-indigo-100">
                                            {carTokenPreview || cartData?.dineInToken || 'Will be generated'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ADDRESS SECTION */}
                        {deliveryType === 'delivery' && (
                            <div
                                className="bg-card p-4 rounded-lg border border-border mb-3 shadow-sm cursor-pointer hover:border-primary/50 transition-colors"
                                onClick={() => setIsAddressSelectorOpen(true)}
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <MapPin className="h-4 w-4 text-primary" />
                                    <h3 className="font-bold text-sm uppercase text-muted-foreground">Delivering To</h3>
                                </div>
                                {selectedAddress ? (
                                    <div className="bg-muted/30 p-3 rounded-md pointer-events-none">
                                        <p className="font-semibold text-sm">{selectedAddress.name}{selectedAddress.label && <span className="font-normal text-muted-foreground"> ({selectedAddress.label})</span>}</p>
                                        <p className="text-xs text-muted-foreground mt-1">{selectedAddress.full}</p>
                                        <p className="text-xs text-muted-foreground">Ph: {selectedAddress.phone}</p>
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="p-0 h-auto mt-2 text-primary pointer-events-auto"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setIsAddressSelectorOpen(true);
                                            }}
                                        >
                                            Change Address
                                        </Button>
                                    </div>
                                ) : (
                                    <div>
                                        <p className="text-sm text-muted-foreground mb-2">No address selected</p>
                                        <Button
                                            variant="outline"
                                            className="w-full pointer-events-auto"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleAddNewAddress();
                                            }}
                                        >
                                            <PlusCircle className="mr-2 h-4 w-4" /> Add Address
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* CART ITEMS SECTION */}
                        <div className="bg-card p-4 rounded-lg border border-border mb-3 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <i className="fas fa-shopping-basket text-primary"></i>
                                    <h3 className="font-bold text-sm uppercase text-muted-foreground">Your Items</h3>
                                </div>
                                <Link
                                    href={orderPageUrl}
                                    prefetch
                                    className="text-xs text-primary font-semibold flex items-center gap-1"
                                >
                                    <PlusCircle className="h-3 w-3" /> Add more
                                </Link>
                            </div>
                            <div className="space-y-2">
                                <div className="space-y-4">
                                    {cart.map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center text-sm bg-muted/10 p-2 rounded-lg">
                                            <div className="flex flex-col gap-1">
                                                <span className="font-medium text-foreground">
                                                    {item.name}
                                                    {getItemVariantLabel(item)}
                                                </span>
                                                {/* NEW: Base Price Display */}
                                                <div className="text-xs text-muted-foreground">
                                                    ₹{parseFloat(item.portion?.price || item.price || 0).toFixed(2)}
                                                </div>
                                                {/* FIXED: Show Add-ons as proper sub-items with specific prices */}
                                                {(item.addons || item.selectedAddOns) && (item.addons || item.selectedAddOns).length > 0 && (
                                                    <div className="flex flex-col gap-0.5 mt-0.5 pl-2 border-l-2 border-muted">
                                                        {(item.addons || item.selectedAddOns).map((addon, aIdx) => (
                                                            <div key={aIdx} className="text-xs text-muted-foreground flex justify-between">
                                                                <span>+ {addon.name}</span>
                                                                <span>₹{parseFloat(addon.price || 0).toFixed(2)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {/* Line Total: (Base + Addons) * Qty */}
                                                <span className="font-bold mt-1">₹{((item.totalPrice || item.price || 0) * item.quantity).toFixed(2)}</span>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {/* Edit Button */}
                                                {(item.portions?.length > 1 || item.addOnGroups?.length > 0) && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleEditItem(idx);
                                                        }}
                                                        className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
                                                    >
                                                        <Edit2 className="h-4 w-4" />
                                                    </button>
                                                )}

                                                {/* Quantity Adjuster */}
                                                <div className="flex items-center gap-3 bg-background border border-border rounded-lg px-2 py-1 shadow-sm h-8">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            updateItemQuantity(idx, -1);
                                                        }}
                                                        className="text-muted-foreground hover:text-destructive transition-colors"
                                                    >
                                                        <Minus className="h-4 w-4" />
                                                    </button>
                                                    <span className="font-bold w-4 text-center">{item.quantity}</span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            updateItemQuantity(idx, 1);
                                                        }}
                                                        className="text-muted-foreground hover:text-green-600 transition-colors"
                                                    >
                                                        <Plus className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {/* Cooking Instructions */}
                                <textarea
                                    className="w-full mt-3 border border-border rounded-xl px-3 py-2 text-sm bg-muted/30 outline-none focus:border-primary transition-colors"
                                    placeholder="Cooking instructions (e.g. extra spicy, no onions)"
                                    rows="2"
                                    value={cookingInstructions}
                                    onChange={(e) => setCookingInstructions(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* COUPONS SECTION */}
                        {/* COUPONS SECTION */}
                        <div
                            className="group flex items-center justify-between bg-card border border-border rounded-2xl p-4 cursor-pointer transition-all hover:bg-muted/50 active:scale-95 my-4 shadow-sm"
                            onClick={() => setIsCouponDrawerOpen(true)}
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center dark:bg-blue-900/20 dark:text-blue-400">
                                    <Percent className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Use Coupons / View Offers</span>
                                    <span className="text-[11px] text-emerald-500 font-semibold mt-0.5">
                                        {nextCouponUnlockMessage || (maxSavings > 0 ? `Save up to Rs ${maxSavings.toFixed(0)} on this order` : 'View available offers')}
                                    </span>
                                </div>
                            </div>
                        </div>


                        {/* TIP SELECTION GRID - ONLY FOR DELIVERY */}
                        {deliveryType === 'delivery' && (
                            <div className="bg-card p-4 rounded-lg border border-border mb-3 shadow-sm">
                                <div className="section-title flex items-center gap-2 mb-3">
                                    <i className="fas fa-heart text-primary"></i>
                                    <h3 className="font-bold text-sm uppercase text-muted-foreground">Tip your delivery hero</h3>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    {[10, 20, 30].map(amount => (
                                        <button
                                            key={amount}
                                            onClick={() => {
                                                // Toggle tip: if already selected, remove it
                                                if (selectedTipAmount === amount && !showCustomTipInput) {
                                                    setSelectedTipAmount(0);
                                                } else {
                                                    setSelectedTipAmount(amount);
                                                    setShowCustomTipInput(false);
                                                }
                                            }}
                                            className={`border rounded-lg py-2 text-sm font-semibold transition-all ${selectedTipAmount === amount && !showCustomTipInput
                                                ? 'border-primary bg-green-50 text-primary'
                                                : 'border-border bg-white text-muted-foreground hover:border-primary/50'
                                                }`}
                                        >
                                            ₹{amount}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => {
                                            // Toggle custom tip input
                                            if (showCustomTipInput) {
                                                setShowCustomTipInput(false);
                                                setSelectedTipAmount(0);
                                                setCustomTipAmount('');
                                            } else {
                                                setShowCustomTipInput(true);
                                                setSelectedTipAmount(0);
                                            }
                                        }}
                                        className={`border rounded-lg py-2 text-sm font-semibold transition-all ${showCustomTipInput
                                            ? 'border-primary bg-green-50 text-primary'
                                            : 'border-border bg-white text-muted-foreground hover:border-primary/50'
                                            }`}
                                    >
                                        Custom
                                    </button>
                                </div>
                                {showCustomTipInput && (
                                    <input
                                        type="number"
                                        placeholder="Enter custom tip amount"
                                        className="w-full mt-3 border border-primary rounded-lg px-3 py-2 text-sm outline-none"
                                        value={customTipAmount}
                                        onChange={(e) => {
                                            setCustomTipAmount(e.target.value);
                                            setSelectedTipAmount(parseFloat(e.target.value) || 0);
                                        }}
                                    />
                                )}
                            </div>
                        )}

                        {/* BILL SUMMARY - COLLAPSIBLE */}
                        <div className="bg-card p-4 rounded-lg border border-border mb-6">
                            {/* Clickable Header */}
                            {/* Clickable Header */}
                            <div
                                className="flex items-center justify-between cursor-pointer py-2"
                                onClick={() => setIsBillSummaryExpanded(!isBillSummaryExpanded)}
                            >
                                <h3 className="font-bold text-lg flex items-center gap-2">
                                    Bill Summary
                                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-normal">
                                        {isBillSummaryExpanded ? 'Hide Details' : 'View Details'}
                                    </span>
                                </h3>
                                <div className="bg-muted/50 p-2 rounded-full hover:bg-muted transition-colors">
                                    {isBillSummaryExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                </div>
                            </div>

                            {/* Collapsed View - Show only "You Pay" */}
                            {!isBillSummaryExpanded && (
                                <div className="flex justify-between text-xl font-bold mt-3">
                                    <span>You Pay</span>
                                    <span className="text-primary">₹{Math.round(grandTotal)}</span>
                                </div>
                            )}

                            {/* Expanded View - Show full breakdown */}
                            {isBillSummaryExpanded && (
                                <div className="space-y-2 mt-4">
                                    <div className="flex justify-between text-sm">
                                        <span>Subtotal</span>
                                        <span>₹{subtotal.toFixed(2)}</span>
                                    </div>
                                    {Number(totalDiscount) > 0 && (
                                        <div className="flex justify-between text-sm text-green-600">
                                            <span>Coupon Discount {appliedCoupons[0]?.code ? `(${appliedCoupons[0].code})` : ''}</span>
                                            <span>- ₹{Number(totalDiscount).toFixed(2)}</span>
                                        </div>
                                    )}
                                    {/* DELIVERY CHARGE ROW */}
                                    {((finalDeliveryCharge > 0) || (deliveryType === 'delivery')) && (
                                        <div className="flex flex-col gap-1">
                                            <div className="flex justify-between text-sm">
                                                <span className="flex items-center gap-2">
                                                    Delivery Fee
                                                    {isValidatingDelivery && <Loader2 className="h-3 w-3 animate-spin" />}
                                                </span>
                                                <span className={isDeliveryOutOfRange ? "text-destructive font-bold" : (isDeliveryFree ? "text-green-600 font-bold" : "")}>
                                                    {isValidatingDelivery ? (
                                                        <span className="text-muted-foreground font-normal italic animate-pulse">Calculating...</span>
                                                    ) : (
                                                        <div className="flex flex-col items-end">
                                                            <span>{isDeliveryOutOfRange ? 'Not Serviceable' : (isDeliveryFree ? 'FREE' : `₹${finalDeliveryCharge.toFixed(2)}`)}</span>
                                                            {isEstimated && !isDeliveryFree && !isDeliveryOutOfRange && (
                                                                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-tight">Estimated</span>
                                                            )}
                                                        </div>
                                                    )}
                                                </span>
                                            </div>
                                            {(deliveryReason || (deliveryValidation && !isValidatingDelivery)) && (
                                                <div className={`text-[10px] text-right italic font-medium ${isDeliveryOutOfRange ? 'text-destructive' : 'text-muted-foreground'}`}>
                                                    {deliveryReason || (deliveryValidation?.allowed !== false && `${deliveryValidation.roadDistance}km Standard Charge`)}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {/* RIDER TIP ROW - from tip selection grid */}
                                    {selectedTipAmount > 0 && (
                                        <div className="flex justify-between text-sm text-green-600">
                                            <span>Delivery Tip</span>
                                            <span className="font-medium">+ ₹{selectedTipAmount.toFixed(2)}</span>
                                        </div>
                                    )}
                                    {cgst > 0 && (
                                        <>
                                            <div className="flex justify-between text-sm">
                                                <span>CGST ({vendorCharges?.gstEnabled ? (vendorCharges.gstRate / 2) : 2.5}%)</span>
                                                <span>₹{cgst.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span>SGST ({vendorCharges?.gstEnabled ? (vendorCharges.gstRate / 2) : 2.5}%)</span>
                                                <span>₹{sgst.toFixed(2)}</span>
                                            </div>
                                        </>
                                    )}

                                    {packagingCharge > 0 && (
                                        <div className="flex justify-between text-sm text-primary">
                                            <span>Packaging Charges</span>
                                            <span>₹{packagingCharge.toFixed(2)}</span>
                                        </div>
                                    )}
                                    <div className="border-t border-dashed pt-2 mt-2" />
                                    <div className="flex justify-between text-sm">
                                        <span>Order Total</span>
                                        <span className="font-semibold">₹{(Math.max(0, subtotal - Number(totalDiscount || 0)) + finalDeliveryCharge + cgst + sgst + packagingCharge + tipAmount).toFixed(2)}</span>
                                    </div>
                                    {convenienceFee > 0 && (
                                        <>
                                            <div className="flex justify-between text-sm text-orange-600">
                                                <span>{vendorCharges?.convenienceFeeLabel || 'Payment Processing Fee'} ({vendorCharges?.convenienceFeeRate || 2.5}%)</span>
                                                <span>₹{convenienceFee.toFixed(2)}</span>
                                            </div>
                                        </>
                                    )}
                                    <div className="border-t border-border pt-2 mt-2" />
                                    <div className="flex justify-between text-xl font-bold">
                                        <span>You Pay</span>
                                        <div className="flex flex-col items-end">
                                            <span className="text-primary leading-none">₹{Math.round(grandTotal)}</span>
                                            <span className="text-[10px] text-muted-foreground font-normal mt-1">
                                                (Exact: ₹{grandTotal.toFixed(2)})
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* SPLIT BILL INTERFACE (if active) */}
                        {isSplitBillActive && (
                            <div className="mt-6">
                                <SplitBillInterface
                                    totalAmount={grandTotal}
                                    onBack={() => setIsSplitBillActive(false)}
                                    orderDetails={fullOrderDetailsForSplit}
                                    onPlaceOrder={placeOrder}
                                />
                            </div>
                        )}
                    </motion.div>
                </main>

                {/* STICKY FOOTER BAR */}
                <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 shadow-[0_-5px_25px_-5px_rgba(0,0,0,0.1)] w-full md:max-w-3xl lg:max-w-4xl mx-auto">
                    <div className="px-4 py-3 flex items-center gap-3">
                        {/* Left: Payment Method Trigger (Selector Only) */}
                        <div
                            className="flex-1 cursor-pointer group"
                            onClick={() => setIsPaymentDrawerOpen(true)}
                        >
                            <div className="flex flex-col gap-0.5 justify-center h-full">
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">PAYMENT MODE</span>
                                    <ChevronUp className="h-3 w-3 text-muted-foreground" />
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center border border-border ${selectedPaymentMethod ? 'bg-primary/10 border-primary/20' : 'bg-muted'}`}>
                                        {selectedPaymentMethod === 'counter' ? (
                                            <HandCoins className="h-4 w-4 text-primary" />
                                        ) : selectedPaymentMethod === 'online' ? (
                                            <QrCode className="h-4 w-4 text-primary" />
                                        ) : (
                                            <Wallet className="h-4 w-4 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="leading-tight">
                                        <p className={`text-sm font-bold line-clamp-1 ${selectedPaymentMethod ? 'text-foreground' : 'text-muted-foreground'}`}>
                                            {selectedPaymentMethod === 'counter' ? 'POD' : selectedPaymentMethod === 'online' ? 'UPI' : 'Select Mode'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right: Smart Action Button (Price + Action) */}
                        <button
                            onClick={() => {
                                if (isAddressStepPending) {
                                    setIsAddressSelectorOpen(true);
                                    return;
                                }

                                if (!selectedPaymentMethod) {
                                    setIsPaymentDrawerOpen(true);
                                    return;
                                }

                                if (selectedPaymentMethod === 'counter') {
                                    handlePayAtCounter();
                                } else if (selectedPaymentMethod === 'online') {
                                    placeOrder('online');
                                }
                            }}
                            disabled={isCtaDisabled}
                            className={cn(
                                "h-12 px-4 rounded-xl font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md flex-none w-[55%] sm:w-[45%]",
                                isOrderReadyToPlace
                                    ? "bg-primary text-white hover:bg-primary/90 shadow-primary/25"
                                    : "bg-amber-500 text-white hover:bg-amber-600 shadow-amber-500/25"
                            )}
                        >
                            {isProcessingPayment ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="animate-spin h-4 w-4" /> Processing
                                </span>
                            ) : (
                                <div className="flex items-center justify-between w-full">
                                    <div className="flex flex-col items-start pr-3 border-r border-white/20 mr-3 min-w-[3rem]">
                                        <span className="text-[9px] font-medium opacity-80 uppercase tracking-wide leading-none mb-0.5">TOTAL</span>
                                        <span className="text-base font-extrabold leading-none">₹{grandTotal.toFixed(0)}</span>
                                    </div>
                                    <div className="flex items-center gap-1 flex-1 justify-center whitespace-nowrap">
                                        <span>{ctaLabel}</span>
                                        <i className="fas fa-caret-right text-xs ml-0.5"></i>
                                    </div>
                                </div>
                            )}
                        </button>
                    </div>
                </div>

                {/* BOTTOM DRAWER - Payment Method Selection */}
                {isPaymentDrawerOpen && (
                    <>
                        {/* Overlay */}
                        <div
                            className="fixed inset-0 bg-black/60 z-[60] animate-in fade-in duration-300 backdrop-blur-sm"
                            onClick={() => setIsPaymentDrawerOpen(false)}
                        />

                        {/* Drawer Content */}
                        <div
                            className="fixed bottom-0 left-0 right-0 bg-card rounded-t-[2rem] z-[70] animate-in slide-in-from-bottom duration-300 w-full md:max-w-3xl lg:max-w-4xl mx-auto shadow-2xl border-t border-border/50"
                            style={{ maxHeight: '85vh', overflowY: 'auto' }}
                        >
                            <div className="p-6 pb-10">
                                {/* Handle */}
                                <div className="w-12 h-1.5 bg-muted-foreground/20 rounded-full mx-auto mb-6" />

                                <h2 className="text-xl font-bold mb-6 text-center">Choose Payment Method</h2>

                                {/* Cash on Delivery Option */}
                                {codEnabled && (
                                    <div
                                        onClick={() => {
                                            setSelectedPaymentMethod('counter');
                                            setSelectedOnlinePaymentType(null);
                                            setTimeout(() => setIsPaymentDrawerOpen(false), 300);
                                        }}
                                        className={`group flex items-center gap-4 p-5 border-2 rounded-2xl mb-4 cursor-pointer transition-all relative overflow-hidden ${selectedPaymentMethod === 'counter'
                                            ? 'border-primary bg-primary/5 shadow-md shadow-primary/10'
                                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                                            }`}
                                    >
                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${selectedPaymentMethod === 'counter' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary'}`}>
                                            <HandCoins className="h-6 w-6" />
                                        </div>
                                        <div className="flex-1">
                                            <p className={`font-bold text-base ${selectedPaymentMethod === 'counter' ? 'text-primary' : 'text-foreground'}`}>Pay upon Delivery</p>
                                            <p className="text-sm text-muted-foreground">Cash or UPI at your doorstep</p>
                                        </div>
                                        {selectedPaymentMethod === 'counter' && (
                                            <div className="bg-primary text-white p-1 rounded-full">
                                                <CheckCircle size={20} className="fill-current" />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Pay Online Option */}
                                {onlinePaymentEnabled && (
                                    <div
                                        onClick={() => {
                                            setSelectedPaymentMethod('online');
                                            setSelectedOnlinePaymentType('full');
                                            setTimeout(() => setIsPaymentDrawerOpen(false), 300);
                                        }}
                                        className={`group flex items-center gap-4 p-5 border-2 rounded-2xl cursor-pointer transition-all relative overflow-hidden ${selectedPaymentMethod === 'online'
                                            ? 'border-primary bg-primary/5 shadow-md shadow-primary/10'
                                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                                            }`}
                                    >
                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${selectedPaymentMethod === 'online' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary'}`}>
                                            <QrCode className="h-6 w-6" />
                                        </div>
                                        <div className="flex-1">
                                            <p className={`font-bold text-base ${selectedPaymentMethod === 'online' ? 'text-primary' : 'text-foreground'}`}>Pay Online / UPI</p>
                                            <p className="text-sm text-muted-foreground">PhonePe, GPay, Cards</p>
                                        </div>
                                        {selectedPaymentMethod === 'online' && (
                                            <div className="bg-primary text-white p-1 rounded-full">
                                                <CheckCircle size={20} className="fill-current" />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Convenience Fee Warning for Online Payment */}
                                {selectedPaymentMethod === 'online' && convenienceFee > 0 && (
                                    <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-700">
                                        ⚠️ +₹{convenienceFee.toFixed(2)} payment processing fee will be added
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
                {/* ADDRESS SELECTOR DRAWER - TOP SLIDE IN */}
                <AnimatePresence>
                    {isAddressSelectorOpen && (
                        <>
                            {/* Overlay */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => window.history.back()}
                                className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
                            />

                            <motion.div
                                initial={{ y: '-100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '-100%' }}
                                transition={{ type: 'spring', damping: 25, stiffness: 300, mass: 0.8 }}
                                drag="y"
                                dragConstraints={{ top: -1000, bottom: 0 }}
                                dragElastic={{ top: 0.1, bottom: 0.05 }}
                                onDragEnd={(e, { offset, velocity }) => {
                                    if (offset.y < -100 || velocity.y < -500) {
                                        window.history.back();
                                    }
                                }}
                                className="fixed top-0 left-0 right-0 h-screen bg-background z-[100] flex flex-col overflow-hidden shadow-2xl pb-10"
                            >
                                {/* Header - Draggable */}
                                <div className="p-4 border-b border-border flex items-center justify-between bg-background z-10 shadow-sm shrink-0 cursor-grab active:cursor-grabbing touch-none select-none">
                                    <h2 className="text-lg font-bold">Select a Location</h2>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => window.history.back()}
                                    >
                                        <ChevronUp size={24} />
                                    </Button>
                                </div>

                                {/* Content - Scrollable */}
                                <div className="flex-1 overflow-y-auto p-4 bg-muted/5 overscroll-contain">
                                    <div className="max-w-3xl mx-auto pb-safe">
                                        {/* Address Selection List Component */}
                                        <AddressSelectionList
                                            addresses={userAddresses}
                                            selectedAddressId={selectedAddress?.id}
                                            onSelect={(addr) => {
                                                setSelectedAddress(addr);
                                                window.history.back();
                                            }}
                                            onUseCurrentLocation={handleUseCurrentLocation}
                                            onAddNewAddress={handleAddNewAddress}
                                        />

                                        {/* Drag Handle Indicator - Pull Up to Close */}
                                        <div
                                            className="w-full flex flex-col items-center justify-center py-8 opacity-60 space-y-2 cursor-grab active:cursor-grabbing touch-none select-none mt-4 bg-transparent"
                                            onClick={() => window.history.back()}
                                        >
                                            <ChevronUp size={24} className="animate-bounce text-primary" />
                                            <span className="text-xs font-bold uppercase tracking-widest text-primary/80">Slide Up to Close</span>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>

                {/* Back Button Handler Effect for Address Drawer */}
                {isAddressSelectorOpen && (
                    <BackButtonHandler onClose={() => setIsAddressSelectorOpen(false)} />
                )}

                {/* COUPON SELECTOR DRAWER - BOTTOM SLIDE IN */}
                <AnimatePresence>
                    {isCouponDrawerOpen && (
                        <>
                            {/* Backdrop */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setIsCouponDrawerOpen(false)}
                                className="fixed inset-0 bg-black/60 z-[100]"
                            />
                            {/* Drawer */}
                            <motion.div
                                initial={{ y: '100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '100%' }}
                                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                                drag="y"
                                dragConstraints={{ top: 0, bottom: 500 }}
                                dragElastic={{ top: 0.1, bottom: 0.5 }}
                                onDragEnd={(e, { offset, velocity }) => {
                                    if (offset.y > 100 || velocity.y > 200) {
                                        setIsCouponDrawerOpen(false);
                                    }
                                }}
                                className="fixed bottom-0 left-0 right-0 z-[101] bg-background rounded-t-3xl border-t border-border shadow-xl h-[85vh] flex flex-col w-full md:max-w-3xl lg:max-w-4xl mx-auto"
                                style={{ touchAction: 'none' }}
                            >
                                {/* Drag Handle & Close */}
                                <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30 rounded-t-3xl">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-primary/10 p-2 rounded-full">
                                            <i className="fas fa-percentage text-primary text-xl"></i>
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold">Apply Coupon</h2>
                                            <p className="text-xs text-muted-foreground">Save more on your order!</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-full bg-muted hover:bg-muted/80"
                                        onClick={() => setIsCouponDrawerOpen(false)}
                                    >
                                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                                    </Button>
                                </div>

                                {/* Content */}
                                <div className="flex-1 overflow-y-auto p-4 bg-muted/5">
                                    <div className="max-w-md mx-auto space-y-4">
                                        {/* Input Field */}
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="Enter coupon code"
                                                value={couponCodeInput}
                                                onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleApplyCouponCode();
                                                    }
                                                }}
                                                className="flex-1 px-4 py-3 rounded-xl border border-border bg-card text-sm font-semibold uppercase tracking-wider focus:outline-none focus:border-primary"
                                            />
                                            <Button className="font-bold" onClick={handleApplyCouponCode}>APPLY</Button>
                                        </div>

                                        <div className="flex items-center gap-2 my-4">
                                            <div className="h-px bg-border flex-1"></div>
                                            <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Available Coupons</span>
                                            <div className="h-px bg-border flex-1"></div>
                                        </div>

                                        {/* Coupon List */}
                                        <div className="space-y-3">
                                            {/* Data-driven Coupon List */}
                                            {cartData.availableCoupons && cartData.availableCoupons.length > 0 ? (
                                                cartData.availableCoupons.map((coupon, idx) => {
                                                    const eligibility = getCouponEligibility(coupon);
                                                    const isApplied = appliedCoupons.some(
                                                        (appliedCoupon) => String(appliedCoupon?.code || '').trim().toUpperCase() === String(coupon?.code || '').trim().toUpperCase()
                                                    );

                                                    return (
                                                        <div key={idx} className="bg-card border border-dashed border-primary/40 rounded-xl p-4 relative overflow-hidden group hover:border-primary transition-colors">
                                                            <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-muted/5 rounded-full border-r border-dashed border-primary/40 group-hover:border-primary transition-colors"></div>
                                                            <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-muted/5 rounded-full border-l border-dashed border-primary/40 group-hover:border-primary transition-colors"></div>

                                                            <div className="flex justify-between items-start ml-2 mr-2 gap-2">
                                                                <div>
                                                                    <div className="bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-1 rounded w-fit mb-2 flex items-center gap-1">
                                                                        <Ticket size={12} />
                                                                        {coupon.code}
                                                                    </div>
                                                                    <p className="font-bold text-sm">
                                                                        {coupon.description || `Get ${coupon.value}${normalizeCouponType(coupon.type) === 'percentage' ? '%' : ' OFF'}`}
                                                                    </p>
                                                                    <p className="text-xs text-muted-foreground mt-1">Min order: ₹{Number(coupon.minOrder) || 0}</p>
                                                                    {!eligibility.eligible && (
                                                                        <p className="text-xs text-amber-500 mt-1">{eligibility.message}</p>
                                                                    )}
                                                                </div>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    disabled={!eligibility.eligible}
                                                                    className="text-primary border-primary hover:bg-primary hover:text-white font-bold h-8 disabled:opacity-60 disabled:cursor-not-allowed"
                                                                    onClick={() => {
                                                                        const applied = applyCoupon(coupon);
                                                                        if (applied) {
                                                                            setIsCouponDrawerOpen(false);
                                                                        }
                                                                    }}
                                                                >
                                                                    {isApplied ? 'APPLIED' : 'APPLY'}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <div className="text-center py-12 px-6 opacity-80">
                                                    <div className="bg-muted/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                                                        <Ticket className="h-8 w-8 text-muted-foreground" />
                                                    </div>
                                                    <p className="font-semibold text-muted-foreground">No offers available for you right now</p>
                                                    <p className="text-xs text-muted-foreground mt-1">Keep an eye out for exciting deals!</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>

                {/* EDIT VARIANT DRAWER */}
                {isEditDrawerOpen && editingItemIndex !== null && cart[editingItemIndex] && (
                    <CustomizationDrawer
                        item={cart[editingItemIndex]}
                        isOpen={isEditDrawerOpen}
                        onClose={() => setIsEditDrawerOpen(false)}
                        onConfirm={handleUpdateItem}
                        actionLabel="Update Item"
                    />
                )}
            </div >
        </>
    );
};


const CheckoutPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
        <CheckoutPageInternal />
    </Suspense>
);

export default CheckoutPage;



