'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { User, Mail, Phone, Shield, Edit, Save, XCircle, Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { getAuth } from 'firebase/auth';
import Image from 'next/image';
import InfoDialog from '@/components/InfoDialog';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

export const dynamic = 'force-dynamic';

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

function MyProfileContent() {
    const searchParams = useSearchParams();
    const employeeOfOwnerId = searchParams.get('employee_of');

    const [profile, setProfile] = useState(null);
    const [editedProfile, setEditedProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        const fetchProfile = async () => {
            const currentUser = getAuth().currentUser;
            if (!currentUser) {
                console.log('[MyProfile] No currentUser found');
                setLoading(false);
                return;
            }
            try {
                // For employees, use localStorage role (set by select-role page, same as layout.js)
                let storedRole = null;
                if (employeeOfOwnerId) {
                    storedRole = localStorage.getItem('employeeRole');
                    console.log('[MyProfile] Using localStorage employeeRole:', storedRole);
                }

                const idToken = await currentUser.getIdToken();
                let url = '/api/employee/me';
                if (employeeOfOwnerId) {
                    url += `?employee_of=${employeeOfOwnerId}`;
                }

                console.log('[MyProfile] Fetching:', url);
                let apiData = {};

                try {
                    const response = await fetch(url, {
                        headers: { 'Authorization': `Bearer ${idToken}` }
                    });

                    if (response.ok) {
                        apiData = await response.json();
                        console.log('[MyProfile] API Response:', apiData);
                    } else {
                        console.warn('[MyProfile] API returned error, using fallback');
                    }
                } catch (apiError) {
                    console.warn('[MyProfile] API fetch failed:', apiError.message);
                }

                // Combine API data with auth data and localStorage role
                const profileData = {
                    ...apiData,
                    email: currentUser.email,
                    photoURL: currentUser.photoURL,
                    displayName: apiData.name || currentUser.displayName || currentUser.email?.split('@')[0],
                    // Use localStorage role if available (for employees), otherwise use API role
                    role: storedRole || apiData.role || 'owner',
                };

                setProfile(profileData);
                setEditedProfile(profileData);
            } catch (error) {
                console.error("[MyProfile] Error fetching profile:", error);
                // Still set basic profile from Firebase Auth if API fails
                const fallbackUser = getAuth().currentUser;
                if (fallbackUser) {
                    const storedRole = employeeOfOwnerId ? localStorage.getItem('employeeRole') : null;
                    const basicProfile = {
                        email: fallbackUser.email,
                        displayName: fallbackUser.displayName || fallbackUser.email?.split('@')[0],
                        photoURL: fallbackUser.photoURL,
                        role: storedRole || 'owner',
                    };
                    setProfile(basicProfile);
                    setEditedProfile(basicProfile);
                } else {
                    setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
                }
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = getAuth().onAuthStateChanged(user => {
            if (user) {
                fetchProfile();
            } else {
                setLoading(false);
            }
        });

        return () => unsubscribe();
    }, [employeeOfOwnerId]);

    const handleEditToggle = () => {
        if (isEditing) {
            setEditedProfile(profile);
        }
        setIsEditing(!isEditing);
    };

    const handleSave = async () => {
        const currentUser = getAuth().currentUser;
        if (!currentUser || !editedProfile) return;

        setSaving(true);
        try {
            const idToken = await currentUser.getIdToken();
            let url = '/api/employee/me';
            if (employeeOfOwnerId) {
                url += `?employee_of=${employeeOfOwnerId}`;
            }

            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    name: editedProfile.displayName,
                    phone: editedProfile.phone,
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to update profile');
            }

            const updatedData = await response.json();
            setProfile({ ...profile, ...updatedData, displayName: updatedData.name });
            setEditedProfile({ ...editedProfile, ...updatedData, displayName: updatedData.name });
            setIsEditing(false);
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Profile updated successfully!' });

        } catch (error) {
            console.error("Error saving profile:", error);
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="p-6 text-center h-screen flex items-center justify-center">
                <GoldenCoinSpinner />
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="p-6 text-center h-screen flex items-center justify-center">
                <p>Could not load profile. Please log in again.</p>
            </div>
        );
    }

    const getRoleBadgeColor = (role) => {
        switch (role) {
            case 'owner': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
            case 'manager': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
            case 'cashier': return 'bg-green-500/10 text-green-500 border-green-500/20';
            case 'chef': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
            case 'waiter': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            case 'delivery': return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
            default: return 'bg-primary/10 text-primary border-primary/20';
        }
    };

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background space-y-8">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <h1 className="text-3xl font-bold tracking-tight">My Profile</h1>

            <SectionCard
                title="Profile Information"
                description="Your personal information and role details."
                footer={
                    <div className="flex justify-end gap-3">
                        {isEditing ? (
                            <>
                                <Button variant="secondary" onClick={handleEditToggle} disabled={saving}>
                                    <XCircle className="mr-2 h-4 w-4" /> Cancel
                                </Button>
                                <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Changes
                                </Button>
                            </>
                        ) : (
                            <Button onClick={handleEditToggle}>
                                <Edit className="mr-2 h-4 w-4" /> Edit Profile
                            </Button>
                        )}
                    </div>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    {/* Profile Picture & Role */}
                    <div className="flex items-center gap-4">
                        <div className="relative w-24 h-24 rounded-full border-4 border-border overflow-hidden">
                            <Image
                                src={profile.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${profile.displayName}`}
                                alt="Profile"
                                layout="fill"
                                objectFit="cover"
                            />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{profile.displayName || profile.name}</p>
                            <span className={`inline-flex items-center gap-2 mt-2 px-3 py-1 text-sm font-semibold rounded-full border capitalize ${getRoleBadgeColor(profile.role)}`}>
                                <Shield size={14} />
                                {profile.role || 'Employee'}
                            </span>
                        </div>
                    </div>

                    {/* Editable Fields */}
                    <div className="space-y-6">
                        <div>
                            <Label htmlFor="displayName" className="flex items-center gap-2">
                                <User size={14} /> Name
                            </Label>
                            <input
                                id="displayName"
                                value={editedProfile?.displayName || ''}
                                onChange={e => setEditedProfile({ ...editedProfile, displayName: e.target.value })}
                                disabled={!isEditing}
                                className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed"
                            />
                        </div>
                        <div>
                            <Label htmlFor="email" className="flex items-center gap-2">
                                <Mail size={14} /> Email Address
                            </Label>
                            <input
                                id="email"
                                value={profile.email || ''}
                                disabled
                                className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
                        </div>
                        <div>
                            <Label htmlFor="phone" className="flex items-center gap-2">
                                <Phone size={14} /> Phone Number
                            </Label>
                            <input
                                id="phone"
                                value={editedProfile?.phone || ''}
                                onChange={e => setEditedProfile({ ...editedProfile, phone: e.target.value })}
                                disabled={!isEditing}
                                placeholder="Enter your phone number"
                                className="mt-1 w-full p-2 border rounded-md bg-input border-border disabled:opacity-70 disabled:cursor-not-allowed"
                            />
                        </div>
                    </div>

                    {/* Outlet Info */}
                    {profile.ownerId && (
                        <div className="md:col-span-2 p-4 bg-muted/30 rounded-lg border border-border">
                            <h4 className="font-semibold flex items-center gap-2 mb-2">
                                <Building2 size={16} /> Linked Outlet
                            </h4>
                            <p className="text-sm text-muted-foreground">
                                You are working as a <span className="font-semibold capitalize">{profile.role}</span> at this outlet.
                            </p>
                        </div>
                    )}
                </div>
            </SectionCard>
        </div>
    );
}

export default function MyProfilePage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><GoldenCoinSpinner /></div>}>
            <MyProfileContent />
        </Suspense>
    );
}
