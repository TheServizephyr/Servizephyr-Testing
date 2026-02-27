"use client";

import React, { useEffect, useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useParams, useSearchParams } from 'next/navigation';
import { Printer, Share2, CheckCircle2, MapPin, Phone, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { useReactToPrint } from 'react-to-print';
import BillToPrint from '@/components/BillToPrint';

// Helper for currency
const formatCurrency = (val) => `₹${Number(val || 0).toLocaleString('en-IN')}`;

export default function PublicBillPage() {
    const { orderId } = useParams();
    const searchParams = useSearchParams();
    const [order, setOrder] = useState(null);
    const [restaurant, setRestaurant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const billRef = useRef();

    const handlePrint = useReactToPrint({
        content: () => billRef.current,
    });

    useEffect(() => {
        const fetchOrder = async () => {
            if (!orderId) return;

            const token = searchParams.get('token');
            const phone = searchParams.get('phone');
            const refParam = searchParams.get('ref');
            try {
                // Prefer secure server API so public bill works with WhatsApp tracking token.
                const params = new URLSearchParams();
                if (token) params.set('token', token);
                if (phone) params.set('phone', phone);
                if (refParam) params.set('ref', refParam);

                const response = await fetch(`/api/order/status/${orderId}?${params.toString()}`, {
                    cache: 'no-store'
                });

                if (response.ok) {
                    const payload = await response.json();
                    const apiOrder = payload?.order || null;
                    const apiRestaurant = payload?.restaurant || null;

                    if (!apiOrder) {
                        setError('Invoice not found.');
                        return;
                    }

                    setOrder({
                        id: apiOrder.id || orderId,
                        ...apiOrder,
                        orderDate: apiOrder.createdAt || apiOrder.orderDate || null,
                        customer: apiOrder.customerName || apiOrder.customer || 'Guest',
                        restaurantName: apiRestaurant?.name || ''
                    });

                    setRestaurant({
                        name: apiRestaurant?.name || 'Restaurant Partner',
                        address: apiRestaurant?.address?.street || apiRestaurant?.address?.full || '',
                        phone: apiRestaurant?.phone || ''
                    });
                    return;
                }

                // Fallback: legacy direct Firestore read (in case tokenless trusted context)
                const orderRef = doc(db, 'orders', orderId);
                const orderSnap = await getDoc(orderRef);
                if (!orderSnap.exists()) {
                    setError('Invoice not found.');
                    return;
                }

                const orderData = orderSnap.data();
                setOrder({ id: orderSnap.id, ...orderData });
                if (orderData.restaurantId) {
                    if (orderData.restaurantName) {
                        setRestaurant({
                            name: orderData.restaurantName,
                            address: orderData.restaurantAddress || '',
                            phone: orderData.restaurantPhone || ''
                        });
                    } else {
                        setRestaurant({ name: 'Restaurant Partner', address: '', phone: '' });
                    }
                }
            } catch (err) {
                console.error(err);
                setError('Could not load invoice.');
            } finally {
                setLoading(false);
            }
        };

        fetchOrder();
    }, [orderId, searchParams]);

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Invoice for Order #${order.id}`,
                    text: `Here is your bill from ${restaurant?.name || 'ServiZephyr Partner'}`,
                    url: window.location.href,
                });
            } catch (err) { }
        } else {
            navigator.clipboard.writeText(window.location.href);
            alert('Link copied to clipboard!');
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 animate-pulse">Loading Invoice...</div>;
    if (error) return <div className="min-h-screen flex items-center justify-center bg-red-50 text-red-500">{error}</div>;

    return (
        <div className="min-h-screen bg-slate-100 py-8 px-4 font-sans">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-lg mx-auto bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200"
            >
                {/* Header with Color */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full bg-white opacity-10 rotate-12 bg-grid-white/10" />
                    <div className="relative z-10">
                        <div className="mx-auto bg-white/20 w-16 h-16 rounded-full flex items-center justify-center mb-4 backdrop-blur-sm">
                            <CheckCircle2 size={32} className="text-white" />
                        </div>
                        <h1 className="text-2xl font-bold">{restaurant?.name}</h1>
                        <p className="opacity-90 text-sm mt-1">{restaurant?.address}</p>
                        <div className="mt-4 inline-block bg-white/20 backdrop-blur-md px-4 py-1 rounded-full text-xs font-medium border border-white/20">
                            Order #{order.customerOrderId || order.id.slice(-6).toUpperCase()}
                        </div>
                    </div>
                </div>

                {/* Bill Content */}
                <div className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Billed To</p>
                            <h3 className="font-bold text-slate-800 text-lg">{order.customerName || order.customer || 'Guest'}</h3>
                            <p className="text-sm text-slate-500">{order.customerPhone}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Date</p>
                            <p className="text-sm font-medium text-slate-700">
                                {order.orderDate?.seconds
                                    ? new Date(order.orderDate.seconds * 1000).toLocaleDateString()
                                    : new Date().toLocaleDateString()}
                            </p>
                            <p className="text-xs text-slate-400">
                                {order.orderDate?.seconds
                                    ? new Date(order.orderDate.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                    : ''}
                            </p>
                        </div>
                    </div>

                    {/* Items Table */}
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 mb-6">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-slate-400 text-xs uppercase text-left">
                                    <th className="pb-2 font-medium">Item</th>
                                    <th className="pb-2 font-medium text-center">Qty</th>
                                    <th className="pb-2 font-medium text-right">Price</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {order.items?.map((item, idx) => (
                                    <tr key={idx}>
                                        <td className="py-3 font-medium text-slate-700">{item.name}</td>
                                        <td className="py-3 text-center text-slate-500">x{item.quantity}</td>
                                        <td className="py-3 text-right font-mono text-slate-700">{formatCurrency(item.price * item.quantity)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Summary */}
                    <div className="space-y-2 border-t border-slate-100 pt-4">
                        <div className="flex justify-between text-sm text-slate-500">
                            <span>Subtotal</span>
                            <span>{formatCurrency(
                                order.items?.reduce((acc, i) => acc + (i.price * i.quantity), 0)
                            )}</span>
                        </div>
                        {order.deliveryCharge > 0 && (
                            <div className="flex justify-between text-sm text-slate-500">
                                <span>Delivery Charge</span>
                                <span>+ {formatCurrency(order.deliveryCharge)}</span>
                            </div>
                        )}
                        {order.packingCharge > 0 && (
                            <div className="flex justify-between text-sm text-slate-500">
                                <span>Packing Charge</span>
                                <span>+ {formatCurrency(order.packingCharge)}</span>
                            </div>
                        )}
                        {order.cgst > 0 && (
                            <div className="flex justify-between text-sm text-slate-500">
                                <span>CGST (2.5%)</span>
                                <span>+ {formatCurrency(order.cgst)}</span>
                            </div>
                        )}
                        {order.sgst > 0 && (
                            <div className="flex justify-between text-sm text-slate-500">
                                <span>SGST (2.5%)</span>
                                <span>+ {formatCurrency(order.sgst)}</span>
                            </div>
                        )}
                        {order.discount > 0 && (
                            <div className="flex justify-between text-sm text-slate-500 text-green-600">
                                <span>Discount</span>
                                <span>- {formatCurrency(order.discount)}</span>
                            </div>
                        )}

                        <div className="flex justify-between text-xl font-bold text-slate-900 pt-2 border-t border-dashed border-slate-200 mt-2">
                            <span>Grand Total</span>
                            <span className="text-green-600 font-mono">{formatCurrency(order.totalAmount)}</span>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-3 mt-8 no-print">
                        <Button onClick={handleShare} variant="outline" className="w-full border-slate-200 hover:bg-slate-50 text-slate-700">
                            <Share2 size={16} className="mr-2" /> Share Link
                        </Button>
                        <Button onClick={handlePrint} className="w-full bg-slate-900 hover:bg-slate-800 text-white">
                            <Download size={16} className="mr-2" /> Download PDF
                        </Button>
                    </div>

                    <div className="mt-8 text-center">
                        <p className="text-xs text-slate-400">
                            Thank you for ordering with us! <br />
                            Powered by <span className="font-bold text-slate-500">ServiZephyr</span>
                        </p>
                    </div>
                </div>

                {/* Hidden Print Component for exact PDF layout */}
                <div style={{ display: 'none' }}>
                    <BillToPrint
                        ref={billRef}
                        order={order}
                        restaurant={restaurant}
                        items={order.items}
                        billDetails={{
                            subtotal: order.items?.reduce((acc, i) => acc + (i.price * i.quantity), 0),
                            grandTotal: order.totalAmount,
                            deliveryCharge: order.deliveryCharge || 0,
                            packingCharge: order.packingCharge || 0,
                            discount: order.discount || 0,
                            cgst: order.cgst || 0,
                            sgst: order.sgst || 0
                        }}
                        customerDetails={{
                            name: order.customerName || order.customer || 'Guest',
                            phone: order.customerPhone || 'N/A',
                            address: order.customerAddress || ''
                        }}
                    />
                </div>
            </motion.div>
        </div>
    );
}
