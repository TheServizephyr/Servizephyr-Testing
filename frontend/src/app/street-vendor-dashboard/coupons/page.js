

"use client";

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tag, PlusCircle, Filter, ArrowDownUp, Edit, Trash2, Calendar as CalendarIcon, Wand2, Ticket, IndianRupee, Percent, CheckCircle, XCircle, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { auth } from '@/lib/firebase';
import { useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';

export const dynamic = 'force-dynamic';

const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        return 'N/A';
    }
    return format(date, "dd MMM yyyy");
};

const CouponModal = ({ isOpen, setIsOpen, onSave, editingCoupon }) => {
    const [coupon, setCoupon] = useState(null);
    const [isStartDatePickerOpen, setStartDatePickerOpen] = useState(false);
    const [isEndDatePickerOpen, setEndDatePickerOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [modalError, setModalError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setIsSaving(false);
            setModalError('');
            if (editingCoupon) {
                setCoupon({
                    ...editingCoupon
                });
            } else {
                setCoupon({
                    id: null, code: '', description: '', type: 'flat', value: '',
                    minOrder: '', startDate: new Date(), expiryDate: new Date(new Date().setDate(new Date().getDate() + 30)),
                    status: 'active', timesUsed: 0, customerId: null
                });
            }
        }
    }, [isOpen, editingCoupon]);

    const handleChange = (field, value) => {
        const newCoupon = { ...coupon, [field]: value };

        if (field === 'type' && value === 'free_delivery') {
            newCoupon.value = 0;
        }

        setCoupon(newCoupon);
    };

    const generateRandomCode = () => {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        handleChange('code', code);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setModalError('');

        let requiredFieldsMet = coupon.code && coupon.minOrder !== '';
        if (coupon.type !== 'free_delivery') {
            requiredFieldsMet = requiredFieldsMet && coupon.value !== '';
        }

        if (!requiredFieldsMet) {
            setModalError('Please fill all required fields: Code, Value (if not free delivery), and Minimum Order.');
            return;
        }

        setIsSaving(true);
        try {
            await onSave(coupon);
            setIsOpen(false);
        } catch (error) {
            setModalError(error.message);
        } finally {
            setIsSaving(false);
        }
    };

    if (!coupon) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-4xl bg-card border-border text-card-foreground">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-2xl">
                            <Ticket /> {editingCoupon ? 'Edit Coupon' : 'Create New Coupon'}
                        </DialogTitle>
                        <DialogDescription>Fill in the details for your new promotional offer.</DialogDescription>
                    </DialogHeader>

                    <div className="grid md:grid-cols-2 gap-x-8 gap-y-6 py-6">
                        <div className="space-y-6">
                            <div>
                                <Label htmlFor="code">Coupon Code</Label>
                                <div className="flex items-center gap-2 mt-1">
                                    <input id="code" value={coupon.code} onChange={e => handleChange('code', e.target.value.toUpperCase())} placeholder="e.g., SAVE20" className="p-2 border rounded-md bg-input border-border w-full" />
                                    <Button type="button" variant="outline" onClick={generateRandomCode}><Wand2 size={16} className="mr-2" /> Generate</Button>
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="description">Description</Label>
                                <textarea id="description" value={coupon.description} onChange={e => handleChange('description', e.target.value)} rows={3} placeholder="e.g., Get 20% off on your first order" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                            </div>
                            <div>
                                <Label>Discount Type</Label>
                                <div className="grid grid-cols-3 gap-2 mt-2">
                                    <div onClick={() => handleChange('type', 'flat')} className={cn('p-3 border-2 rounded-lg cursor-pointer flex items-center justify-center gap-2 text-sm', coupon.type === 'flat' ? 'border-primary bg-primary/10' : 'border-border')}>
                                        <IndianRupee size={16} /> Flat Amount
                                    </div>
                                    <div onClick={() => handleChange('type', 'percentage')} className={cn('p-3 border-2 rounded-lg cursor-pointer flex items-center justify-center gap-2 text-sm', coupon.type === 'percentage' ? 'border-primary bg-primary/10' : 'border-border')}>
                                        <Percent size={16} /> Percentage
                                    </div>
                                    <div onClick={() => handleChange('type', 'free_delivery')} className={cn('p-3 border-2 rounded-lg cursor-pointer flex items-center justify-center gap-2 text-sm', coupon.type === 'free_delivery' ? 'border-primary bg-primary/10' : 'border-border')}>
                                        <Truck size={16} /> Free Delivery
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="value">Discount Value</Label>
                                    <input
                                        id="value"
                                        type="number"
                                        value={coupon.value}
                                        onChange={e => handleChange('value', e.target.value)}
                                        placeholder={coupon.type === 'flat' ? 'e.g., 100' : 'e.g., 20'}
                                        disabled={coupon.type === 'free_delivery'}
                                        className="mt-1 p-2 border rounded-md bg-input border-border w-full disabled:opacity-50 disabled:cursor-not-allowed" />
                                </div>
                                <div>
                                    <Label htmlFor="minOrder">Minimum Order (₹)</Label>
                                    <input id="minOrder" type="number" value={coupon.minOrder} onChange={e => handleChange('minOrder', e.target.value)} placeholder="e.g., 500" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Start Date</Label>
                                    <Popover open={isStartDatePickerOpen} onOpenChange={setStartDatePickerOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.startDate && "text-muted-foreground")}>
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {coupon.startDate ? formatDate(coupon.startDate) : <span>Pick a date</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={new Date(coupon.startDate)} onSelect={(date) => { handleChange('startDate', date); setStartDatePickerOpen(false); }} initialFocus /></PopoverContent>
                                    </Popover>
                                </div>
                                <div>
                                    <Label>Expiry Date</Label>
                                    <Popover open={isEndDatePickerOpen} onOpenChange={setEndDatePickerOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.expiryDate && "text-muted-foreground")}>
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {coupon.expiryDate ? formatDate(coupon.expiryDate) : <span>Pick a date</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={new Date(coupon.expiryDate)} onSelect={(date) => { handleChange('expiryDate', date); setEndDatePickerOpen(false); }} initialFocus /></PopoverContent>
                                    </Popover>
                                </div>
                            </div>
                            <div>
                                <Label>Status</Label>
                                <div className="flex items-center gap-4 mt-2 bg-input p-3 rounded-md">
                                    <Switch id="status" checked={coupon.status === 'active'} onCheckedChange={(checked) => handleChange('status', checked ? 'active' : 'inactive')} />
                                    <Label htmlFor="status" className={cn(coupon.status === 'active' ? 'text-green-400' : 'text-muted-foreground')}>
                                        {coupon.status === 'active' ? 'Coupon is Active' : 'Coupon is Inactive'}
                                    </Label>
                                </div>
                            </div>
                        </div>
                    </div>
                    {modalError && <p className="text-destructive text-center text-sm mt-4">{modalError}</p>}
                    <DialogFooter className="pt-6">
                        <DialogClose asChild><Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                        <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={isSaving}>
                            {isSaving ? 'Saving...' : (editingCoupon ? 'Save Changes' : 'Create Coupon')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const CouponCard = ({ coupon, onStatusToggle, onEdit, onDelete }) => {
    const expiryDate = new Date(coupon.expiryDate);
    const isExpired = expiryDate < new Date();
    const status = isExpired ? 'Expired' : coupon.status;

    const statusConfig = {
        'active': { text: 'text-green-400', bg: 'bg-green-500/10', icon: <CheckCircle />, label: 'Active' },
        'inactive': { text: 'text-gray-400', bg: 'bg-muted', icon: <XCircle />, label: 'Inactive' },
        'Expired': { text: 'text-red-400', bg: 'bg-red-500/10', icon: <XCircle />, label: 'Expired' },
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-card border border-border rounded-xl flex flex-col overflow-hidden shadow-lg hover:shadow-primary/20 hover:-translate-y-1 transition-all duration-300"
        >
            <div className="p-5 bg-card">
                <div className="flex justify-between items-start">
                    <p className="font-mono text-2xl font-bold tracking-widest text-foreground bg-muted px-4 py-2 rounded-lg border-2 border-dashed border-border">{coupon.code}</p>
                    <div className={cn('flex items-center gap-2 text-sm font-semibold px-3 py-1 rounded-full', statusConfig[status]?.bg, statusConfig[status]?.text)}>
                        {statusConfig[status]?.icon}
                        {statusConfig[status]?.label || status}
                    </div>
                </div>
                <p className="text-3xl font-bold text-primary mt-4">
                    {coupon.type === 'free_delivery' ? 'Free Delivery' : (coupon.type === 'flat' ? `₹${coupon.value} OFF` : `${coupon.value}% OFF`)}
                </p>
            </div>

            <div className="p-5 flex-grow">
                <p className="text-sm text-muted-foreground mb-4">{coupon.description}</p>
                <div className="text-sm space-y-2">
                    <p><span className="font-semibold text-muted-foreground">Min. Order:</span> ₹{coupon.minOrder}</p>
                    <p><span className="font-semibold text-muted-foreground">Expires:</span> {formatDate(expiryDate)}</p>
                    <p><span className="font-semibold text-muted-foreground">Times Used:</span> {coupon.timesUsed}</p>
                </div>
            </div>

            <div className="p-4 bg-muted/30 border-t border-border flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Switch
                        checked={status === 'active'}
                        onCheckedChange={() => onStatusToggle(coupon, status === 'active' ? 'inactive' : 'active')}
                        disabled={status === 'Expired'}
                        id={`switch-${coupon.id}`}
                    />
                    <Label htmlFor={`switch-${coupon.id}`} className="text-sm text-muted-foreground">
                        {status === 'active' ? 'Active' : 'Inactive'}
                    </Label>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(coupon)}><Edit size={16} /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive/80 hover:bg-destructive/10" onClick={() => onDelete(coupon.id)}><Trash2 size={16} /></Button>
                </div>
            </div>
        </motion.div>
    );
};

export default function CouponsPage() {
    const [coupons, setCoupons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCoupon, setEditingCoupon] = useState(null);
    const [filter, setFilter] = useState('All');
    const [sort, setSort] = useState('expiryDate-asc');
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const effectiveOwnerId = impersonatedOwnerId || employeeOfOwnerId;

    const handleApiCall = async (method, body) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();

        let url = new URL('/api/owner/coupons', window.location.origin);
        // Add impersonation or employee_of param
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
        }

        const res = await fetch(url.toString(), {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: body ? JSON.stringify(body) : undefined,
        });

        // Check if response has content
        const text = await res.text();
        console.log('[API CALL] Response status:', res.status, 'text length:', text.length);

        if (!text) {
            throw new Error('Empty response from server');
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            console.error('[API CALL] JSON parse error. Response text:', text);
            throw new Error('Invalid response from server: ' + parseError.message);
        }

        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    }

    const fetchCoupons = async () => {
        setLoading(true);
        try {
            const data = await handleApiCall('GET');
            console.log('[COUPON FETCH] Raw API response:', data);
            console.log('[COUPON FETCH] Number of coupons:', data.coupons?.length || 0);

            const processedCoupons = (data.coupons || []).map((c, index) => {
                console.log(`[COUPON FETCH] Processing coupon ${index}:`, c);
                console.log(`[COUPON FETCH] Coupon ${index} startDate raw:`, c.startDate);
                console.log(`[COUPON FETCH] Coupon ${index} expiryDate raw:`, c.expiryDate);

                const processed = {
                    ...c,
                    startDate: c.startDate ? (
                        c.startDate._seconds ? new Date(c.startDate._seconds * 1000) :
                            c.startDate.seconds ? new Date(c.startDate.seconds * 1000) :
                                new Date(c.startDate)
                    ) : new Date(),
                    expiryDate: c.expiryDate ? (
                        c.expiryDate._seconds ? new Date(c.expiryDate._seconds * 1000) :
                            c.expiryDate.seconds ? new Date(c.expiryDate.seconds * 1000) :
                                new Date(c.expiryDate)
                    ) : new Date()
                };

                console.log(`[COUPON FETCH] Coupon ${index} startDate processed:`, processed.startDate);
                console.log(`[COUPON FETCH] Coupon ${index} expiryDate processed:`, processed.expiryDate);
                return processed;
            });

            console.log('[COUPON FETCH] Final processed coupons:', processedCoupons);
            setCoupons(processedCoupons);
        } catch (error) {
            console.error(error);
            setInfoDialog({ isOpen: true, title: "Error", message: "Could not load coupons: " + error.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchCoupons();
            else setLoading(false);
        });
        return () => unsubscribe();
    }, [effectiveOwnerId]);

    const handleSaveCoupon = async (couponData) => {
        try {
            console.log('[COUPON SAVE] Original coupon data:', couponData);
            console.log('[COUPON SAVE] Start Date:', couponData.startDate);
            console.log('[COUPON SAVE] Expiry Date:', couponData.expiryDate);

            const isEditing = !!couponData.id;
            const payload = {
                ...couponData,
                startDate: couponData.startDate.toISOString(),
                expiryDate: couponData.expiryDate.toISOString(),
            };

            console.log('[COUPON SAVE] Payload being sent to API:', payload);
            console.log('[COUPON SAVE] Start Date ISO:', payload.startDate);
            console.log('[COUPON SAVE] Expiry Date ISO:', payload.expiryDate);

            const data = await handleApiCall(isEditing ? 'PATCH' : 'POST', { coupon: payload });
            console.log('[COUPON SAVE] API Response:', data);
            setInfoDialog({ isOpen: true, title: "Success", message: data.message });
            await fetchCoupons();
        } catch (error) {
            console.error("Error saving coupon:", error);
            throw new Error(`Error saving coupon: ${error.message}`);
        }
    };

    const handleEdit = (coupon) => {
        setEditingCoupon(coupon);
        setIsModalOpen(true);
    };

    const handleCreateNew = () => {
        setEditingCoupon(null);
        setIsModalOpen(true);
    };

    const handleDelete = async (id) => {
        if (window.confirm('Are you sure you want to delete this coupon? This action cannot be undone.')) {
            try {
                const data = await handleApiCall('DELETE', { couponId: id });
                setInfoDialog({ isOpen: true, title: "Success", message: data.message });
                await fetchCoupons();
            } catch (error) {
                setInfoDialog({ isOpen: true, title: "Error", message: `Error deleting coupon: ${error.message}` });
            }
        }
    };

    const handleStatusToggle = async (coupon, newStatus) => {
        try {
            await handleApiCall('PATCH', { coupon: { id: coupon.id, status: newStatus } });
            setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, status: newStatus } : c));
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Error updating status: ${error.message}` });
            await fetchCoupons();
        }
    };

    const filteredAndSortedCoupons = useMemo(() => {
        let items = [...coupons].map(c => {
            const expiryDate = new Date(c.expiryDate);
            return { ...c, isExpired: expiryDate < new Date() };
        });

        if (filter !== 'All') {
            items = items.filter(c => (c.isExpired ? 'Expired' : c.status) === filter);
        }

        const [sortKey, sortDir] = sort.split('-');
        items.sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];
            if (sortKey.includes('Date')) {
                valA = new Date(a[sortKey]);
                valB = new Date(b[sortKey]);
            }
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        return items;
    }, [coupons, filter, sort]);


    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <CouponModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} onSave={handleSaveCoupon} editingCoupon={editingCoupon} />

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Coupon & Offer Hub</h1>
                    <p className="text-muted-foreground mt-1">Create, manage, and track your promotional offers.</p>
                </div>
                <Button onClick={handleCreateNew} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    <PlusCircle size={20} className="mr-2" /> Create New Coupon
                </Button>
            </div>

            <div className="flex flex-col md:flex-row justify-end items-center gap-4 mb-6 p-4 bg-card rounded-xl border border-border">
                <div className="flex items-center gap-2">
                    <Filter size={16} className="text-muted-foreground" />
                    <Label htmlFor="filter-status">Filter by Status:</Label>
                    <select id="filter-status" value={filter} onChange={e => setFilter(e.target.value)} className="p-2 text-sm border rounded-md bg-input border-border focus:ring-primary focus:border-primary">
                        <option value="All">All</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="Expired">Expired</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <ArrowDownUp size={16} className="text-muted-foreground" />
                    <Label htmlFor="sort-by">Sort by:</Label>
                    <select id="sort-by" value={sort} onChange={e => setSort(e.target.value)} className="p-2 text-sm border rounded-md bg-input border-border focus:ring-primary focus:border-primary">
                        <option value="expiryDate-asc">Expiry Date (Soonest)</option>
                        <option value="expiryDate-desc">Expiry Date (Latest)</option>
                        <option value="timesUsed-desc">Usage (Most First)</option>
                        <option value="timesUsed-asc">Usage (Least First)</option>
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="bg-card border border-border rounded-xl h-80"></div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AnimatePresence>
                        {filteredAndSortedCoupons.map(coupon => (
                            <CouponCard
                                key={coupon.id}
                                coupon={coupon}
                                onStatusToggle={handleStatusToggle}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}
            {!loading && filteredAndSortedCoupons.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                    <p className="text-lg font-semibold">No coupons found.</p>
                    <p>Try adjusting your filters or create a new coupon!</p>
                </div>
            )}
        </div>
    );
}
