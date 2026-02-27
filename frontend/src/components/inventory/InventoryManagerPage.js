'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search, ArrowDown, ArrowUp, Boxes } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function appendAccessParams(baseUrl, impersonatedOwnerId, employeeOfOwnerId) {
    const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (impersonatedOwnerId) {
        url.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
    } else if (employeeOfOwnerId) {
        url.searchParams.set('employee_of', employeeOfOwnerId);
    }
    return `${url.pathname}${url.search}`;
}

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

export default function InventoryManagerPage({ title = 'Inventory Management', subtitle = 'Track stock and keep items ready for orders.' }) {
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [adjustingId, setAdjustingId] = useState(null);
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [query, setQuery] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [stockDrafts, setStockDrafts] = useState({});

    const loadInventory = useCallback(async (searchTerm = '') => {
        setLoading(true);
        setError('');
        setSuccess('');
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please login again.');

            const idToken = await user.getIdToken();
            const basePath = '/api/owner/inventory';
            const url = appendAccessParams(basePath, impersonatedOwnerId, employeeOfOwnerId);
            const urlObj = new URL(url, window.location.origin);
            urlObj.searchParams.set('limit', '200');
            if (searchTerm.trim()) {
                urlObj.searchParams.set('q', searchTerm.trim().toLowerCase());
            }

            const response = await fetch(urlObj.pathname + urlObj.search, {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Failed to fetch inventory.');

            setItems(Array.isArray(data.items) ? data.items : []);
        } catch (fetchError) {
            setError(fetchError.message || 'Failed to load inventory.');
        } finally {
            setLoading(false);
        }
    }, [employeeOfOwnerId, impersonatedOwnerId]);

    useEffect(() => {
        loadInventory('');
    }, [loadInventory]);

    useEffect(() => {
        setStockDrafts((prev) => {
            const next = { ...prev };
            items.forEach((item) => {
                const id = item.id;
                if (!id) return;
                if (next[id] === undefined) {
                    next[id] = String(toNumber(item.stockOnHand, 0));
                }
            });
            return next;
        });
    }, [items]);

    const runSyncFromMenu = async () => {
        setSyncing(true);
        setError('');
        setSuccess('');
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please login again.');

            const idToken = await user.getIdToken();
            const url = appendAccessParams('/api/owner/inventory/sync-from-menu', impersonatedOwnerId, employeeOfOwnerId);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Sync failed.');

            setSuccess(`Done. ${data.created} items added to stock and ${data.updated} items updated.`);
            await loadInventory(query);
        } catch (syncError) {
            setError(syncError.message || 'Sync failed.');
        } finally {
            setSyncing(false);
        }
    };

    const adjustStock = async (itemId, qtyDelta) => {
        setAdjustingId(itemId);
        setError('');
        setSuccess('');
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Please login again.');
            const idToken = await user.getIdToken();
            const url = appendAccessParams('/api/owner/inventory/adjust', impersonatedOwnerId, employeeOfOwnerId);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    itemId,
                    qtyDelta,
                    reason: 'manual_adjustment',
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Adjustment failed.');

            const updatedItem = data.item || {};
            setItems((prev) =>
                prev.map((item) =>
                    item.id === itemId
                        ? {
                            ...item,
                            stockOnHand: updatedItem.stockOnHand,
                            reserved: updatedItem.reserved,
                            available: updatedItem.available,
                        }
                        : item
                )
            );
            setStockDrafts((prev) => ({
                ...prev,
                [itemId]: String(toNumber(updatedItem.stockOnHand, 0)),
            }));
            setSuccess('Stock updated.');
        } catch (adjustError) {
            setError(adjustError.message || 'Adjustment failed.');
        } finally {
            setAdjustingId(null);
        }
    };

    const setAbsoluteStock = async (item) => {
        const itemId = item?.id;
        if (!itemId) return;

        const currentStock = toNumber(item?.stockOnHand, 0);
        const targetRaw = stockDrafts[itemId];
        const targetStock = Number(targetRaw);

        if (!Number.isFinite(targetStock) || targetStock < 0) {
            setError('Please enter a valid stock number (0 or more).');
            return;
        }

        const qtyDelta = targetStock - currentStock;
        if (qtyDelta === 0) {
            setSuccess('Stock is already same.');
            return;
        }

        await adjustStock(itemId, qtyDelta);
    };

    const summary = useMemo(() => {
        const total = items.length;
        const outOfStock = items.filter((item) => toNumber(item.available) <= 0).length;
        const lowStock = items.filter((item) => {
            const reorderLevel = toNumber(item.reorderLevel, 0);
            if (reorderLevel <= 0) return false;
            return toNumber(item.available) <= reorderLevel;
        }).length;
        return { total, outOfStock, lowStock };
    }, [items]);

    const onSearchSubmit = (event) => {
        event.preventDefault();
        const normalized = searchDraft.trim().toLowerCase();
        setQuery(normalized);
        loadInventory(normalized);
    };

    return (
        <div className="space-y-6 p-4 md:p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
                    <p className="text-muted-foreground mt-1">{subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => loadInventory(query)} disabled={loading || syncing}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button onClick={runSyncFromMenu} disabled={syncing || loading}>
                        {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}
                        Import Existing Items
                    </Button>
                </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-2">How this works:</p>
                <p>1. Add/Delete products in Items tab.</p>
                <p>2. Open this Stock tab to update quantity.</p>
                <p>3. First time only: click <span className="text-foreground font-medium">Import Existing Items</span> to bring current items into stock manager.</p>
            </div>

            {error ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
            ) : null}
            {success ? (
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">{success}</div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Total Items</p>
                    <p className="mt-2 text-2xl font-semibold">{summary.total}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Low Stock</p>
                    <p className="mt-2 text-2xl font-semibold">{summary.lowStock}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-sm text-muted-foreground">Out of Stock</p>
                    <p className="mt-2 text-2xl font-semibold">{summary.outOfStock}</p>
                </div>
            </div>

            <form onSubmit={onSearchSubmit} className="flex flex-col gap-2 md:flex-row">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchDraft}
                        onChange={(event) => setSearchDraft(event.target.value)}
                        placeholder="Search by item name, SKU, barcode"
                        className="pl-9"
                    />
                </div>
                <Button type="submit" variant="outline" disabled={loading}>Search</Button>
            </form>

            <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="border-b border-border bg-muted/30">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium">Item Name</th>
                                <th className="px-4 py-3 text-left font-medium">SKU</th>
                                <th className="px-4 py-3 text-right font-medium">Stock In Hand</th>
                                <th className="px-4 py-3 text-right font-medium">Reserved</th>
                                <th className="px-4 py-3 text-right font-medium">Sellable Stock</th>
                                <th className="px-4 py-3 text-right font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                                        Loading inventory...
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                                        No stock items found. Click &quot;Import Existing Items&quot; once.
                                    </td>
                                </tr>
                            ) : (
                                items.map((item) => {
                                    const onHand = toNumber(item.stockOnHand, 0);
                                    const reserved = toNumber(item.reserved, 0);
                                    const available = toNumber(item.available, onHand - reserved);
                                    return (
                                        <tr key={item.id} className="border-b border-border/60">
                                            <td className="px-4 py-3">
                                                <div className="font-medium">{item.name || 'Unnamed Item'}</div>
                                                <div className="text-xs text-muted-foreground">{item.categoryId || 'general'}</div>
                                            </td>
                                            <td className="px-4 py-3">{item.sku || '-'}</td>
                                            <td className="px-4 py-3 text-right">{onHand}</td>
                                            <td className="px-4 py-3 text-right">{reserved}</td>
                                            <td className="px-4 py-3 text-right">{available}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-2 flex-wrap">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8"
                                                        disabled={adjustingId === item.id}
                                                        onClick={() => adjustStock(item.id, -1)}
                                                    >
                                                        <ArrowDown className="h-4 w-4 mr-1" />
                                                        -1
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8"
                                                        disabled={adjustingId === item.id}
                                                        onClick={() => adjustStock(item.id, 1)}
                                                    >
                                                        {adjustingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4 mr-1" />}
                                                        +1
                                                    </Button>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        value={stockDrafts[item.id] ?? String(onHand)}
                                                        onChange={(event) =>
                                                            setStockDrafts((prev) => ({
                                                                ...prev,
                                                                [item.id]: event.target.value,
                                                            }))
                                                        }
                                                        className="h-8 w-20 text-right"
                                                    />
                                                    <Button
                                                        size="sm"
                                                        variant="default"
                                                        className="h-8"
                                                        disabled={adjustingId === item.id}
                                                        onClick={() => setAbsoluteStock(item)}
                                                    >
                                                        Set Stock
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
