'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Mic, Bell, MapPin, CheckCircle2, XCircle, AlertCircle, RefreshCw, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';

const PermissionItem = ({ icon: Icon, label, status, onAction, actionLabel, helpText }) => {
    const getStatusColor = () => {
        if (status === 'granted') return 'text-green-500';
        if (status === 'denied') return 'text-red-500';
        return 'text-amber-500';
    };

    const getStatusIcon = () => {
        if (status === 'granted') return <CheckCircle2 size={20} className="text-green-500" />;
        if (status === 'denied') return <XCircle size={20} className="text-red-500" />;
        return <AlertCircle size={20} className="text-amber-500" />;
    };

    const getStatusText = () => {
        if (status === 'granted') return 'Allowed';
        if (status === 'denied') return 'Blocked';
        return 'Not Set';
    };

    return (
        <div className="flex flex-col gap-2 p-3 bg-muted/40 rounded-lg border border-border">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-full bg-background", getStatusColor())}>
                        <Icon size={20} />
                    </div>
                    <div>
                        <p className="font-medium text-sm">{label}</p>
                        <p className={cn("text-xs font-semibold", getStatusColor())}>{getStatusText()}</p>
                    </div>
                </div>
                <div>{getStatusIcon()}</div>
            </div>

            {status !== 'granted' && (
                <div className="mt-1 pl-1">
                    {status === 'denied' && helpText ? (
                        <div className="text-xs text-muted-foreground bg-background p-2 rounded border border-border">
                            <p className="font-semibold text-red-500 mb-1 flex items-center gap-1">
                                <AlertCircle size={12} /> Action Required:
                            </p>
                            {helpText}
                        </div>
                    ) : (
                        onAction && (
                            <Button size="sm" variant="outline" className="w-full text-xs h-8" onClick={onAction}>
                                {actionLabel || "Enable"}
                            </Button>
                        )
                    )}
                </div>
            )}
        </div>
    );
};

export default function SystemStatusDialog({ isOpen, onClose }) {
    const [permissions, setPermissions] = useState({
        microphone: 'prompt', // granted, denied, prompt
        notifications: 'prompt',
        geolocation: 'prompt'
    });
    const [loading, setLoading] = useState(true);

    const checkPermissions = async () => {
        setLoading(true);
        try {
            // Check Microphone
            // Note: query for 'microphone' might not be supported in all browsers, needing try/catch
            try {
                const micStatus = await navigator.permissions.query({ name: 'microphone' });
                setPermissions(prev => ({ ...prev, microphone: micStatus.state }));

                // Add listener for changes
                micStatus.onchange = () => {
                    setPermissions(prev => ({ ...prev, microphone: micStatus.state }));
                };
            } catch (e) {
                console.warn("Mic permission query not supported", e);
                setPermissions(prev => ({ ...prev, microphone: 'unknown' }));
            }

            // Check Notifications
            try {
                const notifStatus = await navigator.permissions.query({ name: 'notifications' });
                setPermissions(prev => ({ ...prev, notifications: notifStatus.state }));
                notifStatus.onchange = () => {
                    setPermissions(prev => ({ ...prev, notifications: notifStatus.state }));
                };
            } catch (e) {
                // Fallback for notification check
                setPermissions(prev => ({ ...prev, notifications: Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'prompt' }));
            }

            // Check Geolocation
            try {
                const geoStatus = await navigator.permissions.query({ name: 'geolocation' });
                setPermissions(prev => ({ ...prev, geolocation: geoStatus.state }));
                geoStatus.onchange = () => {
                    setPermissions(prev => ({ ...prev, geolocation: geoStatus.state }));
                };
            } catch (e) {
                console.warn("Geo permission query not supported", e);
            }

        } catch (error) {
            console.error("Error checking permissions:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            checkPermissions();
        }
    }, [isOpen]);

    const requestMic = async () => {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            checkPermissions();
        } catch (e) {
            console.error("Mic request failed", e);
            checkPermissions(); // Update to denied if it was denied
        }
    };

    const requestNotification = async () => {
        try {
            await Notification.requestPermission();
            checkPermissions();
        } catch (e) {
            console.error("Notification request failed", e);
        }
    };

    const requestLocation = () => {
        navigator.geolocation.getCurrentPosition(
            () => checkPermissions(),
            () => checkPermissions()
        );
    };

    const helpContent = (
        <div className="space-y-1">
            <p>1. Open Chrome <span className="font-bold">Settings</span> (⋮)</p>
            <p>2. Go to <span className="font-bold">Site Settings</span></p>
            <p>3. Tap the blocked service (e.g., Microphone)</p>
            <p>4. Tap <span className="font-bold">Allow</span> for this app</p>
        </div>
    );

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md bg-card text-foreground border-border">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Smartphone className="text-primary" /> System Permission Status
                    </DialogTitle>
                    <DialogDescription>
                        Check and manage app permissions. If a permission is blocked, you must enable it in your Browser Settings.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-2">
                    <PermissionItem
                        icon={Mic}
                        label="Microphone"
                        status={permissions.microphone}
                        onAction={requestMic}
                        helpText={helpContent}
                    />
                    <PermissionItem
                        icon={Bell}
                        label="Notifications"
                        status={permissions.notifications}
                        onAction={requestNotification}
                        helpText={helpContent}
                    />
                    <PermissionItem
                        icon={MapPin}
                        label="Location"
                        status={permissions.geolocation}
                        onAction={requestLocation}
                        helpText={helpContent}
                    />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={checkPermissions} disabled={loading}>
                        <RefreshCw size={14} className={cn("mr-2", loading && "animate-spin")} /> Refresh
                    </Button>
                    <Button onClick={onClose}>Done</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
