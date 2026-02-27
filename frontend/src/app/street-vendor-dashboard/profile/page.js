'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, LogOut, ChevronRight, ShoppingBag, MapPin, Settings, Edit, Save, XCircle, Trash2, KeyRound, Eye, EyeOff, FileText, Bot, Truck, Image as ImageIcon, Upload, X, IndianRupee, Wallet, ChevronsUpDown, Check, Store, ConciergeBell, Loader2, ArrowLeft, QrCode, Banknote, Mail, Phone, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { getAuth, updatePassword, EmailAuthProvider, reauthenticateWithCredential, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import Image from 'next/image';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import InfoDialog from '@/components/InfoDialog';
import Link from 'next/link';
import imageCompression from 'browser-image-compression';

import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Helper: Upload file to Firebase Storage
const uploadToStorage = async (file, path) => {
    const storage = getStorage();
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
};

export const dynamic = 'force-dynamic';

const SectionCard = ({ title, description, children, footer, action }) => (
    <motion.div
        className="bg-card border border-border rounded-xl overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
    >
        <div className="p-6 border-b border-border flex items-center justify-between gap-4">
            <div>
                <h2 className="text-xl font-bold text-foreground">{title}</h2>
                {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
            </div>
            {action && <div>{action}</div>}
        </div>
        <div className="p-6">
            {children}
        </div>
        {footer && <div className="p-6 bg-muted/30 border-t border-border">{footer}</div>}
    </motion.div>
);

const DeleteAccountModal = ({ isOpen, setIsOpen }) => {
    const [confirmationText, setConfirmationText] = useState("");
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const isDeleteDisabled = confirmationText !== "DELETE";

    const handleDelete = async () => {
        try {
            const user = getAuth().currentUser;
            if (user) {
                const provider = new GoogleAuthProvider();
                await signInWithPopup(user, provider);

                const idToken = await user.getIdToken(true);
                const response = await fetch('/api/user/delete', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || "Failed to delete account.");
                }

                setInfoDialog({ isOpen: true, title: 'Success', message: 'Account deleted successfully.' });
                setTimeout(() => window.location.href = "/", 2000);
            }
        } catch (error) {
            console.error("Error deleting account:", error);
            const errorMessage = error.code === 'auth/popup-closed-by-user'
                ? 'Re-authentication cancelled. Account not deleted.'
                : `Failed to delete account: ${error.message}`;
            setInfoDialog({ isOpen: true, title: 'Error', message: errorMessage });
        } finally {
            setIsOpen(false);
        }
    };

    return (
        <>
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="sm:max-w-md bg-destructive/10 border-destructive text-foreground backdrop-blur-md">
                    <DialogHeader>
                        <DialogTitle className="text-2xl text-destructive-foreground">Permanently Delete Account</DialogTitle>
                        <DialogDescription className="text-destructive-foreground/80">
                            This is a security-sensitive action. You will be asked to sign in with Google again to confirm your identity.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="delete-confirm" className="font-semibold">To confirm, please type &quot;DELETE&quot; in the box below.</Label>
                        <input
                            id="delete-confirm"
                            type="text"
                            value={confirmationText}
                            onChange={(e) => setConfirmationText(e.target.value)}
                            className="mt-2 w-full p-2 border rounded-md bg-background border-destructive/50 text-foreground focus:ring-destructive"
                            placeholder="DELETE"
                        />
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                        <Button
                            variant="destructive"
                            disabled={isDeleteDisabled}
                            onClick={handleDelete}
                        >
                            Re-authenticate & Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

const ImageUpload = ({ label, currentImage, onFileSelect, isEditing, folderPath }) => {
    const fileInputRef = React.useRef(null);
    const [uploading, setUploading] = useState(false);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            setUploading(true);
            try {
                // Compress image before uploading
                const compressionOptions = {
                    maxSizeMB: 0.5, // Reduced max size to 0.5MB
                    maxWidthOrHeight: 1024,
                    useWebWorker: true,
                    fileType: 'image/jpeg'
                };

                const compressedFile = await imageCompression(file, compressionOptions);
                const timestamp = Date.now();
                const path = `${folderPath}/${timestamp}_${compressedFile.name}`;

                const downloadURL = await uploadToStorage(compressedFile, path);

                onFileSelect(downloadURL);
            } catch (error) {
                console.error('Image upload failed:', error);
                alert("Upload failed. Please try again.");
            } finally {
                setUploading(false);
            }
        }
    };

    return (
        <div>
            <Label className="flex items-center gap-2"><ImageIcon size={14} /> {label}</Label>
            <div className="mt-2 flex items-center gap-4">
                <div className="relative w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-muted/50 overflow-hidden">
                    {uploading ? (
                        <div className="flex flex-col items-center justify-center p-2">
                            <Loader2 className="animate-spin h-6 w-6 text-primary" />
                            <span className="text-[10px] text-muted-foreground mt-1">Uploading...</span>
                        </div>
                    ) : currentImage ? (
                        <Image src={currentImage} alt={label} layout="fill" objectFit="cover" />
                    ) : (
                        <ImageIcon size={24} className="text-muted-foreground" />
                    )}
                </div>
                {isEditing && (
                    <>
                        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                            <Upload size={16} className="mr-2" /> {uploading ? '...' : 'Upload'}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};


// --- Main Page Component ---
function VendorProfilePageContent() {
    const router = useRouter();
    const [user, setUser] = useState(null);
    const [editedUser, setEditedUser] = useState(null);
    // ... (rest of state) ...
    const [loading, setLoading] = useState(true);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isEditingMedia, setIsEditingMedia] = useState(false);
    const [isEditingPayment, setIsEditingPayment] = useState(false);
    const [isEditingCharges, setIsEditingCharges] = useState(false); // For Add-on Charges section
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const defaultAddress = { street: '', city: '', state: '', postalCode: '', country: 'IN' };

    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const effectiveOwnerId = impersonatedOwnerId || employeeOfOwnerId;

    useEffect(() => {
        const fetchUserData = async () => {
            const currentUser = getAuth().currentUser;
            if (!currentUser) {
                setLoading(false);
                router.push('/');
                return;
            }
            try {
                const idToken = await currentUser.getIdToken();
                let apiUrl = '/api/owner/settings';
                if (impersonatedOwnerId) {
                    apiUrl += `?impersonate_owner_id=${impersonatedOwnerId}`;
                } else if (employeeOfOwnerId) {
                    apiUrl += `?employee_of=${employeeOfOwnerId}`;
                }

                const response = await fetch(apiUrl, {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });

                if (!response.ok) throw new Error((await response.json()).message || 'Failed to fetch user data');

                const data = await response.json();
                const userData = { ...data, address: data.address || defaultAddress, uid: currentUser.uid }; // ✅ Inject UID
                setUser(userData);
                setEditedUser(userData);
            } catch (error) {
                setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = getAuth().onAuthStateChanged(user => {
            if (user) fetchUserData();
            else setLoading(false);
        });

        return () => unsubscribe();
    }, [router, effectiveOwnerId]);

    // ... (Handlers) ...
    const handleEditToggle = (section) => {
        const toggles = {
            profile: [isEditingProfile, setIsEditingProfile],
            media: [isEditingMedia, setIsEditingMedia],
            payment: [isEditingPayment, setIsEditingPayment],
            charges: [isEditingCharges, setIsEditingCharges],
        };
        const [isEditing, setIsEditing] = toggles[section];
        if (isEditing) setEditedUser(user);
        setIsEditing(!isEditing);
    };

    const handleAddressChange = (field, value) => {
        setEditedUser(prev => ({
            ...prev,
            address: { ...prev.address, [field]: value }
        }));
    };

    // NOTE: Main ImageUpload handles logo. Banner needs manual handling below since it's an array?
    // Actually, reused ImageUpload below for Banner too effectively.

    const handlePaymentToggle = (type, value) => {
        setEditedUser(prev => ({ ...prev, [type]: value }));
    };

    const handleSave = async (section) => {
        const currentUser = getAuth().currentUser;
        if (!currentUser || !editedUser) return;

        let payload = {};
        if (section === 'profile') {
            payload = {
                name: editedUser.name,
                restaurantName: editedUser.restaurantName,
                phone: editedUser.phone,
            };
        } else if (section === 'media') {
            payload = {
                logoUrl: editedUser.logoUrl,
                bannerUrls: editedUser.bannerUrls,
            };
        } else if (section === 'payment') {
            payload = {
                isOpen: editedUser.isOpen,
                dineInOnlinePaymentEnabled: editedUser.dineInOnlinePaymentEnabled,
                dineInPayAtCounterEnabled: editedUser.dineInPayAtCounterEnabled,
            };
        } else if (section === 'charges') {
            payload = {
                gstEnabled: editedUser.gstEnabled,
                gstRate: editedUser.gstRate,
                gstMinAmount: editedUser.gstMinAmount,
                convenienceFeeEnabled: editedUser.convenienceFeeEnabled,
                convenienceFeeRate: editedUser.convenienceFeeRate,
                convenienceFeePaidBy: editedUser.convenienceFeePaidBy,
                convenienceFeeLabel: editedUser.convenienceFeeLabel,
                packagingChargeEnabled: editedUser.packagingChargeEnabled,
                packagingChargeAmount: editedUser.packagingChargeAmount,
            };
        }

        try {
            const idToken = await currentUser.getIdToken();
            let url = '/api/owner/settings';
            if (impersonatedOwnerId) {
                url += `?impersonate_owner_id=${impersonatedOwnerId}`;
            } else if (employeeOfOwnerId) {
                url += `?employee_of=${employeeOfOwnerId}`;
            }

            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update settings');
            }

            const updatedUser = await response.json();
            setUser(updatedUser);
            setEditedUser(updatedUser);

            if (section === 'profile') setIsEditingProfile(false);
            if (section === 'media') setIsEditingMedia(false);
            if (section === 'payment') setIsEditingPayment(false);
            if (section === 'charges') setIsEditingCharges(false);

            setInfoDialog({ isOpen: true, title: 'Success', message: 'Settings updated successfully.' });
        } catch (error) {
            console.error("Error saving data:", error);
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        }
    };

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background space-y-8 overflow-x-hidden max-w-full">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })} title={infoDialog.title} message={infoDialog.message} />
            <DeleteAccountModal isOpen={isDeleteModalOpen} setIsOpen={setDeleteModalOpen} />

            <h1 className="text-3xl font-bold tracking-tight">Stall Profile & Settings</h1>

            <SectionCard
                title="Your Details"
                description="Manage your personal and business details."
                action={isEditingProfile ? (
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => handleEditToggle('profile')}><XCircle className="mr-2 h-4 w-4" /> Cancel</Button>
                        <Button onClick={() => handleSave('profile')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4" /> Save</Button>
                    </div>
                ) : (
                    <Button onClick={() => handleEditToggle('profile')}><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                )}
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <div className="space-y-6">
                        <div>
                            <Label htmlFor="merchantId" className="flex items-center gap-2"><KeyRound size={14} /> Merchant ID</Label>
                            <div className="mt-1 w-full p-2 border rounded-md bg-muted border-border font-mono text-sm flex items-center justify-between">
                                <span>{user.merchantId || '-'}</span>
                                {user.merchantId && (
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigator.clipboard.writeText(user.merchantId)}>
                                        <div className="sr-only">Copy</div>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                                    </Button>
                                )}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">Unique identifier for your stall.</p>
                        </div>
                        <div>
                            <Label htmlFor="ownerName" className="flex items-center gap-2"><User size={14} /> Your Name</Label>
                            <input id="ownerName" value={editedUser.name} onChange={e => setEditedUser({ ...editedUser, name: e.target.value })} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70" />
                        </div>
                        <div>
                            <Label htmlFor="restaurantName" className="flex items-center gap-2"><Store size={14} /> Stall/Business Name</Label>
                            <input id="restaurantName" value={editedUser.restaurantName} onChange={e => setEditedUser({ ...editedUser, restaurantName: e.target.value })} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70" />
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div>
                            <Label htmlFor="email" className="flex items-center gap-2"><Mail size={14} /> Email Address</Label>
                            <input id="email" value={user.email} disabled className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-50" />
                        </div>
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={14} /> Phone Number</Label>
                            <input id="phone" value={editedUser.phone} onChange={e => setEditedUser({ ...editedUser, phone: e.target.value })} disabled={!isEditingProfile} className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70" />
                        </div>
                    </div>
                </div>
            </SectionCard>

            <SectionCard
                title="Media & Branding"
                description="Upload your stall's logo and a banner for your order page."
                action={isEditingMedia ? (
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => handleEditToggle('media')}><XCircle className="mr-2 h-4 w-4" /> Cancel</Button>
                        <Button onClick={() => handleSave('media')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4" /> Save</Button>
                    </div>
                ) : (
                    <Button onClick={() => handleEditToggle('media')}><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                )}
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <ImageUpload
                        label="Logo"
                        currentImage={editedUser.logoUrl}
                        onFileSelect={(url) => setEditedUser({ ...editedUser, logoUrl: url })}
                        isEditing={isEditingMedia}
                        folderPath={`users/${user.uid}/logo`}
                    />
                    <ImageUpload
                        label="Banner"
                        currentImage={editedUser.bannerUrls?.[0]}
                        onFileSelect={(url) => setEditedUser({ ...editedUser, bannerUrls: [url] })}
                        isEditing={isEditingMedia}
                        folderPath={`users/${user.uid}/banners`}
                    />
                </div>
            </SectionCard>

            <SectionCard
                title="Operational Settings"
                description="Control your stall's availability and payment methods."
                action={isEditingPayment ? (
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => handleEditToggle('payment')}><XCircle className="mr-2 h-4 w-4" /> Cancel</Button>
                        <Button onClick={() => handleSave('payment')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4" /> Save</Button>
                    </div>
                ) : (
                    <Button onClick={() => handleEditToggle('payment')}><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                )}
            >
                <div className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <Label htmlFor="isOpen" className="flex flex-col">
                            <span className="font-bold text-lg">Stall Status</span>
                            <span className="text-sm text-muted-foreground">Turn this off to temporarily stop all new orders.</span>
                        </Label>
                        <Switch id="isOpen" checked={editedUser.isOpen} onCheckedChange={(val) => setEditedUser({ ...editedUser, isOpen: val })} disabled={!isEditingPayment} />
                    </div>
                    <div className="grid md:grid-cols-2 gap-6 pt-6 border-t border-border">
                        <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                            <h4 className="font-bold">Payment Methods</h4>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="dineInOnlinePaymentEnabled" className="text-sm">Online Payments</Label>
                                <Switch id="dineInOnlinePaymentEnabled" checked={editedUser.dineInOnlinePaymentEnabled} onCheckedChange={(val) => handlePaymentToggle('dineInOnlinePaymentEnabled', val)} disabled={!isEditingPayment} />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="dineInPayAtCounterEnabled" className="text-sm">Pay at Counter</Label>
                                <Switch id="dineInPayAtCounterEnabled" checked={editedUser.dineInPayAtCounterEnabled} onCheckedChange={(val) => handlePaymentToggle('dineInPayAtCounterEnabled', val)} disabled={!isEditingPayment} />
                            </div>
                        </div>
                    </div>
                </div>
            </SectionCard>

            <SectionCard
                title="⚙️ Add-on Charges Configuration"
                description="Configure additional charges for your orders: GST, payment fees, and custom charges."
                action={isEditingCharges ? (
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => handleEditToggle('charges')}><XCircle className="mr-2 h-4 w-4" /> Cancel</Button>
                        <Button onClick={() => handleSave('charges')} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Save className="mr-2 h-4 w-4" /> Save</Button>
                    </div>
                ) : (
                    <Button onClick={() => handleEditToggle('charges')}><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                )}
            >
                <div className="space-y-8">
                    {/* GST Configuration */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                            <Label htmlFor="gstEnabled" className="flex flex-col">
                                <span className="font-bold text-lg flex items-center gap-2"><IndianRupee size={18} />Enable GST</span>
                                <span className="text-sm text-muted-foreground">Apply Goods & Services Tax to orders</span>
                            </Label>
                            <Switch
                                id="gstEnabled"
                                checked={editedUser.gstEnabled || false}
                                onCheckedChange={(val) => setEditedUser({ ...editedUser, gstEnabled: val })}
                                disabled={!isEditingCharges}
                            />
                        </div>

                        {editedUser.gstEnabled && (
                            <div className="ml-6 p-4 border-l-4 border-primary/50 space-y-4 bg-muted/30 rounded">
                                <div>
                                    <Label className="font-semibold">GST Rate (%)</Label>
                                    <div className="flex gap-2 mt-2">
                                        {[5, 12, 18, 28].map(rate => (
                                            <Button
                                                key={rate}
                                                type="button"
                                                variant={editedUser.gstRate === rate ? "default" : "outline"}
                                                onClick={() => setEditedUser({ ...editedUser, gstRate: rate })}
                                                disabled={!isEditingCharges}
                                                className="flex-1"
                                            >
                                                {rate}%
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <Label htmlFor="gstMinAmount">Apply only to orders above (₹)</Label>
                                    <input
                                        id="gstMinAmount"
                                        type="number"
                                        value={editedUser.gstMinAmount || 0}
                                        onChange={e => setEditedUser({ ...editedUser, gstMinAmount: parseFloat(e.target.value) || 0 })}
                                        disabled={!isEditingCharges}
                                        className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70"
                                        placeholder="0 (applies to all orders)"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Online Payment Convenience Fee */}
                    <div className="space-y-4 pt-4 border-t">
                        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                            <Label htmlFor="convenienceFeeEnabled" className="flex flex-col">
                                <span className="font-bold text-lg flex items-center gap-2"><Wallet size={18} />Online Payment Fee</span>
                                <span className="text-sm text-muted-foreground">Charge a processing fee for online payments</span>
                            </Label>
                            <Switch
                                id="convenienceFeeEnabled"
                                checked={editedUser.convenienceFeeEnabled || false}
                                onCheckedChange={(val) => setEditedUser({ ...editedUser, convenienceFeeEnabled: val })}
                                disabled={!isEditingCharges}
                            />
                        </div>

                        {editedUser.convenienceFeeEnabled && (
                            <div className="ml-6 p-4 border-l-4 border-primary/50 space-y-4 bg-muted/30 rounded">
                                <div>
                                    <Label htmlFor="convenienceFeeRate">Fee Rate (%)</Label>
                                    <input
                                        id="convenienceFeeRate"
                                        type="number"
                                        step="0.1"
                                        value={editedUser.convenienceFeeRate || 2.5}
                                        onChange={e => setEditedUser({ ...editedUser, convenienceFeeRate: parseFloat(e.target.value) || 0 })}
                                        disabled={!isEditingCharges}
                                        className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70"
                                        placeholder="2.5"
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Recommended: 2-3% to cover Razorpay&apos;s fees
                                    </p>
                                </div>
                                <div>
                                    <Label className="font-semibold">Who pays the fee?</Label>
                                    <div className="flex gap-3 mt-2">
                                        <Button
                                            type="button"
                                            variant={editedUser.convenienceFeePaidBy === 'customer' ? "default" : "outline"}
                                            onClick={() => setEditedUser({ ...editedUser, convenienceFeePaidBy: 'customer' })}
                                            disabled={!isEditingCharges}
                                            className="flex-1"
                                        >
                                            Customer Pays
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={editedUser.convenienceFeePaidBy === 'vendor' ? "default" : "outline"}
                                            onClick={() => setEditedUser({ ...editedUser, convenienceFeePaidBy: 'vendor' })}
                                            disabled={!isEditingCharges}
                                            className="flex-1"
                                        >
                                            I&apos;ll Absorb
                                        </Button>
                                    </div>
                                    {editedUser.convenienceFeePaidBy === 'customer' && (
                                        <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-xs text-green-700 dark:text-green-400">
                                            ✅ Recommended: Vendor receives full order amount
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <Label htmlFor="convenienceFeeLabel">Custom Label (shown to customer)</Label>
                                    <input
                                        id="convenienceFeeLabel"
                                        type="text"
                                        value={editedUser.convenienceFeeLabel || 'Payment Processing Fee'}
                                        onChange={e => setEditedUser({ ...editedUser, convenienceFeeLabel: e.target.value })}
                                        disabled={!isEditingCharges}
                                        className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70"
                                        placeholder="e.g., Payment Processing Fee"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Packaging Charges */}
                    <div className="space-y-4 pt-4 border-t">
                        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                            <Label htmlFor="packagingChargeEnabled" className="flex flex-col">
                                <span className="font-bold text-lg flex items-center gap-2"><Package size={18} />Packaging Charges</span>
                                <span className="text-sm text-muted-foreground">Charge for packing takeaway orders</span>
                            </Label>
                            <Switch
                                id="packagingChargeEnabled"
                                checked={editedUser.packagingChargeEnabled || false}
                                onCheckedChange={(val) => setEditedUser({ ...editedUser, packagingChargeEnabled: val })}
                                disabled={!isEditingCharges}
                            />
                        </div>

                        {editedUser.packagingChargeEnabled && (
                            <div className="ml-6 p-4 border-l-4 border-primary/50 space-y-4 bg-muted/30 rounded">
                                <div>
                                    <Label htmlFor="packagingChargeAmount">Amount (₹)</Label>
                                    <input
                                        id="packagingChargeAmount"
                                        type="number"
                                        value={editedUser.packagingChargeAmount || 0}
                                        onChange={e => setEditedUser({ ...editedUser, packagingChargeAmount: parseFloat(e.target.value) || 0 })}
                                        disabled={!isEditingCharges}
                                        className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70"
                                        placeholder="0"
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        This amount will be added to Takeaway orders.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </SectionCard>

            <SectionCard
                title="Tools & Links"
                description="Access important tools for your business."
            >
                <div className="grid md:grid-cols-2 gap-4">
                    <Link href="/street-vendor-dashboard/qr" passHref>
                        <Button variant="outline" className="w-full h-16 text-lg"><QrCode className="mr-2" /> My QR Code</Button>
                    </Link>
                    <Link href="/street-vendor-dashboard/payout-settings" passHref>
                        <Button variant="outline" className="w-full h-16 text-lg"><Banknote className="mr-2" /> Payout Settings</Button>
                    </Link>
                </div>
            </SectionCard>

            <SectionCard title="Account Security">
                <Button variant="destructive" onClick={() => setDeleteModalOpen(true)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete My Account
                </Button>
            </SectionCard>
        </div>
    );
}

export default function VendorProfilePage() {
    return (
        <Suspense fallback={<div className="p-6 text-center h-screen flex items-center justify-center"><Loader2 className="animate-spin h-16 w-16 text-primary" /></div>}>
            <VendorProfilePageContent />
        </Suspense>
    );
}
