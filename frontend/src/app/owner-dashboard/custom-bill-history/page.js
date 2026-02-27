"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Receipt, RefreshCw, Search, User, Phone, MapPin, Printer } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';

import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import InfoDialog from '@/components/InfoDialog';
import BillToPrint from '@/components/BillToPrint';


const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const toDateInput = (date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const defaultSummary = {
    totalBills: 0,
    totalAmount: 0,
    avgBillValue: 0,
    pendingSettlementAmount: 0,
    pendingSettlementBills: 0,
    settledAmount: 0,
    settledBills: 0,
};

export default function CustomBillHistoryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const [history, setHistory] = useState([]);
    const [summary, setSummary] = useState(defaultSummary);
    const [loading, setLoading] = useState(true);
    const [isSettling, setIsSettling] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedBillIds, setSelectedBillIds] = useState([]);
    const [settlingBillIds, setSettlingBillIds] = useState([]);
    const [selectedBill, setSelectedBill] = useState(null);
    const [printBillData, setPrintBillData] = useState(null);
    const [pendingRebillPrint, setPendingRebillPrint] = useState(false);
    const [restaurant, setRestaurant] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const rebillPrintRef = useRef(null);

    const [fromDate, setFromDate] = useState(() => toDateInput(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
    const [toDate, setToDate] = useState(() => toDateInput(new Date()));
    const accessQuery = impersonatedOwnerId
        ? `impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`
        : employeeOfOwnerId
            ? `employee_of=${encodeURIComponent(employeeOfOwnerId)}`
            : '';

    const handleRebillPrint = useReactToPrint({
        content: () => rebillPrintRef.current,
    });

    const fetchRestaurantDetails = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const idToken = await user.getIdToken();
        const settingsUrl = new URL('/api/owner/settings', window.location.origin);
        if (accessQuery) {
            const params = new URLSearchParams(accessQuery);
            params.forEach((value, key) => settingsUrl.searchParams.set(key, value));
        }

        const res = await fetch(settingsUrl.toString(), {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || 'Failed to load outlet details.');

        setRestaurant({
            name: data.restaurantName || 'Outlet',
            address: data.address || '',
            gstin: data.gstin || '',
            gstEnabled: !!data.gstEnabled,
            gstPercentage: Number(data.gstPercentage ?? data.gstRate ?? 0),
            gstMinAmount: Number(data.gstMinAmount ?? 0),
        });
    };

    const fetchHistory = async (searchOverride = query) => {
        try {
            setLoading(true);
            const user = auth.currentUser;
            if (!user) throw new Error('Please login first.');
            const idToken = await user.getIdToken();

            const apiUrl = new URL('/api/owner/custom-bill/history', window.location.origin);
            apiUrl.searchParams.set('from', fromDate);
            apiUrl.searchParams.set('to', toDate);
            apiUrl.searchParams.set('limit', '300');
            if (searchOverride?.trim()) apiUrl.searchParams.set('search', searchOverride.trim());
            if (impersonatedOwnerId) {
                apiUrl.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
            } else if (employeeOfOwnerId) {
                apiUrl.searchParams.set('employee_of', employeeOfOwnerId);
            }

            const res = await fetch(apiUrl.toString(), {
                headers: { Authorization: `Bearer ${idToken}` },
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.message || 'Failed to load custom bill history.');

            setHistory(Array.isArray(data.history) ? data.history : []);
            setSummary({ ...defaultSummary, ...(data.summary || {}) });
        } catch (error) {
            setInfoDialog({
                isOpen: true,
                title: 'History Load Failed',
                message: error.message,
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                fetchHistory();
                fetchRestaurantDetails().catch((error) => {
                    console.warn('[Custom Bill History] Outlet details fetch failed:', error?.message || error);
                });
            } else {
                setLoading(false);
            }
        });

        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate, toDate, accessQuery]);

    useEffect(() => {
        if (!pendingRebillPrint || !printBillData) return;

        const runPrint = async () => {
            try {
                await handleRebillPrint?.();
            } catch (error) {
                setInfoDialog({
                    isOpen: true,
                    title: 'Re-Bill Failed',
                    message: error?.message || 'Unable to print bill.',
                });
            } finally {
                setPendingRebillPrint(false);
            }
        };

        runPrint();
    }, [pendingRebillPrint, printBillData, handleRebillPrint]);

    const selectableBillIds = useMemo(
        () => history
            .filter((bill) => bill?.settlementEligible && !bill?.isSettled)
            .map((bill) => bill.id),
        [history]
    );

    const selectedBillIdSet = useMemo(
        () => new Set(selectedBillIds),
        [selectedBillIds]
    );
    const settlingBillIdSet = useMemo(
        () => new Set(settlingBillIds),
        [settlingBillIds]
    );

    useEffect(() => {
        const selectableSet = new Set(selectableBillIds);
        setSelectedBillIds((prev) => prev.filter((id) => selectableSet.has(id)));
    }, [selectableBillIds]);

    const selectedSettleAmount = useMemo(() => {
        return history.reduce((sum, bill) => {
            if (!selectedBillIdSet.has(bill.id)) return sum;
            return sum + Number(bill.totalAmount || 0);
        }, 0);
    }, [history, selectedBillIdSet]);

    const allSelectableSelected = selectableBillIds.length > 0 && selectableBillIds.every((id) => selectedBillIdSet.has(id));

    const toggleBillSelection = (billId) => {
        setSelectedBillIds((prev) => (
            prev.includes(billId)
                ? prev.filter((id) => id !== billId)
                : [...prev, billId]
        ));
    };

    const toggleSelectAll = () => {
        if (allSelectableSelected) {
            setSelectedBillIds([]);
            return;
        }
        setSelectedBillIds([...selectableBillIds]);
    };

    const settleBills = async (historyIds) => {
        const billIds = Array.isArray(historyIds) ? historyIds.filter(Boolean) : [];
        if (billIds.length === 0) {
            throw new Error('No pending bills provided for settlement.');
        }

        const user = auth.currentUser;
        if (!user) throw new Error('Please login first.');
        const idToken = await user.getIdToken();

        const apiUrl = new URL('/api/owner/custom-bill/history', window.location.origin);
        if (impersonatedOwnerId) {
            apiUrl.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            apiUrl.searchParams.set('employee_of', employeeOfOwnerId);
        }

        const res = await fetch(apiUrl.toString(), {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
                action: 'settle',
                historyIds: billIds,
            }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || 'Failed to settle selected bills.');
        return data;
    };

    const handleSettleSelected = async () => {
        if (selectedBillIds.length === 0) {
            setInfoDialog({
                isOpen: true,
                title: 'No Bills Selected',
                message: 'Please select pending counter bills to settle.',
            });
            return;
        }

        try {
            setIsSettling(true);
            const data = await settleBills(selectedBillIds);
            setInfoDialog({
                isOpen: true,
                title: 'Settlement Complete',
                message: data?.message || 'Selected bills settled successfully.',
            });

            setSelectedBillIds([]);
            await fetchHistory();
        } catch (error) {
            setInfoDialog({
                isOpen: true,
                title: 'Settlement Failed',
                message: error.message,
            });
        } finally {
            setIsSettling(false);
        }
    };

    const handleSettleSingle = async (bill) => {
        if (!bill?.id || !bill?.settlementEligible || bill?.isSettled) return;
        if (settlingBillIdSet.has(bill.id) || isSettling) return;

        try {
            setSettlingBillIds((prev) => [...prev, bill.id]);
            await settleBills([bill.id]);
            setSelectedBillIds((prev) => prev.filter((id) => id !== bill.id));
            await fetchHistory();
        } catch (error) {
            setInfoDialog({
                isOpen: true,
                title: 'Settlement Failed',
                message: error.message,
            });
        } finally {
            setSettlingBillIds((prev) => prev.filter((id) => id !== bill.id));
        }
    };

    const totalItems = useMemo(
        () => history.reduce((sum, bill) => sum + Number(bill.itemCount || 0), 0),
        [history]
    );

    const backUrl = impersonatedOwnerId
        ? `/owner-dashboard/custom-bill?impersonate_owner_id=${encodeURIComponent(impersonatedOwnerId)}`
        : employeeOfOwnerId
            ? `/owner-dashboard/custom-bill?employee_of=${encodeURIComponent(employeeOfOwnerId)}`
            : '/owner-dashboard/custom-bill';

    const triggerRebill = (bill) => {
        if (!bill) return;
        setPrintBillData(bill);
        setPendingRebillPrint(true);
    };

    const printableItems = useMemo(() => {
        if (!printBillData?.items || !Array.isArray(printBillData.items)) return [];
        return printBillData.items.map((item, index) => {
            const quantity = Number(item?.quantity || 1);
            const price = Number(item?.price || 0);
            const totalPrice = Number(item?.totalPrice || price * quantity);
            const portionName = String(item?.portionName || '').trim();

            return {
                id: item?.id || `rebill-item-${index + 1}`,
                name: item?.name || 'Item',
                quantity,
                price,
                totalPrice,
                portion: portionName ? { name: portionName, price } : undefined,
            };
        });
    }, [printBillData]);

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <Button onClick={() => router.push(backUrl)} variant="ghost" size="icon">
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Custom Bill History</h1>
                        <p className="text-muted-foreground mt-1 text-sm md:text-base">
                            All offline/manual counter bills with full details.
                        </p>
                    </div>
                </div>

                <Button onClick={() => fetchHistory()} variant="outline" disabled={loading}>
                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    <span className="ml-2">Refresh</span>
                </Button>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">From</p>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(event) => setFromDate(event.target.value)}
                            className="w-full h-10 mt-1 rounded-md bg-input border border-border px-3"
                        />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">To</p>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(event) => setToDate(event.target.value)}
                            className="w-full h-10 mt-1 rounded-md bg-input border border-border px-3"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Search</p>
                        <div className="relative mt-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') fetchHistory(event.currentTarget.value);
                                }}
                                placeholder="Customer, phone, bill id, item..."
                                className="w-full h-10 rounded-md bg-input border border-border pl-10 pr-20"
                            />
                            <Button
                                type="button"
                                size="sm"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-8"
                                onClick={() => fetchHistory()}
                                disabled={loading}
                            >
                                Go
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Bills</p>
                    <p className="text-2xl font-bold mt-1">{Number(summary.totalBills || 0).toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Counter Revenue</p>
                    <p className="text-2xl font-bold mt-1">{formatCurrency(summary.totalAmount || 0)}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Items Sold</p>
                    <p className="text-2xl font-bold mt-1">{Number(totalItems || 0).toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending Settlement</p>
                    <p className="text-2xl font-bold mt-1">{formatCurrency(summary.pendingSettlementAmount || 0)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{Number(summary.pendingSettlementBills || 0)} bill(s)</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Settled Amount</p>
                    <p className="text-2xl font-bold mt-1">{formatCurrency(summary.settledAmount || 0)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{Number(summary.settledBills || 0)} bill(s)</p>
                </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold">
                        Selected for settlement: {selectedBillIds.length} bill(s)
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Selected Amount: {formatCurrency(selectedSettleAmount)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={toggleSelectAll}
                        disabled={loading || selectableBillIds.length === 0}
                    >
                        {allSelectableSelected ? 'Clear Selection' : 'Select All Pending'}
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSettleSelected}
                        disabled={loading || isSettling || selectedBillIds.length === 0}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                        {isSettling ? 'Settling...' : 'Settle Selected'}
                    </Button>
                </div>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30 border-b border-border">
                            <tr>
                                <th className="p-4 text-left font-semibold text-muted-foreground">
                                    <input
                                        type="checkbox"
                                        checked={allSelectableSelected}
                                        onChange={toggleSelectAll}
                                        disabled={loading || selectableBillIds.length === 0}
                                        onClick={(event) => event.stopPropagation()}
                                    />
                                </th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Bill ID</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Customer</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Items</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Amount</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Settlement</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Printed At</th>
                                <th className="p-4 text-left font-semibold text-muted-foreground">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({ length: 6 }).map((_, idx) => (
                                    <tr key={`skeleton-${idx}`} className="animate-pulse">
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-5" /></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-24" /></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-36" /></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-12" /></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-20" /></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-24" /></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-36" /></td>
                                        <td className="p-4"><div className="h-5 bg-muted rounded w-20" /></td>
                                    </tr>
                                ))
                            ) : history.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                                        No custom bill history found in selected range.
                                    </td>
                                </tr>
                            ) : (
                                history.map((bill) => {
                                    const isSelectable = !!bill?.settlementEligible && !bill?.isSettled;
                                    const isSelected = selectedBillIdSet.has(bill.id);
                                    const isRowSettling = settlingBillIdSet.has(bill.id);

                                    return (
                                        <tr
                                            key={bill.id}
                                            className="hover:bg-muted/40 cursor-pointer"
                                            onClick={() => setSelectedBill(bill)}
                                        >
                                        <td className="p-4">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                disabled={!isSelectable}
                                                onChange={() => toggleBillSelection(bill.id)}
                                                onClick={(event) => event.stopPropagation()}
                                            />
                                        </td>
                                        <td className="p-4 font-mono text-xs md:text-sm">{String(bill.historyId || bill.id).slice(0, 12)}</td>
                                        <td className="p-4">
                                            <div className="font-medium">{bill.customerName || 'Walk-in Customer'}</div>
                                            <div className="text-xs text-muted-foreground">{bill.customerPhone || '-'}</div>
                                        </td>
                                        <td className="p-4">{Number(bill.itemCount || 0)}</td>
                                        <td className="p-4 font-semibold">{formatCurrency(bill.totalAmount || 0)}</td>
                                        <td className="p-4">
                                            {!bill?.settlementEligible ? (
                                                <span className="inline-flex items-center rounded-full border border-slate-500/40 px-2 py-1 text-xs text-slate-500">
                                                    Not Required
                                                </span>
                                            ) : bill?.isSettled ? (
                                                <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600">
                                                    Settled
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleSettleSingle(bill);
                                                    }}
                                                    disabled={isSettling || isRowSettling}
                                                    className={cn(
                                                        "inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 transition-colors",
                                                        isSettling || isRowSettling
                                                            ? "opacity-60 cursor-not-allowed"
                                                            : "hover:bg-amber-500/20"
                                                    )}
                                                >
                                                    {isRowSettling ? 'Settling...' : 'Pending'}
                                                </button>
                                            )}
                                        </td>
                                        <td className="p-4 text-muted-foreground">{formatDateTime(bill.printedAt)}</td>
                                        <td className="p-4">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    triggerRebill(bill);
                                                }}
                                            >
                                                <Printer className="h-3.5 w-3.5 mr-1" />
                                                Re-Bill
                                            </Button>
                                        </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <Dialog open={!!selectedBill} onOpenChange={() => setSelectedBill(null)}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Receipt className="h-5 w-5" />
                            Custom Bill Details
                        </DialogTitle>
                    </DialogHeader>

                    {selectedBill && (
                        <div className="space-y-5">
                            <div className="flex justify-end">
                                <Button
                                    type="button"
                                    onClick={() => triggerRebill(selectedBill)}
                                    className="bg-primary hover:bg-primary/90"
                                >
                                    <Printer className="h-4 w-4 mr-2" />
                                    Re-Bill Print
                                </Button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/30 rounded-lg p-4">
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Bill ID</p>
                                    <p className="font-mono text-sm mt-1">{selectedBill.historyId || selectedBill.id}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Printed Time</p>
                                    <p className="text-sm mt-1">{formatDateTime(selectedBill.printedAt)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Settlement</p>
                                    <p className="text-sm mt-1">
                                        {!selectedBill?.settlementEligible
                                            ? 'Not Required (Create Order)'
                                            : selectedBill?.isSettled
                                                ? `Settled on ${formatDateTime(selectedBill.settledAt)}`
                                                : 'Pending'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><User className="h-3.5 w-3.5" />Customer</p>
                                    <p className="text-sm mt-1">{selectedBill.customerName || 'Walk-in Customer'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Phone className="h-3.5 w-3.5" />Phone</p>
                                    <p className="text-sm mt-1">{selectedBill.customerPhone || '-'}</p>
                                </div>
                                {selectedBill.customerAddress && (
                                    <div className="md:col-span-2">
                                        <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Address</p>
                                        <p className="text-sm mt-1">{selectedBill.customerAddress}</p>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className="font-semibold mb-2">Items</h3>
                                <div className="space-y-2">
                                    {(selectedBill.items || []).map((item, index) => (
                                        <div key={`${item.id || 'item'}-${index}`} className="flex justify-between items-start p-3 bg-muted/20 rounded-lg">
                                            <div className="flex-1 pr-3">
                                                <p className="font-medium text-sm">{item.name || 'Item'}</p>
                                                {item.portionName && (
                                                    <p className="text-xs text-muted-foreground mt-1">Portion: {item.portionName}</p>
                                                )}
                                                <p className="text-xs text-muted-foreground mt-1">Qty: {Number(item.quantity || 1)}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs text-muted-foreground">Unit: {formatCurrency(item.price || 0)}</p>
                                                <p className="font-semibold text-sm">{formatCurrency(item.totalPrice || 0)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="border-t pt-3 space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Subtotal</span>
                                    <span>{formatCurrency(selectedBill.subtotal || 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">CGST</span>
                                    <span>{formatCurrency(selectedBill.cgst || 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">SGST</span>
                                    <span>{formatCurrency(selectedBill.sgst || 0)}</span>
                                </div>
                                {Number(selectedBill.deliveryCharge || 0) > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Delivery Charge</span>
                                        <span>{formatCurrency(selectedBill.deliveryCharge || 0)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between font-bold text-base border-t pt-2">
                                    <span>Total</span>
                                    <span>{formatCurrency(selectedBill.totalAmount || 0)}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <div className="hidden">
                <div ref={rebillPrintRef}>
                    {printBillData && (
                        <BillToPrint
                            order={{ orderDate: printBillData.printedAt ? new Date(printBillData.printedAt) : new Date() }}
                            restaurant={restaurant || { name: 'Outlet', address: '' }}
                            billDetails={{
                                subtotal: Number(printBillData.subtotal || 0),
                                cgst: Number(printBillData.cgst || 0),
                                sgst: Number(printBillData.sgst || 0),
                                grandTotal: Number(printBillData.totalAmount || 0),
                                discount: 0,
                                deliveryCharge: Number(printBillData.deliveryCharge || 0),
                            }}
                            items={printableItems}
                            customerDetails={{
                                name: printBillData.customerName || 'Walk-in Customer',
                                phone: printBillData.customerPhone || '',
                                address: printBillData.customerAddress || '',
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
