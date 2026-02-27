
'use client';

import { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Save, Truck, Map as MapIcon, IndianRupee, ToggleRight, Settings, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import InfoDialog from '@/components/InfoDialog';
import { auth } from '@/lib/firebase';

export const dynamic = 'force-dynamic';

const DEFAULT_ORDER_SLAB_RULES = [
    { maxOrder: 100, fee: 10 },
    { maxOrder: 200, fee: 20 }
];

const normalizeOrderSlabRules = (rules = []) => {
    if (!Array.isArray(rules) || rules.length === 0) {
        return [...DEFAULT_ORDER_SLAB_RULES];
    }

    const normalized = rules
        .map((rule) => ({
            maxOrder: Number(rule?.maxOrder) || 0,
            fee: Number(rule?.fee) || 0
        }))
        .filter((rule) => rule.maxOrder > 0)
        .sort((a, b) => a.maxOrder - b.maxOrder);

    if (normalized.length === 0) {
        return [...DEFAULT_ORDER_SLAB_RULES];
    }

    if (normalized.length === 1) {
        const fallbackRule = DEFAULT_ORDER_SLAB_RULES[1];
        const fallbackMax = Math.max(normalized[0].maxOrder + 1, fallbackRule.maxOrder);
        return [normalized[0], { maxOrder: fallbackMax, fee: fallbackRule.fee }];
    }

    return normalized.slice(0, 2);
};

function DeliverySettingsPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const [settings, setSettings] = useState({
        deliveryEnabled: true,
        deliveryRadius: [5],
        deliveryFeeType: 'fixed',
        deliveryFixedFee: 30,
        deliveryBaseDistance: 0,
        deliveryPerKmFee: 5,
        deliveryFreeThreshold: 500,
        // NEW: Road factor & free zone
        roadDistanceFactor: 1.0,
        freeDeliveryRadius: 0,
        freeDeliveryMinOrder: 0,
        // NEW: Tiered charges
        deliveryTiers: [], // Array of { minOrder: number, fee: number }
        // NEW: Order slab + distance engine
        deliveryOrderSlabRules: [...DEFAULT_ORDER_SLAB_RULES],
        deliveryOrderSlabAboveFee: 0,
        deliveryOrderSlabBaseDistance: 1,
        deliveryOrderSlabPerKmFee: 15,
    });
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) {
                    router.push('/');
                    return;
                }
                const idToken = await user.getIdToken();

                const queryParams = new URLSearchParams();
                if (impersonatedOwnerId) queryParams.set('impersonate_owner_id', impersonatedOwnerId);
                if (employeeOfOwnerId) queryParams.set('employee_of', employeeOfOwnerId);
                const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

                const res = await fetch(`/api/owner/delivery-settings${queryString}`, {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });
                if (!res.ok) throw new Error("Failed to load settings.");
                const data = await res.json();
                const toNum = (value, fallback = 0) => {
                    const n = Number(value);
                    return Number.isFinite(n) ? n : fallback;
                };
                setSettings({
                    // Keep threshold unified across "Free Over" and "Bonus Min Order".
                    // Prefer explicit free-over value, fallback to global min-order override.
                    // This keeps UI and backend behavior aligned.
                    deliveryFreeThreshold: toNum(data.deliveryFreeThreshold, 0) > 0
                        ? toNum(data.deliveryFreeThreshold, 0)
                        : toNum(data.freeDeliveryMinOrder, 500),
                    deliveryEnabled: data.deliveryEnabled,
                    deliveryRadius: [toNum(data.deliveryRadius, 5)],
                    deliveryFeeType: data.deliveryFeeType || 'fixed',
                    deliveryFixedFee: toNum(data.deliveryFixedFee, 30),
                    deliveryBaseDistance: toNum(data.deliveryBaseDistance, 0),
                    deliveryPerKmFee: toNum(data.deliveryPerKmFee, 5),
                    // NEW: Road factor & free zone
                    roadDistanceFactor: toNum(data.roadDistanceFactor, 1.0),
                    freeDeliveryRadius: toNum(data.freeDeliveryRadius, 0),
                    freeDeliveryMinOrder: toNum(data.deliveryFreeThreshold, 0) > 0
                        ? toNum(data.deliveryFreeThreshold, 0)
                        : toNum(data.freeDeliveryMinOrder, 0),
                    // NEW: Tiered charges
                    deliveryTiers: (data.deliveryTiers || []).map(t => ({
                        minOrder: toNum(t?.minOrder, 0),
                        fee: toNum(t?.fee, 0),
                    })),
                    deliveryOrderSlabRules: normalizeOrderSlabRules(data.deliveryOrderSlabRules),
                    deliveryOrderSlabAboveFee: toNum(data.deliveryOrderSlabAboveFee, 0),
                    deliveryOrderSlabBaseDistance: Math.max(0, toNum(data.deliveryOrderSlabBaseDistance, 1)),
                    deliveryOrderSlabPerKmFee: Math.max(0, toNum(data.deliveryOrderSlabPerKmFee, 15)),
                });
            } catch (error) {
                setInfoDialog({ isOpen: true, title: 'Error', message: `Could not load settings: ${error.message}` });
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchSettings();
            else setLoading(false);
        });

        return () => unsubscribe();
    }, [router]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated.");
            const idToken = await user.getIdToken();

            const toNum = (value, fallback = 0) => {
                const n = Number(value);
                return Number.isFinite(n) ? n : fallback;
            };

            const payload = {
                deliveryEnabled: settings.deliveryEnabled,
                deliveryRadius: toNum(settings.deliveryRadius[0], 5),
                deliveryFeeType: settings.deliveryFeeType,
                deliveryFixedFee: toNum(settings.deliveryFixedFee, 0),
                deliveryBaseDistance: toNum(settings.deliveryBaseDistance, 0),
                deliveryPerKmFee: toNum(settings.deliveryPerKmFee, 0),
                deliveryFreeThreshold: toNum(settings.deliveryFreeThreshold, 0),
                // NEW: Road factor & free zone
                roadDistanceFactor: toNum(settings.roadDistanceFactor, 1.0),
                freeDeliveryRadius: toNum(settings.freeDeliveryRadius, 0),
                // Keep threshold usable even after switching from "Free Over Amount" mode.
                freeDeliveryMinOrder: settings.deliveryFeeType === 'free-over'
                    ? toNum(settings.deliveryFreeThreshold, 0)
                    : toNum(settings.freeDeliveryMinOrder, 0),
                // NEW: Tiered charges
                deliveryTiers: settings.deliveryTiers.map(t => ({ minOrder: toNum(t.minOrder, 0), fee: toNum(t.fee, 0) })),
                // NEW: Order slab + distance engine
                deliveryOrderSlabRules: normalizeOrderSlabRules(settings.deliveryOrderSlabRules)
                    .map(rule => ({ maxOrder: toNum(rule.maxOrder, 0), fee: toNum(rule.fee, 0) })),
                deliveryOrderSlabAboveFee: toNum(settings.deliveryOrderSlabAboveFee, 0),
                deliveryOrderSlabBaseDistance: Math.max(0, toNum(settings.deliveryOrderSlabBaseDistance, 1)),
                deliveryOrderSlabPerKmFee: Math.max(0, toNum(settings.deliveryOrderSlabPerKmFee, 15)),
            };

            const queryParams = new URLSearchParams();
            if (impersonatedOwnerId) queryParams.set('impersonate_owner_id', impersonatedOwnerId);
            if (employeeOfOwnerId) queryParams.set('employee_of', employeeOfOwnerId);
            const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

            const response = await fetch(`/api/owner/delivery-settings${queryString}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to save settings');
            }

            setInfoDialog({ isOpen: true, title: 'Success', message: 'Delivery settings saved successfully!' });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not save settings: ${error.message}` });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSettingChange = (key, value) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };

            // Keep threshold value shared between:
            // 1) Main engine "Free Over Amount"
            // 2) Bonus override "Min Order for Free Delivery"
            if (key === 'deliveryFreeThreshold') {
                const unifiedValue = Number(value) || 0;
                next.deliveryFreeThreshold = unifiedValue;
                next.freeDeliveryMinOrder = unifiedValue;
            }

            if (key === 'freeDeliveryMinOrder') {
                const unifiedValue = Number(value) || 0;
                next.freeDeliveryMinOrder = unifiedValue;
                next.deliveryFreeThreshold = unifiedValue;
            }

            // If user switches to free-over mode and threshold is empty,
            // prefill it from already configured global min-order.
            if (key === 'deliveryFeeType' && value === 'free-over' && (Number(prev.deliveryFreeThreshold) || 0) <= 0) {
                next.deliveryFreeThreshold = Number(prev.freeDeliveryMinOrder) || 0;
            }

            if (key === 'deliveryFeeType' && value === 'order-slab-distance') {
                next.deliveryOrderSlabRules = normalizeOrderSlabRules(prev.deliveryOrderSlabRules);
                next.deliveryOrderSlabBaseDistance = Number(prev.deliveryOrderSlabBaseDistance) > 0
                    ? Number(prev.deliveryOrderSlabBaseDistance)
                    : 1;
                next.deliveryOrderSlabPerKmFee = Number(prev.deliveryOrderSlabPerKmFee) >= 0
                    ? Number(prev.deliveryOrderSlabPerKmFee)
                    : 15;
            }

            return next;
        });
    }

    const addTier = () => {
        setSettings(prev => ({
            ...prev,
            deliveryTiers: [...prev.deliveryTiers, { minOrder: 0, fee: 0 }]
        }));
    };

    const removeTier = (index) => {
        setSettings(prev => ({
            ...prev,
            deliveryTiers: prev.deliveryTiers.filter((_, i) => i !== index)
        }));
    };

    const updateTier = (index, field, value) => {
        setSettings(prev => {
            const newTiers = [...prev.deliveryTiers];
            newTiers[index] = { ...newTiers[index], [field]: value };
            return { ...prev, deliveryTiers: newTiers };
        });
    };

    const updateOrderSlabRule = (index, field, value) => {
        setSettings(prev => {
            const normalizedRules = normalizeOrderSlabRules(prev.deliveryOrderSlabRules);
            normalizedRules[index] = {
                ...normalizedRules[index],
                [field]: value
            };

            if (field === 'maxOrder' && index === 1) {
                const firstMax = Number(normalizedRules[0]?.maxOrder) || DEFAULT_ORDER_SLAB_RULES[0].maxOrder;
                if ((Number(normalizedRules[1]?.maxOrder) || 0) <= firstMax) {
                    normalizedRules[1].maxOrder = firstMax + 1;
                }
            }

            if (field === 'maxOrder' && index === 0) {
                const firstMax = Number(normalizedRules[0]?.maxOrder) || DEFAULT_ORDER_SLAB_RULES[0].maxOrder;
                const secondMax = Number(normalizedRules[1]?.maxOrder) || DEFAULT_ORDER_SLAB_RULES[1].maxOrder;
                if (secondMax <= firstMax) {
                    normalizedRules[1].maxOrder = firstMax + 1;
                }
            }

            return { ...prev, deliveryOrderSlabRules: normalizedRules };
        });
    };

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        )
    }

    const orderSlabRules = normalizeOrderSlabRules(settings.deliveryOrderSlabRules);
    const firstOrderSlab = orderSlabRules[0] || DEFAULT_ORDER_SLAB_RULES[0];
    const secondOrderSlab = orderSlabRules[1] || DEFAULT_ORDER_SLAB_RULES[1];
    const sampleDistanceForSlabMode = Number(settings.deliveryOrderSlabBaseDistance || 1) + 2;
    const extraSampleKm = Math.max(0, sampleDistanceForSlabMode - Number(settings.deliveryOrderSlabBaseDistance || 1));
    const sampleSlabBase = Number(firstOrderSlab.fee || 0);
    const sampleSlabCharge = sampleSlabBase + (extraSampleKm * Number(settings.deliveryOrderSlabPerKmFee || 0));
    const isOverrideEngineLocked =
        settings.deliveryFeeType === 'tiered' ||
        settings.deliveryFeeType === 'order-slab-distance';

    return (
        <div className="p-4 md:p-8 space-y-8 max-w-5xl mx-auto pb-24">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-full hover:bg-muted">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                            Delivery Settings
                        </h1>
                        <p className="text-muted-foreground mt-1 font-medium">Configure how you deliver to your customers.</p>
                    </div>
                </div>

                <div className="flex items-center gap-3 px-4 py-3 bg-card border rounded-2xl shadow-sm">
                    <div className="flex flex-col">
                        <span className="text-sm font-bold">Accepting Orders</span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                            {settings.deliveryEnabled ? 'Active' : 'Paused'}
                        </span>
                    </div>
                    <Switch
                        checked={settings.deliveryEnabled}
                        onCheckedChange={(val) => handleSettingChange('deliveryEnabled', val)}
                        className="data-[state=checked]:bg-green-500 scale-110 ml-2"
                    />
                </div>
            </header>

            {/* SECTION 1: CORE LOGISTICS */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                <Card className="overflow-hidden border-2 shadow-sm">
                    <CardHeader className="bg-muted/30 pb-8">
                        <CardTitle className="flex items-center gap-3 text-xl">
                            <div className="p-2 bg-primary/10 rounded-xl">
                                <MapIcon className="h-5 w-5 text-primary" />
                            </div>
                            Core Logistics
                        </CardTitle>
                        <CardDescription className="text-base">Define your reach and road adjustments.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 md:p-8 -mt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            {/* Radius Slider */}
                            <div className="space-y-6">
                                <div className="flex justify-between items-end">
                                    <Label className="text-base font-bold flex flex-col gap-1">
                                        Delivery Radius
                                        <span className="text-xs text-muted-foreground font-medium italic">Max distance for delivery</span>
                                    </Label>
                                    <span className="text-2xl font-black text-primary">{settings.deliveryRadius[0]} <small className="text-sm font-bold">km</small></span>
                                </div>
                                <Slider
                                    value={settings.deliveryRadius}
                                    onValueChange={(val) => handleSettingChange('deliveryRadius', val)}
                                    max={30}
                                    step={1}
                                    className="py-4"
                                />
                            </div>

                            {/* Road Factor Slider */}
                            <div className="space-y-6">
                                <div className="flex justify-between items-end">
                                    <Label className="text-base font-bold flex flex-col gap-1">
                                        Road Adjustment
                                        <span className="text-xs text-muted-foreground font-medium italic">Multiplier for road turns</span>
                                    </Label>
                                    <span className="text-2xl font-black text-primary">{settings.roadDistanceFactor.toFixed(1)} <small className="text-sm font-bold">x</small></span>
                                </div>
                                <Slider
                                    value={[settings.roadDistanceFactor]}
                                    onValueChange={(val) => handleSettingChange('roadDistanceFactor', val[0])}
                                    min={1.0}
                                    max={2.0}
                                    step={0.1}
                                    className="py-4"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>

            {/* STEP 1: CHARGING ENGINE */}
            <div className="space-y-6">
                <div className="flex items-center gap-3 px-1">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white font-black text-sm shadow-lg shadow-primary/20">1</div>
                    <div className="flex flex-col">
                        <h2 className="text-xl font-bold tracking-tight">Main Charging Engine</h2>
                        <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Select one primary method</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    {[
                        { id: 'fixed', label: 'Fixed Fee', icon: <IndianRupee className="h-5 w-5" />, desc: 'Simple flat rate' },
                        { id: 'per-km', label: 'Distance Based', icon: <Truck className="h-5 w-5" />, desc: 'Pay per Kilometre' },
                        { id: 'free-over', label: 'Free Over Amount', icon: <ToggleRight className="h-5 w-5" />, desc: 'Free for large orders' },
                        { id: 'tiered', label: 'Tiered Charges', icon: <Settings className="h-5 w-5" />, desc: 'Advanced rules' },
                        { id: 'order-slab-distance', label: 'Order Slab + KM', icon: <Truck className="h-5 w-5" />, desc: 'Amount slab + extra KM' }
                    ].map((strat) => {
                        const isActive = settings.deliveryFeeType === strat.id;
                        return (
                            <button
                                key={strat.id}
                                onClick={() => handleSettingChange('deliveryFeeType', strat.id)}
                                className={cn(
                                    "flex flex-col items-start p-4 rounded-2xl border-2 text-left transition-all duration-500 group relative overflow-hidden",
                                    isActive
                                        ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                                        : "border-border bg-muted/20 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 hover:border-primary/40 hover:bg-muted/50"
                                )}
                            >
                                <div className="flex justify-between items-start w-full mb-3">
                                    <div className={cn(
                                        "p-2.5 rounded-xl transition-all duration-500",
                                        isActive ? "bg-primary text-white scale-110" : "bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary"
                                    )}>
                                        {strat.icon}
                                    </div>
                                    <Switch
                                        checked={isActive}
                                        onCheckedChange={() => handleSettingChange('deliveryFeeType', strat.id)}
                                        className="scale-75 data-[state=checked]:bg-primary"
                                    />
                                </div>

                                <span className={cn(
                                    "font-bold text-sm leading-tight mb-1 transition-colors",
                                    isActive ? "text-foreground" : "text-muted-foreground"
                                )}>
                                    {strat.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground font-medium leading-normal">
                                    {strat.desc}
                                </span>

                                {isActive && (
                                    <motion.div
                                        layoutId="active-glow"
                                        className="absolute inset-0 bg-primary/5 pointer-events-none"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* DYNAMIC CONFIG AREA */}
                <motion.div
                    key={settings.deliveryFeeType}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="min-h-[160px]"
                >
                    <Card className="border-2 border-primary/20 shadow-sm bg-card/50 backdrop-blur-sm">
                        <CardContent className="p-8">
                            {settings.deliveryFeeType === 'fixed' && (
                                <div className="max-w-md mx-auto space-y-4 text-center">
                                    <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4">Flat Fee Setup</p>
                                    <div className="flex items-center justify-center gap-4">
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-xl opacity-50">₹</span>
                                            <Input
                                                type="number"
                                                className="h-16 pl-10 pr-6 text-3xl font-black rounded-2xl border-2 w-48 text-center"
                                                value={settings.deliveryFixedFee}
                                                onChange={e => handleSettingChange('deliveryFixedFee', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-sm font-medium text-muted-foreground mt-4 italic">Customers will always be charged ₹{settings.deliveryFixedFee} per order.</p>
                                </div>
                            )}

                            {settings.deliveryFeeType === 'per-km' && (
                                <div className="max-w-2xl mx-auto space-y-8">
                                    <div className="text-center space-y-2">
                                        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Hybrid Distance Pricing</p>
                                        <p className="text-xs text-muted-foreground">Set a base fare for a minimum distance, then a rate per KM.</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        {/* Base Fare */}
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Step 1: Base Fare</Label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-lg opacity-50">₹</span>
                                                <Input
                                                    type="number"
                                                    className="h-14 pl-10 pr-4 text-2xl font-black rounded-xl border-2 text-center"
                                                    value={settings.deliveryFixedFee}
                                                    onChange={e => handleSettingChange('deliveryFixedFee', e.target.value)}
                                                />
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">Minimum order fee</p>
                                        </div>

                                        {/* Included Distance */}
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Step 2: Included KM</Label>
                                            <div className="relative">
                                                <Input
                                                    type="number"
                                                    className="h-14 pl-4 pr-12 text-2xl font-black rounded-xl border-2 text-center"
                                                    value={settings.deliveryBaseDistance}
                                                    onChange={e => handleSettingChange('deliveryBaseDistance', e.target.value)}
                                                />
                                                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-sm opacity-50 text-muted-foreground">KM</span>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">Distance covered by Base Fare</p>
                                        </div>

                                        {/* Thereafter Rate */}
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Step 3: Thereafter</Label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-lg opacity-50">₹</span>
                                                <Input
                                                    type="number"
                                                    className="h-14 pl-10 pr-12 text-2xl font-black rounded-xl border-2 text-center"
                                                    value={settings.deliveryPerKmFee}
                                                    onChange={e => handleSettingChange('deliveryPerKmFee', e.target.value)}
                                                />
                                                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-primary text-xs">/km</span>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">Charge for extra distance</p>
                                        </div>
                                    </div>

                                    {/* LIVE PREVIEW BOX */}
                                    <div className="bg-primary/5 border border-primary/10 rounded-2xl p-6 relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
                                            <Truck className="h-12 w-12 text-primary" />
                                        </div>
                                        <h4 className="text-xs font-black uppercase tracking-widest text-primary mb-3">Simulated Breakdown:</h4>
                                        <div className="space-y-1 text-sm">
                                            <p className="font-medium">
                                                • Customer at <span className="text-primary font-bold">{Number(settings.deliveryBaseDistance) || 0}km</span> pays <span className="text-primary font-bold">₹{settings.deliveryFixedFee || 0}</span>
                                            </p>
                                            <p className="font-medium">
                                                • Customer at <span className="text-primary font-bold">{(Number(settings.deliveryBaseDistance) || 0) + 2}km</span> pays <span className="text-primary font-bold">₹{(Number(settings.deliveryFixedFee) || 0) + (2 * (Number(settings.deliveryPerKmFee) || 0))}</span>
                                            </p>
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-primary/10">
                                            <p className="text-[10px] text-muted-foreground leading-relaxed italic">
                                                Formula: ₹{settings.deliveryFixedFee || 0} Base + (Total KM - {settings.deliveryBaseDistance || 0}KM) × ₹{settings.deliveryPerKmFee || 0}/KM
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {settings.deliveryFeeType === 'order-slab-distance' && (
                                <div className="max-w-4xl mx-auto space-y-8">
                                    <div className="text-center space-y-2">
                                        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Order Slab + Distance Pricing</p>
                                        <p className="text-xs text-muted-foreground">
                                            First {settings.deliveryOrderSlabBaseDistance || 1}km gets amount-based base fare, then add per-km fee.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Order Under</Label>
                                            <div className="space-y-2">
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={firstOrderSlab.maxOrder}
                                                        onChange={(e) => updateOrderSlabRule(0, 'maxOrder', Number(e.target.value))}
                                                    />
                                                </div>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={firstOrderSlab.fee}
                                                        onChange={(e) => updateOrderSlabRule(0, 'fee', Number(e.target.value))}
                                                    />
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">e.g. Under Rs {firstOrderSlab.maxOrder} to Rs {firstOrderSlab.fee}</p>
                                        </div>

                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Order Under</Label>
                                            <div className="space-y-2">
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={secondOrderSlab.maxOrder}
                                                        onChange={(e) => updateOrderSlabRule(1, 'maxOrder', Number(e.target.value))}
                                                    />
                                                </div>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={secondOrderSlab.fee}
                                                        onChange={(e) => updateOrderSlabRule(1, 'fee', Number(e.target.value))}
                                                    />
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">e.g. Under Rs {secondOrderSlab.maxOrder} to Rs {secondOrderSlab.fee}</p>
                                        </div>

                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Above Second Slab</Label>
                                            <div className="space-y-2">
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                    <Input
                                                        type="number"
                                                        className="h-11 pl-8 text-lg font-bold rounded-xl text-center"
                                                        value={settings.deliveryOrderSlabAboveFee}
                                                        onChange={(e) => handleSettingChange('deliveryOrderSlabAboveFee', Number(e.target.value))}
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="relative">
                                                        <Input
                                                            type="number"
                                                            className="h-11 pr-10 text-lg font-bold rounded-xl text-center"
                                                            value={settings.deliveryOrderSlabBaseDistance}
                                                            onChange={(e) => handleSettingChange('deliveryOrderSlabBaseDistance', Number(e.target.value))}
                                                        />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">km</span>
                                                    </div>
                                                    <div className="relative">
                                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">â‚¹</span>
                                                        <Input
                                                            type="number"
                                                            className="h-11 pl-8 pr-10 text-lg font-bold rounded-xl text-center"
                                                            value={settings.deliveryOrderSlabPerKmFee}
                                                            onChange={(e) => handleSettingChange('deliveryOrderSlabPerKmFee', Number(e.target.value))}
                                                        />
                                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-primary">/km</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-center font-medium text-muted-foreground italic">Base for first {settings.deliveryOrderSlabBaseDistance || 1}km, then Rs {settings.deliveryOrderSlabPerKmFee || 0}/km</p>
                                        </div>
                                    </div>

                                    <div className="bg-primary/5 border border-primary/10 rounded-2xl p-5">
                                        <h4 className="text-xs font-black uppercase tracking-widest text-primary mb-2">Sample Preview</h4>
                                        <p className="text-sm font-medium">
                                            Under Rs {firstOrderSlab.maxOrder} and {settings.deliveryOrderSlabBaseDistance || 1}km: Rs {sampleSlabBase}
                                        </p>
                                        <p className="text-sm font-medium">
                                            Under Rs {firstOrderSlab.maxOrder} and {sampleDistanceForSlabMode}km: Rs {sampleSlabCharge}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {settings.deliveryFeeType === 'free-over' && (
                                <div className="max-w-md mx-auto space-y-4 text-center">
                                    <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4">Threshold Setup</p>
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-muted-foreground">Free delivery for orders above</span>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">₹</span>
                                                <Input
                                                    type="number"
                                                    className="h-12 pl-8 pr-4 text-xl font-black rounded-xl border-2 w-32 text-center"
                                                    value={settings.deliveryFreeThreshold}
                                                    onChange={e => handleSettingChange('deliveryFreeThreshold', Number(e.target.value))}
                                                />
                                            </div>
                                        </div>
                                        <div className="w-full h-px bg-border my-2" />
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-muted-foreground">Otherwise, charge</span>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">₹</span>
                                                <Input
                                                    type="number"
                                                    className="h-12 pl-8 pr-4 text-xl font-black rounded-xl border-2 w-28 text-center"
                                                    value={settings.deliveryFixedFee}
                                                    onChange={e => handleSettingChange('deliveryFixedFee', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-sm font-medium text-muted-foreground mt-4 italic">Standard fee applies for small orders. This threshold is shared with Bonus Min Order and works for Fixed/Distance modes too.</p>
                                </div>
                            )}

                            {settings.deliveryFeeType === 'tiered' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Order Value Rules</p>
                                        <Button onClick={addTier} variant="outline" size="sm" className="rounded-full border-primary/40 text-primary font-bold hover:bg-primary/5">
                                            + Add New Rule
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {settings.deliveryTiers.length === 0 && (
                                            <div className="col-span-full py-12 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center text-muted-foreground">
                                                <Settings className="h-10 w-10 opacity-20 mb-3" />
                                                <p className="font-semibold italic">No rules defined yet.</p>
                                                <Button variant="link" onClick={addTier} className="text-xs">Create your first rule</Button>
                                            </div>
                                        )}
                                        {settings.deliveryTiers.map((tier, index) => (
                                            <motion.div
                                                layout
                                                initial={{ scale: 0.95, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                key={index}
                                                className="relative p-5 rounded-2xl bg-muted/40 border-2 border-border shadow-sm group"
                                            >
                                                <button
                                                    onClick={() => removeTier(index)}
                                                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <XCircle className="h-4 w-4" />
                                                </button>

                                                <div className="space-y-4">
                                                    <div className="space-y-2">
                                                        <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-tighter">If Order Amount ≥</Label>
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">₹</span>
                                                            <Input
                                                                type="number"
                                                                className="h-10 pl-7 text-lg font-bold rounded-xl"
                                                                value={tier.minOrder}
                                                                onChange={(e) => updateTier(index, 'minOrder', e.target.value)}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-tighter">Delivery Charge</Label>
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold opacity-50">₹</span>
                                                            <Input
                                                                type="number"
                                                                className={cn(
                                                                    "h-10 pl-7 text-lg font-bold rounded-xl",
                                                                    Number(tier.fee) === 0 ? "text-green-500 border-green-500/50 bg-green-500/5" : ""
                                                                )}
                                                                value={tier.fee}
                                                                onChange={(e) => updateTier(index, 'fee', e.target.value)}
                                                            />
                                                            {Number(tier.fee) === 0 && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase text-green-500">Free</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground text-center font-medium italic mt-4">
                                        💡 Tips: Add multiple tiers (e.g., ₹0-200: ₹40, ₹200-500: ₹20, Above ₹500: Free)
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>

            {/* VISUAL CONNECTOR */}
            <div className="flex flex-col items-center py-4 opacity-20">
                <div className="w-px h-12 bg-gradient-to-b from-primary to-transparent" />
                <Settings className="h-4 w-4 text-primary animate-pulse" />
            </div>

            {/* STEP 2: GLOBAL OVERRIDES */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className={cn(
                    "transition-all duration-500",
                    isOverrideEngineLocked ? "opacity-40 grayscale pointer-events-none" : "opacity-100"
                )}
            >
                <div className="flex items-center gap-3 px-1 mb-6">
                    <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full font-black text-sm shadow-lg transition-colors",
                        isOverrideEngineLocked ? "bg-muted text-muted-foreground" : "bg-green-500 text-white shadow-green-500/20"
                    )}>2</div>
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold tracking-tight">Bonus Overrides</h2>
                            {isOverrideEngineLocked && (
                                <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-black uppercase text-muted-foreground border">
                                    Disabled in Current Mode
                                </span>
                            )}
                        </div>
                        <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Global rules that skip the base fee</p>
                    </div>
                </div>

                <Card className={cn(
                    "border-2 shadow-sm overflow-hidden transition-colors",
                    isOverrideEngineLocked ? "border-muted" : "border-green-500/20"
                )}>
                    <CardHeader className={cn(
                        "transition-colors",
                        isOverrideEngineLocked ? "bg-muted/10" : "bg-green-500/5 border-b border-green-500/10"
                    )}>
                        <CardTitle className={cn(
                            "flex items-center gap-3 text-xl transition-colors",
                            isOverrideEngineLocked ? "text-muted-foreground" : "text-green-600 dark:text-green-400"
                        )}>
                            <div className={cn(
                                "p-2 rounded-xl transition-colors",
                                isOverrideEngineLocked ? "bg-muted/20" : "bg-green-500/10"
                            )}>
                                <Truck className="h-5 w-5" />
                            </div>
                            Fast & Free Zone
                        </CardTitle>
                        <CardDescription className="text-base">
                            {isOverrideEngineLocked
                                ? "Current engine already handles complete delivery logic. Global overrides are disabled."
                                : "Reward nearby or big orders with zero delivery fees."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                            {/* RADIUS OVERRIDE */}
                            <div className="space-y-6">
                                <div className="flex justify-between items-end">
                                    <Label className="text-base font-bold flex flex-col gap-1">
                                        Free Within Radius
                                        <span className="text-xs text-muted-foreground font-medium italic">Apply zero fee if distance ≤ radius</span>
                                    </Label>
                                    <span className={cn(
                                        "text-2xl font-black",
                                        settings.freeDeliveryRadius > 0 ? "text-green-500" : "text-muted-foreground opacity-40"
                                    )}>
                                        {settings.freeDeliveryRadius} <small className="text-xs font-bold uppercase tracking-widest">km</small>
                                    </span>
                                </div>
                                <Slider
                                    value={[settings.freeDeliveryRadius]}
                                    onValueChange={(val) => handleSettingChange('freeDeliveryRadius', val[0])}
                                    min={0}
                                    max={settings.deliveryRadius[0]}
                                    step={0.5}
                                    className="py-4"
                                />
                            </div>

                            {/* MIN ORDER OVERRIDE */}
                            <div className="space-y-6">
                                <Label className="text-base font-bold flex flex-col gap-1">
                                    Min Order for Free Delivery
                                    <span className="text-xs text-muted-foreground font-medium italic">Global threshold to skip all fees (shared with Free Over Amount)</span>
                                </Label>
                                <div className="relative group max-w-[200px]">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-xl text-muted-foreground group-focus-within:text-green-500 transition-colors">₹</span>
                                    <Input
                                        type="number"
                                        className="h-14 pl-10 pr-4 text-2xl font-black rounded-2xl border-2 focus:border-green-500 transition-all text-center"
                                        value={settings.freeDeliveryMinOrder}
                                        onChange={(e) => handleSettingChange('freeDeliveryMinOrder', Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        </div>

                        {settings.freeDeliveryRadius > 0 && (
                            <div className="mt-8 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
                                <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center animate-pulse shadow-lg shadow-green-500/20">
                                    <Truck className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-green-700 dark:text-green-300 leading-tight">Dynamic Free Delivery Active!</p>
                                    <p className="text-xs font-semibold text-green-600/80 mt-1">
                                        Customers within <strong>{settings.freeDeliveryRadius}km</strong> get free shipping
                                        {settings.freeDeliveryMinOrder > 0 ? ` on orders above ₹${settings.freeDeliveryMinOrder}` : ''}.
                                    </p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </motion.div>

            {/* SAVE ACTION */}
            {/* SAVE ACTION */}
            <div className="sticky bottom-0 -mx-4 md:-mx-8 px-4 md:px-8 py-4 bg-background/95 backdrop-blur-xl border-t z-40 flex items-center justify-center mt-auto">
                <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full max-w-sm h-14 rounded-2xl font-black text-lg bg-primary hover:bg-primary/90 shadow-2xl shadow-primary/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                    {isSaving ? (
                        <>
                            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                            Optimizing...
                        </>
                    ) : (
                        <>
                            <Save className="mr-3 h-6 w-6" />
                            Apply Settings
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default function DeliverySettingsPage() {
    return (
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <DeliverySettingsPageContent />
        </Suspense>
    )
}
