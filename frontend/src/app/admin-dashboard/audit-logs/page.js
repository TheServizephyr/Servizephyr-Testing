'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, Download, Filter, RefreshCw, Search, User, Activity, Clock, MapPin } from 'lucide-react';
import { format } from 'date-fns';

export default function AuditLogsPage() {
    const { user, isUserLoading } = useUser();
    const router = useRouter();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({
        adminId: '',
        action: '',
        startDate: '',
        endDate: ''
    });
    const [pagination, setPagination] = useState({
        limit: 50,
        offset: 0,
        totalCount: 0,
        hasMore: false
    });

    useEffect(() => {
        if (!isUserLoading && !user) {
            router.push('/');
        }
    }, [user, isUserLoading, router]);

    useEffect(() => {
        if (user) {
            fetchLogs();
        }
    }, [user, pagination.offset]);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const idToken = await user.getIdToken();
            const params = new URLSearchParams({
                limit: pagination.limit.toString(),
                offset: pagination.offset.toString(),
                ...(filters.adminId && { adminId: filters.adminId }),
                ...(filters.action && { action: filters.action }),
                ...(filters.startDate && { startDate: filters.startDate }),
                ...(filters.endDate && { endDate: filters.endDate })
            });

            const res = await fetch(`/api/admin/audit-logs?${params}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!res.ok) throw new Error('Failed to fetch audit logs');

            const data = await res.json();
            setLogs(data.logs);
            setPagination(prev => ({
                ...prev,
                totalCount: data.totalCount,
                hasMore: data.hasMore
            }));
        } catch (error) {
            console.error('Error fetching audit logs:', error);
        } finally {
            setLoading(false);
        }
    };

    const exportToCSV = () => {
        const headers = ['Timestamp', 'Admin Email', 'Admin ID', 'Target Owner ID', 'Action', 'IP Address', 'User Agent', 'Metadata'];
        const rows = logs.map(log => [
            log.timestamp,
            log.adminEmail,
            log.adminId,
            log.targetOwnerId,
            log.action,
            log.ipAddress || 'N/A',
            log.userAgent || 'N/A',
            JSON.stringify(log.metadata || {})
        ]);

        const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`;
        a.click();
    };

    const getActionColor = (action) => {
        if (action.includes('delete')) return 'text-red-600 bg-red-100';
        if (action.includes('update') || action.includes('create')) return 'text-blue-600 bg-blue-100';
        if (action.includes('view')) return 'text-green-600 bg-green-100';
        return 'text-gray-600 bg-gray-100';
    };

    const getActionLabel = (action) => {
        return action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    if (isUserLoading || loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="text-center">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
                    <p>Loading audit logs...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold">Audit Logs</h1>
                        <p className="text-muted-foreground">Admin impersonation activity tracking</p>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={fetchLogs} variant="outline" size="sm">
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Refresh
                        </Button>
                        <Button onClick={exportToCSV} variant="outline" size="sm" disabled={logs.length === 0}>
                            <Download className="h-4 w-4 mr-2" />
                            Export CSV
                        </Button>
                    </div>
                </div>

                {/* Filters */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Filter className="h-5 w-5" />
                            Filters
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-2 block">Action</label>
                                <select
                                    value={filters.action}
                                    onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                                    className="w-full p-2 border rounded-md"
                                >
                                    <option value="">All Actions</option>
                                    <option value="view_menu">View Menu</option>
                                    <option value="create_menu_item">Create Menu Item</option>
                                    <option value="update_menu_item">Update Menu Item</option>
                                    <option value="delete_menu_item">Delete Menu Item</option>
                                    <option value="view_orders">View Orders</option>
                                    <option value="update_order">Update Order</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-2 block">Start Date</label>
                                <input
                                    type="date"
                                    value={filters.startDate}
                                    onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                                    className="w-full p-2 border rounded-md"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-2 block">End Date</label>
                                <input
                                    type="date"
                                    value={filters.endDate}
                                    onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                                    className="w-full p-2 border rounded-md"
                                />
                            </div>
                            <div className="flex items-end">
                                <Button onClick={() => { setPagination(prev => ({ ...prev, offset: 0 })); fetchLogs(); }} className="w-full">
                                    <Search className="h-4 w-4 mr-2" />
                                    Apply Filters
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <Activity className="h-8 w-8 text-blue-600" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Total Logs</p>
                                    <p className="text-2xl font-bold">{pagination.totalCount}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <User className="h-8 w-8 text-green-600" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Unique Admins</p>
                                    <p className="text-2xl font-bold">{new Set(logs.map(l => l.adminId)).size}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <Clock className="h-8 w-8 text-purple-600" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Showing</p>
                                    <p className="text-2xl font-bold">{logs.length}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Logs Table */}
                <Card>
                    <CardHeader>
                        <CardTitle>Activity Log</CardTitle>
                        <CardDescription>Recent admin impersonation activities</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {logs.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                    <p>No audit logs found</p>
                                </div>
                            ) : (
                                logs.map((log) => (
                                    <div key={log.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                            <div className="space-y-2 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                                                        {getActionLabel(log.action)}
                                                    </span>
                                                    <span className="text-sm text-muted-foreground">
                                                        {format(new Date(log.timestamp), 'PPpp')}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 text-sm">
                                                    <User className="h-4 w-4" />
                                                    <span className="font-medium">{log.adminEmail}</span>
                                                    <span className="text-muted-foreground">→</span>
                                                    <span>Owner: {log.targetOwnerId}</span>
                                                </div>
                                                {log.ipAddress && (
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <MapPin className="h-3 w-3" />
                                                        <span>{log.ipAddress}</span>
                                                    </div>
                                                )}
                                            </div>
                                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                                                <div className="text-xs bg-muted p-2 rounded">
                                                    <pre className="max-w-xs overflow-x-auto">{JSON.stringify(log.metadata, null, 2)}</pre>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Pagination */}
                        {pagination.totalCount > pagination.limit && (
                            <div className="flex justify-between items-center mt-6 pt-6 border-t">
                                <Button
                                    onClick={() => setPagination(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                                    disabled={pagination.offset === 0}
                                    variant="outline"
                                >
                                    Previous
                                </Button>
                                <span className="text-sm text-muted-foreground">
                                    Showing {pagination.offset + 1} - {Math.min(pagination.offset + pagination.limit, pagination.totalCount)} of {pagination.totalCount}
                                </span>
                                <Button
                                    onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
                                    disabled={!pagination.hasMore}
                                    variant="outline"
                                >
                                    Next
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
