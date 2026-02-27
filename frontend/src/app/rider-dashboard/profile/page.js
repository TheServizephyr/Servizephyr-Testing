
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Phone, Edit, Save, XCircle, KeyRound, Eye, EyeOff, Loader2, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser } from '@/firebase';
import { getAuth, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import InfoDialog from '@/components/InfoDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const SectionCard = ({ title, description, children, footer }) => (
    <motion.div
        className="bg-card border border-border rounded-xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
    >
        <div className="p-6 border-b border-border">
            <h2 className="text-xl font-bold text-foreground">{title}</h2>
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="p-6">
            {children}
        </div>
        {footer && <div className="p-6 bg-muted/30 border-t border-border rounded-b-xl">{footer}</div>}
    </motion.div>
);

// 🏪 Restaurant Connection Card Component
const RestaurantConnectionCard = ({ restaurantId }) => {
    const [restaurant, setRestaurant] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchRestaurant = async () => {
            try {
                // Try restaurants collection first
                let docRef = doc(db, 'restaurants', restaurantId);
                let docSnap = await getDoc(docRef);

                if (!docSnap.exists()) {
                    // Try shops collection
                    docRef = doc(db, 'shops', restaurantId);
                    docSnap = await getDoc(docRef);
                }

                if (docSnap.exists()) {
                    setRestaurant({ id: docSnap.id, ...docSnap.data() });
                }
            } catch (err) {
                console.error('[Restaurant Card] Fetch error:', err);
            } finally {
                setLoading(false);
            }
        };

        if (restaurantId) {
            fetchRestaurant();
        }
    }, [restaurantId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-4">
                <Loader2 className="animate-spin text-primary" size={24} />
            </div>
        );
    }

    if (!restaurant) {
        return <p className="text-sm text-muted-foreground text-center">Restaurant not found</p>;
    }

    return (
        <div className="space-y-3">
            <div className="flex items-start gap-3">
                <div className="bg-primary/20 p-3 rounded-full">
                    <ShoppingBag className="text-primary" size={20} />
                </div>
                <div className="flex-1">
                    <h4 className="text-lg font-bold text-foreground">{restaurant.name}</h4>
                    {restaurant.address && (
                        <p className="text-sm text-muted-foreground mt-1">
                            📍 {restaurant.address.street}, {restaurant.address.city}
                        </p>
                    )}
                    {restaurant.ownerPhone && (
                        <p className="text-sm text-muted-foreground mt-1">
                            📞 {restaurant.ownerPhone}
                        </p>
                    )}
                </div>
                <div className="bg-green-500/20 px-3 py-1 rounded-full">
                    <span className="text-xs font-bold text-green-400">✓ Active</span>
                </div>
            </div>
        </div>
    );
};

export default function RiderProfilePage() {
    const { user, isUserLoading } = useUser();
    const [riderData, setRiderData] = useState(null);
    const [editedData, setEditedData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        if (!isUserLoading && user) {
            const fetchRiderData = async () => {
                const docRef = doc(db, 'drivers', user.uid);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setRiderData(data);
                    setEditedData(data);
                } else {
                    setInfoDialog({ isOpen: true, title: 'Error', message: 'Rider profile not found.' });
                }
                setLoading(false);
            };
            fetchRiderData();
        }
    }, [user, isUserLoading]);

    const handleSave = async () => {
        if (!editedData.name || !editedData.phone) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Name and phone cannot be empty.' });
            return;
        }

        try {
            const docRef = doc(db, 'drivers', user.uid);
            await updateDoc(docRef, {
                name: editedData.name,
                phone: editedData.phone,
            });
            setRiderData(editedData);
            setIsEditing(false);
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Profile updated successfully!' });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to update profile: ${error.message}` });
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin text-primary" /></div>;
    }

    return (
        <div className="space-y-8">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <h1 className="text-3xl font-bold tracking-tight">My Rider Profile</h1>

            <SectionCard
                title="Personal Information"
                description="Manage your personal details."
                footer={
                    <div className="flex justify-end gap-3">
                        {isEditing ? (
                            <>
                                <Button variant="secondary" onClick={() => { setIsEditing(false); setEditedData(riderData); }}>
                                    <XCircle className="mr-2 h-4 w-4" /> Cancel
                                </Button>
                                <Button onClick={handleSave} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                                    <Save className="mr-2 h-4 w-4" /> Save Profile
                                </Button>
                            </>
                        ) : (
                            <Button onClick={() => setIsEditing(true)}>
                                <Edit className="mr-2 h-4 w-4" /> Edit Profile
                            </Button>
                        )}
                    </div>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <div className="flex items-center gap-4">
                        <Avatar className="h-20 w-20 border-4 border-primary/20">
                            <AvatarImage src={riderData?.profilePictureUrl || user?.photoURL} />
                            <AvatarFallback>{riderData?.name?.charAt(0) || 'R'}</AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="text-2xl font-bold">{riderData?.name}</p>
                            <span className="text-muted-foreground">{user?.email}</span>
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div>
                            <Label htmlFor="name" className="flex items-center gap-2"><User size={14} /> Full Name</Label>
                            <Input id="name" value={editedData?.name || ''} onChange={e => setEditedData({ ...editedData, name: e.target.value })} disabled={!isEditing} />
                        </div>
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2"><Phone size={14} /> Phone Number</Label>
                            <Input id="phone" value={editedData?.phone || ''} onChange={e => setEditedData({ ...editedData, phone: e.target.value })} disabled={!isEditing} />
                        </div>
                    </div>
                </div>
            </SectionCard>

            {/* 🏪 Connected Restaurant Card */}
            {riderData?.currentRestaurantId && (
                <SectionCard
                    title="Connected Restaurant"
                    description="The restaurant you are currently delivering for."
                >
                    <RestaurantConnectionCard restaurantId={riderData.currentRestaurantId} />
                </SectionCard>
            )}
        </div>
    );
}
