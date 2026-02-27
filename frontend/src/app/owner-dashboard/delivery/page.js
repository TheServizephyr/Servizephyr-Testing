

"use client";

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { Phone, Bike, Mail, Search, Edit, RefreshCw, Star, Clock, Trophy, ChevronDown, ChevronUp, BarChart as BarChartIcon, Settings, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { cn } from "@/lib/utils";
import { auth } from '@/lib/firebase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useSearchParams } from 'next/navigation';
import { Switch } from '@/components/ui/switch';
import InfoDialog from '@/components/InfoDialog';
import Link from 'next/link';
import { Trash2, Upload, QrCode, AlertTriangle } from 'lucide-react'; // Added icons
import imageCompression from 'browser-image-compression'; // ✅ Image Compression

const StatusBadge = ({ status }) => {
    const statusConfig = {
        'Available': 'bg-green-500/10 text-green-400 border-green-500/20',
        'On Delivery': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        'Inactive': 'bg-muted text-muted-foreground border-border',
        'No Signal': 'bg-red-500/10 text-red-400 border-red-500/20', // ✅ STEP 3D: Offline detection
    };
    return (
        <span className={cn('px-2 py-1 text-xs font-semibold rounded-full border', statusConfig[status] || statusConfig['Inactive'])}>
            {status}
        </span>
    );
};

const InviteRiderModal = ({ isOpen, setIsOpen, onInvite }) => {
    const [email, setEmail] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [modalError, setModalError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setEmail('');
            setIsSubmitting(false);
            setModalError('');
        }
    }, [isOpen]);

    const handleSubmit = async () => {
        setModalError('');
        if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
            setModalError('Please enter a valid email address.');
            return;
        }
        setIsSubmitting(true);
        try {
            await onInvite(email);
            setIsOpen(false);
        } catch (error) {
            setModalError(error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Invite a New Rider</DialogTitle>
                    <DialogDescription>
                        Enter the email address of the rider you want to invite. They must have already registered an account on the Rider Portal.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="email" className="text-right">Rider&apos;s Email</Label>
                        <input id="email" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="rider@example.com" className="col-span-3 p-2 border rounded-md bg-input border-border" />
                    </div>
                    {modalError && <p className="text-destructive text-center text-sm">{modalError}</p>}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={isSubmitting}>Cancel</Button></DialogClose>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? 'Sending...' : 'Send Invitation'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
};


const AssignOrderModal = ({ isOpen, setIsOpen, onAssign, boyName, readyOrders }) => {
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    const handleAssign = async () => {
        if (selectedOrder) {
            setIsSaving(true);
            try {
                await onAssign(selectedOrder);
                setIsOpen(false);
            } catch (error) {
                // error alert shown in onAssign
                throw error;
            }
            finally {
                setIsSaving(false);
            }
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>Assign Order to {boyName}</DialogTitle>
                    <DialogDescription>Select an order that is ready for dispatch.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-3 max-h-60 overflow-y-auto">
                    <h4 className="font-semibold text-muted-foreground">Ready Orders:</h4>
                    {readyOrders && readyOrders.length > 0 ? readyOrders.map(order => (
                        <div
                            key={order.id}
                            onClick={() => setSelectedOrder(order.id)}
                            className={cn(
                                "p-3 rounded-lg border cursor-pointer transition-all",
                                selectedOrder === order.id
                                    ? 'bg-primary/10 border-primary ring-2 ring-primary'
                                    : 'bg-muted/50 border-border hover:bg-muted'
                            )}
                        >
                            <div className="flex justify-between items-center">
                                <p className="font-bold">{order.id}</p>
                                <p className="text-sm text-muted-foreground">for {order.customer}</p>
                                <p className="text-xs text-muted-foreground">{order.items} items</p>
                            </div>
                        </div>
                    )) : <p className="text-center text-muted-foreground">No orders are ready.</p>}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleAssign} disabled={!selectedOrder || isSaving}>
                        {isSaving ? 'Assigning...' : 'Confirm Assignment'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const PerformanceCard = ({ title, value, icon: Icon, onClick, isLoading }) => (
    <div
        className={cn("bg-card p-4 rounded-lg flex items-center gap-4 border border-border", onClick && "cursor-pointer hover:bg-muted transition-colors", isLoading && 'animate-pulse')}
        onClick={onClick}
    >
        <div className="bg-muted p-3 rounded-full text-primary">
            <Icon size={24} />
        </div>
        <div>
            {isLoading ? (
                <>
                    <div className="h-4 bg-muted-foreground/20 rounded w-24 mb-2"></div>
                    <div className="h-6 bg-muted-foreground/20 rounded w-16"></div>
                </>
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">{title}</p>
                    <p className="text-xl font-bold text-foreground">{value}</p>
                </>
            )}
        </div>
    </div>
);

const SortableHeader = ({ children, column, sortConfig, onSort }) => {
    const isSorted = sortConfig.key === column;
    const direction = isSorted ? sortConfig.direction : 'desc';
    const Icon = direction === 'asc' ? ChevronUp : ChevronDown;

    return (
        <th onClick={() => onSort(column)} className="cursor-pointer p-4 text-left text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors">
            <div className="flex items-center gap-2">
                {children}
                {isSorted && <Icon size={16} />}
            </div>
        </th>
    );
};

const DeliveryAnalytics = ({ boysData, weeklyData, isLoading }) => {
    const [sortConfig, setSortConfig] = useState({ key: 'totalDeliveries', direction: 'desc' });
    const [searchQuery, setSearchQuery] = useState("");

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const filteredAndSortedRiders = useMemo(() => {
        if (!boysData) return [];
        let filtered = [...boysData];
        if (searchQuery) {
            filtered = filtered.filter(boy => (boy.name || '').toLowerCase().includes(searchQuery.toLowerCase()));
        }
        filtered.sort((a, b) => {
            if (a[sortConfig.key] < b[sortConfig.key]) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (a[sortConfig.key] > b[sortConfig.key]) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
        return filtered;
    }, [searchQuery, sortConfig, boysData]);

    return (
        <div className="mt-8 space-y-6">
            <h2 className="text-2xl font-bold tracking-tight">Delivery Analytics Hub</h2>
            <section>
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><BarChartIcon /> Team&apos;s Weekly Performance</h3>
                <div className="bg-card border border-border rounded-xl p-5 h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weeklyData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis fontSize={12} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} formatter={(value) => [value, "Deliveries"]} />
                            <Bar dataKey="deliveries" fill="hsl(var(--primary))" name="Total Deliveries" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </section>
            <section>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold">Rider Deep Dive</h3>
                    <div className="relative w-full md:w-auto max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                        <input
                            type="text"
                            placeholder="Search rider..."
                            className="bg-input border border-border rounded-lg w-full pl-10 pr-4 py-2 focus:ring-2 focus:ring-primary outline-none"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-muted/50">
                                    <SortableHeader column="name" sortConfig={sortConfig} onSort={handleSort}>Rider</SortableHeader>
                                    <SortableHeader column="totalDeliveries" sortConfig={sortConfig} onSort={handleSort}>Total Deliveries</SortableHeader>
                                    <SortableHeader column="avgDeliveryTime" sortConfig={sortConfig} onSort={handleSort}>Avg. Time (min)</SortableHeader>
                                    <SortableHeader column="avgRating" sortConfig={sortConfig} onSort={handleSort}>Avg. Rating</SortableHeader>
                                    <th className="p-4 text-left text-sm font-semibold text-muted-foreground">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {isLoading ? Array.from({ length: 3 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded"></div></td>
                                    </tr>
                                )) : filteredAndSortedRiders.map(boy => (
                                    <tr key={boy.id} className="hover:bg-muted transition-colors">
                                        <td className="p-4 font-medium">{boy.name}</td>
                                        <td className="p-4 text-center font-bold text-lg">{boy.totalDeliveries || 0}</td>
                                        <td className="p-4 text-center">{boy.avgDeliveryTime || 0}</td>
                                        <td className="p-4 text-center flex items-center justify-center gap-1">
                                            {(boy.avgRating || 0).toFixed(1)} <Star size={14} className="text-yellow-400" />
                                        </td>
                                        <td className="p-4">
                                            <StatusBadge status={boy.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        </div>
    );
};

// ✅ PER-RIDER QR MANAGER
const RiderQRManager = ({ rider, onUpdate }) => {
    const [uploading, setUploading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '', type: 'info' });

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        try {
            // 0. AUTH CHECK
            const user = auth.currentUser;
            if (!user) throw new Error("You must be logged in.");
            const idToken = await user.getIdToken();

            // 1. COMPRESS IMAGE
            const options = {
                maxSizeMB: 0.5,
                maxWidthOrHeight: 1024,
                useWebWorker: true
            };
            const compressedFile = await imageCompression(file, options);
            console.log(`Original: ${(file.size / 1024).toFixed(2)}KB, Compressed: ${(compressedFile.size / 1024).toFixed(2)}KB`);

            // 2. PREPARE FORM DATA
            const formData = new FormData();
            formData.append('file', compressedFile, compressedFile.name);
            formData.append('riderId', rider.id);

            // 3. SERVER-SIDE UPLOAD (Avoids CORS issues)
            const res = await fetch('/api/owner/settings/upload-qr-url', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`
                },
                body: formData
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || 'Failed to upload image');
            }

            const { publicUrl } = await res.json();

            // 4. SAVE URL TO RIDER PROFILE
            await onUpdate({ id: rider.id, paymentQRCode: publicUrl });

            setInfoDialog({ isOpen: true, title: 'Success', message: 'QR Code updated successfully!', type: 'success' });
        } catch (error) {
            console.error(error);
            setInfoDialog({ isOpen: true, title: 'Upload Failed', message: error.message || 'Failed to upload QR Code', type: 'error' });
        } finally {
            setUploading(false);
        }
    };

    const handleRemove = async () => {
        if (!confirm('Are you sure you want to remove this QR code?')) return;
        setUploading(true);
        try {
            await onUpdate({ id: rider.id, paymentQRCode: null }); // Remove
            setInfoDialog({ isOpen: true, title: 'Success', message: 'QR Code removed successfully!', type: 'success' });
        } catch (error) {
            console.error(error);
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to remove QR Code', type: 'error' });
        } finally {
            setUploading(false);
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <div onClick={() => setIsOpen(true)} className="cursor-pointer hover:bg-muted p-1 rounded-md transition-colors" title="Manage Payment QR">
                    {rider.paymentQRCode ? (
                        <div className="relative">
                            <QrCode size={18} className="text-green-500" />
                            <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full border border-background"></div>
                        </div>
                    ) : (
                        <QrCode size={18} className="text-muted-foreground" />
                    )}
                </div>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Manage Payment QR for {rider.name}</DialogTitle>
                        <DialogDescription>
                            Upload a UPI QR code (Paytm/PhonePe/GPay) for this rider to collect payments.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col items-center gap-4 py-4">
                        <div className="bg-muted p-4 rounded-xl border border-dashed border-border flex items-center justify-center w-64 h-64 relative overflow-hidden">
                            {rider.paymentQRCode ? (
                                <Image
                                    src={rider.paymentQRCode}
                                    alt="QR"
                                    fill
                                    unoptimized
                                    sizes="256px"
                                    className="object-contain"
                                />
                            ) : (
                                <div className="text-center text-muted-foreground">
                                    <QrCode size={48} className="mx-auto mb-2 opacity-50" />
                                    <p>No QR Code Uploaded</p>
                                </div>
                            )}
                            {uploading && (
                                <div className="absolute inset-0 bg-background/50 flex items-center justify-center backdrop-blur-sm">
                                    <RefreshCw className="animate-spin text-primary" size={32} />
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 w-full">
                            <div className="flex-1">
                                <input
                                    type="file"
                                    accept="image/*"
                                    id={`qr-upload-${rider.id}`}
                                    className="hidden"
                                    onChange={handleFileChange}
                                    disabled={uploading}
                                />
                                <label htmlFor={`qr-upload-${rider.id}`} className="w-full">
                                    <Button variant="outline" className="w-full cursor-pointer" asChild disabled={uploading}>
                                        <span><Upload size={16} className="mr-2" /> {rider.paymentQRCode ? 'Update QR' : 'Upload QR'}</span>
                                    </Button>
                                </label>
                            </div>
                            {rider.paymentQRCode && (
                                <Button variant="destructive" onClick={handleRemove} disabled={uploading}>
                                    <Trash2 size={16} />
                                </Button>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ ...infoDialog, isOpen: false })}
                title={infoDialog.title}
                message={infoDialog.message}
                variant={infoDialog.type === 'error' ? 'destructive' : 'default'}
            />
        </>
    );
};

const DeleteConfirmationModal = ({ isOpen, setIsOpen, onConfirm, riderName }) => {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleConfirm = async () => {
        setIsDeleting(true);
        try {
            await onConfirm();
            setIsOpen(false);
        } catch (error) {
            // Error handling is managed by parent
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="bg-card border-border text-foreground sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="h-5 w-5" />
                        Confirm Deletion
                    </DialogTitle>
                    <DialogDescription className="py-2">
                        Are you sure you want to remove <span className="font-bold text-foreground">{riderName}</span> from your team?
                        <br /><br />
                        This action cannot be undone. The rider will lose access to the Rider App immediately.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="secondary" disabled={isDeleting}>Cancel</Button>
                    </DialogClose>
                    <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
                        {isDeleting ? 'Removing...' : 'Remove Rider'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default function DeliveryPage() {
    const [data, setData] = useState({ boys: [], performance: {}, readyOrders: [], weeklyPerformance: [] });
    const [settings, setSettings] = useState({}); // Store settings for QR code
    const [loading, setLoading] = useState(true);
    const [isInviteModalOpen, setInviteModalOpen] = useState(false);
    const [isAssignModalOpen, setAssignModalOpen] = useState(false);
    // Delete Modal State
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [riderToDelete, setRiderToDelete] = useState(null);

    const [selectedBoy, setSelectedBoy] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const handleApiCall = async (method, body, endpoint = '/api/owner/delivery') => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();

        let url = new URL(endpoint, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
        }

        // Handle query params for DELETE
        // Handle query params for DELETE
        if (method === 'DELETE' && body?.id) {
            url.searchParams.append('id', body.id);
        }

        const res = await fetch(url.toString(), {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify(body),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.message || 'API call failed');
        return result;
    }

    const fetchData = async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
        try {
            const result = await handleApiCall('GET', undefined, '/api/owner/delivery');
            const settingsResult = await handleApiCall('GET', undefined, '/api/owner/settings'); // Fetch settings for QR
            setData(result);
            setSettings(settingsResult);
        } catch (error) {
            console.error(error);
            setInfoDialog({ isOpen: true, title: "Error", message: "Could not load delivery data: " + error.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchData();
            else setLoading(false);
        });
        return () => unsubscribe();
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    // ✅ FIX 3: Auto-refresh delivery data every 10 seconds for real-time updates
    // ✅ FIX 3: Optimized Polling - 60s Interval & Pause in Background
    useEffect(() => {
        const interval = setInterval(() => {
            // Only poll if the tab is visible to save costs
            if (document.visibilityState === 'visible') {
                fetchData(true);
            }
        }, 60000); // 60 seconds (Reduced from 10s to save costs)

        return () => clearInterval(interval);
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const handleInviteRider = async (riderEmail) => {
        try {
            const data = await handleApiCall('POST', { riderEmail }, '/api/owner/delivery/invite');
            setInfoDialog({ isOpen: true, title: "Success", message: data.message });
        } catch (error) {
            console.error(error);
            throw new Error(`Failed to send invite: ${error.message}`);
        }
    };

    const handleConfirmAssignment = async (orderId) => {
        if (!selectedBoy) return;
        try {
            // This needs to update the order status as well, but for now, just updates the boy.
            await handleApiCall('PATCH', { boy: { id: selectedBoy.id, status: 'On Delivery' } });
            setInfoDialog({ isOpen: true, title: "Success", message: `Order ${orderId} assigned to ${selectedBoy.name}` });
            await fetchData(true);
        } catch (error) {
            console.error(error);
            throw new Error(`Error assigning order: ${error.message}`);
        } finally {
            setSelectedBoy(null);
        }
    };

    const handleAssignClick = (boy) => { setSelectedBoy(boy); setAssignModalOpen(true); };

    const handleStatusToggle = async (boy, newStatus) => {
        try {
            await handleApiCall('PATCH', { boy: { ...boy, status: newStatus } }, '/api/owner/delivery');
            await fetchData(true);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Error updating status: ${error.message}` });
        }
    };

    const handleRiderUpdate = async (updates) => {
        try {
            await handleApiCall('PATCH', { boy: updates }, '/api/owner/delivery');
            await fetchData(true);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Error updating rider: ${error.message}` });
            throw error;
        }
    };

    // New Delete Handler
    const handleDeleteRider = async () => {
        if (!riderToDelete) return;
        try {
            await handleApiCall('DELETE', { id: riderToDelete.id });
            await fetchData(true);
            setInfoDialog({ isOpen: true, title: "Success", message: `${riderToDelete.name} has been removed successfully.` });
        } catch (e) {
            setInfoDialog({ isOpen: true, title: "Error", message: e.message });
        }
    };

    return (
        <div className="p-4 md:p-6 text-foreground bg-background min-h-screen">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <InviteRiderModal isOpen={isInviteModalOpen} setIsOpen={setInviteModalOpen} onInvite={handleInviteRider} />
            {selectedBoy && <AssignOrderModal isOpen={isAssignModalOpen} setIsOpen={setAssignModalOpen} onAssign={handleConfirmAssignment} boyName={selectedBoy.name} readyOrders={data.readyOrders} />}

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                setIsOpen={setDeleteModalOpen}
                onConfirm={handleDeleteRider}
                riderName={riderToDelete?.name}
            />

            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Delivery Command Center</h1>
                        <p className="text-muted-foreground mt-1 text-sm md:text-base">Monitor and manage your delivery team in real-time.</p>
                    </div>
                    <div className="flex-shrink-0 flex gap-4">
                        <Link href={`/owner-dashboard/delivery-settings?${searchParams.toString()}`}>
                            <Button variant="outline"><Settings size={16} className="mr-2" /> Delivery Settings</Button>
                        </Link>
                        <Button onClick={() => fetchData(true)} variant="outline" disabled={loading}>
                            <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh
                        </Button>
                        <Button onClick={() => setInviteModalOpen(true)}>
                            <Mail size={16} className="mr-2" /> Invite Rider
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <PerformanceCard title="Total Deliveries Today" value={data.performance?.totalDeliveries || 0} icon={Bike} isLoading={loading} />
                    <PerformanceCard title="Average Delivery Time" value={`${data.performance?.avgDeliveryTime || 0} min`} icon={Clock} isLoading={loading} />
                    <PerformanceCard title="Top Performer" value={data.performance?.topPerformer?.name || 'N/A'} icon={Trophy} isLoading={loading} />
                </div>

                {/* Per-Rider Logic: PaymentQRSection Removed */}
                {/* <PaymentQRSection ... /> */}

                <div className="bg-card rounded-xl p-4 flex flex-col border border-border">
                    <h3 className="text-lg font-semibold mb-4">Delivery Team ({data.boys?.length || 0})</h3>
                    <div className="overflow-y-auto space-y-3">
                        {loading ? Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="p-3 bg-muted rounded-lg border border-border animate-pulse h-28"></div>
                        )) : (data.boys || []).map(boy => (
                            <motion.div
                                key={boy.id}
                                layout
                                className="p-3 bg-muted/50 rounded-lg border border-border"
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-bold text-foreground">{boy.name}</p>
                                            <RiderQRManager rider={boy} onUpdate={handleRiderUpdate} />
                                        </div>
                                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Phone size={12} />{boy.phone}</p>
                                    </div>
                                    <StatusBadge status={boy.status} />
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground bg-background p-2 rounded-md">
                                    <div>
                                        <p className="font-semibold text-foreground">{boy.deliveriesToday || 0}</p>
                                        <p>Today</p>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-1">
                                        <p className="font-semibold text-foreground">{(boy.avgDeliveryTime || 0)} min</p>
                                        <p>Avg Time</p>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-1">
                                        <p className="font-semibold text-foreground">{(boy.avgRating || 0).toFixed(1)}</p>
                                        <Star size={12} className="text-yellow-400" />
                                    </div>
                                </div>
                                <div className="mt-3 pt-3 border-t border-border flex justify-between items-center gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={boy.status !== 'Inactive'}
                                            onCheckedChange={(checked) => handleStatusToggle(boy, checked ? 'Available' : 'Inactive')}
                                            disabled={boy.status === 'On Delivery'}
                                            id={`switch-${boy.id}`}
                                        />
                                        <Label htmlFor={`switch-${boy.id}`} className="text-sm text-muted-foreground cursor-pointer">
                                            {boy.status !== 'Inactive' ? 'Active' : 'Inactive'}
                                        </Label>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 w-8 p-0"
                                            onClick={() => {
                                                setRiderToDelete(boy);
                                                setDeleteModalOpen(true);
                                            }}
                                        >
                                            <Trash2 size={14} />
                                        </Button>
                                        <Button size="sm" disabled={boy.status !== 'Available'} onClick={() => handleAssignClick(boy)}>
                                            <Bike size={14} className="mr-1" /> Assign Order
                                        </Button>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                        {!loading && (!data.boys || data.boys.length === 0) && (
                            <p className="text-center text-muted-foreground py-10">No delivery riders have been added yet.</p>
                        )}
                    </div>
                </div>

                <DeliveryAnalytics boysData={data.boys} weeklyData={data.weeklyPerformance} isLoading={loading} />
            </div>
        </div>
    );
}
