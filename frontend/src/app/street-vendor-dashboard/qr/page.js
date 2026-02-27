'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import QRCode from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';
import { useUser } from '@/firebase';
import { useSearchParams } from 'next/navigation';
import { toPng } from 'html-to-image';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';


export default function StreetVendorQrPage() {
    const { user, isUserLoading } = useUser();
    const [vendorId, setVendorId] = useState(null);
    const [restaurantName, setRestaurantName] = useState('');
    const [loading, setLoading] = useState(true);
    const printRef = useRef();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const effectiveOwnerId = impersonatedOwnerId || employeeOfOwnerId;

    const handlePrint = useReactToPrint({
        content: () => printRef.current,
        documentTitle: "ServiZephyr_QR_Code",
    });

    const handleDownload = useCallback(() => {
        if (!printRef.current) return;

        toPng(printRef.current, { cacheBust: true, pixelRatio: 3 })
            .then((dataUrl) => {
                const link = document.createElement('a');
                link.download = `ServiZephyr-QR-${vendorId}.png`;
                link.href = dataUrl;
                link.click();
            })
            .catch((err) => {
                console.error('oops, something went wrong!', err);
            });
    }, [vendorId]);


    useEffect(() => {
        if (isUserLoading) return;
        if (!user) {
            setLoading(false);
            return;
        };

        const fetchVendorData = async () => {
            try {
                const idToken = await user.getIdToken();

                // Build URL with correct query param for employee/impersonation access
                let url = '/api/owner/settings';
                if (impersonatedOwnerId) {
                    url += `?impersonate_owner_id=${impersonatedOwnerId}`;
                } else if (employeeOfOwnerId) {
                    url += `?employee_of=${employeeOfOwnerId}`;
                }

                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });

                if (!res.ok) throw new Error('Failed to fetch vendor data');

                const data = await res.json();
                if (data.businessId) {
                    setVendorId(data.businessId);
                    setRestaurantName(data.restaurantName || 'My Restaurant');
                } else {
                    throw new Error("No business ID found.");
                }

            } catch (err) {
                console.error("Error fetching vendor data:", err);
            } finally {
                setLoading(false);
            }
        }
        fetchVendorData();
    }, [user, isUserLoading, effectiveOwnerId]);

    const qrValue = vendorId ? `${window.location.origin}/order/${vendorId}` : '';

    return (
        <>
            <style jsx global>{`
        @keyframes gradient-animation {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        .animated-gradient {
            background: linear-gradient(-45deg, hsl(var(--primary)), #ffffff);
            background-size: 400% 400%;
            animation: gradient-animation 10s ease infinite;
        }
    `}</style>
            <div className="min-h-screen bg-background text-foreground font-body p-4 flex flex-col">
                <header className="flex justify-between items-center mb-6">
                    <Link href="/street-vendor-dashboard" passHref>
                        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                            <ArrowLeft size={28} />
                        </Button>
                    </Link>
                    <h1 className="text-2xl font-bold font-headline">My QR Code</h1>
                    <div className="w-12"> {/* Spacer */}</div>
                </header>

                <main className="flex-grow flex flex-col items-center justify-center text-center">
                    {loading ? (
                        <GoldenCoinSpinner />
                    ) : vendorId ? (
                        <>
                            <motion.div
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                                className="w-full max-w-lg"
                            >
                                <div ref={printRef} className="animated-gradient p-8 rounded-3xl shadow-2xl shadow-primary/20">
                                    <div className="bg-white p-6 rounded-xl">
                                        {/* ORDER HERE - Main Call to Action */}
                                        <h2 className="text-5xl sm:text-6xl font-black text-black mb-4 font-headline text-center tracking-wide" style={{ textShadow: '3px 3px 0px rgba(0,0,0,0.2), 5px 5px 10px rgba(0,0,0,0.15), 1px 1px 2px rgba(0,0,0,0.3)', letterSpacing: '0.08em', fontWeight: '900' }}>
                                            ORDER HERE
                                        </h2>

                                        {/* QR Code - Large Size */}
                                        <div className="w-full h-auto my-4">
                                            <QRCode
                                                value={qrValue}
                                                size={1536}
                                                level={"H"}
                                                includeMargin={true}
                                                imageSettings={{
                                                    src: "/logo.png",
                                                    x: undefined,
                                                    y: undefined,
                                                    height: 384,
                                                    width: 384,
                                                    excavate: true,
                                                }}
                                                style={{ width: '100%', height: 'auto' }}
                                            />
                                        </div>

                                        {/* Restaurant Name */}
                                        <h3 className="text-3xl sm:text-4xl font-bold text-black mt-4 mb-6 font-headline" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.1)' }}>{restaurantName}</h3>

                                        {/* Branding */}
                                        <div className="mt-4">
                                            <p className="text-slate-600 text-base">Powered by ServiZephyr</p>
                                            <p className="text-slate-500 text-sm mt-1">Know more about at servizephyr.com</p>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>

                            <p className="mt-8 text-muted-foreground max-w-md">
                                Print this QR code and display it at your stall. Customers can scan it to see your menu and place pre-paid orders.
                            </p>

                            <div className="mt-8 grid grid-cols-1 gap-4 w-full max-w-lg">
                                <Button onClick={handleDownload} variant="outline" className="text-lg h-14 px-8 border-2 border-border text-foreground hover:bg-muted">
                                    <Download className="mr-2" /> Download PNG
                                </Button>
                            </div>
                        </>
                    ) : (
                        <p>Could not load vendor QR code. Please make sure your profile is set up.</p>
                    )}
                </main>
            </div>
        </>
    );
}
