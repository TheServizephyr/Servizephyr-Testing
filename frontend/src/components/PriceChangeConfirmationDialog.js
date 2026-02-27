import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { formatPriceChangeMessage } from '@/lib/priceValidation';

/**
 * PriceChangeConfirmationDialog
 * Shows warning when manager tries to make significant price changes
 */
export default function PriceChangeConfirmationDialog({
    isOpen,
    onClose,
    onConfirm,
    oldPrice,
    newPrice,
    itemName,
    severity = 'warning'
}) {
    const percentChange = ((newPrice - oldPrice) / oldPrice) * 100;
    const isIncrease = percentChange > 0;
    const absPercent = Math.abs(percentChange).toFixed(1);

    const Icon = isIncrease ? TrendingUp : TrendingDown;
    const iconColor = severity === 'error' ? 'text-red-500' : 'text-yellow-500';

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${severity === 'error' ? 'bg-red-100' : 'bg-yellow-100'}`}>
                            <AlertTriangle className={`h-6 w-6 ${iconColor}`} />
                        </div>
                        <DialogTitle>
                            {severity === 'error' ? 'Price Change Blocked' : 'Large Price Change Detected'}
                        </DialogTitle>
                    </div>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="bg-muted p-4 rounded-lg space-y-3">
                        <div>
                            <p className="text-sm text-muted-foreground">Item Name</p>
                            <p className="font-semibold">{itemName}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm text-muted-foreground">Old Price</p>
                                <p className="font-semibold text-lg">₹{oldPrice}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">New Price</p>
                                <p className="font-semibold text-lg">₹{newPrice}</p>
                            </div>
                        </div>

                        <div className="pt-2 border-t">
                            <div className="flex items-center gap-2">
                                <Icon className={`h-5 w-5 ${iconColor}`} />
                                <span className={`font-bold ${iconColor}`}>
                                    {absPercent}% {isIncrease ? 'Increase' : 'Decrease'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <DialogDescription className="text-sm">
                        {severity === 'error' ? (
                            <>
                                <strong>This price change requires owner approval.</strong>
                                <br /><br />
                                Large price increases can negatively impact customer satisfaction and may indicate an error.
                                Please contact the owner to approve this change.
                            </>
                        ) : (
                            <>
                                <strong>This is a significant price change.</strong>
                                <br /><br />
                                Please confirm that this price change is intentional. Large decreases can impact revenue,
                                while large increases may affect customer satisfaction.
                            </>
                        )}
                    </DialogDescription>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    {severity !== 'error' && (
                        <Button
                            type="button"
                            variant={severity === 'error' ? 'destructive' : 'default'}
                            onClick={onConfirm}
                        >
                            Confirm Price Change
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
