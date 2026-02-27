

"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PlusCircle, GripVertical, Trash2, Edit, Image as ImageIcon, Search, X, Utensils, Pizza, Soup, Drumstick, Salad, CakeSlice, GlassWater, ChevronDown, IndianRupee, Upload, Copy, FileJson, XCircle, ShoppingBag, Laptop, BookOpen, ToyBrick } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { auth, storage } from '@/lib/firebase';
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { useSearchParams } from 'next/navigation';
import InfoDialog from "@/components/InfoDialog";
import imageCompression from 'browser-image-compression';
import { useUser } from '@/firebase';
import { validatePriceChange } from '@/lib/priceValidation';
import PriceChangeConfirmationDialog from '@/components/PriceChangeConfirmationDialog';
import ConfirmationDialog from '@/components/ConfirmationDialog';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

export const dynamic = 'force-dynamic';

const restaurantCategoryConfig = {
    "starters": { title: "Starters", icon: Salad },
    "main-course": { title: "Main Course", icon: Pizza },
    "beverages": { title: "Beverages", icon: GlassWater },
    "desserts": { title: "Desserts", icon: CakeSlice },
    "soup": { title: "Soup", icon: Soup },
    "tandoori-item": { title: "Tandoori Items", icon: Drumstick },
    "momos": { title: "Momos", icon: Drumstick },
    "burgers": { title: "Burgers", icon: Pizza },
    "rolls": { title: "Rolls", icon: Utensils },
    "tandoori-khajana": { title: "Tandoori Khajana", icon: Drumstick },
    "rice": { title: "Rice", icon: Utensils },
    "noodles": { title: "Noodles", icon: Utensils },
    "pasta": { title: "Pasta", icon: Utensils },
    "raita": { title: "Raita", icon: Utensils },
};

const shopCategoryConfig = {
    "electronics": { title: "Electronics", icon: Laptop },
    "groceries": { title: "Groceries", icon: ShoppingBag },
    "clothing": { title: "Clothing", icon: Utensils }, // Placeholder, can be changed
    "books": { title: "Books", icon: BookOpen },
    "home-appliances": { title: "Home Appliances", icon: Utensils },
    "toys-games": { title: "Toys & Games", icon: ToyBrick },
    "beauty-personal-care": { title: "Beauty & Personal Care", icon: Utensils },
    "sports-outdoors": { title: "Sports & Outdoors", icon: Utensils },
};

const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';
const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const isStoreBusinessType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'shop' || normalized === 'store';
};


// --- COMPONENTS (Single File) ---

const MenuItem = ({
    item,
    index,
    onDelete,
    onEdit,
    onToggleAvailability,
    onSelectItem,
    isSelected,
    canEdit = true,
    canDelete = true,
    canToggleAvailability = true,
    showStockControls = false,
    stockInfo = null,
    stockDraftValue = '',
    onStockDraftChange = null,
    onSetStock = null,
    onAdjustStock = null,
    isStockUpdating = false,
}) => {
    // Determine the price to display. Find the 'Full' price, or the first price if 'Full' doesn't exist.
    const displayPortion = (item.portions && item.portions.length > 0)
        ? item.portions.find(p => p.name.toLowerCase() === 'full') || item.portions[0]
        : null;
    const stockOnHand = toFiniteNumber(stockInfo?.stockOnHand, 0);
    const reserved = toFiniteNumber(stockInfo?.reserved, 0);
    const available = toFiniteNumber(stockInfo?.available, stockOnHand - reserved);

    return (
        <Draggable draggableId={item.id} index={index}>
            {(provided, snapshot) => (
                <motion.div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    className={`flex flex-col md:grid md:grid-cols-12 md:items-center p-3 rounded-lg gap-3 bg-card m-2 border ${isSelected ? "border-primary bg-primary/10" : "border-border"} ${snapshot.isDragging ? 'bg-primary/10 shadow-lg ring-2 ring-primary' : ''}`}
                    whileHover={{
                        backgroundColor: "hsl(var(--primary) / 0.1)"
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                    <div className="flex items-center md:col-span-1 text-center md:text-left">
                        <div {...provided.dragHandleProps} className="p-2 cursor-grab text-muted-foreground hover:text-white">
                            <GripVertical size={20} />
                        </div>
                    </div>
                    <div className="flex md:col-span-4 items-center gap-4">
                        <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => onSelectItem(item.id)}
                            aria-label={`Select ${item.name}`}
                            className="mr-2"
                        />
                        <div className="relative w-16 h-16 rounded-md overflow-hidden bg-muted flex-shrink-0">
                            {item.imageUrl ? (
                                <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon /></div>
                            )}
                        </div>
                        <div className="flex-grow text-left">
                            <p className="font-semibold text-foreground">{item.name}</p>
                            {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                        </div>
                    </div>
                    <div className="md:col-span-2 font-medium flex justify-around items-center text-foreground">
                        <span className="text-center">
                            {displayPortion ? `₹${displayPortion.price}` : 'N/A'}
                            {item.portions && item.portions.length > 1 && <span className="text-xs text-muted-foreground"> ({item.portions.length} sizes)</span>}
                        </span>
                    </div>
                    <div className="md:col-span-2 flex justify-center items-center">
                        <div className="flex items-center justify-between w-full md:w-auto md:justify-center py-2 md:py-0">
                            <span className="text-xs text-muted-foreground md:hidden mr-2">Available</span>
                            <Switch
                                checked={item.isAvailable}
                                onCheckedChange={canToggleAvailability ? () => onToggleAvailability(item.id, !item.isAvailable) : undefined}
                                disabled={!canToggleAvailability}
                                aria-label="Toggle Availability"
                                className={!canToggleAvailability ? 'opacity-50 cursor-not-allowed' : ''}
                            />
                        </div>
                    </div>
                    <div className="md:col-span-2 flex justify-center gap-2 pt-2 border-t border-border md:border-t-0 md:pt-0">
                        {canEdit && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onEdit(item)}>
                                <Edit size={16} />
                            </Button>
                        )}
                        {canDelete && (
                            <Button variant="ghost" size="icon" className="text-destructive h-8 w-8 hover:bg-destructive/10 hover:text-destructive" onClick={() => onDelete(item.id)}>
                                <Trash2 size={16} />
                            </Button>
                        )}
                        {!canEdit && !canDelete && (
                            <span className="text-xs text-muted-foreground italic">View Only</span>
                        )}
                    </div>
                    {showStockControls && (
                        <div className="md:col-span-12 border-t border-border/60 pt-3">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                <div className="text-xs text-muted-foreground">
                                    Stock: <span className="text-foreground font-semibold">{stockOnHand}</span>
                                    {' '} | Reserved: <span className="text-foreground font-semibold">{reserved}</span>
                                    {' '} | Sellable: <span className="text-foreground font-semibold">{available}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8"
                                        disabled={!canEdit || isStockUpdating}
                                        onClick={() => onAdjustStock?.(item.id, -1)}
                                    >
                                        -1
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8"
                                        disabled={!canEdit || isStockUpdating}
                                        onClick={() => onAdjustStock?.(item.id, 1)}
                                    >
                                        +1
                                    </Button>
                                    <input
                                        type="number"
                                        min="0"
                                        value={stockDraftValue}
                                        onChange={(event) => onStockDraftChange?.(item.id, event.target.value)}
                                        className="h-8 w-20 rounded-md border border-border bg-input px-2 text-right text-sm"
                                        disabled={!canEdit || isStockUpdating}
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="h-8"
                                        disabled={!canEdit || isStockUpdating}
                                        onClick={() => onSetStock?.(item.id)}
                                    >
                                        {isStockUpdating ? 'Saving...' : 'Set Stock'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}
        </Draggable>
    );
};



const MenuCategory = ({
    categoryId,
    title,
    icon,
    items,
    onDeleteItem,
    onEditItem,
    onToggleAvailability,
    setMenu,
    open,
    setOpen,
    selectedItems,
    setSelectedItems,
    canEdit = true,
    canDelete = true,
    canToggleAvailability = true,
    showStockControls = false,
    getStockInfo = null,
    getStockDraftValue = null,
    onStockDraftChange = null,
    onSetStock = null,
    onAdjustStock = null,
    stockUpdatingItemId = null,
    isStoreBusiness = false,
    categoryImageUrl = '',
    onUploadCategoryImage = null,
    isCategoryImageSaving = false,
}) => {
    const Icon = icon;
    const isExpanded = open === categoryId;

    const handleSelectAll = (checked) => {
        const itemIdsInCategory = items.map(item => item.id);
        if (checked) {
            setSelectedItems(prev => [...new Set([...prev, ...itemIdsInCategory])]);
        } else {
            setSelectedItems(prev => prev.filter(id => !itemIdsInCategory.includes(id)));
        }
    };

    const isAllSelected = items.length > 0 && items.every(item => selectedItems.includes(item.id));
    const isPartiallySelected = items.some(item => selectedItems.includes(item.id)) && !isAllSelected;

    const handleDragEnd = (result) => {
        const { source, destination } = result;
        if (!destination || source.droppableId !== destination.droppableId) return;

        const newItems = Array.from(items);
        const [movedItem] = newItems.splice(source.index, 1);
        newItems.splice(destination.index, 0, movedItem);

        // Here you would ideally make an API call to save the new order
        console.log("New order for", categoryId, newItems.map(i => i.id));

        setMenu(prevMenu => ({
            ...prevMenu,
            [categoryId]: newItems
        }));
    };

    return (
        <motion.div
            layout
            className="bg-card border border-border rounded-xl overflow-hidden"
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
            <div className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50 transition-colors">
                <button
                    type="button"
                    className="flex items-center justify-between flex-1 min-w-0"
                    onClick={() => setOpen(isExpanded ? null : categoryId)}
                >
                    <div className="flex items-center gap-3 min-w-0">
                        {isStoreBusiness && categoryImageUrl ? (
                            <div className="relative h-12 w-12 rounded-lg overflow-hidden border border-border bg-muted shrink-0">
                                <Image src={categoryImageUrl} alt={title} layout="fill" objectFit="cover" />
                            </div>
                        ) : (
                            <div className="bg-primary/10 p-3 rounded-full shrink-0">
                                <Icon className="h-6 w-6 text-primary" />
                            </div>
                        )}
                        <h3 className="text-lg font-semibold text-foreground truncate">{title}</h3>
                        <span className="text-sm text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded-md shrink-0">({items.length})</span>
                    </div>
                    <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
                        <ChevronDown size={24} className="text-foreground" />
                    </motion.div>
                </button>
                {isStoreBusiness && canEdit && (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={isCategoryImageSaving}
                        onClick={(event) => {
                            event.stopPropagation();
                            onUploadCategoryImage?.(categoryId, title);
                        }}
                    >
                        {isCategoryImageSaving ? 'Uploading...' : 'Upload Image'}
                    </Button>
                )}
            </div>
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="overflow-hidden"
                    >
                        <div className="hidden md:grid grid-cols-12 items-center px-3 py-2 text-sm font-semibold text-muted-foreground bg-background">
                            <div className="col-span-1"></div>
                            <div className="col-span-4 flex items-center">
                                <Checkbox
                                    checked={isAllSelected}
                                    onCheckedChange={handleSelectAll}
                                    data-state={isPartiallySelected ? "indeterminate" : (isAllSelected ? "checked" : "unchecked")}
                                    aria-label="Select all items in this category"
                                    className="mr-4"
                                />
                                Item
                            </div>
                            <div className="col-span-2 text-center">Base Price</div>
                            <div className="col-span-2 text-center">Available</div>
                            <div className="col-span-2 text-center pr-4">Actions</div>
                        </div>
                        <DragDropContext onDragEnd={handleDragEnd}>
                            <Droppable droppableId={categoryId}>
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        className={`min-h-[60px] max-h-[calc(100vh-280px)] overflow-y-auto transition-colors ${snapshot.isDraggingOver ? 'bg-primary/5' : ''}`}
                                    >
                                        {items.map((item, index) => (
                                            <MenuItem
                                                key={item.id}
                                                item={item}
                                                index={index}
                                                onDelete={() => onDeleteItem(item.id)}
                                                onEdit={onEditItem}
                                                onToggleAvailability={onToggleAvailability}
                                                onSelectItem={() => setSelectedItems(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])}
                                                isSelected={selectedItems.includes(item.id)}
                                                canEdit={canEdit}
                                                canDelete={canDelete}
                                                canToggleAvailability={canToggleAvailability}
                                                showStockControls={showStockControls}
                                                stockInfo={getStockInfo ? getStockInfo(item.id) : null}
                                                stockDraftValue={getStockDraftValue ? getStockDraftValue(item.id) : ''}
                                                onStockDraftChange={onStockDraftChange}
                                                onSetStock={onSetStock}
                                                onAdjustStock={onAdjustStock}
                                                isStockUpdating={stockUpdatingItemId === item.id}
                                            />
                                        ))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        </DragDropContext>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};




const AddItemModal = ({ isOpen, setIsOpen, onSave, editingItem, allCategories, showInfoDialog, businessType = 'restaurant' }) => {
    const [item, setItem] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [newCategory, setNewCategory] = useState('');
    const [showNewCategory, setShowNewCategory] = useState(false);
    const fileInputRef = useRef(null);
    const [pricingType, setPricingType] = useState('portions');
    const isShop = isStoreBusinessType(businessType);

    const sortedCategories = useMemo(() => {
        return Object.entries(allCategories)
            .map(([id, config]) => ({ id, title: config?.title }))
            .sort((a, b) => {
                if (!a.title) return 1;
                if (!b.title) return -1;
                return a.title.localeCompare(b.title);
            });
    }, [allCategories]);


    useEffect(() => {
        if (isOpen) {
            setIsSaving(false);
            setNewCategory('');
            setShowNewCategory(false);
            if (editingItem) {
                if (isShop) {
                    setPricingType('single');
                } else {
                    const hasMultiplePortions = editingItem.portions && editingItem.portions.length > 1;
                    const hasDifferentPortionName = editingItem.portions && editingItem.portions.length === 1 && editingItem.portions[0].name.toLowerCase() !== 'full';
                    if (hasMultiplePortions || hasDifferentPortionName) {
                        setPricingType('portions');
                    } else {
                        setPricingType('single');
                    }
                }

                setItem({
                    ...editingItem,
                    tags: Array.isArray(editingItem.tags) ? editingItem.tags.join(', ') : '',
                    brand: String(editingItem.brand || '').trim(),
                    productType: String(editingItem.productType || editingItem.type || '').trim(),
                    addOnGroups: isShop ? [] : (editingItem.addOnGroups || []),
                });
            } else {
                setPricingType(isShop ? 'single' : 'portions');
                setItem({
                    name: "",
                    description: "",
                    portions: [{ name: 'Full', price: '' }],
                    categoryId: sortedCategories[0]?.id || (isShop ? "electronics" : "starters"),
                    isVeg: true,
                    isAvailable: true,
                    imageUrl: "",
                    tags: "",
                    brand: "",
                    productType: "",
                    addOnGroups: isShop ? [] : [],
                });
            }
        } else {
            setItem(null);
        }
    }, [editingItem, isOpen, isShop, sortedCategories]);

    const handleCategoryChange = (e) => {
        const value = e.target.value;
        if (value === 'add_new') {
            setShowNewCategory(true);
            handleChange('categoryId', value);
        } else {
            setShowNewCategory(false);
            setNewCategory('');
            handleChange('categoryId', value);
        }
    };

    const handleChange = (field, value) => {
        setItem(prev => ({ ...prev, [field]: value }));
    };

    const handlePortionChange = (index, field, value) => {
        const newPortions = [...item.portions];
        newPortions[index][field] = value;
        setItem(prev => ({ ...prev, portions: newPortions }));
    };

    const handleBasePriceChange = (value) => {
        setItem(prev => ({ ...prev, portions: [{ name: 'Full', price: value }] }));
    };


    const addPortion = () => {
        setItem(prev => ({ ...prev, portions: [...prev.portions, { name: '', price: '' }] }));
    };

    const removePortion = (index) => {
        if (item.portions.length > 1) {
            const newPortions = item.portions.filter((_, i) => i !== index);
            setItem(prev => ({ ...prev, portions: newPortions }));
        }
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                // Compress image before uploading
                const compressionOptions = {
                    maxSizeMB: 1, // Max 1MB
                    maxWidthOrHeight: 2048, // Max dimension
                    useWebWorker: true,
                    fileType: 'image/jpeg' // Convert to JPEG
                };

                const compressedFile = await imageCompression(file, compressionOptions);
                console.log(`Original menu item image size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
                console.log(`Compressed menu item image size: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);

                const uid = auth.currentUser?.uid;
                if (!uid) throw new Error("User not authenticated");

                const timestamp = Date.now();
                const safeName = compressedFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
                const path = `menu-items/${uid}/${timestamp}-${safeName}`;
                const fileRef = storageRef(storage, path);
                const snapshot = await uploadBytes(fileRef, compressedFile, {
                    contentType: compressedFile.type || 'image/jpeg'
                });
                const downloadURL = await getDownloadURL(snapshot.ref);
                handleChange('imageUrl', downloadURL);
            } catch (error) {
                console.error('Menu item image compression failed:', error);
                try {
                    const uid = auth.currentUser?.uid;
                    if (!uid) throw new Error("User not authenticated");
                    const timestamp = Date.now();
                    const safeName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
                    const path = `menu-items/${uid}/${timestamp}-${safeName}`;
                    const fileRef = storageRef(storage, path);
                    const snapshot = await uploadBytes(fileRef, file, {
                        contentType: file.type || 'image/jpeg'
                    });
                    const downloadURL = await getDownloadURL(snapshot.ref);
                    handleChange('imageUrl', downloadURL);
                } catch (uploadError) {
                    console.error('Menu item image upload failed:', uploadError);
                    handleChange('imageUrl', '');
                    showInfoDialog({
                        isOpen: true,
                        title: 'Upload Failed',
                        message: `Could not upload image: ${uploadError.message}. Please try again.`
                    });
                }
            }
        }
    };
    // --- Add-on Group Handlers ---
    const addAddOnGroup = () => {
        setItem(prev => ({ ...prev, addOnGroups: [...prev.addOnGroups, { title: '', type: 'radio', required: false, options: [{ name: '', price: '' }] }] }));
    };

    const removeAddOnGroup = (groupIndex) => {
        setItem(prev => ({ ...prev, addOnGroups: prev.addOnGroups.filter((_, i) => i !== groupIndex) }));
    };

    const handleAddOnGroupChange = (groupIndex, field, value) => {
        const newGroups = [...item.addOnGroups];
        newGroups[groupIndex][field] = value;
        setItem(prev => ({ ...prev, addOnGroups: newGroups }));
    };

    const addAddOnOption = (groupIndex) => {
        const newGroups = [...item.addOnGroups];
        newGroups[groupIndex].options.push({ name: '', price: '' });
        setItem(prev => ({ ...prev, addOnGroups: newGroups }));
    };

    const removeAddOnOption = (groupIndex, optionIndex) => {
        const newGroups = [...item.addOnGroups];
        if (newGroups[groupIndex].options.length > 1) {
            newGroups[groupIndex].options = newGroups[groupIndex].options.filter((_, i) => i !== optionIndex);
            setItem(prev => ({ ...prev, addOnGroups: newGroups }));
        }
    };

    const handleAddOnOptionChange = (groupIndex, optionIndex, field, value) => {
        const newGroups = [...item.addOnGroups];
        newGroups[groupIndex].options[optionIndex][field] = value;
        setItem(prev => ({ ...prev, addOnGroups: newGroups }));
    };


    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!item || isSaving) return;

        const finalCategoryId = showNewCategory ? newCategory.trim().toLowerCase().replace(/\s+/g, '-') : item.categoryId;
        const finalNewCategoryName = showNewCategory ? newCategory.trim() : '';

        if (showNewCategory && !finalNewCategoryName) {
            showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please enter a name for the new category." });
            return;
        }

        setIsSaving(true);
        try {
            const tagsArray = item.tags ? item.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [];
            const normalizedBrand = isShop ? String(item.brand || '').trim() : '';
            const normalizedProductType = isShop
                ? String(item.productType || item.type || '').trim()
                : '';

            let finalPortions;
            if (isShop || pricingType === 'single') {
                const basePrice = item.portions?.[0]?.price;
                if (!basePrice || isNaN(parseFloat(basePrice))) {
                    showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please enter a valid base price." });
                    setIsSaving(false);
                    return;
                }
                finalPortions = [{ name: 'Full', price: parseFloat(basePrice) }];
            } else {
                finalPortions = item.portions
                    .filter(p => p.name.trim() && p.price && !isNaN(parseFloat(p.price)))
                    .map(p => ({ name: p.name.trim(), price: parseFloat(p.price) }));
            }

            const finalAddOnGroups = isShop
                ? []
                : item.addOnGroups
                    .filter(g => g.title.trim() && g.options.some(opt => opt.name.trim() && opt.price))
                    .map(g => ({
                        ...g,
                        options: g.options
                            .filter(opt => opt.name.trim() && opt.price)
                            .map(opt => ({ name: opt.name.trim(), price: parseFloat(opt.price) }))
                    }));

            if (finalPortions.length === 0) {
                showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please add at least one valid portion with a name and price." });
                setIsSaving(false);
                return;
            }

            const newItemData = {
                id: editingItem ? item.id : undefined,
                name: item.name,
                description: item.description,
                portions: finalPortions,
                isVeg: isShop ? true : item.isVeg,
                isAvailable: item.isAvailable,
                imageUrl: item.imageUrl || `https://picsum.photos/seed/${item.name.replace(/\s/g, '')}/100/100`,
                tags: tagsArray,
                addOnGroups: finalAddOnGroups,
                ...(isShop ? {
                    brand: normalizedBrand,
                    productType: normalizedProductType,
                    type: normalizedProductType,
                } : {}),
            };


            if (!newItemData.name) {
                showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please provide an item name." });
                setIsSaving(false);
                return;
            }

            await onSave(newItemData, finalCategoryId, finalNewCategoryName, !!editingItem);
            setIsOpen(false);
        } catch (error) {
            // Error alert is handled in the parent `handleSaveItem`
        } finally {
            setIsSaving(false);
        }
    };

    if (!item) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-4xl bg-card border-border text-foreground">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{editingItem ? (isShop ? 'Edit Product' : 'Edit Item') : (isShop ? 'Add New Product' : 'Add New Item')}</DialogTitle>
                        <DialogDescription>
                            {editingItem ? 'Update the details for this entry.' : "Fill in the details and click save when you're done."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid md:grid-cols-2 gap-x-8 gap-y-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
                        {/* Left Column: Basic Details */}
                        <div className="space-y-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="name" className="text-right">Name</Label>
                                <input id="name" value={item.name} onChange={e => handleChange('name', e.target.value)} required placeholder={isShop ? "e.g., Dove Soap 100g" : "e.g., Veg Pulao"} className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="description" className="text-right">{isShop ? 'Details' : 'Description'}</Label>
                                <input id="description" value={item.description} onChange={e => handleChange('description', e.target.value)} placeholder={isShop ? "e.g., Brand/Size/Color" : "e.g., 10 Pcs."} className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                            </div>
                            {isShop && (
                                <>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="brand" className="text-right">Brand</Label>
                                        <input
                                            id="brand"
                                            value={item.brand || ''}
                                            onChange={e => handleChange('brand', e.target.value)}
                                            placeholder="e.g., Dove"
                                            className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="productType" className="text-right">Type</Label>
                                        <input
                                            id="productType"
                                            value={item.productType || ''}
                                            onChange={e => handleChange('productType', e.target.value)}
                                            placeholder="e.g., Soap, Shampoo, Biscuit"
                                            className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        />
                                    </div>
                                </>
                            )}
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="category" className="text-right">Category</Label>
                                <select id="category" value={item.categoryId} onChange={handleCategoryChange} className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70">
                                    {sortedCategories.map(({ id, title }) => (
                                        <option key={id} value={id}>{title}</option>
                                    ))}
                                    <option value="add_new" className="font-bold text-primary">+ Add New Category...</option>
                                </select>
                            </div>
                            {showNewCategory && (
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="newCategory" className="text-right">New Category</Label>
                                    <input id="newCategory" value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder={isShop ? "e.g., Personal Care" : "e.g., Biryani Special"} className="col-span-3 p-2 border rounded-md bg-input border-border" />
                                </div>
                            )}
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="tags" className="text-right">{isShop ? 'Keywords' : 'Tags'}</Label>
                                <input id="tags" value={item.tags} onChange={e => handleChange('tags', e.target.value)} placeholder={isShop ? "e.g., Bestseller, Fast Moving" : "e.g., Spicy, Chef's Special"} className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">Image</Label>
                                <div className="col-span-3 flex items-center gap-4">
                                    <div className="relative w-20 h-20 rounded-md border-2 border-dashed border-border flex items-center justify-center bg-muted overflow-hidden">
                                        {item.imageUrl ? (
                                            <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" />
                                        ) : (
                                            <ImageIcon size={24} className="text-muted-foreground" />
                                        )}
                                    </div>
                                    <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                                        <Upload size={16} className="mr-2" />Upload
                                    </Button>
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-4 pt-4">
                                {!isShop && (
                                    <div className="flex items-center space-x-2">
                                        <Switch id="is-veg" checked={item.isVeg} onCheckedChange={checked => handleChange('isVeg', checked)} />
                                        <Label htmlFor="is-veg">Vegetarian</Label>
                                    </div>
                                )}
                                <div className="flex items-center space-x-2">
                                    <Switch id="is-available" checked={item.isAvailable} onCheckedChange={checked => handleChange('isAvailable', checked)} />
                                    <Label htmlFor="is-available">Available</Label>
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Portions & Add-ons */}
                        <div className="space-y-4">
                            <div>
                                <Label>Pricing</Label>
                                {!isShop && (
                                    <div className="flex items-center gap-2 mt-2 bg-muted p-1 rounded-lg">
                                        <Button type="button" onClick={() => setPricingType('single')} variant={pricingType === 'single' ? 'default' : 'ghost'} className={cn("flex-1", pricingType === 'single' && 'bg-background text-foreground shadow-sm')}>Single Price</Button>
                                        <Button type="button" onClick={() => setPricingType('portions')} variant={pricingType === 'portions' ? 'default' : 'ghost'} className={cn("flex-1", pricingType === 'portions' && 'bg-background text-foreground shadow-sm')}>Variable Portions</Button>
                                    </div>
                                )}
                                <div className="mt-3 space-y-3">
                                    {(isShop || pricingType === 'single') ? (
                                        <div className="flex items-center gap-2">
                                            <Label className="w-24">{isShop ? 'Selling Price' : 'Base Price'}</Label>
                                            <IndianRupee className="text-muted-foreground" size={16} />
                                            <input type="number" value={item.portions?.[0]?.price || ''} onChange={(e) => handleBasePriceChange(e.target.value)} placeholder="e.g., 150" className="flex-1 p-2 border rounded-md bg-input border-border" required />
                                        </div>
                                    ) : (
                                        <>
                                            {item.portions.map((portion, index) => (
                                                <div key={index} className="flex items-center gap-2">
                                                    <input value={portion.name} onChange={(e) => handlePortionChange(index, 'name', e.target.value)} placeholder="e.g., Half" className="flex-1 p-2 border rounded-md bg-input border-border" required />
                                                    <IndianRupee className="text-muted-foreground" size={16} />
                                                    <input type="number" value={portion.price} onChange={(e) => handlePortionChange(index, 'price', e.target.value)} placeholder="Price" className="w-24 p-2 border rounded-md bg-input border-border" required />
                                                    <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removePortion(index)} disabled={item.portions.length <= 1}>
                                                        <Trash2 size={16} />
                                                    </Button>
                                                </div>
                                            ))}
                                            <Button type="button" variant="outline" size="sm" onClick={addPortion}>
                                                <PlusCircle size={16} className="mr-2" /> Add Portion
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                            {!isShop && <div className="border-t border-border pt-4">
                                <Label>Add-on Groups (Optional)</Label>
                                <div className="mt-2 space-y-4">
                                    {item.addOnGroups.map((group, groupIndex) => (
                                        <div key={groupIndex} className="p-3 bg-muted/50 border border-border rounded-lg space-y-3">
                                            <div className="flex items-center gap-2">
                                                <input value={group.title} onChange={(e) => handleAddOnGroupChange(groupIndex, 'title', e.target.value)} placeholder="Group Title (e.g., Breads)" className="flex-1 p-2 border rounded-md bg-input border-border text-foreground font-semibold" />
                                                <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeAddOnGroup(groupIndex)}><Trash2 size={16} /></Button>
                                            </div>
                                            {group.options.map((opt, optIndex) => (
                                                <div key={optIndex} className="flex items-center gap-2">
                                                    <input value={opt.name} onChange={(e) => handleAddOnOptionChange(groupIndex, optIndex, 'name', e.target.value)} placeholder="Option name" className="flex-1 p-2 border rounded-md bg-input border-border" />
                                                    <input type="number" value={opt.price} onChange={(e) => handleAddOnOptionChange(groupIndex, optIndex, 'price', e.target.value)} placeholder="Price" className="w-24 p-2 border rounded-md bg-input border-border" />
                                                    <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeAddOnOption(groupIndex, optIndex)} disabled={group.options.length <= 1}><Trash2 size={16} /></Button>
                                                </div>
                                            ))}
                                            <Button type="button" variant="outline" size="sm" onClick={() => addAddOnOption(groupIndex)}>
                                                <PlusCircle size={16} className="mr-2" /> Add Option
                                            </Button>
                                        </div>
                                    ))}
                                    <Button type="button" variant="outline" onClick={addAddOnGroup}>
                                        <PlusCircle size={16} className="mr-2" /> Add Add-on Group
                                    </Button>
                                </div>
                            </div>}
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={isSaving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                            {isSaving ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                            ) : (
                                editingItem ? 'Save Changes' : 'Save Item'
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const BulkAddModal = ({ isOpen, setIsOpen, onSave, businessType, showInfoDialog }) => {
    const [jsonText, setJsonText] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [copySuccess, setCopySuccess] = useState('');

    const isShop = isStoreBusinessType(businessType);
    const placeholderText = isShop ? '[PASTE YOUR PRODUCT LIST HERE]' : '[PASTE YOUR MENU TEXT HERE]';
    const instructionsText = isShop ? 'your product list' : 'your menu text';
    const aiPrompt = isShop
        ? `You are a retail catalog data extractor for a store. Convert the following product list/catalog text (or text from the provided image) into a clean JSON array for bulk store upload with category grouping.

Each object must strictly follow this format:
{
  "name": "string (Product name, required)",
  "description": "string (Optional details like brand, pack size, variant)",
  "brand": "string (Optional brand, e.g., 'Dove')",
  "productType": "string (Optional product type, e.g., 'Soap', 'Biscuit')",
  "imageUrl": "string (Optional product image URL)",
  "categoryId": "string (Lowercase, dash-separated category slug, e.g., 'beauty-personal-care')",
  "categoryTitle": "string (Optional display name, e.g., 'Beauty personal care')",
  "categoryImageUrl": "string (Optional category card image URL for storefront categories)",
  "superCategoryId": "string (Optional group slug, e.g., 'grocery-kitchen', 'snacks-drinks')",
  "superCategoryTitle": "string (Optional group title, e.g., 'Grocery & Kitchen')",
  "portions": [
    { "name": "Full", "price": "number (Selling price in INR)" }
  ],
  "tags": ["string", "... (Optional tags like 'Bestseller', 'Fast Moving', 'Daily Use')"],
  "isAvailable": "boolean (Optional, default true)"
}

Important Rules:
- Output ONLY a valid JSON array. No markdown, no explanation, no extra text.
- Keep exactly ONE entry in "portions", and its "name" must be "Full".
- Do NOT include restaurant-only fields like "isVeg" or "addOnGroups".
- If category is unclear, use "general".
- Keep price numeric only (no currency symbols, commas, or text).
- Use consistent "brand" and "productType" values for similar products.
- If product name appears multiple times, keep the best/most complete entry only.
- Use same superCategoryId and superCategoryTitle for related categories (for grouped layout).

Here is the text:
---
${placeholderText}
---`
        : `You are an expert data extractor. Convert the following restaurant menu text (or content from the provided image) into a structured JSON array. Each object in the array must strictly follow this format:
{
  "name": "string (Dish name)",
  "description": "string (Optional item description)",
  "imageUrl": "string (Optional URL to the item image)",
  "categoryId": "string (Lowercase, dash-separated, e.g., 'main-course')",
  "isVeg": "boolean (true for vegetarian, false for non-vegetarian, default to true if unsure)",
  "portions": [
    { "name": "string (e.g., 'Full', 'Half', 'Regular')", "price": "number" }
  ],
  "tags": ["string", "... (Optional array of tags like 'Bestseller', 'Spicy')"],
  "addOnGroups": [
    {
      "title": "string (e.g., 'Choose your bread')",
      "options": [
        { "name": "string (e.g., 'Tandoori Roti')", "price": "number" }
      ]
    }
  ]
}

Important Rules:
- If an item has only one price, create a single entry in the 'portions' array with the name "Full".
- If a category is not obvious, use a sensible default like 'main-course'.
- The final output must be ONLY the JSON array, with no extra text or explanations.

Here is the text:
---
${placeholderText}
---`;

    const handleCopy = () => {
        navigator.clipboard.writeText(aiPrompt).then(() => {
            setCopySuccess('Prompt Copied!');
            setTimeout(() => setCopySuccess(''), 2000);
        }, () => {
            setCopySuccess('Failed to copy!');
            setTimeout(() => setCopySuccess(''), 2000);
        });
    };

    const handleSubmit = async () => {
        let items;
        try {
            items = JSON.parse(jsonText);
            if (!Array.isArray(items)) throw new Error("JSON data must be an array.");
        } catch (error) {
            showInfoDialog({ isOpen: true, title: 'Input Error', message: `Invalid JSON format: ${error.message}` });
            return;
        }

        setIsSaving(true);
        try {
            await onSave(items);
            setJsonText('');
            setIsOpen(false);
        } catch (error) {
            // alert is handled by the parent
        } finally {
            setIsSaving(false);
        }
    };

    return (
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-4xl bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-2xl">
                        <FileJson /> {isShop ? 'Bulk Add Products via JSON' : 'Bulk Add Items via JSON'}
                    </DialogTitle>
                    <DialogDescription>
                        {isShop
                            ? 'Quickly add multiple products by pasting a structured JSON array.'
                            : 'Quickly add multiple items by pasting a structured JSON array.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid md:grid-cols-2 gap-x-8 max-h-[70vh] overflow-y-auto pr-4">
                    <div className="space-y-4 py-4">
                        <h3 className="font-semibold text-lg">How to use:</h3>
                        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                            <li>Copy the AI prompt provided.</li>
                            <li>Go to an AI tool like ChatGPT or Gemini.</li>
                            <li>Paste the prompt, and then paste ${instructionsText} where it says \`${placeholderText}\`.</li>
                            <li>The AI will generate a JSON array. Copy the entire JSON code.</li>
                            <li>Paste the copied JSON code into the text area on this page.</li>
                            <li>Click <span className="font-medium">{isShop ? 'Upload & Save Products' : 'Upload & Save Items'}</span>.</li>
                        </ol>
                        <div className="p-4 bg-muted rounded-lg">
                            <div className="flex justify-between items-center mb-2">
                                <Label className="font-semibold">AI Prompt for JSON Generation</Label>
                                <Button size="sm" variant="ghost" onClick={handleCopy}>
                                    <Copy size={14} className="mr-2" /> {copySuccess || 'Copy'}
                                </Button>
                            </div>
                            <p className="text-xs bg-background p-3 rounded-md font-mono whitespace-pre-wrap">{aiPrompt}</p>
                        </div>
                    </div>
                    <div className="py-4">
                        <Label htmlFor="json-input" className="font-semibold text-lg">Paste JSON Here</Label>
                        <textarea
                            id="json-input"
                            value={jsonText}
                            onChange={(e) => setJsonText(e.target.value)}
                            placeholder={
                                isShop
                                    ? '[\n  {\n    "name": "Dove Soap 100g",\n    "description": "Pack of 1",\n    "brand": "Dove",\n    "productType": "Soap",\n    "categoryId": "beauty-personal-care",\n    "categoryTitle": "Beauty personal care",\n    "categoryImageUrl": "https://example.com/beauty.jpg",\n    "superCategoryId": "beauty-wellness",\n    "superCategoryTitle": "Beauty & Wellness",\n    "portions": [{ "name": "Full", "price": 55 }],\n    "tags": ["bestseller"]\n  }\n]'
                                    : '[\n  {\n    "name": "Paneer Butter Masala",\n    "categoryId": "main-course",\n    "isVeg": true,\n    "portions": [{ "name": "Full", "price": 240 }]\n  }\n]'
                            }
                            className="w-full h-96 mt-2 p-3 font-mono text-sm border rounded-md bg-input border-border focus:ring-primary focus:border-primary"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSubmit} disabled={isSaving || !jsonText} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        {isSaving ? 'Uploading...' : (isShop ? 'Upload & Save Products' : 'Upload & Save Items')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const MotionButton = motion(Button);

// --- Main Page Component ---
export default function MenuPage() {
    const [menu, setMenu] = useState({});
    const [customCategories, setCustomCategories] = useState([]);
    const [businessType, setBusinessType] = useState('restaurant');
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [openCategory, setOpenCategory] = useState(null);
    const [selectedItems, setSelectedItems] = useState([]);
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const { toast } = useToast();
    const [priceChangeDialog, setPriceChangeDialog] = useState({
        isOpen: false,
        oldPrice: 0,
        newPrice: 0,
        itemName: '',
        severity: 'warning',
        onConfirm: null
    });

    const [confirmationDialog, setConfirmationDialog] = useState({
        isOpen: false,
        title: '',
        description: '',
        variant: 'default',
        confirmText: 'Confirm',
        onConfirm: null
    });
    const [openItems, setOpenItems] = useState([]);
    const [isOpenItemsModalOpen, setIsOpenItemsModalOpen] = useState(false);
    const [newOpenItemName, setNewOpenItemName] = useState('');
    const [newOpenItemPrice, setNewOpenItemPrice] = useState('');
    const [inventoryByItemId, setInventoryByItemId] = useState({});
    const [stockDrafts, setStockDrafts] = useState({});
    const [stockSyncing, setStockSyncing] = useState(false);
    const [stockUpdatingItemId, setStockUpdatingItemId] = useState(null);
    const [categoryImageUpdatingId, setCategoryImageUpdatingId] = useState(null);
    const categoryImageInputRef = useRef(null);
    const [categoryImageTarget, setCategoryImageTarget] = useState(null); // { categoryId, categoryTitle }
    const hasHydratedFromCacheRef = useRef(false);
    const isStoreBusiness = isStoreBusinessType(businessType);

    // 🔐 RBAC: Get user role for access control
    const { user: authUser, isLoading: isUserLoading } = useUser();
    const userRole = authUser?.role || 'owner'; // Default to owner if not set

    // 🔐 RBAC: Menu access permissions
    const canEdit = userRole === 'owner' || userRole === 'manager';
    const canDelete = userRole === 'owner';
    const canAdd = userRole === 'owner' || userRole === 'manager';
    const canBulkEdit = userRole === 'owner' || userRole === 'manager';
    const canToggleAvailability = userRole === 'owner' || userRole === 'manager' || userRole === 'chef';
    const isReadOnly = !canEdit && !canDelete;

    const cacheKey = useMemo(() => {
        const scope = impersonatedOwnerId ? `imp_${impersonatedOwnerId}` : (employeeOfOwnerId ? `emp_${employeeOfOwnerId}` : 'owner_self');
        return `owner_menu_cache_v2_${scope}`;
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const buildScopedUrl = useCallback((endpoint) => {
        const url = new URL(endpoint, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
        }
        return url.toString();
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const handleApiCall = useCallback(async (endpoint, method, body) => {
        const user = auth.currentUser;
        if (!user) throw new Error("User not authenticated.");
        const idToken = await user.getIdToken();

        const res = await fetch(buildScopedUrl(endpoint), {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `API call failed: ${method} ${endpoint}`);
        return data;
    }, [buildScopedUrl]);

    const readCachedPayload = useCallback(() => {
        try {
            const raw = localStorage.getItem(cacheKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed?.data ? parsed : null;
        } catch {
            return null;
        }
    }, [cacheKey]);

    const writeCachedPayload = useCallback((data = {}) => {
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                ts: Date.now(),
                data,
            }));
        } catch {
            // Ignore storage write issues silently (private mode/storage quota)
        }
    }, [cacheKey]);

    const applyMenuPayload = useCallback((data) => {
        setMenu(data.menu || {});
        setCustomCategories(data.customCategories || []);
        setBusinessType(data.businessType || 'restaurant');
        if (data.menu && Object.keys(data.menu).length > 0) {
            setOpenCategory(prev => prev || Object.keys(data.menu)[0]);
        }
    }, []);

    const fetchMenu = useCallback(async ({ background = false, includeOpenItems = false } = {}) => {
        if (!background) {
            setLoading(true);
        }
        try {
            const user = auth.currentUser;
            if (!user) { setLoading(false); return; }
            const idToken = await user.getIdToken();
            const headers = { 'Authorization': `Bearer ${idToken}` };
            const versionUrl = buildScopedUrl('/api/owner/menu?versionOnly=1');
            const menuUrl = buildScopedUrl(`/api/owner/menu?dashboard=1${includeOpenItems ? '&includeOpenItems=1' : ''}`);

            const cached = readCachedPayload();
            try {
                const versionRes = await fetch(versionUrl, { headers });
                if (versionRes.ok && cached?.data?.menu) {
                    const versionData = await versionRes.json();
                    const latestVersion = Number(versionData?.menuVersion || 0);
                    const cachedVersion = Number(cached?.data?.menuVersion ?? -1);
                    if (cachedVersion === latestVersion) {
                        applyMenuPayload(cached.data);
                        if (Array.isArray(cached.data.openItems)) {
                            setOpenItems(cached.data.openItems);
                        }
                        if (!background) setLoading(false);
                        return;
                    }
                }
            } catch {
                // Version check failure should not block full fetch fallback.
            }

            const menuRes = await fetch(menuUrl, { headers });

            const data = await menuRes.json();
            if (!menuRes.ok) {
                throw new Error(data.message || 'Failed to fetch menu.');
            }
            applyMenuPayload(data);

            let nextOpenItems = null;
            if (includeOpenItems && Array.isArray(data.openItems)) {
                nextOpenItems = data.openItems;
                setOpenItems(nextOpenItems);
            }

            const preservedOpenItems = Array.isArray(cached?.data?.openItems) ? cached.data.openItems : [];
            writeCachedPayload({
                menu: data.menu || {},
                customCategories: data.customCategories || [],
                businessType: data.businessType || 'restaurant',
                openItems: nextOpenItems ?? preservedOpenItems,
                menuVersion: Number(data?.menuVersion || 0),
            });
        } catch (error) {
            console.error("Error fetching menu:", error);
            setInfoDialog({ isOpen: true, title: "Error", message: "Could not fetch menu. " + error.message });
        } finally {
            if (!background) {
                setLoading(false);
            }
        }
    }, [applyMenuPayload, buildScopedUrl, readCachedPayload, writeCachedPayload]);

    const handleUploadCategoryImageClick = useCallback((categoryId, categoryTitle) => {
        if (!isStoreBusiness || !canEdit) return;
        const normalizedCategoryId = String(categoryId || '').trim().toLowerCase();
        if (!normalizedCategoryId || normalizedCategoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) return;
        setCategoryImageTarget({
            categoryId: normalizedCategoryId,
            categoryTitle: String(categoryTitle || '').trim() || normalizedCategoryId,
        });
        categoryImageInputRef.current?.click();
    }, [isStoreBusiness, canEdit]);

    const handleCategoryImageFileChange = useCallback(async (event) => {
        const file = event.target.files?.[0];
        const target = categoryImageTarget;
        event.target.value = '';
        if (!file || !target) return;

        setCategoryImageUpdatingId(target.categoryId);
        try {
            const compressionOptions = {
                maxSizeMB: 1,
                maxWidthOrHeight: 1600,
                useWebWorker: true,
                fileType: 'image/jpeg',
            };

            let fileToUpload = file;
            try {
                fileToUpload = await imageCompression(file, compressionOptions);
            } catch (compressionError) {
                console.warn('Category image compression failed, uploading original file:', compressionError);
            }

            const uid = auth.currentUser?.uid;
            if (!uid) throw new Error('User not authenticated');

            const timestamp = Date.now();
            const safeName = fileToUpload.name.replace(/[^a-zA-Z0-9.]/g, '_');
            // Reuse existing allowed storage namespace used by menu item uploads.
            const path = `menu-items/${uid}/category-${target.categoryId}-${timestamp}-${safeName}`;
            const fileRef = storageRef(storage, path);
            const snapshot = await uploadBytes(fileRef, fileToUpload, {
                contentType: fileToUpload.type || 'image/jpeg',
            });
            const downloadURL = await getDownloadURL(snapshot.ref);

            await handleApiCall('/api/owner/menu', 'PATCH', {
                updates: {
                    categoryId: target.categoryId,
                    categoryTitle: target.categoryTitle,
                    imageUrl: downloadURL,
                },
            });

            await fetchMenu({ background: true, includeOpenItems: true });
            toast({
                title: 'Saved',
                description: 'Category image uploaded successfully.',
                variant: 'default',
            });
        } catch (error) {
            setInfoDialog({
                isOpen: true,
                title: 'Upload Failed',
                message: error.message || 'Could not upload category image.',
            });
        } finally {
            setCategoryImageUpdatingId(null);
            setCategoryImageTarget(null);
        }
    }, [categoryImageTarget, handleApiCall, fetchMenu, toast]);

    useEffect(() => {
        if (hasHydratedFromCacheRef.current) return;
        hasHydratedFromCacheRef.current = true;
        const cached = readCachedPayload();
        if (!cached?.data) return;
        applyMenuPayload(cached.data);
        if (Array.isArray(cached.data.openItems)) {
            setOpenItems(cached.data.openItems);
        }
        setLoading(false);
    }, [applyMenuPayload, readCachedPayload]);

    useEffect(() => {
        if (isUserLoading) return;
        if (!auth.currentUser) {
            setLoading(false);
            return;
        }
        fetchMenu({ background: false, includeOpenItems: true });
    }, [isUserLoading, authUser?.uid, impersonatedOwnerId, employeeOfOwnerId, fetchMenu]);

    const fetchInventoryForStore = useCallback(async () => {
        if (!isStoreBusiness) {
            setInventoryByItemId({});
            setStockDrafts({});
            return;
        }

        try {
            const user = auth.currentUser;
            if (!user) return;
            const idToken = await user.getIdToken();
            const inventoryUrl = buildScopedUrl('/api/owner/inventory?limit=500');
            const res = await fetch(inventoryUrl, {
                headers: { Authorization: `Bearer ${idToken}` }
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to fetch stock.');
            }

            const items = Array.isArray(data.items) ? data.items : [];
            const nextMap = {};
            const nextDrafts = {};
            items.forEach((inventoryItem) => {
                if (!inventoryItem?.id) return;
                nextMap[inventoryItem.id] = inventoryItem;
                nextDrafts[inventoryItem.id] = String(toFiniteNumber(inventoryItem.stockOnHand, 0));
            });

            setInventoryByItemId(nextMap);
            setStockDrafts((prev) => ({ ...prev, ...nextDrafts }));
        } catch (error) {
            console.error('Failed to fetch store inventory:', error);
        }
    }, [isStoreBusiness, buildScopedUrl]);

    useEffect(() => {
        fetchInventoryForStore();
    }, [fetchInventoryForStore]);

    const importStoreItemsToStock = async () => {
        if (!isStoreBusiness) return;
        setStockSyncing(true);
        try {
            const data = await handleApiCall('/api/owner/inventory/sync-from-menu', 'POST', {});
            await fetchInventoryForStore();
            setInfoDialog({
                isOpen: true,
                title: 'Stock Ready',
                message: `${data.created || 0} items added and ${data.updated || 0} items updated in stock manager.`,
            });
        } catch (error) {
            setInfoDialog({
                isOpen: true,
                title: 'Stock Sync Failed',
                message: error.message || 'Could not import items to stock.',
            });
        } finally {
            setStockSyncing(false);
        }
    };

    const adjustStoreStock = async (itemId, qtyDelta) => {
        if (!isStoreBusiness || !itemId) return;
        if (!Number.isFinite(Number(qtyDelta)) || Number(qtyDelta) === 0) return;

        if (!inventoryByItemId[itemId]) {
            setInfoDialog({
                isOpen: true,
                title: 'Stock Not Ready',
                message: 'First click "Import Items to Stock", then update quantity.',
            });
            return;
        }

        setStockUpdatingItemId(itemId);
        try {
            const data = await handleApiCall('/api/owner/inventory/adjust', 'POST', {
                itemId,
                qtyDelta: Number(qtyDelta),
                reason: 'manual_adjustment',
            });

            const updatedItem = data?.item || {};
            setInventoryByItemId((prev) => ({
                ...prev,
                [itemId]: {
                    ...(prev[itemId] || {}),
                    stockOnHand: toFiniteNumber(updatedItem.stockOnHand, 0),
                    reserved: toFiniteNumber(updatedItem.reserved, 0),
                    available: toFiniteNumber(updatedItem.available, 0),
                },
            }));
            setStockDrafts((prev) => ({
                ...prev,
                [itemId]: String(toFiniteNumber(updatedItem.stockOnHand, 0)),
            }));
        } catch (error) {
            setInfoDialog({
                isOpen: true,
                title: 'Stock Update Failed',
                message: error.message || 'Could not update stock.',
            });
        } finally {
            setStockUpdatingItemId(null);
        }
    };

    const setStoreStockFromDraft = async (itemId) => {
        if (!isStoreBusiness || !itemId) return;
        if (!inventoryByItemId[itemId]) {
            setInfoDialog({
                isOpen: true,
                title: 'Stock Not Ready',
                message: 'First click "Import Items to Stock", then set quantity.',
            });
            return;
        }

        const rawValue = stockDrafts[itemId];
        const targetStock = Number(rawValue);
        if (!Number.isFinite(targetStock) || targetStock < 0) {
            setInfoDialog({
                isOpen: true,
                title: 'Invalid Quantity',
                message: 'Please enter a valid stock value (0 or greater).',
            });
            return;
        }

        const currentStock = toFiniteNumber(inventoryByItemId[itemId]?.stockOnHand, 0);
        const qtyDelta = targetStock - currentStock;
        if (qtyDelta === 0) return;
        await adjustStoreStock(itemId, qtyDelta);
    };

    const allCategories = useMemo(() => {
        const categories = { ...(isStoreBusiness ? shopCategoryConfig : restaurantCategoryConfig) };
        customCategories.forEach(cat => {
            const categoryId = String(cat?.id || '').trim();
            if (!categoryId || categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
                return;
            }
            const previous = categories[categoryId] || {};
            categories[categoryId] = {
                ...previous,
                title: cat.title || previous.title || categoryId.charAt(0).toUpperCase() + categoryId.slice(1).replace(/-/g, ' '),
                icon: previous.icon || Utensils,
                imageUrl: cat.imageUrl || previous.imageUrl || '',
            };
        });

        // Ensure legacy/unknown category keys (e.g. "general") from menu docs are visible in dashboard.
        Object.keys(menu || {}).forEach((categoryId) => {
            if (categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
                return;
            }
            if (!categories[categoryId]) {
                categories[categoryId] = {
                    title: categoryId.charAt(0).toUpperCase() + categoryId.slice(1).replace(/-/g, ' '),
                    icon: Utensils,
                    imageUrl: '',
                };
            }
        });

        return categories;
    }, [customCategories, isStoreBusiness, menu]);


    const handleSaveItem = async (itemData, categoryId, newCategory, isEditing) => {
        const trimmedNewCategory = (newCategory || '').trim();
        const finalCategoryId = trimmedNewCategory
            ? trimmedNewCategory.toLowerCase().replace(/\s+/g, '-')
            : String(categoryId || '').trim().toLowerCase();

        if (finalCategoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
            setInfoDialog({
                isOpen: true,
                title: 'Category Reserved',
                message: 'Open Items are reserved for manual billing only. Use the Open Items section at the end of this page.',
            });
            return;
        }

        // Internal function to perform the actual API call
        const performSave = async () => {
            try {
                const data = await handleApiCall('/api/owner/menu', 'POST', { item: itemData, categoryId, newCategory, isEditing });
                toast({
                    title: "Success",
                    description: data.message,
                    variant: "default",
                });
                await fetchMenu();
                return true;
            } catch (error) {
                console.error("Error saving item:", error);
                setInfoDialog({ isOpen: true, title: "Error", message: "Could not save item. " + error.message });
                throw error;
            }
        };

        // 🔐 RBAC: Price change validation for Managers
        if (isEditing && editingItem && userRole === 'manager') {
            const oldPrice = parseFloat(editingItem.portions?.[0]?.price || 0);
            const newPrice = parseFloat(itemData.portions?.[0]?.price || 0);

            if (oldPrice > 0 && oldPrice !== newPrice) {
                const validation = validatePriceChange(oldPrice, newPrice, userRole);

                if (!validation.allowed) {
                    if (validation.requiresConfirmation) {
                        setPriceChangeDialog({
                            isOpen: true,
                            oldPrice,
                            newPrice,
                            itemName: itemData.name,
                            severity: 'warning',
                            onConfirm: performSave
                        });
                        return; // Stop here, wait for modal
                    } else {
                        setInfoDialog({
                            isOpen: true,
                            title: 'Price Change Blocked',
                            message: validation.message
                        });
                        return; // Hard block
                    }
                }
            }
        }

        // Default: Proceed with save (for owners or if validation passed/wasn't needed)
        await performSave();
    };

    const handleBulkSave = async (items) => {
        try {
            const data = await handleApiCall('/api/owner/menu-bulk', 'POST', { items });
            toast({
                title: "Success",
                description: data.message,
                variant: "default",
            });
            await fetchMenu();
        } catch (error) {
            console.error("Error saving bulk items:", error);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save bulk items: ${error.message}` });
            throw error;
        }
    };

    const handleEditItem = (item) => {
        const categoryId = Object.keys(menu).find(key =>
            (menu[key] || []).some(i => i.id === item.id)
        );
        setEditingItem({ ...item, categoryId: categoryId || Object.keys(allCategories)[0] });
        setIsModalOpen(true);
    };

    const handleAddNewItem = () => {
        setEditingItem(null);
        setIsModalOpen(true);
    };

    const handleDeleteItem = (itemId) => {
        setConfirmationDialog({
            isOpen: true,
            title: "Delete Item",
            description: "Are you sure you want to delete this item? This action cannot be undone.",
            variant: "destructive",
            confirmText: "Delete",
            onConfirm: async () => {
                try {
                    await handleApiCall('/api/owner/menu', 'DELETE', { itemId });
                    toast({
                        title: "Success",
                        description: "Item deleted successfully!",
                        variant: "default",
                    });
                    await fetchMenu();
                } catch (error) {
                    console.error("Error deleting item:", error);
                    setInfoDialog({ isOpen: true, title: 'Error', message: "Could not delete item. " + error.message });
                }
            }
        });
    };

    const handleToggleAvailability = async (itemId, newAvailability) => {
        try {
            await handleApiCall('/api/owner/menu', 'PATCH', { updates: { id: itemId, isAvailable: newAvailability } });
            // Optimistic update
            setMenu(prevMenu => {
                const newMenuState = { ...prevMenu };
                for (const category in newMenuState) {
                    newMenuState[category] = newMenuState[category].map(item =>
                        item.id === itemId ? { ...item, isAvailable: newAvailability } : item
                    );
                }
                return newMenuState;
            });
        } catch (error) {
            console.error("Error toggling availability:", error);
            setInfoDialog({ isOpen: true, title: 'Error', message: "Could not update item availability. " + error.message });
            fetchMenu(); // Re-sync with server on error
        }
    };

    const handleBulkDelete = () => {
        setConfirmationDialog({
            isOpen: true,
            title: "Bulk Delete Items",
            description: `Are you sure you want to delete ${selectedItems.length} items? This action cannot be undone.`,
            variant: "destructive",
            confirmText: "Delete All",
            onConfirm: async () => {
                try {
                    await handleApiCall('/api/owner/menu', 'PATCH', { itemIds: selectedItems, action: 'delete' });
                    toast({
                        title: "Success",
                        description: `${selectedItems.length} items deleted successfully!`,
                        variant: "default",
                    });
                    setSelectedItems([]);
                    await fetchMenu();
                } catch (error) {
                    console.error("Error bulk deleting items:", error);
                    setInfoDialog({ isOpen: true, title: 'Error', message: "Could not delete items. " + error.message });
                }
            }
        });
    };

    const handleBulkOutOfStock = () => {
        setConfirmationDialog({
            isOpen: true,
            title: "Mark Out of Stock",
            description: `Are you sure you want to mark ${selectedItems.length} items as out of stock?`,
            variant: "default",
            confirmText: "Confirm",
            onConfirm: async () => {
                try {
                    await handleApiCall('/api/owner/menu', 'PATCH', { itemIds: selectedItems, action: 'outOfStock' });
                    toast({
                        title: "Success",
                        description: `${selectedItems.length} items marked as out of stock!`,
                        variant: "default",
                    });
                    setSelectedItems([]);
                    await fetchMenu();
                } catch (error) {
                    console.error("Error marking items out of stock:", error);
                    setInfoDialog({ isOpen: true, title: 'Error', message: "Could not update items. " + error.message });
                }
            }
        });
    };

    const handleAddOpenItem = async () => {
        const itemName = newOpenItemName.trim();
        const itemPrice = parseFloat(newOpenItemPrice);

        if (!itemName) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Please enter item name' });
            return;
        }

        if (!Number.isFinite(itemPrice) || itemPrice <= 0) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Please enter a valid price' });
            return;
        }

        try {
            const user = auth.currentUser;
            if (!user) throw new Error("User not authenticated.");
            const idToken = await user.getIdToken();

            let url = '/api/owner/open-items';
            if (impersonatedOwnerId) {
                url += `?impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`;
            } else if (employeeOfOwnerId) {
                url += `?employee_of=${encodeURIComponent(employeeOfOwnerId)}`;
            }

            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ name: itemName, price: itemPrice })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create open item');

            setOpenItems([...openItems, data.item]);
            setNewOpenItemName('');
            setNewOpenItemPrice('');
            setInfoDialog({ isOpen: true, title: 'Success', message: `${itemName} added successfully` });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        }
    };

    const handleDeleteOpenItem = (itemId) => {
        setConfirmationDialog({
            isOpen: true,
            title: "Delete Open Item",
            description: "Are you sure you want to delete this item?",
            variant: "destructive",
            confirmText: "Delete",
            onConfirm: async () => {
                try {
                    const user = auth.currentUser;
                    if (!user) throw new Error("User not authenticated.");
                    const idToken = await user.getIdToken();

                    let url = '/api/owner/open-items';
                    if (impersonatedOwnerId) {
                        url += `?impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`;
                    } else if (employeeOfOwnerId) {
                        url += `?employee_of=${encodeURIComponent(employeeOfOwnerId)}`;
                    }

                    const res = await fetch(url, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${idToken}`
                        },
                        body: JSON.stringify({ itemId })
                    });

                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to delete open item');

                    setOpenItems(openItems.filter(item => item.id !== itemId));
                    setInfoDialog({ isOpen: true, title: 'Success', message: 'Item deleted successfully' });
                } catch (error) {
                    setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
                }
            }
        });
    };

    const sortedOpenItems = useMemo(() => {
        return [...openItems].sort((a, b) =>
            String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' })
        );
    }, [openItems]);

    const pageTitle = isStoreBusiness ? 'Item Catalog' : 'Menu Management';
    const pageDescription = isStoreBusiness ? 'Organize categories, manage products, and control availability.' : 'Organize categories, reorder items, and manage availability.';
    const searchPlaceholder = isStoreBusiness ? 'Search for a product...' : 'Search for a dish...';
    const addNewText = isStoreBusiness ? 'Add New Product' : 'Add New Dish';


    if (loading) {
        return (
            <div className="p-6 text-center h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-6 bg-background text-foreground min-h-screen">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <AddItemModal
                isOpen={isModalOpen}
                setIsOpen={setIsModalOpen}
                onSave={handleSaveItem}
                editingItem={editingItem}
                allCategories={allCategories}
                showInfoDialog={setInfoDialog}
                businessType={businessType}
            />

            <BulkAddModal
                isOpen={isBulkModalOpen}
                setIsOpen={setIsBulkModalOpen}
                onSave={handleBulkSave}
                businessType={businessType}
                showInfoDialog={setInfoDialog}
            />

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">{pageTitle}</h1>
                    <p className="text-muted-foreground mt-1">{pageDescription}</p>
                    {isStoreBusiness && (
                        <div className="mt-2 text-xs text-muted-foreground">
                            Tip: Product details and stock quantity are managed on this same page.
                        </div>
                    )}
                </div>
                <div className="flex gap-2">
                    {isStoreBusiness && canEdit && (
                        <MotionButton
                            onClick={importStoreItemsToStock}
                            variant="outline"
                            disabled={stockSyncing}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <Upload size={20} className="mr-2" />
                            {stockSyncing ? 'Importing...' : 'Import Items to Stock'}
                        </MotionButton>
                    )}
                    {/* 🔐 RBAC: Only owner can bulk add via JSON */}
                    {canBulkEdit && (
                        <MotionButton
                            onClick={() => setIsBulkModalOpen(true)}
                            variant="outline"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <FileJson size={20} className="mr-2" />
                            Bulk Add via JSON
                        </MotionButton>
                    )}

                    {/* 🔐 RBAC: Owner and Manager can add new items */}
                    {canAdd && (
                        <MotionButton
                            onClick={handleAddNewItem}
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <PlusCircle size={20} className="mr-2" />
                            {addNewText}
                        </MotionButton>
                    )}

                    {/* 🔐 RBAC: Show 'View Only' for Chef/Waiter */}
                    {isReadOnly && (
                        <div className="px-4 py-2 bg-muted/30 border border-muted rounded-md text-sm text-muted-foreground flex items-center italic">
                            View Only Mode
                        </div>
                    )}
                </div>
            </div>

            {/* 🔐 RBAC: Price Change Confirmation Modal */}
            <PriceChangeConfirmationDialog
                isOpen={priceChangeDialog.isOpen}
                onClose={() => setPriceChangeDialog({ ...priceChangeDialog, isOpen: false })}
                onConfirm={() => {
                    setPriceChangeDialog({ ...priceChangeDialog, isOpen: false });
                    priceChangeDialog.onConfirm();
                }}
                oldPrice={priceChangeDialog.oldPrice}
                newPrice={priceChangeDialog.newPrice}
                itemName={priceChangeDialog.itemName}
                severity={priceChangeDialog.severity}
            />

            <ConfirmationDialog
                isOpen={confirmationDialog.isOpen}
                onClose={() => setConfirmationDialog({ ...confirmationDialog, isOpen: false })}
                onConfirm={confirmationDialog.onConfirm}
                title={confirmationDialog.title}
                description={confirmationDialog.description}
                variant={confirmationDialog.variant}
                confirmText={confirmationDialog.confirmText}
            />

            <input
                type="file"
                ref={categoryImageInputRef}
                onChange={handleCategoryImageFileChange}
                accept="image/*"
                className="hidden"
            />

            {/* Search & Bulk Actions Bar */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 p-3 bg-card border border-border rounded-xl">
                <div className="flex items-center gap-2 w-full max-w-sm">
                    <Search size={20} className="text-muted-foreground" />
                    <input placeholder={searchPlaceholder} className="w-full bg-transparent focus:outline-none placeholder-muted-foreground text-foreground" />
                </div>
            </div>

            {/* Menu Categories */}
            <div className="space-y-4 pb-24">
                {Object.keys(allCategories).sort((a, b) => {
                    const titleA = allCategories[a]?.title;
                    const titleB = allCategories[b]?.title;
                    if (!titleA) return 1;
                    if (!titleB) return -1;
                    return titleA.localeCompare(titleB);
                }).map(categoryId => {
                    if (categoryId === RESERVED_OPEN_ITEMS_CATEGORY_ID) return null;
                    const config = allCategories[categoryId];
                    const items = menu[categoryId] || [];
                    if (!config || items.length === 0 && !customCategories.some(c => c.id === categoryId)) return null;

                    return (
                        <MenuCategory
                            key={categoryId}
                            categoryId={categoryId}
                            title={config.title}
                            icon={config.icon || Utensils}
                            items={items}
                            onDeleteItem={handleDeleteItem}
                            onEditItem={handleEditItem}
                            onToggleAvailability={handleToggleAvailability}
                            setMenu={setMenu}
                            open={openCategory}
                            setOpen={setOpenCategory}
                            selectedItems={selectedItems}
                            setSelectedItems={setSelectedItems}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            canToggleAvailability={canToggleAvailability}
                            showStockControls={isStoreBusiness}
                            getStockInfo={(itemId) => inventoryByItemId[itemId] || null}
                            getStockDraftValue={(itemId) => {
                                const existing = stockDrafts[itemId];
                                if (existing !== undefined) return existing;
                                const fallbackValue = toFiniteNumber(inventoryByItemId[itemId]?.stockOnHand, 0);
                                return String(fallbackValue);
                            }}
                            onStockDraftChange={(itemId, value) => {
                                setStockDrafts((prev) => ({
                                    ...prev,
                                    [itemId]: value,
                                }));
                            }}
                            onSetStock={setStoreStockFromDraft}
                            onAdjustStock={adjustStoreStock}
                            stockUpdatingItemId={stockUpdatingItemId}
                            isStoreBusiness={isStoreBusiness}
                            categoryImageUrl={config.imageUrl || ''}
                            onUploadCategoryImage={handleUploadCategoryImageClick}
                            isCategoryImageSaving={categoryImageUpdatingId === categoryId}
                        />
                    );
                })}
            </div>

            {/* OPEN ITEMS SECTION - For Manual Billing Only */}
            {canAdd && (
                <div className="space-y-4">
                    <div className="border-t border-border pt-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-xl font-bold">Open Items (Manual Billing Only)</h2>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Items added here are only available in manual billing for walk-in customers (water bottles, disposals, etc.) - NOT in online menu
                                </p>
                            </div>
                            <Button
                                onClick={() => setIsOpenItemsModalOpen(true)}
                                className="bg-amber-600 hover:bg-amber-700 text-white"
                            >
                                <PlusCircle size={18} className="mr-2" />
                                Add Open Item
                            </Button>
                        </div>

                        {openItems.length === 0 ? (
                            <div className="p-6 bg-muted/20 rounded-lg border border-border/50 text-center text-muted-foreground">
                                <p>No open items yet. Add items for manual billing.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {sortedOpenItems.map((item) => (
                                    <motion.div
                                        key={item.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="flex items-center justify-between p-4 bg-amber-900/10 border border-amber-600/30 rounded-lg hover:bg-amber-900/15 transition-colors"
                                    >
                                        <div>
                                            <p className="font-semibold text-foreground">{item.name}</p>
                                            <p className="text-sm text-muted-foreground">₹{item.price.toFixed(2)}</p>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive hover:bg-destructive/10"
                                            onClick={() => handleDeleteOpenItem(item.id)}
                                        >
                                            <Trash2 size={16} />
                                        </Button>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Open Items Modal */}
            <Dialog open={isOpenItemsModalOpen} onOpenChange={setIsOpenItemsModalOpen}>
                <DialogContent className="bg-card border-border text-foreground max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <PlusCircle size={20} className="text-amber-600" />
                            Add Open Item
                        </DialogTitle>
                        <DialogDescription>
                            Add items not in your menu for manual billing (water, disposal, napkins, etc.)
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="open-item-name" className="text-sm font-semibold">Item Name</Label>
                            <input
                                id="open-item-name"
                                type="text"
                                placeholder="e.g., Water Bottle, Disposable Plate..."
                                value={newOpenItemName}
                                onChange={(e) => setNewOpenItemName(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-input border border-border text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="open-item-price" className="text-sm font-semibold">Price (₹)</Label>
                            <input
                                id="open-item-price"
                                type="number"
                                placeholder="0"
                                value={newOpenItemPrice}
                                onChange={(e) => setNewOpenItemPrice(e.target.value)}
                                step="0.5"
                                min="0"
                                className="w-full px-3 py-2 rounded-lg bg-input border border-border text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                            />
                        </div>
                    </div>

                    <DialogFooter className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setIsOpenItemsModalOpen(false);
                                setNewOpenItemName('');
                                setNewOpenItemPrice('');
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAddOpenItem}
                            className="bg-amber-600 hover:bg-amber-700"
                        >
                            <PlusCircle size={16} className="mr-2" />
                            Add Item
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AnimatePresence>
                {selectedItems.length > 0 && (
                    <motion.div
                        className="fixed bottom-4 left-1/2 w-[95%] md:w-auto bg-card border border-border rounded-xl shadow-2xl p-3 flex justify-between md:justify-center items-center gap-2 md:gap-4 z-50"
                        initial={{ y: 100, x: "-50%", opacity: 0 }}
                        animate={{ y: 0, x: "-50%", opacity: 1 }}
                        exit={{ y: 100, x: "-50%", opacity: 0 }}
                    >
                        <p className="text-sm font-semibold whitespace-nowrap">{selectedItems.length} <span className="hidden sm:inline">item(s) selected</span><span className="sm:hidden">selected</span></p>

                        <div className="flex items-center gap-2">
                            {/* 🔐 RBAC: Owner, Manager, Chef can bulk mark out of stock */}
                            {canToggleAvailability && (
                                <Button variant="outline" size="sm" onClick={handleBulkOutOfStock} className="whitespace-nowrap h-8 px-2">
                                    <XCircle size={16} className="mr-2" /> <span className="hidden sm:inline">Mark Out of Stock</span><span className="sm:hidden">Out of Stock</span>
                                </Button>
                            )}

                            {/* 🔐 RBAC: Only Owner can bulk delete */}
                            {canBulkEdit && (
                                <Button variant="destructive" size="sm" onClick={handleBulkDelete} className="h-8 px-2">
                                    <Trash2 size={16} className="md:mr-2" /> <span className="hidden md:inline">Delete Selected</span>
                                </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedItems([])}>
                                <X size={16} />
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
}
