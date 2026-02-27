"use client";

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, X, MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useReactToPrint } from 'react-to-print';
import BillToPrint from '@/components/BillToPrint';
import { EscPosEncoder } from '@/services/printer/escpos';
import { connectPrinter, printData } from '@/services/printer/webUsbPrinter';
import { formatSafeDate } from '@/lib/safeDateFormat';
import { getItemVariantLabel } from '@/lib/itemVariantDisplay';

import { useToast } from "@/components/ui/use-toast";
import { toPng } from 'html-to-image';
import { auth } from '@/lib/firebase';

// Reusable Print Dialog
export default function PrintOrderDialog({ isOpen, onClose, order, restaurant }) {
    const billRef = useRef();
    const { toast } = useToast();
    const [usbDevice, setUsbDevice] = useState(null);
    const [status, setStatus] = useState('');
    const [isSharing, setIsSharing] = useState(false);

    const handleStandardPrint = useReactToPrint({
        content: () => billRef.current,
        onAfterPrint: () => setStatus('Standard print sent'),
    });

    const handleWhatsAppShare = async () => {
        if (!order.customerPhone) {
            toast({
                title: "Contact Missing",
                description: "Customer phone number not available for this order.",
                variant: "destructive"
            });
            return;
        }

        setIsSharing(true);
        setStatus('Generating image...');

        try {
            // 1. Generate Image from Bill Component
            // Increased delay to ensure all assets/fonts are loaded
            await new Promise(resolve => setTimeout(resolve, 800));

            const node = billRef.current;

            const dataUrl = await toPng(node, {
                height: node.scrollHeight,
                width: node.scrollWidth,
                pixelRatio: 2.5, // Optimized for clarity and file size
                backgroundColor: '#ffffff',
                cacheBust: true,
            });

            // Convert base64 to file blob
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const imageFile = new File([blob], `bill_${order.id.substring(0, 8)}.png`, { type: 'image/png' });

            setStatus('Uploading bill...');

            // 2. Authentication
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required.");
            const idToken = await user.getIdToken();

            // 3. Upload Image to Firebase
            const uploadUrlRes = await fetch('/api/owner/whatsapp-direct/upload-url', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fileName: imageFile.name,
                    fileType: imageFile.type,
                    fileSize: imageFile.size
                })
            });

            if (!uploadUrlRes.ok) throw new Error("Failed to get upload URL");
            const { presignedUrl, publicUrl, storagePath } = await uploadUrlRes.json();

            const uploadToStorageRes = await fetch(presignedUrl, {
                method: 'PUT',
                body: imageFile,
                headers: { 'Content-Type': imageFile.type }
            });

            if (!uploadToStorageRes.ok) throw new Error("Failed to upload image to storage");

            setStatus('Sending to WhatsApp...');

            // 4. Send WhatsApp Message
            const sendMessageRes = await fetch('/api/owner/whatsapp-direct/messages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    conversationId: order.customerPhone, // Assuming 10 digits as per backend logic
                    imageUrl: publicUrl,
                    storagePath: storagePath,
                    text: `Hello ${order.customerName || order.customer || 'Guest'}, here is the bill for your order #${order.customerOrderId || order.id.substring(0, 8)}. Thank you for dining with us!`
                })
            });

            if (!sendMessageRes.ok) {
                const errorData = await sendMessageRes.json();
                throw new Error(errorData.message || "Failed to send WhatsApp message");
            }

            setStatus('Shared on WhatsApp! ✅');
            toast({
                title: "Success",
                description: "Bill shared on WhatsApp successfully.",
            });
        } catch (error) {
            console.error("[WhatsApp Share Error]:", error);
            setStatus('Sharing failed ❌');
            toast({
                title: "Sharing Failed",
                description: error.message || "Something went wrong while sharing the bill.",
                variant: "destructive"
            });
        } finally {
            setIsSharing(false);
        }
    };

    const handleDirectPrint = async () => {
        try {
            setStatus('Connecting to printer...');
            let device = usbDevice;

            // If we have a stored device, check if it's still open
            if (device && !device.opened) {
                console.log('[Printer] Stored device closed, resetting...');
                device = null;
                setUsbDevice(null);
            }

            if (!device) {
                try {
                    // Pass setStatus to connectPrinter to show granular steps
                    device = await connectPrinter(setStatus);
                    setUsbDevice(device);
                } catch (err) {
                    console.error('[Printer] Connection error:', err);
                    setStatus(err.message.includes('No device selected') ? 'Connection cancelled' : err.message);
                    return;
                }
            }

            setStatus('Preparing data...');
            const encoder = new EscPosEncoder();

            // Header
            encoder.initialize().align('center')
                .bold(true).text(restaurant?.name || 'Restaurant').newline()
                .bold(false).text(restaurant?.address?.street || (typeof restaurant?.address === 'string' ? restaurant.address : '')).newline();

            if (restaurant?.gstin) encoder.text(`GSTIN: ${restaurant.gstin}`).newline();
            if (restaurant?.fssai) encoder.text(`FSSAI: ${restaurant.fssai}`).newline();

            encoder.text('--------------------------------').newline()
                .align('left').bold(true)
                .text(`Cust. Order ID: ${order.customerOrderId || order.id.substring(0, 8)}`).newline()
                .bold(false)
                .text(`Date: ${formatSafeDate(order.orderDate || order.createdAt)}`)
                .newline()
                .text('--------------------------------').newline();

            // Items
            (order.items || []).forEach(item => {
                const qty = item.quantity || 1;
                const price = item.price || 0;
                const total = (qty * price).toFixed(0);

                // FIXED: Portion Name
                const variantLabel = getItemVariantLabel(item).replace(/^\s*/, '');
                encoder.text(`${item.name}${variantLabel}`).newline();

                // FIXED: Add-ons as sub-items
                if (item.addons && item.addons.length > 0) {
                    item.addons.forEach(addon => {
                        encoder.text(`  + ${addon.name} (${addon.price})`).newline();
                    });
                }

                encoder.text(`  ${qty} x ${price}`).align('right').text(total).align('left').newline();
            });

            // Totals
            encoder.text('--------------------------------').newline()
                .align('right');

            const subtotal = (order.items || []).reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const cgst = order.cgst !== undefined ? order.cgst : (order.tax || 0) / 2;
            const sgst = order.sgst !== undefined ? order.sgst : (order.tax || 0) / 2;
            const tax = cgst + sgst;
            const packing = order.packagingCharge || 0;
            const delivery = order.deliveryCharge || 0;
            const platform = order.platformFee || 0;
            const convenience = order.convenienceFee || 0;
            const service = order.serviceFee || 0;
            const tip = order.tip || 0;
            const discount = order.discount || 0;

            const gstRate = order?.gstPercentage || restaurant?.gstPercentage || 5;
            const halfRate = (gstRate / 2).toFixed(1).replace(/\.0$/, '');
            const grandTotal = order.totalAmount || (subtotal + tax + packing + delivery + platform + convenience + service + tip - discount);

            encoder.text(`Subtotal: ${subtotal}`).newline();

            if (discount > 0) encoder.text(`Discount: -${discount}`).newline();
            if (packing > 0) encoder.text(`Packing: ${packing}`).newline();
            if (platform > 0) encoder.text(`Platform Fee: ${platform}`).newline();
            if (convenience > 0) encoder.text(`Conv. Fee: ${convenience}`).newline();
            if (service > 0) encoder.text(`Service Fee: ${service}`).newline();
            if (delivery > 0) encoder.text(`Delivery: ${delivery}`).newline();
            if (tip > 0) encoder.text(`Tip: ${tip}`).newline();

            if (cgst > 0) encoder.text(`CGST (${halfRate}%): ${cgst}`).newline();
            if (sgst > 0) encoder.text(`SGST (${halfRate}%): ${sgst}`).newline();

            encoder.bold(true).size('large')
                .text(`TOTAL: ${grandTotal}`).newline()
                .size('normal').bold(false).align('center')
                .newline()
                .text('Powered by ServiZephyr').newline()
                .newline().newline().newline()
                .cut();

            await printData(device, encoder.encode(), setStatus);
            setStatus('Sent to Thermal Printer ✅');
        } catch (error) {
            console.error('[Printer] Print error:', error);
            setStatus(`Error: ${error.message}`);
            // If print fails, reset device state to force re-discovery
            setUsbDevice(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md p-0 overflow-hidden">
                <DialogHeader className="p-4 border-b">
                    <DialogTitle className="flex items-center gap-2">
                        Print Bill
                        {status && (
                            <span className="text-[10px] font-normal text-muted-foreground bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full truncate max-w-[200px]" title={status}>
                                {status}
                            </span>
                        )}
                    </DialogTitle>
                </DialogHeader>

                <div className="max-h-[60vh] overflow-y-auto bg-gray-100 p-4 flex justify-center">
                    <div className="w-[78mm] mx-auto bg-white shadow-md min-h-[100px]">
                        {/* Preview for ref */}
                        <div ref={billRef}>
                            <BillToPrint
                                order={order}
                                restaurant={restaurant}
                                // Adapter for BillToPrint props if needed
                                items={order.items || []}
                                customerDetails={{
                                    name: order.customerName || order.customer || order.name || 'Walk-in Customer',
                                    phone: order.customerPhone,
                                    address: order.customerAddress
                                }}
                                billDetails={{
                                    subtotal: (order.items || []).reduce((sum, i) => sum + (i.price * i.quantity), 0),
                                    grandTotal: order.totalAmount,
                                    cgst: order.cgst !== undefined ? order.cgst : (order.tax || 0) / 2,
                                    sgst: order.sgst !== undefined ? order.sgst : (order.tax || 0) / 2,
                                    packagingCharge: order.packagingCharge || 0,
                                    deliveryCharge: order.deliveryCharge || 0,
                                    platformFee: order.platformFee || 0,
                                    convenienceFee: order.convenienceFee || 0,
                                    serviceFee: order.serviceFee || 0,
                                    tip: order.tip || 0,
                                    discount: order.discount || 0
                                }}
                            />
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-muted border-t flex flex-wrap sm:flex-nowrap gap-2 justify-end no-print">
                    <Button
                        onClick={handleWhatsAppShare}
                        variant="outline"
                        disabled={isSharing}
                        className="border-green-600 text-green-600 hover:bg-green-50 whitespace-nowrap flex-shrink-0"
                    >
                        <MessageSquare className="mr-2 h-4 w-4" />
                        {isSharing ? 'Sharing...' : 'WhatsApp'}
                    </Button>
                    <Button onClick={handleDirectPrint} variant="secondary" className="bg-slate-800 text-white hover:bg-slate-700 whitespace-nowrap flex-shrink-0">
                        ⚡ Thermal
                    </Button>
                    <Button onClick={handleStandardPrint} className="bg-primary hover:bg-primary/90 whitespace-nowrap flex-shrink-0">
                        <Printer className="mr-2 h-4 w-4" /> Standard
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
