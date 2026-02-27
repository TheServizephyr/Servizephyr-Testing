import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const SplitBillInterface = ({ totalAmount, onBack, orderDetails, onPlaceOrder }) => {
    const [splitCount, setSplitCount] = useState(2);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const router = useRouter();

    const handleGenerateSplitLinks = async () => {
        console.log("[SplitBillInterface] Generating split links...");
        if (splitCount < 2) {
            setError("Must split between at least 2 people.");
            return;
        }
        setLoading(true);
        setError('');

        try {
            // ALWAYS call onPlaceOrder to add items (works for both new and existing orders)
            console.log("[SplitBillInterface] Calling onPlaceOrder to add items...");
            const orderResult = await onPlaceOrder('split_bill');
            if (!orderResult || !orderResult.firestore_order_id) {
                throw new Error("Failed to process order for split payment.");
            }
            const baseOrderId = orderResult.firestore_order_id;
            console.log(`[SplitBillInterface] Order processed with ID: ${baseOrderId}`);

            const payload = {
                grandTotal: orderDetails.grandTotal,
                splitCount,
                baseOrderId: baseOrderId,
                restaurantId: orderDetails.restaurantId,
                // Pass pending items if this is an add-on order
                pendingItems: orderResult.pendingItems || [],
                pendingSubtotal: orderResult.pendingSubtotal || 0,
                pendingCgst: orderResult.pendingCgst || 0,
                pendingSgst: orderResult.pendingSgst || 0,
            };
            console.log("[SplitBillInterface] Calling /api/payment/create-order with payload:", payload);

            const res = await fetch('/api/payment/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to create split payment session.');

            console.log(`[SplitBillInterface] Split session created with ID: ${data.splitId}. Redirecting...`);
            router.push(`/split-pay/${data.splitId}`);

        } catch (err) {
            console.error("[SplitBillInterface] Error creating split session:", err);
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <Button onClick={onBack} variant="ghost" size="sm" className="mb-4"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Payment Options</Button>
            <h3 className="text-lg font-bold">Split Equally</h3>
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <Label htmlFor="split-count">Split bill between how many people?</Label>
                <input id="split-count" type="number" min="2" value={splitCount} onChange={e => setSplitCount(parseInt(e.target.value))} className="w-24 p-2 rounded-md bg-input border border-border" />
            </div>
            <Button onClick={handleGenerateSplitLinks} disabled={loading || splitCount < 2} className="w-full h-12 text-lg">
                {loading ? <Loader2 className="animate-spin" /> : 'Create Split Session'}
            </Button>
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        </div>
    );
};

export default SplitBillInterface;
