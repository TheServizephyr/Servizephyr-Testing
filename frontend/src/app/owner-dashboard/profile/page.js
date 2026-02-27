
'use client';

import { motion } from 'framer-motion';
import { User, LogOut, ChevronRight, ShoppingBag, MapPin, Settings, Edit, Save, XCircle, Trash2, KeyRound, Eye, EyeOff } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from '@/components/ui/card';
import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import InfoDialog from '@/components/InfoDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { getAuth, updatePassword, EmailAuthProvider, reauthenticateWithCredential, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';


const DeleteAccountModal = ({ isOpen, setIsOpen }) => {
    const [confirmationText, setConfirmationText] = useState("");
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const isDeleteDisabled = confirmationText !== "DELETE";

    const handleDelete = async () => {
        try {
            const user = getAuth().currentUser;
            if (user) {
                // Re-authenticate with Google Popup before deleting
                const provider = new GoogleAuthProvider();
                await signInWithPopup(user, provider);

                const idToken = await user.getIdToken(true); // Force refresh token
                const response = await fetch('/api/user/delete', {
                    method: 'POST', // Changed to POST as DELETE with body can be tricky
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
                            This is a security-sensitive action. You will be asked to sign in with Google again to confirm your identity before your account is deleted. This is irreversible.
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


const ProfileOption = ({ icon, title, description, onClick }) => (
    <motion.div
        onClick={onClick}
        className="flex items-center p-4 bg-background hover:bg-muted rounded-lg cursor-pointer transition-colors"
        whileTap={{ scale: 0.98 }}
    >
        <div className="mr-4 bg-muted p-3 rounded-full text-primary">
            {icon}
        </div>
        <div className="flex-grow">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ChevronRight className="text-muted-foreground" />
    </motion.div>
);

export default function ProfilePage() {
    const router = useRouter();
    const { user: authUser, isUserLoading: isAuthLoading } = useUser();
    const [profileData, setProfileData] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState('');
    const [editedPhone, setEditedPhone] = useState('');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);

    useEffect(() => {
        const fetchProfileData = async () => {
            if (authUser) {
                try {
                    const idToken = await authUser.getIdToken();
                    // Using the same settings API as owner, as it can fetch user data
                    const response = await fetch('/api/owner/settings', {
                        headers: { 'Authorization': `Bearer ${idToken}` }
                    });
                    if (!response.ok) throw new Error("Failed to fetch profile data.");
                    const data = await response.json();
                    setProfileData(data);
                    setEditedName(data.name || authUser.displayName || '');
                    setEditedPhone(data.phone || authUser.phoneNumber || '');
                } catch (error) {
                    console.error("Error fetching profile data:", error);
                    setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load your profile details.' });
                    // Fallback to authUser data
                    setProfileData({
                        name: authUser.displayName,
                        email: authUser.email,
                        phone: authUser.phoneNumber,
                        profilePicture: authUser.photoURL
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
            const response = await fetch('/api/owner/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ name: editedName, phone: editedPhone }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || "Failed to update profile.");
            }

            const updatedData = await response.json();
            setProfileData(updatedData); // Re-sync state with the backend response
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Profile updated successfully!' });
            setIsEditing(false);

        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        }
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditedName(profileData?.name || '');
        setEditedPhone(profileData?.phone || '');
    }


    if (isAuthLoading || !profileData) {
        return (
            <div className="flex items-center justify-center h-[calc(100vh-100px)]">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
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
            <DeleteAccountModal isOpen={isDeleteModalOpen} setIsOpen={setDeleteModalOpen} />
            <div className="p-4 md:p-6 space-y-6">
                <header className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">My Profile</h1>
                        <p className="text-muted-foreground mt-1">Manage your orders, addresses, and settings.</p>
                    </div>
                    {isEditing ? (
                        <div className="flex gap-2">
                            <Button variant="secondary" onClick={handleCancelEdit}>
                                <XCircle size={16} className="mr-2" /> Cancel
                            </Button>
                            <Button onClick={handleSaveProfile} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                                <Save size={16} className="mr-2" /> Save
                            </Button>
                        </div>
                    ) : (
                        <Button variant="outline" onClick={() => setIsEditing(true)}>
                            <Edit size={16} className="mr-2" /> Edit Profile
                        </Button>
                    )}
                </header>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <Card className="p-6">
                        <div className="flex flex-col sm:flex-row items-center gap-4">
                            <Avatar className="h-20 w-20 border-4 border-primary/20">
                                <AvatarImage src={profileData?.profilePicture || authUser?.photoURL || ''} alt={profileData?.name || 'User'} />
                                <AvatarFallback className="text-2xl bg-muted">{profileData?.name?.charAt(0) || 'U'}</AvatarFallback>
                            </Avatar>
                            <div className="flex-grow w-full">
                                {isEditing ? (
                                    <div className="space-y-4">
                                        <div>
                                            <Label htmlFor="name">Full Name</Label>
                                            <Input id="name" value={editedName} onChange={e => setEditedName(e.target.value)} />
                                        </div>
                                        <div>
                                            <Label htmlFor="phone">Phone Number</Label>
                                            <Input id="phone" value={editedPhone} onChange={e => setEditedPhone(e.target.value)} />
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <h2 className="text-2xl font-bold">{profileData?.name || 'Hello, User!'}</h2>
                                        <p className="text-muted-foreground">{profileData?.email || authUser?.email}</p>
                                        <p className="text-muted-foreground">{profileData?.phone || 'No phone number'}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="space-y-3"
                >
                    <ProfileOption
                        icon={<ShoppingBag size={20} />}
                        title="My Orders"
                        description="View your past and current orders"
                        onClick={() => router.push('/customer-dashboard/orders')}
                    />
                    <ProfileOption
                        icon={<MapPin size={20} />}
                        title="My Addresses"
                        description="Manage your saved delivery locations"
                        onClick={() => router.push('/customer-dashboard/addresses')}
                    />
                    <ProfileOption
                        icon={<Settings size={20} />}
                        title="Account Settings"
                        description="Update your notification preferences"
                        onClick={() => router.push('/customer-dashboard/settings')}
                    />
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="mt-8"
                >
                    <Button onClick={() => setDeleteModalOpen(true)} variant="destructive">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete My Account
                    </Button>
                    <Button onClick={handleLogout} variant="outline" className="w-full md:w-auto ml-4">
                        <LogOut className="mr-2 h-4 w-4" /> Logout
                    </Button>
                </motion.div>
            </div>
        </>
    );
}
