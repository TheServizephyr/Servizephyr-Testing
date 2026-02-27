
'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { motion } from 'framer-motion';
import { X, CameraOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const QrScanner = ({ onClose, onScanSuccess }) => {
    const scannerRef = useRef(null);
    const [cameraError, setCameraError] = useState(null);

    useEffect(() => {
        if (!scannerRef.current) return;

        const html5QrCode = new Html5Qrcode(scannerRef.current.id);
        let currentCameraId;

        const startScanner = (cameras) => {
            if (cameras && cameras.length > 0) {
                const camera = cameras.find(c => c.label.toLowerCase().includes('back')) || cameras[0];
                currentCameraId = camera.id;

                html5QrCode.start(
                    currentCameraId, 
                    {
                        fps: 10,
                        qrbox: (viewfinderWidth, viewfinderHeight) => {
                            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                            const qrboxSize = Math.floor(minEdge * 0.9);
                            return {
                                width: qrboxSize,
                                height: qrboxSize,
                            };
                        },
                    },
                    (decodedText, decodedResult) => {
                        onScanSuccess(decodedText);
                        html5QrCode.stop();
                    },
                    (errorMessage) => {
                        // ignore non-critical errors
                    }
                ).catch((err) => {
                    console.error(`Unable to start scanning, error: ${err}`);
                    setCameraError("Could not start camera. Please ensure permissions are granted and no other app is using it.");
                });
            } else {
                 setCameraError("No cameras found on this device.");
            }
        };

        Html5Qrcode.getCameras().then(startScanner).catch(err => {
            console.error("Failed to get cameras", err);
            setCameraError("Could not access camera. Please check your browser permissions.");
        });

        return () => {
            if (html5QrCode && html5QrCode.isScanning) {
                html5QrCode.stop().catch(err => {
                    console.error("Failed to stop scanner cleanly", err);
                });
            }
        };
    }, [onScanSuccess]);

    return (
        <motion.div
            className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <div className="relative w-full max-w-md bg-background rounded-2xl p-4 shadow-2xl">
                <button 
                    onClick={onClose}
                    className="absolute -top-3 -right-3 bg-destructive text-destructive-foreground rounded-full p-2 z-10 shadow-lg"
                >
                    <X size={24} />
                </button>
                <h2 className="text-xl font-bold text-center mb-4">Scan QR Code</h2>
                
                {cameraError ? (
                    <Alert variant="destructive">
                        <CameraOff className="h-4 w-4" />
                        <AlertTitle>Camera Error</AlertTitle>
                        <AlertDescription>
                            {cameraError} Please check your browser settings to allow camera access.
                        </AlertDescription>
                    </Alert>
                ) : (
                    <div id="qr-scanner-container" ref={scannerRef} className="rounded-lg overflow-hidden border-2 border-primary"></div>
                )}
            </div>
        </motion.div>
    );
};

export default QrScanner;
