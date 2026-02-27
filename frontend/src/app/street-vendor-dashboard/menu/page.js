'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, PlusCircle, Trash2, IndianRupee, Loader2, Camera, FileJson, Edit, Upload, X, Plus, Image as ImageIcon, Utensils, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useUser, useMemoFirebase, useCollection } from '@/firebase';
import { db, auth, storage } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, getDocs, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import InfoDialog from '@/components/InfoDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import imageCompression from 'browser-image-compression';


const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", confirmVariant = "destructive" }) => (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="bg-card border-border text-foreground">
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                    {message}
                </DialogDescription>
            </DialogHeader>
            <DialogFooter>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant={confirmVariant} onClick={onConfirm}>{confirmText}</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);

const AiScanModal = ({ isOpen, onClose, onScan }) => {
    const [file, setFile] = useState(null);
    const fileInputRef = useRef(null);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    const handleScanClick = () => {
        if (file) {
            onScan(file);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-2xl"><Camera /> Scan Menu with AI</DialogTitle>
                    <DialogDescription>Take a clear picture of your physical menu, upload it, and let our AI digitize it for you instantly.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                    <Button variant="outline" className="w-full h-24 border-dashed" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="mr-2" /> {file ? `Selected: ${file.name}` : 'Click to Upload Image'}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">For best results, use a clear, well-lit photo with readable text.</p>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                    <Button onClick={handleScanClick} disabled={!file} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        Scan with AI
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const MenuItem = ({ item, onEdit, onDelete, onToggle, onSelectItem, isSelected }) => (
    <motion.div
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        whileHover={{ y: -4, boxShadow: "0 10px 20px hsla(var(--primary), 0.2)" }}
        className={cn("bg-card rounded-lg p-3 md:p-4 border border-border shadow-md hover:shadow-primary/20 hover:-translate-y-1 transition-all duration-300", isSelected && "bg-primary/10 border-primary ring-2 ring-primary")}
    >
        {/* Mobile Layout - Stacked */}
        <div className="flex md:hidden flex-col gap-2">
            {/* Top Row: Checkbox, Image, Name, Price */}
            <div className="flex items-center gap-3">
                <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onSelectItem(item.id)}
                    aria-label={`Select ${item.name}`}
                />
                <div className="relative w-14 h-14 rounded-md overflow-hidden bg-muted flex-shrink-0">
                    {item.imageUrl && item.imageUrl !== 'uploading...' ? (
                        <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" />
                    ) : (
                        <ImageIcon size={28} className="text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className={`font-bold text-base truncate ${!item.isAvailable ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{item.name}</p>
                    <p className="text-green-500 font-semibold text-sm">₹{item.portions?.[0]?.price || 'N/A'}</p>
                </div>
            </div>
            {/* Middle Row: Switch */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Switch id={`switch-${item.id}`} checked={item.isAvailable} onCheckedChange={(checked) => onToggle(item.id, checked)} />
                    <Label htmlFor={`switch-${item.id}`} className="text-xs font-medium text-muted-foreground">{item.isAvailable ? 'Available' : 'Out of Stock'}</Label>
                </div>
                {/* Action Buttons on same row as switch */}
                <div className="flex items-center gap-1">
                    <Button onClick={() => onEdit(item)} size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Edit size={16} />
                    </Button>
                    <Button onClick={() => onDelete(item.id, item.name)} size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                        <Trash2 size={16} />
                    </Button>
                </div>
            </div>
        </div>

        {/* Desktop Layout - Grid */}
        <div className="hidden md:grid md:grid-cols-5 gap-4 items-center">
            <div className="col-span-1 flex items-center gap-4">
                <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onSelectItem(item.id)}
                    aria-label={`Select ${item.name}`}
                />
                <div className="relative w-16 h-16 rounded-md overflow-hidden bg-muted flex-shrink-0">
                    {item.imageUrl && item.imageUrl !== 'uploading...' && (
                        <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" />
                    )}
                    {/* No placeholder icon - completely blank if no image */}
                </div>
            </div>
            <div className="col-span-2">
                <p className={`font-bold text-lg ${!item.isAvailable ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{item.name}</p>
                <p className="text-green-500 font-semibold">₹{item.portions?.[0]?.price || 'N/A'}</p>
            </div>
            <div className="col-span-1 flex items-center justify-center gap-2">
                <Switch id={`switch-${item.id}-desktop`} checked={item.isAvailable} onCheckedChange={(checked) => onToggle(item.id, checked)} />
                <Label htmlFor={`switch-${item.id}-desktop`} className="text-sm font-medium text-muted-foreground">{item.isAvailable ? 'Available' : 'Out of Stock'}</Label>
            </div>
            <div className="col-span-1 flex items-center justify-end gap-2">
                <Button onClick={() => onEdit(item)} size="icon" variant="ghost" className="text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Edit />
                </Button>
                <Button onClick={() => onDelete(item.id, item.name)} size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10">
                    <Trash2 />
                </Button>
            </div>
        </div>
    </motion.div>
);

const AddItemModal = ({ isOpen, setIsOpen, onSave, editingItem, allCategories, showInfoDialog }) => {
    const [item, setItem] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [newCategory, setNewCategory] = useState('');
    const [showNewCategory, setShowNewCategory] = useState(false);
    const fileInputRef = useRef(null);
    const [pricingType, setPricingType] = useState('portions');

    const sortedCategories = useMemo(() => Object.entries(allCategories)
        .map(([id, config]) => ({ id, title: config?.title || id }))
        .sort((a, b) => a.title.localeCompare(b.title)), [allCategories]);

    useEffect(() => {
        if (isOpen) {
            setIsSaving(false);
            setNewCategory('');
            setShowNewCategory(false);
            if (editingItem) {
                const hasMultiplePortions = editingItem.portions && editingItem.portions.length > 1;
                const hasDifferentPortionName = editingItem.portions && editingItem.portions.length === 1 && editingItem.portions[0].name.toLowerCase() !== 'full';

                if (hasMultiplePortions || hasDifferentPortionName) {
                    setPricingType('portions');
                } else {
                    setPricingType('single');
                }

                setItem({
                    ...editingItem,
                    tags: Array.isArray(editingItem.tags) ? editingItem.tags.join(', ') : '',
                    portions: Array.isArray(editingItem.portions) && editingItem.portions.length > 0 ? editingItem.portions : [{ name: 'Full', price: '' }],
                });
            } else {
                setPricingType('portions');
                setItem({
                    name: "",
                    description: "",
                    portions: [{ name: 'Full', price: '' }],
                    categoryId: sortedCategories[0]?.id || "snacks",
                    isVeg: true,
                    isAvailable: true,
                    imageUrl: "",
                    tags: "",
                });
            }
        } else {
            setItem(null);
        }
    }, [editingItem, isOpen, sortedCategories]);

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

    const handleChange = (field, value) => setItem(prev => ({ ...prev, [field]: value }));
    const handlePortionChange = (index, field, value) => {
        const newPortions = [...item.portions];
        newPortions[index][field] = value;
        setItem(prev => ({ ...prev, portions: newPortions }));
    };
    const addPortion = () => setItem(prev => ({ ...prev, portions: [...prev.portions, { name: '', price: '' }] }));
    const removePortion = (index) => {
        if (item.portions.length > 1) {
            setItem(prev => ({ ...prev, portions: prev.portions.filter((_, i) => i !== index) }));
        }
    };
    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Show loading indicator
        handleChange('imageUrl', 'uploading...');

        try {
            // 1. Compress the image (Optional but recommended for performance)
            const options = {
                maxSizeMB: 0.5,              // Max 500KB
                maxWidthOrHeight: 1024,       // Max dimension 1024px
                useWebWorker: true,
                fileType: 'image/jpeg',
            };

            let fileToUpload = file;
            try {
                fileToUpload = await imageCompression(file, options);
            } catch (compressionError) {
                console.warn('Compression failed, using original file:', compressionError);
            }

            // 2. Create Storage Reference
            // Path: menu-items/{userId}/{timestamp}-{filename}
            const userId = auth.currentUser?.uid;
            if (!userId) throw new Error("User not authenticated");

            const timestamp = Date.now();
            const filename = fileToUpload.name.replace(/[^a-zA-Z0-9.]/g, '_'); // Sanitize filename
            const storagePath = `menu-items/${userId}/${timestamp}-${filename}`;
            const storageRef = ref(storage, storagePath);

            // 3. Upload File
            const snapshot = await uploadBytes(storageRef, fileToUpload);

            // 4. Get Download URL
            const downloadURL = await getDownloadURL(snapshot.ref);

            // 5. Save URL
            handleChange('imageUrl', downloadURL);

        } catch (error) {
            console.error('Upload failed:', error);
            handleChange('imageUrl', ''); // Reset on error
            showInfoDialog({
                isOpen: true,
                title: 'Upload Failed',
                message: `Could not upload image: ${error.message}. Please try again.`
            });
        }
    };

    const handleBasePriceChange = (value) => {
        setItem(prev => ({ ...prev, portions: [{ name: 'Full', price: value }] }));
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

            let finalPortions;
            if (pricingType === 'single') {
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
                isVeg: item.isVeg,
                isAvailable: item.isAvailable,
                imageUrl: item.imageUrl || "",
                tags: tagsArray,
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
                        <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
                        <DialogDescription>
                            {editingItem ? 'Update the details for this item.' : "Fill in the details for the new item. Click save when you're done."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid md:grid-cols-2 gap-x-8 gap-y-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
                        {/* Left Column: Basic Details */}
                        <div className="space-y-4">
                            <div><Label>Name</Label><input value={item.name} onChange={e => handleChange('name', e.target.value)} required placeholder="e.g., Veg Pulao" className="w-full p-2 bg-input border border-border rounded-md" /></div>
                            <div><Label>Description</Label><input value={item.description} onChange={e => handleChange('description', e.target.value)} placeholder="e.g., 10 Pcs." className="w-full p-2 bg-input border border-border rounded-md" /></div>
                            <div>
                                <Label>Category</Label>
                                <select value={item.categoryId} onChange={handleCategoryChange} className="w-full p-2 bg-input border border-border rounded-md">
                                    {sortedCategories.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
                                    <option value="add_new">+ Add New Category...</option>
                                </select>
                            </div>
                            {showNewCategory && (<div><Label>New Category Name</Label><input value={newCategory} onChange={e => setNewCategory(e.target.value)} className="w-full p-2 bg-input border border-border rounded-md" /></div>)}
                            <div><Label>Tags (comma-separated)</Label><input value={item.tags} onChange={e => handleChange('tags', e.target.value)} placeholder="e.g., Spicy, Chef&apos;s Special" className="w-full p-2 bg-input border border-border rounded-md" /></div>
                            <div>
                                <Label>Image</Label>
                                <div className="mt-2 flex items-center gap-4">
                                    <div className="relative w-20 h-20 rounded-md border-2 border-dashed border-border flex items-center justify-center bg-muted overflow-hidden">
                                        {item.imageUrl === 'uploading...' ? (
                                            <Loader2 className="animate-spin text-primary" />
                                        ) : item.imageUrl ? (
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
                                <div className="flex items-center space-x-2"><Switch id="is-veg" checked={item.isVeg} onCheckedChange={checked => handleChange('isVeg', checked)} /><Label htmlFor="is-veg">Vegetarian</Label></div>
                                <div className="flex items-center space-x-2"><Switch id="is-available" checked={item.isAvailable} onCheckedChange={checked => handleChange('isAvailable', checked)} /><Label htmlFor="is-available">Available</Label></div>
                            </div>
                        </div>

                        {/* Right Column: Portions */}
                        <div className="space-y-4">
                            <div>
                                <Label>Pricing</Label>
                                <div className="flex items-center gap-2 mt-2 bg-muted p-1 rounded-lg">
                                    <Button type="button" onClick={() => setPricingType('single')} variant={pricingType === 'single' ? 'default' : 'ghost'} className={cn("flex-1", pricingType === 'single' && 'bg-background text-foreground shadow-sm')}>Single Price</Button>
                                    <Button type="button" onClick={() => setPricingType('portions')} variant={pricingType === 'portions' ? 'default' : 'ghost'} className={cn("flex-1", pricingType === 'portions' && 'bg-background text-foreground shadow-sm')}>Variable Portions</Button>
                                </div>
                                <div className="mt-3 space-y-3">
                                    {pricingType === 'single' ? (
                                        <div className="flex items-center gap-2">
                                            <Label className="w-24">Base Price</Label>
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
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSaving || item?.imageUrl === 'uploading...'} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                            {isSaving ? <Loader2 className="animate-spin mr-2" /> : null} {editingItem ? 'Save Changes' : 'Save Item'}
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

    const contextType = 'restaurant menu';
    const itemName = 'Dish name';
    const placeholderText = '[PASTE YOUR MENU TEXT HERE]';
    const instructionsText = 'your menu text';
    const categoryExample = "'main-course'";
    const defaultCategory = "main-course";

    const aiPrompt = `You are an expert data extractor. Convert the following ${contextType} text into a structured JSON array. Each object in the array must strictly follow this format:
{
  "name": "string (${itemName})",
  "description": "string (Optional item description)",
  "categoryId": "string (Lowercase, dash-separated, e.g., ${categoryExample})",
  "isVeg": "boolean (true for vegetarian, false for non-vegetarian, default to true if unsure)",
  "portions": [
    { "name": "string (e.g., 'Full', 'Half', 'Regular')", "price": "number" }
  ],
  "tags": ["string", "... (Optional array of tags like 'Bestseller', 'Spicy')"]
}

Important Rules:
- The 'imageUrl' and 'addOnGroups' fields MUST NOT be part of your response.
- If an item has only one price, create a single entry in the 'portions' array with the name "Full".
- If a category is not obvious, use a sensible default like '${defaultCategory}'.
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
                    <DialogTitle className="flex items-center gap-2 text-2xl"><FileJson /> Bulk Add Items via JSON</DialogTitle>
                    <DialogDescription>Quickly add multiple items by pasting a structured JSON array.</DialogDescription>
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
                            <li>Click &quot;Upload &amp; Save Items&quot;.</li>
                        </ol>
                        <div className="p-4 bg-muted rounded-lg">
                            <div className="flex justify-between items-center mb-2">
                                <Label className="font-semibold">AI Prompt for JSON Generation</Label>
                                <Button size="sm" variant="ghost" onClick={handleCopy}>
                                    {copySuccess || 'Copy'}
                                </Button>
                            </div>
                            <p className="text-xs bg-background p-3 rounded-md font-mono whitespace-pre-wrap overflow-auto">{aiPrompt}</p>
                        </div>
                    </div>
                    <div className="py-4">
                        <Label htmlFor="json-input" className="font-semibold text-lg">Paste JSON Here</Label>
                        <textarea
                            id="json-input"
                            value={jsonText}
                            onChange={(e) => setJsonText(e.target.value)}
                            placeholder='[ ... ]'
                            className="w-full h-96 mt-2 p-3 font-mono text-sm border rounded-md bg-input border-border focus:ring-primary focus:border-primary"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSubmit} disabled={isSaving || !jsonText} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        {isSaving ? 'Uploading...' : 'Upload & Save Items'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


export default function StreetVendorMenuPage() {
    const { user, isUserLoading } = useUser();
    const [menuItems, setMenuItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
    const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isScanning, setIsScanning] = useState(false);
    const [customCategories, setCustomCategories] = useState([]);
    const [itemToDelete, setItemToDelete] = useState(null);
    const [selectedItems, setSelectedItems] = useState([]);
    const [bulkConfirmation, setBulkConfirmation] = useState(null); // { action: 'delete' | 'outOfStock', count: number }

    // Move searchParams hook BEFORE vendorQuery that uses it
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const effectiveOwnerId = impersonatedOwnerId || employeeOfOwnerId;

    const vendorQuery = useMemoFirebase(() => {
        if (!user) return null;
        // Only use direct Firestore query for owner's own data
        // For employee access, we'll use API fetch instead
        if (effectiveOwnerId) return null; // Skip Firestore, use API
        return query(collection(db, 'street_vendors'), where('ownerId', '==', user.uid));
    }, [user, effectiveOwnerId]);

    const { data: vendorData, isLoading: isVendorLoading, error: vendorError } = useCollection(vendorQuery);

    const vendorId = useMemo(() => vendorData?.[0]?.id, [vendorData]);

    useEffect(() => {
        if (vendorError) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load your vendor profile. ' + vendorError.message });
        }
    }, [vendorError]);

    // Fetch customCategories from Firebase for normal vendors
    useEffect(() => {
        if (!vendorId || effectiveOwnerId) return; // Skip if impersonating/employee access (API handles it)

        const fetchCustomCategories = async () => {
            try {
                const vendorDocRef = doc(db, 'street_vendors', vendorId);
                const vendorDocSnap = await getDoc(vendorDocRef);
                if (vendorDocSnap.exists()) {
                    const data = vendorDocSnap.data();
                    setCustomCategories(data.customCategories || []);
                }
            } catch (error) {
                console.error('Error fetching custom categories:', error);
            }
        };

        fetchCustomCategories();
    }, [vendorId, effectiveOwnerId]);

    // Transform customCategories array into object format for dropdown
    const allCategories = useMemo(() => {
        const categoriesObj = {};

        // Add all custom categories from database
        customCategories.forEach(cat => {
            categoriesObj[cat.id] = {
                id: cat.id,
                title: cat.title || cat.id // Use title if available, fallback to ID
            };
        });

        // Always include 'general' as fallback
        if (!categoriesObj['general']) {
            categoriesObj['general'] = { id: 'general', title: 'General' };
        }

        return categoriesObj;
    }, [customCategories]);

    const fetchMenu = useCallback(async () => {
        if (!user) {
            setLoading(false);
            return () => { };
        }

        // If impersonating or employee access, use API instead of Firestore listener
        if (effectiveOwnerId) {
            try {
                const idToken = await user.getIdToken();
                const paramName = impersonatedOwnerId ? 'impersonate_owner_id' : 'employee_of';
                const res = await fetch(`/api/owner/menu?${paramName}=${effectiveOwnerId}`, {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });
                if (!res.ok) throw new Error('Failed to fetch menu via API');
                const data = await res.json();

                // Transform API response to match Firestore structure if needed
                const items = [];
                Object.values(data.menu).forEach(categoryItems => {
                    items.push(...categoryItems);
                });

                setMenuItems(items);
                if (data.customCategories) {
                    setCustomCategories(data.customCategories);
                }
                setLoading(false);
            } catch (err) {
                console.error("API Fetch Error:", err);
                setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load menu items via API. ' + err.message });
                setLoading(false);
            }
            return () => { }; // No unsubscribe for API
        }

        if (!vendorId) {
            setLoading(false);
            return () => { };
        }

        const menuCollectionRef = collection(db, 'street_vendors', vendorId, 'menu');
        const q = query(menuCollectionRef);

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const items = [];
            querySnapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() });
            });
            setMenuItems(items);
            setLoading(false);
        }, (err) => {
            const contextualError = new FirestorePermissionError({ path: menuCollectionRef.path, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Firestore Error:", err);
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load menu items. ' + err.message });
            setLoading(false);
        });

        return unsubscribe;
    }, [user, vendorId, effectiveOwnerId]);


    useEffect(() => {
        if (isUserLoading) return;
        // If impersonating or employee access, we don't need vendorId to be loaded from Firestore
        if (!effectiveOwnerId && isVendorLoading) return;

        const fetchData = async () => {
            const unsubscribe = await fetchMenu();
            return unsubscribe;
        };

        const cleanupPromise = fetchData();
        return () => { cleanupPromise.then(unsub => unsub && unsub()) };
    }, [user, isUserLoading, vendorId, isVendorLoading, fetchMenu, effectiveOwnerId]);

    const handleToggleAvailability = async (itemId, newAvailability) => {
        // For impersonation or employee access, use API
        if (effectiveOwnerId) {
            try {
                const idToken = await user.getIdToken();
                const paramName = impersonatedOwnerId ? 'impersonate_owner_id' : 'employee_of';
                await fetch(`/api/owner/menu?${paramName}=${effectiveOwnerId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                    body: JSON.stringify({ updates: { id: itemId, isAvailable: newAvailability } })
                });
                // Optimistic update or refetch
                setMenuItems(prev => prev.map(item => item.id === itemId ? { ...item, isAvailable: newAvailability } : item));
            } catch (error) {
                setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not update item status via API: ' + error.message });
            }
            return;
        }

        if (!vendorId) return;
        const itemRef = doc(db, 'street_vendors', vendorId, 'menu', itemId);
        try {
            await updateDoc(itemRef, { isAvailable: newAvailability });
        } catch (error) {
            errorEmitter.emit('permission-error', new FirestorePermissionError({ path: itemRef.path, operation: 'update', requestResourceData: { isAvailable: newAvailability } }));
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not update item status: ' + error.message });
        };
    };

    const handleDeleteItem = (itemId, itemName) => {
        setItemToDelete({ id: itemId, name: itemName });
    };

    const confirmDeleteItem = async () => {
        if (!itemToDelete) return;

        // For impersonation or employee access, use API
        if (effectiveOwnerId) {
            try {
                const idToken = await user.getIdToken();
                const paramName = impersonatedOwnerId ? 'impersonate_owner_id' : 'employee_of';
                await fetch(`/api/owner/menu?${paramName}=${effectiveOwnerId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                    body: JSON.stringify({ itemId: itemToDelete.id })
                });
                setInfoDialog({ isOpen: true, title: 'Success', message: `Item "${itemToDelete.name}" has been deleted.` });
                setMenuItems(prev => prev.filter(item => item.id !== itemToDelete.id));
            } catch (error) {
                setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not delete item via API: ' + error.message });
            } finally {
                setItemToDelete(null);
            }
            return;
        }

        if (!vendorId) return;
        const itemRef = doc(db, 'street_vendors', vendorId, 'menu', itemToDelete.id);
        try {
            await deleteDoc(itemRef);
            setInfoDialog({ isOpen: true, title: 'Success', message: `Item "${itemToDelete.name}" has been deleted.` });
        } catch (error) {
            errorEmitter.emit('permission-error', new FirestorePermissionError({ path: itemRef.path, operation: 'delete' }));
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not delete item: ' + error.message });
        } finally {
            setItemToDelete(null);
        }
    };

    const handleSaveItem = useCallback(async (itemData, categoryId, newCategory, isEditing) => {
        const handleApiCall = async (endpoint, method, body) => {
            const idToken = await user.getIdToken();
            let url = endpoint;
            // Add impersonation or employee_of param
            if (impersonatedOwnerId) {
                url += `?impersonate_owner_id=${impersonatedOwnerId}`;
            } else if (employeeOfOwnerId) {
                url += `?employee_of=${employeeOfOwnerId}`;
            }
            const response = await fetch(url, {
                method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'API call failed');
            }
            return await response.json();
        };

        try {
            const data = await handleApiCall('/api/owner/menu', 'POST', { item: itemData, categoryId, newCategory, isEditing });
            setInfoDialog({ isOpen: true, title: 'Success', message: data.message });

            // Refetch menu and categories to get updated data
            if (effectiveOwnerId) {
                const fetchUnsub = await fetchMenu();
                if (fetchUnsub) fetchUnsub();
            } else {
                // For normal vendors, optimistically update UI
                if (isEditing) {
                    setMenuItems(prev => prev.map(item =>
                        item.id === itemData.id
                            ? { ...item, ...itemData, categoryId: categoryId }
                            : item
                    ));
                }
                // For new category, refetch customCategories
                if (newCategory && newCategory.trim() !== '') {
                    try {
                        const vendorDocRef = doc(db, 'street_vendors', vendorId);
                        const vendorDocSnap = await getDoc(vendorDocRef);
                        if (vendorDocSnap.exists()) {
                            const data = vendorDocSnap.data();
                            setCustomCategories(data.customCategories || []);
                        }
                    } catch (error) {
                        console.error('Error refetching custom categories:', error);
                    }
                }
            }

        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not save item: ${error.message}` });
            throw error;
        }
    }, [user, fetchMenu, impersonatedOwnerId, vendorId]);


    const handleAiScan = async (file) => {
        setIsScanning(true);
        setIsAiModalOpen(false); // Close the modal and show page-level indicator
        try {
            // Compress image before sending to AI
            const compressionOptions = {
                maxSizeMB: 0.8, // Max 800KB
                maxWidthOrHeight: 1920, // Max dimension
                useWebWorker: true,
                fileType: 'image/jpeg' // Convert to JPEG for better compression
            };

            const compressedFile = await imageCompression(file, compressionOptions);
            console.log(`Original file size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
            console.log(`Compressed file size: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);

            const reader = new FileReader();
            reader.readAsDataURL(compressedFile); // Use compressed file
            await new Promise((resolve, reject) => {
                reader.onload = async () => {
                    try {
                        const imageDataUri = reader.result;
                        let url = '/api/ai/scan-menu';
                        // Add impersonation or employee_of param
                        if (impersonatedOwnerId) {
                            url += `?impersonate_owner_id=${impersonatedOwnerId}`;
                        } else if (employeeOfOwnerId) {
                            url += `?employee_of=${employeeOfOwnerId}`;
                        }

                        const response = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user.getIdToken()}` },
                            body: JSON.stringify({ imageDataUri }),
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.message);
                        setInfoDialog({ isOpen: true, title: 'Success!', message: result.message });

                        if (effectiveOwnerId) {
                            const fetchUnsub = await fetchMenu();
                            if (fetchUnsub) fetchUnsub();
                        }

                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
                reader.onerror = (error) => reject(error);
            });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'AI Scan Failed', message: error.message });
        } finally {
            setIsScanning(false);
        }
    };

    const handleBulkSave = async (items) => {
        try {
            const user = await auth.currentUser;
            if (!user) throw new Error("User not authenticated");
            const idToken = await user.getIdToken();
            let url = '/api/owner/menu-bulk';
            // Add impersonation or employee_of param
            if (impersonatedOwnerId) {
                url += `?impersonate_owner_id=${impersonatedOwnerId}`;
            } else if (employeeOfOwnerId) {
                url += `?employee_of=${employeeOfOwnerId}`;
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ items }),
            });
            if (!response.ok) throw new Error((await response.json()).message);
            const data = await response.json();
            setInfoDialog({ isOpen: true, title: 'Success!', message: data.message });

            if (effectiveOwnerId) {
                const fetchUnsub = await fetchMenu();
                if (fetchUnsub) fetchUnsub();
            }
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Bulk Add Failed', message: error.message });
            throw error;
        }
    };

    const handleEditItem = (item) => {
        setEditingItem(item);
        setIsAddItemModalOpen(true);
    };

    const handleToggleSelection = (itemId) => {
        setSelectedItems(prev => {
            if (prev.includes(itemId)) {
                // Remove from selection
                return prev.filter(id => id !== itemId);
            } else {
                // Add to selection
                return [...prev, itemId];
            }
        });
    };

    const handleBulkAction = (action) => {
        if (selectedItems.length === 0) return;
        setBulkConfirmation({ action, count: selectedItems.length });
    };

    const confirmBulkAction = async () => {
        if (!bulkConfirmation) return;

        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication failed");
            const idToken = await user.getIdToken();
            let url = '/api/owner/menu';
            // Add impersonation or employee_of param
            if (impersonatedOwnerId) {
                url += `?impersonate_owner_id=${impersonatedOwnerId}`;
            } else if (employeeOfOwnerId) {
                url += `?employee_of=${employeeOfOwnerId}`;
            }

            await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ itemIds: selectedItems, action: bulkConfirmation.action })
            });
            setInfoDialog({ isOpen: true, title: 'Success', message: `Successfully completed bulk action.` });
            setSelectedItems([]);

            if (effectiveOwnerId) {
                const fetchUnsub = await fetchMenu();
                if (fetchUnsub) fetchUnsub();
            } else {
                // Firestore listener handles it
            }
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not perform bulk action: ${error.message}` });
        } finally {
            setBulkConfirmation(null);
        }
    };


    const groupedMenu = menuItems.reduce((acc, item) => {
        const categoryKey = item.categoryId || 'general';
        const categoryTitle = allCategories[categoryKey]?.title || categoryKey;
        (acc[categoryTitle] = acc[categoryTitle] || []).push(item);
        return acc;
    }, {});

    return (
        <div className="min-h-screen bg-background text-foreground font-body p-4">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            {/* Single Item Delete Confirmation */}
            <ConfirmationModal
                isOpen={!!itemToDelete}
                onClose={() => setItemToDelete(null)}
                onConfirm={confirmDeleteItem}
                title="Confirm Deletion"
                message={
                    <>
                        Are you sure you want to permanently delete the item: <span className="font-bold text-primary">{itemToDelete?.name}</span>? This action cannot be undone.
                    </>
                }
                confirmText="Confirm Delete"
                confirmVariant="destructive"
            />
            {/* Bulk Action Confirmation */}
            <ConfirmationModal
                isOpen={!!bulkConfirmation}
                onClose={() => setBulkConfirmation(null)}
                onConfirm={confirmBulkAction}
                title={bulkConfirmation?.action === 'delete' ? 'Confirm Bulk Delete' : 'Confirm Bulk Out of Stock'}
                message={
                    bulkConfirmation?.action === 'delete'
                        ? `Are you sure you want to delete ${bulkConfirmation?.count} items? This action cannot be undone.`
                        : `Are you sure you want to mark ${bulkConfirmation?.count} items as out of stock?`
                }
                confirmText={bulkConfirmation?.action === 'delete' ? 'Delete Items' : 'Mark Out of Stock'}
                confirmVariant={bulkConfirmation?.action === 'delete' ? 'destructive' : 'default'}
            />
            <AiScanModal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} onScan={handleAiScan} />
            <BulkAddModal isOpen={isBulkModalOpen} setIsOpen={setIsBulkModalOpen} onSave={handleBulkSave} businessType="street-vendor" showInfoDialog={setInfoDialog} />
            <AddItemModal isOpen={isAddItemModalOpen} setIsOpen={setIsAddItemModalOpen} onSave={handleSaveItem} editingItem={editingItem} allCategories={allCategories} showInfoDialog={setInfoDialog} />

            <header className="flex justify-between items-center mb-6">
                <h1 className="text-xl font-bold font-headline">My Menu</h1>
                <div className="flex gap-2">
                    <Button onClick={() => setIsBulkModalOpen(true)} variant="ghost" size="icon" className="text-primary hover:text-primary hover:bg-primary/10">
                        <FileJson size={20} />
                    </Button>
                    <Button onClick={() => setIsAiModalOpen(true)} variant="ghost" size="icon" className="text-primary hover:text-primary hover:bg-primary/10">
                        <Camera size={20} />
                    </Button>
                    <Button onClick={() => { setEditingItem(null); setIsAddItemModalOpen(true); }} className="bg-primary hover:bg-primary/90 text-primary-foreground h-10 w-10 p-0">
                        <PlusCircle size={20} />
                    </Button>
                </div>
            </header>

            <AnimatePresence>
                {isScanning && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="bg-primary/10 text-primary font-semibold p-3 rounded-lg flex items-center justify-center gap-3 mb-4 text-center"
                    >
                        <Loader2 className="animate-spin" />
                        AI is scanning your menu... Your new items will appear here shortly.
                    </motion.div>
                )}
            </AnimatePresence>

            {selectedItems.length > 0 && (
                <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm p-3 border rounded-lg mb-4">
                    {/* Mobile Layout - Stacked */}
                    <div className="flex md:hidden flex-col gap-2">
                        <p className="font-semibold text-sm">{selectedItems.length} items selected</p>
                        <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleBulkAction('outOfStock')} className="flex-1">
                                <XCircle size={14} className="mr-1" /> Out of Stock
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleBulkAction('delete')} className="flex-1">
                                <Trash2 size={14} className="mr-1" /> Delete
                            </Button>
                        </div>
                    </div>
                    {/* Desktop Layout - Horizontal */}
                    <div className="hidden md:flex items-center justify-between gap-4">
                        <p className="font-semibold">{selectedItems.length} items selected</p>
                        <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleBulkAction('outOfStock')}>
                                <XCircle size={16} className="mr-2" /> Mark Out of Stock
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleBulkAction('delete')}>
                                <Trash2 size={16} className="mr-2" /> Delete
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <main>
                {(loading || isUserLoading || isVendorLoading) ? (
                    <div className="text-center py-20 text-muted-foreground">
                        <Loader2 className="mx-auto animate-spin" size={48} />
                        <p className="mt-4">Loading your menu...</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {Object.entries(groupedMenu).map(([category, items]) => (
                            <div key={category}>
                                <h2 className="text-xl font-bold text-sky-500 mb-2">{category}</h2>
                                <div className="space-y-3">
                                    {items.map(item => (
                                        <MenuItem
                                            key={item.id}
                                            item={item}
                                            onToggle={handleToggleAvailability}
                                            onDelete={handleDeleteItem}
                                            onEdit={handleEditItem}
                                            onSelectItem={handleToggleSelection}
                                            isSelected={selectedItems.includes(item.id)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                        {Object.keys(groupedMenu).length === 0 && !isScanning && (
                            <div className="text-center py-20 text-muted-foreground">
                                <p>Your menu is empty.</p>
                                <p>Click <PlusCircle className="inline" size={16} /> to add an item, or use <Camera className="inline" size={16} /> to scan your menu with AI.</p>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
