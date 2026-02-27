'use client';

import { motion } from 'framer-motion';
import { LogOut, ChevronRight, ShoppingBag, MapPin, Settings, Edit, Save, XCircle, ShieldCheck, Sparkles, BarChart3 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import InfoDialog from '@/components/InfoDialog';

const ProfileOption = ({ icon, title, description, onClick }) => (
    <motion.button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-4 rounded-2xl border border-border/70 bg-card/65 p-4 text-left transition-all hover:border-primary/35 hover:bg-primary/5"
        whileTap={{ scale: 0.99 }}
    >
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
            {icon}
        </div>
        <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </motion.button>
);

export default function ProfilePage() {
    const router = useRouter();
    const { user: authUser, isUserLoading: isAuthLoading } = useUser();
    const [profileData, setProfileData] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState('');
    const [editedPhone, setEditedPhone] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        const fetchProfileData = async () => {
            if (authUser) {
                try {
                    const idToken = await authUser.getIdToken();
                    const response = await fetch('/api/customer/profile', {
                        headers: { Authorization: `Bearer ${idToken}` },
                    });
                    if (!response.ok) throw new Error('Failed to fetch profile data.');
                    const data = await response.json();
                    setProfileData(data);
                    setEditedName(data.name || authUser.displayName || '');
                    setEditedPhone(data.phone || authUser.phoneNumber || '');
                } catch (error) {
                    console.error('Error fetching profile data:', error);
                    setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load your profile details.' });
                    setProfileData({
                        name: authUser.displayName,
                        email: authUser.email,
                        phone: authUser.phoneNumber,
                        profilePicture: authUser.photoURL,
                    });
                    setEditedName(authUser.displayName || '');
                    setEditedPhone(authUser.phoneNumber || '');
                }
            }
        };

        if (!isAuthLoading) {
            fetchProfileData();
        }
    }, [authUser, isAuthLoading]);

    const handleLogout = async () => {
        await auth.signOut();
        localStorage.clear();
        router.push('/');
    };

    const handleSaveProfile = async () => {
        if (!editedName || !editedPhone) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Name and phone cannot be empty.' });
            return;
        }

        try {
            const idToken = await authUser.getIdToken();
            const response = await fetch('/api/customer/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ name: editedName, phone: editedPhone }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update profile.');
            }

            const updatedData = await response.json();
            setProfileData(updatedData);
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Profile updated successfully.' });
            setIsEditing(false);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        }
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditedName(profileData?.name || '');
        setEditedPhone(profileData?.phone || '');
    };

    if (isAuthLoading || !profileData) {
        return (
            <div className="flex items-center justify-center h-[calc(100vh-120px)]">
                <LoaderFallback />
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
            />
            <div className="px-4 py-5 md:px-6 md:py-7 space-y-6">
                <header className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card/80 to-blue-500/10 p-5 md:p-6">
                    <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
                    <div className="relative flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                                <Sparkles className="h-3.5 w-3.5" />
                                Account Center
                            </div>
                            <h1 className="mt-3 font-[family-name:var(--font-customer-display)] text-3xl font-bold tracking-tight">My Profile</h1>
                            <p className="mt-2 text-sm text-muted-foreground">Manage account details, addresses, and preferences from one place.</p>
                        </div>
                        {isEditing ? (
                            <div className="flex gap-2">
                                <Button variant="secondary" className="rounded-xl" onClick={handleCancelEdit}>
                                    <XCircle size={16} className="mr-2" /> Cancel
                                </Button>
                                <Button className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSaveProfile}>
                                    <Save size={16} className="mr-2" /> Save
                                </Button>
                            </div>
                        ) : (
                            <Button variant="outline" className="rounded-xl" onClick={() => setIsEditing(true)}>
                                <Edit size={16} className="mr-2" /> Edit Profile
                            </Button>
                        )}
                    </div>
                </header>

                <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
                    <Card className="rounded-3xl border border-border/70 bg-card/70 p-6 shadow-[0_24px_45px_-34px_rgba(2,6,23,0.95)]">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                            <Avatar className="h-24 w-24 border-4 border-primary/25 shadow-lg">
                                <AvatarImage src={profileData?.profilePicture || authUser?.photoURL || ''} alt={profileData?.name || 'User'} />
                                <AvatarFallback className="text-2xl bg-muted">{profileData?.name?.charAt(0) || 'U'}</AvatarFallback>
                            </Avatar>

                            <div className="flex-1 min-w-0">
                                {isEditing ? (
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor="name">Full Name</Label>
                                            <Input id="name" value={editedName} onChange={(e) => setEditedName(e.target.value)} className="rounded-xl" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="phone">Phone Number</Label>
                                            <Input id="phone" value={editedPhone} onChange={(e) => setEditedPhone(e.target.value)} className="rounded-xl" />
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <h2 className="text-2xl font-bold">{profileData?.name || 'Hello, User'}</h2>
                                        {(profileData?.customerId || authUser?.customerId) ? (
                                            <p className="mt-1 text-sm font-mono text-primary font-semibold tracking-wide">
                                                ID: {profileData?.customerId || authUser?.customerId}
                                            </p>
                                        ) : null}
                                        <p className="mt-2 text-muted-foreground break-all">{profileData?.email || authUser?.email}</p>
                                        <p className="text-muted-foreground">{profileData?.phone || 'No phone number'}</p>
                                    </div>
                                )}

                                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    Account verified
                                </div>
                            </div>
                        </div>
                    </Card>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.06 }}
                    className="space-y-3"
                >
                    <ProfileOption
                        icon={<BarChart3 size={20} />}
                        title="My Analytics"
                        description="Track spend, loyalty points, and food patterns"
                        onClick={() => router.push('/customer-dashboard/analytics')}
                    />
                    <ProfileOption
                        icon={<ShoppingBag size={20} />}
                        title="My Orders"
                        description="View your complete order history"
                        onClick={() => router.push('/customer-dashboard/orders')}
                    />
                    <ProfileOption
                        icon={<MapPin size={20} />}
                        title="My Addresses"
                        description="Manage saved delivery locations"
                        onClick={() => router.push('/customer-dashboard/addresses')}
                    />
                    <ProfileOption
                        icon={<Settings size={20} />}
                        title="Account Settings"
                        description="Notifications, security, and preferences"
                        onClick={() => router.push('/customer-dashboard/settings')}
                    />
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
                    <Button onClick={handleLogout} variant="destructive" className="w-full rounded-xl md:w-auto">
                        <LogOut className="mr-2 h-4 w-4" /> Logout
                    </Button>
                </motion.div>
            </div>
        </>
    );
}

function LoaderFallback() {
    return <div className="h-16 w-16 animate-spin rounded-full border-2 border-primary border-t-transparent" />;
}
