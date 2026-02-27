'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, User, Store, Phone, Mail, MapPin, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import InfoDialog from '@/components/InfoDialog';

export default function WaitlistPage() {
    const [waitlistEntries, setWaitlistEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const fetchWaitlist = async () => {
        setLoading(true);
        try {
            // Attach Firebase ID token for admin-protected endpoints
            const currentUser = auth.currentUser;
            const headers = {};
            if (currentUser) {
                const idToken = await currentUser.getIdToken();
                headers.Authorization = `Bearer ${idToken}`;
            }

            const res = await fetch('/api/admin/waitlist', { headers });
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to fetch waitlist');
            }
            const data = await res.json();
            setWaitlistEntries(data.entries);
        } catch (error) {
            console.error("[Waitlist Page] Error:", error);
            setInfoDialog({
                isOpen: true,
                title: "Error",
                message: `Could not load waitlist: ${error.message}`
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWaitlist();
    }, []);

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 md:p-6 space-y-6">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <header>
                <h1 className="text-3xl font-bold tracking-tight">Waitlist Submissions</h1>
                <p className="text-muted-foreground mt-1">New restaurants and shops eager to join the platform.</p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>All Entries ({waitlistEntries.length})</CardTitle>
                    <CardDescription>Sorted from newest to oldest.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[50px]">Rank</TableHead>
                                    <TableHead>Contact</TableHead>
                                    <TableHead>Business</TableHead>
                                    <TableHead>Address</TableHead>
                                    <TableHead>Joined</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    [...Array(5)].map((_, i) => (
                                        <TableRow key={i}><TableCell colSpan={5} className="p-4"><div className="h-8 bg-muted rounded-md animate-pulse"></div></TableCell></TableRow>
                                    ))
                                ) : waitlistEntries.length > 0 ? (
                                    waitlistEntries.map((entry, index) => (
                                        <TableRow key={entry.id}>
                                            <TableCell className="font-bold text-lg text-muted-foreground text-center">{index + 1}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2 font-medium"><User size={14} /> {entry.name}</div>
                                                <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1"><Phone size={14} /> {entry.phone}</div>
                                                {entry.email && <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1"><Mail size={14} /> {entry.email}</div>}
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-medium flex items-center gap-2"><Store size={14} /> {entry.businessName}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-sm text-muted-foreground flex items-start gap-2"><MapPin size={14} className="mt-1 flex-shrink-0" /> {entry.address}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-sm text-muted-foreground flex items-center gap-2"><Clock size={14} />
                                                    {entry.createdAt ? formatDistanceToNow(entry.createdAt, { addSuffix: true }) : 'N/A'}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center p-16 text-muted-foreground">
                                            <User className="mx-auto h-12 w-12" />
                                            <p className="mt-4 font-semibold">The waitlist is empty!</p>
                                            <p className="text-sm">No one has joined the waitlist yet.</p>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}
