'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { MapPin, LocateFixed, Loader2, Plus, Home, Building, Trash2, ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InfoDialog from '@/components/InfoDialog';
import { useUser } from '@/firebase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const SavedAddressCard = ({ address, onDelete, isAuth, index }) => {
    const Icon = address.label === 'Home' ? Home : address.label === 'Work' ? Building : MapPin;

    return (
        <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className="group flex gap-4 rounded-2xl border border-border/70 bg-card/65 p-4 transition-all hover:border-primary/35 hover:bg-primary/5"
        >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                <Icon size={20} />
            </div>
            <div className="min-w-0 flex-1">
                <h3 className="font-bold text-foreground">{address.label || 'Address'}</h3>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{address.full}</p>
                <p className="mt-2 text-xs text-muted-foreground">Phone: {address.phone || 'N/A'}</p>
            </div>
            {isAuth ? (
                <div className="flex-shrink-0">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full border border-destructive/25 text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(address.id);
                        }}
                    >
                        <Trash2 size={15} />
                    </Button>
                </div>
            ) : null}
        </motion.div>
    );
};

const ConfirmationDialog = ({ isOpen, onClose, onConfirm, title, message }) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-background border-border text-foreground rounded-2xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{message}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button variant="destructive" onClick={onConfirm}>Delete</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const AddressesPageInternal = () => {
    const router = useRouter();
    const { user, isUserLoading } = useUser();

    const [addresses, setAddresses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [addressToDelete, setAddressToDelete] = useState(null);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const fetchAddresses = useCallback(async () => {
        if (isUserLoading) return;

        setLoading(true);
        setError('');

        if (!user) {
            setLoading(false);
            setAddresses([]);
            return;
        }

        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/user/addresses', {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            if (!res.ok) throw new Error('Failed to fetch your saved addresses.');
            const data = await res.json();
            setAddresses(data.addresses || []);
        } catch (err) {
            console.error('[Addresses Page] Error fetching user addresses:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [user, isUserLoading]);

    useEffect(() => {
        fetchAddresses();
    }, [fetchAddresses]);

    const promptDeleteAddress = (addressId) => {
        setAddressToDelete(addressId);
        setIsConfirmOpen(true);
    };

    const confirmDeleteAddress = async () => {
        if (!addressToDelete) return;
        setIsConfirmOpen(false);

        if (!user) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'You must be logged in to delete an address.' });
            return;
        }

        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/user/addresses', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ addressId: addressToDelete }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Failed to delete address.');
            }
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Address deleted successfully.' });
            fetchAddresses();
        } catch (err) {
            setInfoDialog({ isOpen: true, title: 'Error', message: err.message });
        } finally {
            setAddressToDelete(null);
        }
    };

    const handleAddNewAddress = () => {
        const currentUrl = window.location.href;
        router.push(`/add-address?returnUrl=${encodeURIComponent(currentUrl)}`);
    };

    const handleUseCurrentLocation = () => {
        const currentUrl = window.location.href;
        router.push(`/add-address?useCurrent=true&returnUrl=${encodeURIComponent(currentUrl)}`);
    };

    return (
        <div className="px-4 py-5 md:px-6 md:py-7 space-y-5">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <ConfirmationDialog
                isOpen={isConfirmOpen}
                onClose={() => setIsConfirmOpen(false)}
                onConfirm={confirmDeleteAddress}
                title="Confirm Deletion"
                message="Are you sure you want to permanently delete this address?"
            />

            <header className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card/80 to-emerald-500/10 p-5">
                <div className="flex flex-wrap items-center gap-3">
                    <Button variant="ghost" size="icon" className="rounded-full border border-border/70" onClick={() => router.push('/customer-dashboard/profile')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                            <Sparkles className="h-3.5 w-3.5" />
                            Address Vault
                        </div>
                        <h1 className="mt-2 font-[family-name:var(--font-customer-display)] text-3xl font-bold tracking-tight">My Addresses</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Save and manage your delivery points for faster checkout.</p>
                    </div>
                </div>
            </header>

            <div className="grid gap-3 md:grid-cols-2">
                <button
                    onClick={handleUseCurrentLocation}
                    className="w-full rounded-2xl border border-border/70 bg-card/65 p-4 text-left transition-all hover:border-primary/35 hover:bg-primary/5"
                >
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                            <LocateFixed className="h-5 w-5" />
                        </span>
                        <div>
                            <p className="font-semibold text-foreground">Use current location</p>
                            <p className="text-xs text-muted-foreground">Detect via GPS for precise pin</p>
                        </div>
                    </div>
                </button>
                <button
                    onClick={handleAddNewAddress}
                    className="w-full rounded-2xl border border-border/70 bg-card/65 p-4 text-left transition-all hover:border-primary/35 hover:bg-primary/5"
                >
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                            <Plus className="h-5 w-5" />
                        </span>
                        <div>
                            <p className="font-semibold text-foreground">Add new address</p>
                            <p className="text-xs text-muted-foreground">Pin custom location on map</p>
                        </div>
                    </div>
                </button>
            </div>

            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Saved Addresses</h2>
                    {!loading && user ? <span className="text-xs text-muted-foreground">{addresses.length} total</span> : null}
                </div>

                {isUserLoading || loading ? (
                    <div className="min-h-[32vh] rounded-2xl border border-border/60 bg-card/40 flex justify-center items-center">
                        <Loader2 className="animate-spin text-primary h-8 w-8" />
                    </div>
                ) : error ? (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">{error}</div>
                ) : !user ? (
                    <div className="rounded-2xl border border-border/60 bg-card/40 p-5 text-sm text-muted-foreground">
                        Please log in to manage your addresses.
                    </div>
                ) : addresses.length > 0 ? (
                    <div className="space-y-3">
                        {addresses.map((address, index) => (
                            <SavedAddressCard
                                key={address.id}
                                address={address}
                                onDelete={promptDeleteAddress}
                                isAuth={!!user}
                                index={index}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center text-muted-foreground">
                        <p className="font-semibold text-foreground">No saved addresses found</p>
                        <p className="text-sm mt-1">Add your first address to speed up checkout.</p>
                    </div>
                )}
            </section>
        </div>
    );
};

export default function AddressesPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary h-16 w-16" /></div>}>
            <AddressesPageInternal />
        </Suspense>
    );
}
