
'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Check, X, Filter, MoreVertical, User, Phone, Users, Clock, Hash, Trash2, Search, RefreshCw, CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { useSearchParams } from 'next/navigation';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import InfoDialog from '@/components/InfoDialog';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const formatDateTime = (dateValue) => {
    if (!dateValue) return 'N/A';

    let date;
    // Check if it's a Firestore Timestamp-like object from a JSON response
    if (typeof dateValue === 'object' && dateValue !== null && dateValue._seconds) {
        date = new Date(dateValue._seconds * 1000 + (dateValue._nanoseconds || 0) / 1000000);
    }
    // Check if it's a native Firestore Timestamp
    else if (typeof dateValue === 'object' && dateValue !== null && typeof dateValue.toDate === 'function') {
        date = dateValue.toDate();
    }
    // Check if it's already a Date object or a valid date string
    else {
        date = new Date(dateValue);
    }

    // Final validation
    if (isNaN(date.getTime())) {
        console.warn("Invalid date value provided to formatDateTime:", dateValue);
        return 'Invalid Date';
    }

    return format(date, "dd MMM, yyyy 'at' hh:mm a");
};

const BookingRow = ({ booking, onUpdateStatus }) => {
    const statusConfig = {
        pending: { style: 'text-yellow-400 bg-yellow-500/10', icon: <Clock size={14} /> },
        confirmed: { style: 'text-green-400 bg-green-500/10', icon: <CheckCircle size={14} /> },
        cancelled: { style: 'text-red-400 bg-red-500/10', icon: <XCircle size={14} /> },
        completed: { style: 'text-blue-400 bg-blue-500/10', icon: <CheckCircle size={14} /> },
    };

    const currentStatusConfig = statusConfig[booking.status] || statusConfig.pending;


    const createdAtDate = useMemo(() => {
        if (!booking.createdAt) return null;
        if (booking.createdAt._seconds) {
            return new Date(booking.createdAt._seconds * 1000);
        }
        if (booking.createdAt.seconds) {
            return new Date(booking.createdAt.seconds * 1000);
        }
        const date = new Date(booking.createdAt);
        return isNaN(date.getTime()) ? null : date;
    }, [booking.createdAt]);

    const bookingDate = useMemo(() => {
        if (!booking.bookingDateTime) return null;
        if (booking.bookingDateTime._seconds) {
            return new Date(booking.bookingDateTime._seconds * 1000);
        }
        const date = new Date(booking.bookingDateTime);
        return isNaN(date.getTime()) ? null : date;
    }, [booking.bookingDateTime]);

    const canBeCompleted = bookingDate ? isPast(bookingDate) : true;

    return (
        <TableRow>
            <TableCell>
                <div className="font-medium">{booking.customerName}</div>
                <div className="text-sm text-muted-foreground">{booking.customerPhone}</div>
            </TableCell>
            <TableCell className="text-center">{booking.partySize}</TableCell>
            <TableCell>
                <div className="font-medium">{formatDateTime(booking.bookingDateTime)}</div>
                {createdAtDate && (
                    <div className="text-xs text-muted-foreground">
                        Booked at {format(createdAtDate, 'p')}
                    </div>
                )}
            </TableCell>
            <TableCell>
                <span className={cn('flex items-center gap-2 px-2 py-1 text-xs font-semibold rounded-full capitalize', currentStatusConfig.style)}>
                    {currentStatusConfig.icon}
                    {booking.status}
                </span>
            </TableCell>
            <TableCell className="text-right">
                {booking.status === 'pending' ? (
                    <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" className="border-green-500 text-green-500 hover:bg-green-500/10 hover:text-green-500" onClick={() => onUpdateStatus(booking.id, 'confirmed')}>
                            <Check className="mr-2 h-4 w-4" /> Confirm
                        </Button>
                        <Button variant="outline" size="sm" className="border-red-500 text-red-500 hover:bg-red-500/10 hover:text-red-500" onClick={() => onUpdateStatus(booking.id, 'cancelled')}>
                            <X className="mr-2 h-4 w-4" /> Cancel
                        </Button>
                    </div>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {(booking.status === 'confirmed') && (
                                <DropdownMenuItem onClick={() => onUpdateStatus(booking.id, 'cancelled')}>
                                    <X className="mr-2 h-4 w-4 text-red-500" />
                                    <span className="text-red-500">Cancel</span>
                                </DropdownMenuItem>
                            )}
                            {booking.status === 'confirmed' && canBeCompleted && (
                                <DropdownMenuItem onClick={() => onUpdateStatus(booking.id, 'completed')}>
                                    <CheckCircle className="mr-2 h-4 w-4 text-blue-500" />
                                    <span className="text-blue-500">Mark as Completed</span>
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </TableCell>
        </TableRow>
    );
};


function BookingsPageContent() {
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('upcoming');


    const fetchBookings = async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required.");
            const idToken = await user.getIdToken();

            let url = new URL('/api/owner/bookings', window.location.origin);
            if (impersonatedOwnerId) {
                url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            } else if (employeeOfOwnerId) {
                url.searchParams.append('employee_of', employeeOfOwnerId);
            }

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to fetch bookings.');
            }
            const data = await res.json();
            setBookings(data.bookings || []);
        } catch (error) {
            console.error("Error fetching bookings:", error);
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not load bookings: ${error.message}` });
        } finally {
            if (!isManualRefresh) setLoading(false);
        }
    };

    // Real-time listener for bookings
    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoading(false);
            return;
        }

        // For impersonation or employee access, use API
        if (impersonatedOwnerId || employeeOfOwnerId) {
            console.log('[Bookings] Using API for impersonation/employee access');
            fetchBookings();
            return;
        }

        // For owner's own dashboard - use REAL-TIME listener
        setLoading(true);
        const ownerId = user.uid;

        const bookingsQuery = query(
            collection(db, 'bookings'),
            where('ownerId', '==', ownerId),
            orderBy('bookingDateTime', 'desc')
        );

        const unsubscribe = onSnapshot(
            bookingsQuery,
            (querySnapshot) => {
                const fetchedBookings = [];
                querySnapshot.forEach((doc) => {
                    fetchedBookings.push({ id: doc.id, ...doc.data() });
                });

                console.log(`[Bookings] Real-time update: ${fetchedBookings.length} bookings`);
                setBookings(fetchedBookings);
                setLoading(false);
            },
            (error) => {
                console.error('[Bookings] Firestore listener error:', error);
                setInfoDialog({
                    isOpen: true,
                    title: 'Connection Error',
                    message: 'Could not connect to bookings. Please refresh the page.'
                });
                setLoading(false);
            }
        );

        // Cleanup - CRITICAL
        return () => {
            console.log('[Bookings] Cleaning up real-time listener');
            unsubscribe();
        };
    }, [impersonatedOwnerId, employeeOfOwnerId, fetchBookings]);


    const handleUpdateStatus = async (bookingId, status) => {
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required.");
            const idToken = await user.getIdToken();

            let url = new URL('/api/owner/bookings', window.location.origin);
            if (impersonatedOwnerId) {
                url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            } else if (employeeOfOwnerId) {
                url.searchParams.append('employee_of', employeeOfOwnerId);
            }

            const res = await fetch(url.toString(), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ bookingId, status }),
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || "Failed to update status.");
            }

            setInfoDialog({ isOpen: true, title: 'Success', message: `Booking has been ${status}.` });
            fetchBookings(true); // Refresh data
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to update status: ${error.message}` });
        }
    };


    const filteredBookings = useMemo(() => {
        let items = [...bookings];

        if (activeTab === 'upcoming') {
            items = items.filter(b => b.status === 'pending' || b.status === 'confirmed');
        } else if (activeTab === 'past') {
            items = items.filter(b => b.status === 'completed' || b.status === 'cancelled');
        }


        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            items = items.filter(b =>
                b.customerName.toLowerCase().includes(lowerQuery) ||
                b.customerPhone.includes(lowerQuery)
            );
        }

        // Sort upcoming by soonest, past by latest
        items.sort((a, b) => {
            const dateA = a.bookingDateTime._seconds ? new Date(a.bookingDateTime._seconds * 1000) : new Date(a.bookingDateTime);
            const dateB = b.bookingDateTime._seconds ? new Date(b.bookingDateTime._seconds * 1000) : new Date(b.bookingDateTime);
            return activeTab === 'upcoming' ? dateA - dateB : dateB - dateA;
        });

        return items;
    }, [bookings, searchQuery, activeTab]);

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 md:p-6 space-y-6">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Table Bookings</h1>
                    <p className="text-muted-foreground mt-1">Manage your upcoming and past reservations.</p>
                </div>
                <Button onClick={() => fetchBookings(true)} variant="outline" disabled={loading}>
                    <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh
                </Button>
            </header>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                    <TabsList className="w-full md:w-auto">
                        <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                        <TabsTrigger value="past">Past & Completed</TabsTrigger>
                    </TabsList>
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                        <input
                            type="text"
                            placeholder="Search by name or phone..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border"
                        />
                    </div>
                </div>
                <Card>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Customer</TableHead>
                                        <TableHead className="text-center">Guests</TableHead>
                                        <TableHead>Booking Date & Time</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        [...Array(5)].map((_, i) => (
                                            <TableRow key={i}>
                                                <TableCell colSpan={5} className="p-4">
                                                    <div className="h-8 bg-muted rounded-md animate-pulse"></div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : filteredBookings.length > 0 ? (
                                        filteredBookings.map(booking => (
                                            <BookingRow key={booking.id} booking={booking} onUpdateStatus={handleUpdateStatus} />
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center p-16 text-muted-foreground">
                                                <CalendarClock className="mx-auto h-12 w-12" />
                                                <p className="mt-4 font-semibold">No bookings found</p>
                                                <p className="text-sm">There are no bookings matching your current filters.</p>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </Tabs>
        </motion.div>
    );
}

export default function BookingsPage() {
    return (
        <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <BookingsPageContent />
        </Suspense>
    );
}
