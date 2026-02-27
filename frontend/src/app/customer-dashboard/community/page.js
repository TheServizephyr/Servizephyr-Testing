'use client';

import { motion } from 'framer-motion';
import { MessageSquare, Sparkles, BellRing, Users, Megaphone } from 'lucide-react';

const ComingCard = ({ icon: Icon, title, description, delay }) => (
    <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay }}
        className="rounded-2xl border border-border/70 bg-card/65 p-4"
    >
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
        </div>
        <h3 className="mt-3 font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </motion.div>
);

export default function CommunityPage() {
    return (
        <div className="px-4 py-5 md:px-6 md:py-7 space-y-5">
            <header className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/15 via-card/80 to-indigo-500/10 p-5 md:p-6">
                <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
                <div className="relative">
                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                        Next-Gen Community
                    </div>
                    <h1 className="mt-3 font-[family-name:var(--font-customer-display)] text-3xl font-bold tracking-tight">Community Feed</h1>
                    <p className="mt-2 max-w-2xl text-sm md:text-base text-muted-foreground">
                        We are preparing a social layer where customers can share reviews, discover trending plates, and get flash broadcasts from favorite restaurants.
                    </p>
                </div>
            </header>

            <div className="grid gap-3 md:grid-cols-3">
                <ComingCard
                    icon={Megaphone}
                    title="Restaurant Broadcasts"
                    description="Exclusive real-time announcements, offers, and chef specials from nearby restaurants."
                    delay={0.03}
                />
                <ComingCard
                    icon={Users}
                    title="Local Food Threads"
                    description="Share dish opinions, ask for recommendations, and build local food circles."
                    delay={0.06}
                />
                <ComingCard
                    icon={BellRing}
                    title="Smart Alerts"
                    description="Personalized notifications based on your cuisine choices and ordering patterns."
                    delay={0.09}
                />
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, delay: 0.12 }}
                className="rounded-3xl border border-dashed border-border/70 bg-card/40 py-16 px-6 text-center"
            >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                    <MessageSquare className="h-7 w-7" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Launching Soon</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                    Community is under active development. Your dashboard will automatically unlock this section when the feature is enabled.
                </p>
            </motion.div>
        </div>
    );
}
