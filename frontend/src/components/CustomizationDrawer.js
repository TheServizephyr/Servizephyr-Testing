
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CustomizationDrawer = ({ item, isOpen, onClose, onConfirm, actionLabel = "Add item" }) => {
    const [selectedPortion, setSelectedPortion] = useState(null);
    const [addOnQuantities, setAddOnQuantities] = useState({});

    // Initialize state when item opens
    useEffect(() => {
        if (item) {
            // If item has an existing selection (editing mode), try to restore it
            // Otherwise default to min price portion

            let initialPortion = null;
            if (item.selectedPortion) {
                initialPortion = item.selectedPortion;
            } else {
                initialPortion = item.portions?.reduce((min, p) => p.price < min.price ? p : min, item.portions[0]) || null;
            }
            setSelectedPortion(initialPortion);

            const initialQuantities = {};

            // Initialize addons
            (item.addOnGroups || []).forEach(group => {
                group.options.forEach(option => {
                    const key = `${group.title}-${option.name}`;
                    // Check if this addon was already selected (for editing)
                    const existingAddon = item.selectedAddons?.find(a =>
                        a.name === option.name &&
                        // ideally check group too but simplified for now
                        true
                    );
                    initialQuantities[key] = existingAddon ? existingAddon.quantity : 0;
                });
            });
            setAddOnQuantities(initialQuantities);
        }
    }, [item, isOpen]);

    const handleAddOnQuantityChange = (groupTitle, addOnName, action) => {
        const key = `${groupTitle}-${addOnName}`;
        setAddOnQuantities(prev => {
            const currentQty = prev[key] || 0;
            const newQty = action === 'increment' ? currentQty + 1 : Math.max(0, currentQty - 1);
            return { ...prev, [key]: newQty };
        });
    };

    const totalPrice = useMemo(() => {
        if (!selectedPortion || !item) return 0;
        let total = selectedPortion.price;

        (item.addOnGroups || []).forEach(group => {
            group.options.forEach(option => {
                const key = `${group.title}-${option.name}`;
                const quantity = addOnQuantities[key] || 0;
                total += quantity * option.price;
            });
        });

        return total;
    }, [selectedPortion, addOnQuantities, item]);

    const handleFinalConfirm = () => {
        const selectedAddOns = [];
        (item.addOnGroups || []).forEach(group => {
            group.options.forEach(option => {
                const key = `${group.title}-${option.name}`;
                const quantity = addOnQuantities[key] || 0;
                if (quantity > 0) {
                    selectedAddOns.push({ ...option, quantity });
                }
            });
        });

        onConfirm({
            ...item,
            selectedPortion, // Persist selection
            selectedAddons: selectedAddOns, // Persist selection
            variant: selectedPortion?.name, // Legacy support
            addons: selectedAddOns, // Legacy support
            price: selectedPortion?.price, // Unit base price
            totalPrice: totalPrice // Calculated total unit price (base + addons)
        });
        onClose();
    };

    if (!item) return null;

    const sortedPortions = item.portions ? [...item.portions].sort((a, b) => a.price - b.price) : [];
    const showPortions = sortedPortions.length > 1;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 bg-black/60 z-[110]" // Z-index higher than checkout drawers
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        className="fixed bottom-0 left-0 right-0 bg-background rounded-t-2xl p-6 flex flex-col max-h-[85vh] z-[120]"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex-shrink-0">
                            <h3 className="text-2xl font-bold">{item.name}</h3>
                            {(item.addOnGroups?.length > 0) && <p className="text-sm font-semibold text-muted-foreground mt-1">Customize your dish</p>}
                            {(!showPortions && item.description) && <p className="text-sm text-muted-foreground mt-1">{item.description}</p>}
                        </div>

                        <div className="py-4 space-y-6 overflow-y-auto flex-grow">
                            {showPortions && (
                                <div className="space-y-2">
                                    <h4 className="font-semibold text-lg">Size</h4>
                                    {sortedPortions.map(portion => (
                                        <div
                                            key={portion.name}
                                            onClick={() => setSelectedPortion(portion)}
                                            className={cn(
                                                "flex justify-between items-center p-4 rounded-lg border-2 cursor-pointer transition-all",
                                                selectedPortion?.name === portion.name ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                                            )}
                                        >
                                            <span className="font-semibold">{portion.name}</span>
                                            <span className="font-bold text-primary">₹{portion.price}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {(item.addOnGroups || []).map(group => (
                                <div key={group.title} className="space-y-2 pt-4 border-t border-dashed border-border">
                                    <h4 className="font-semibold text-lg">{group.title}</h4>
                                    {group.options.map(option => {
                                        const key = `${group.title}-${option.name}`;
                                        const quantity = addOnQuantities[key] || 0;

                                        return (
                                            <div
                                                key={option.name}
                                                className="flex justify-between items-center p-3 rounded-lg border border-border"
                                            >
                                                <div>
                                                    <span className="font-medium">{option.name}</span>
                                                    <p className="text-sm text-muted-foreground">+ ₹{option.price}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Button size="icon" variant="outline" className="h-7 w-7 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500" onClick={() => handleAddOnQuantityChange(group.title, option.name, 'decrement')} disabled={quantity === 0}>-</Button>
                                                    <span className="font-bold w-5 text-center">{quantity}</span>
                                                    <Button size="icon" variant="outline" className="h-7 w-7 hover:bg-green-500/10 hover:text-green-500 hover:border-green-500" onClick={() => handleAddOnQuantityChange(group.title, option.name, 'increment')}>+</Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>

                        <div className="flex-shrink-0 pt-4 border-t border-border">
                            <Button onClick={handleFinalConfirm} className="w-full h-14 text-lg bg-primary hover:bg-primary/90 text-primary-foreground" disabled={!selectedPortion}>
                                {selectedPortion ? `${actionLabel} for ₹${totalPrice}` : 'Please select a size'}
                            </Button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default CustomizationDrawer;
