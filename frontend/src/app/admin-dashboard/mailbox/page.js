
"use client";

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Mail, RefreshCw, AlertTriangle, User, Clock, Link as LinkIcon, Check, MoreVertical, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import InfoDialog from '@/components/InfoDialog';
import { auth } from '@/lib/firebase';

const ReportRow = ({ report, onUpdateStatus }) => {
    const [expanded, setExpanded] = useState(false);

    const statusConfig = {
        'new': 'text-blue-400 bg-blue-500/10',
        'in_progress': 'text-yellow-400 bg-yellow-500/10',
        'resolved': 'text-green-400 bg-green-500/10',
    };

    const userTypeColors = {
        'Owner': 'bg-primary/10 text-primary',
        'Customer': 'bg-blue-500/10 text-blue-400',
        'Street Vendor': 'bg-orange-500/10 text-orange-400',
        'Shop Owner': 'bg-purple-500/10 text-purple-400',
        'Rider': 'bg-cyan-500/10 text-cyan-400',
        'Guest': 'bg-gray-500/10 text-gray-400',
    };

    return (
        <>
            <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpanded(!expanded)}>
                <TableCell>
                    <div className="font-medium text-foreground">{report.title}</div>
                    <div className="text-sm text-muted-foreground truncate max-w-xs">{report.description || report.message}</div>
                    {report.user?.type && (
                        <span className={cn('mt-1 inline-block px-2 py-0.5 text-xs font-semibold rounded-full', userTypeColors[report.user.type] || 'bg-gray-500/10 text-gray-400')}>
                            {report.user.type}
                        </span>
                    )}
                </TableCell>
                <TableCell>
                    <div className="font-medium">{report.user?.name || 'N/A'}</div>
                    <div className="text-sm text-muted-foreground">{report.user?.email || 'N/A'}</div>
                    {report.user?.phone && report.user.phone !== 'N/A' && (
                        <div className="text-xs text-muted-foreground">{report.user.phone}</div>
                    )}
                </TableCell>
                <TableCell>
                    <a href={report.path} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-400 hover:underline text-sm">
                        <LinkIcon size={14} /> {report.path}
                    </a>
                </TableCell>
                <TableCell className="text-muted-foreground">
                    <div className="text-sm">
                        {report.timestamp ? formatDistanceToNow(new Date(report.timestamp), { addSuffix: true }) : 'N/A'}
                    </div>
                    {report.exactTimestamp && (
                        <div className="text-xs text-muted-foreground font-mono mt-1">
                            {new Date(report.exactTimestamp).toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                hour12: false
                            })}
                        </div>
                    )}
                </TableCell>
                <TableCell>
                    <span className={cn('px-2 py-1 text-xs font-semibold rounded-full capitalize', statusConfig[report.status])}>
                        {report.status.replace('_', ' ')}
                    </span>
                </TableCell>
                <TableCell className="text-right">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUpdateStatus(report.id, 'in_progress'); }}>
                                Mark as In Progress
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUpdateStatus(report.id, 'resolved'); }}>
                                Mark as Resolved
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-500" onClick={(e) => e.stopPropagation()}>
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </TableCell>
            </TableRow>

            {expanded && (
                <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30 p-6">
                        <div className="space-y-4">
                            <div>
                                <h4 className="font-semibold mb-2">📝 Full Description</h4>
                                <p className="text-sm text-muted-foreground">{report.description || report.message || 'No description provided'}</p>
                            </div>

                            {report.exactTimestamp && (
                                <div>
                                    <h4 className="font-semibold mb-2">🕐 Exact Timestamp (for Vercel Logs)</h4>
                                    <code className="text-sm bg-black/5 dark:bg-white/5 px-2 py-1 rounded">
                                        {report.exactTimestamp}
                                    </code>
                                    {report.localTime && (
                                        <p className="text-xs text-muted-foreground mt-1">Local: {report.localTime}</p>
                                    )}
                                </div>
                            )}

                            {report.context?.browser && (
                                <div>
                                    <h4 className="font-semibold mb-2">🌐 Browser & Device</h4>
                                    <div className="text-sm space-y-1">
                                        <p><strong>User Agent:</strong> <code className="text-xs">{report.context.browser.userAgent}</code></p>
                                        <p><strong>Platform:</strong> {report.context.browser.platform}</p>
                                        <p><strong>Language:</strong> {report.context.browser.language}</p>
                                    </div>
                                </div>
                            )}

                            {report.context?.screen && (
                                <div>
                                    <h4 className="font-semibold mb-2">📱 Screen Info</h4>
                                    <p className="text-sm">
                                        {report.context.screen.width} × {report.context.screen.height}
                                        ({report.context.screen.colorDepth}-bit color)
                                    </p>
                                </div>
                            )}

                            {report.context?.page?.referrer && (
                                <div>
                                    <h4 className="font-semibold mb-2">🔗 Previous Page</h4>
                                    <p className="text-sm text-blue-400">{report.context.page.referrer || 'Direct visit'}</p>
                                </div>
                            )}
                        </div>
                    </TableCell>
                </TableRow>
            )}
        </>
    );
};


export default function MailboxPage() {
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [activeTab, setActiveTab] = useState('new');

    const fetchReports = async (isManualRefresh = false) => {
        if (!isManualRefresh) setLoading(true);
        try {
            // Include Firebase ID token for admin-protected endpoints
            const currentUser = auth.currentUser;
            let headers = {};
            if (currentUser) {
                const idToken = await currentUser.getIdToken();
                headers.Authorization = `Bearer ${idToken}`;
            }

            const res = await fetch('/api/admin/mailbox', { headers });

            if (!res.ok) {
                const text = await res.text();
                let errorData = {};
                try { errorData = JSON.parse(text); } catch (e) { errorData = { message: text }; }
                throw new Error(errorData.message || `Failed to fetch reports (${res.status})`);
            }
            const data = await res.json();
            setReports(data.reports || []);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not load reports: ${error.message}` });
        } finally {
            if (!isManualRefresh) setLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
    }, []);

    const handleUpdateStatus = async (reportId, status) => {
        try {
            await fetch('/api/admin/mailbox', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reportId, status }),
            });

            fetchReports(true); // Refresh data
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Failed to update status: ${error.message}` });
        }
    };

    const filteredReports = useMemo(() => {
        if (activeTab === 'all') return reports;
        return reports.filter(r => r.status === activeTab);
    }, [reports, activeTab]);

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
                    <h1 className="text-3xl font-bold tracking-tight">Admin Mailbox</h1>
                    <p className="text-muted-foreground mt-1">Review error reports submitted by all users.</p>
                </div>
                <Button onClick={() => fetchReports(true)} variant="outline" disabled={loading}>
                    <RefreshCw size={16} className={cn("mr-2", loading && "animate-spin")} /> Refresh
                </Button>
            </header>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full md:w-auto">
                    <TabsTrigger value="new">New</TabsTrigger>
                    <TabsTrigger value="in_progress">In Progress</TabsTrigger>
                    <TabsTrigger value="resolved">Resolved</TabsTrigger>
                    <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
                <Card className="mt-4">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Report Details</TableHead>
                                        <TableHead>Submitted By</TableHead>
                                        <TableHead>Page</TableHead>
                                        <TableHead>Time</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        [...Array(5)].map((_, i) => (
                                            <TableRow key={i}><TableCell colSpan={6} className="p-4"><div className="h-8 bg-muted rounded-md animate-pulse"></div></TableCell></TableRow>
                                        ))
                                    ) : filteredReports.length > 0 ? (
                                        filteredReports.map(report => (
                                            <ReportRow key={report.id} report={report} onUpdateStatus={handleUpdateStatus} />
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center p-16 text-muted-foreground">
                                                <Mail className="mx-auto h-12 w-12" />
                                                <p className="mt-4 font-semibold">Mailbox is empty!</p>
                                                <p className="text-sm">No reports in this category.</p>
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

