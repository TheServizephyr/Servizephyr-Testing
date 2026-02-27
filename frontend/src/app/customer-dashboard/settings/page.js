'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Trash2, KeyRound, Loader2, BellRing, Shield, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useEffect, useState } from 'react';
import { useUser } from '@/firebase';
import InfoDialog from '@/components/InfoDialog';

const SectionCard = ({ title, description, icon: Icon, children, footer, delay = 0 }) => (
    <motion.div
        className="overflow-hidden rounded-2xl border border-border/70 bg-card/65 shadow-[0_22px_45px_-34px_rgba(2,6,23,0.95)]"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay }}
    >
        <div className="border-b border-border/70 p-5">
            <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
                {Icon ? <Icon className="h-5 w-5 text-primary" /> : null}
                {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div className="p-5">{children}</div>
        {footer ? <div className="border-t border-border/70 bg-background/40 p-4">{footer}</div> : null}
    </motion.div>
);

export default function CustomerSettingsPage() {
    const router = useRouter();
    const { user, isUserLoading } = useUser();
    const [notifications, setNotifications] = useState({
        orderUpdates: true,
        promotions: true,
        communityAlerts: false,
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        const fetchSettings = async () => {
            if (isUserLoading) return;
            if (!user) {
                setIsLoading(false);
                return;
            }

            try {
                const idToken = await user.getIdToken();
                const response = await fetch('/api/customer/profile', {
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.message || 'Failed to load notification settings.');
                }

                if (data.notifications) {
                    setNotifications({
                        orderUpdates: data.notifications.orderUpdates !== false,
                        promotions: data.notifications.promotions !== false,
                        communityAlerts: data.notifications.communityAlerts === true,
                    });
                }
            } catch (error) {
                setInfoDialog({
                    isOpen: true,
                    title: 'Error',
                    message: error.message || 'Could not load account settings.',
                });
            } finally {
                setIsLoading(false);
            }
        };

        fetchSettings();
    }, [user, isUserLoading]);

    const handleNotificationChange = (key) => {
        setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSaveChanges = async () => {
        if (!user) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Please log in again to continue.' });
            return;
        }

        setIsSaving(true);
        try {
            const idToken = await user.getIdToken();
            const response = await fetch('/api/customer/profile', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ notifications }),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to save settings.');
            }

            setInfoDialog({ isOpen: true, title: 'Success', message: 'Notification settings saved successfully.' });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message || 'Could not save settings.' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="px-4 py-5 md:px-6 md:py-7 space-y-5">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <header className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card/80 to-cyan-500/10 p-5">
                <div className="flex flex-wrap items-center gap-3">
                    <Button variant="ghost" size="icon" className="rounded-full border border-border/70" onClick={() => router.push('/customer-dashboard/profile')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                            <Sparkles className="h-3.5 w-3.5" />
                            Preference Center
                        </div>
                        <h1 className="mt-2 font-[family-name:var(--font-customer-display)] text-3xl font-bold tracking-tight">Account Settings</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Manage notifications and account safety controls.</p>
                    </div>
                </div>
            </header>

            <SectionCard
                title="Notification Settings"
                icon={BellRing}
                description="Choose what updates you want to receive."
                delay={0.04}
                footer={
                    <div className="flex justify-end">
                        <Button
                            className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
                            onClick={handleSaveChanges}
                            disabled={isLoading || isSaving}
                        >
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Save Changes
                        </Button>
                    </div>
                }
            >
                <div className="space-y-3">
                    <NotificationRow
                        id="orderUpdates"
                        title="Order Status Updates"
                        description="Real-time alerts for order confirmation, preparing, and delivery stages."
                        checked={notifications.orderUpdates}
                        onToggle={() => handleNotificationChange('orderUpdates')}
                        disabled={isLoading || isSaving}
                    />
                    <NotificationRow
                        id="promotions"
                        title="Promotions & Offers"
                        description="Get special discounts and limited-time restaurant deals."
                        checked={notifications.promotions}
                        onToggle={() => handleNotificationChange('promotions')}
                        disabled={isLoading || isSaving}
                    />
                    <NotificationRow
                        id="communityAlerts"
                        title="Community Alerts"
                        description="Receive important announcements from restaurants you follow."
                        checked={notifications.communityAlerts}
                        onToggle={() => handleNotificationChange('communityAlerts')}
                        disabled={isLoading || isSaving}
                    />
                </div>
            </SectionCard>

            <SectionCard
                title="Account Security"
                icon={Shield}
                description="Manage core security options for your account."
                delay={0.08}
            >
                <div className="space-y-3">
                    <Button variant="outline" className="w-full justify-start rounded-xl text-left">
                        <KeyRound className="mr-3 h-4 w-4" />
                        Change Password
                    </Button>
                    <p className="text-xs text-muted-foreground">Password management can be handled securely from your authenticated account session.</p>
                </div>
            </SectionCard>

            <SectionCard
                title="Danger Zone"
                icon={Trash2}
                description="Irreversible actions. Use carefully."
                delay={0.12}
            >
                <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="font-bold text-foreground">Delete Account</h3>
                        <p className="text-sm text-muted-foreground">Permanently remove your account and associated customer data.</p>
                    </div>
                    <Button variant="destructive" className="rounded-xl">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </Button>
                </div>
            </SectionCard>
        </div>
    );
}

function NotificationRow({ id, title, description, checked, onToggle, disabled }) {
    return (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/45 p-3.5">
            <Label htmlFor={id} className="flex-1 cursor-pointer">
                <span className="block font-semibold text-foreground">{title}</span>
                <span className="block text-xs text-muted-foreground mt-1">{description}</span>
            </Label>
            <Switch id={id} checked={checked} onCheckedChange={onToggle} disabled={disabled} />
        </div>
    );
}
