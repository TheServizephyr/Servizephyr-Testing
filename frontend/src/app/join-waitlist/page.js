
'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Store, Phone, Mail, MapPin, Feather, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function JoinWaitlistPage() {
    const [formData, setFormData] = useState({
        name: '',
        businessName: '',
        phone: '',
        email: '',
        address: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        if (!formData.name || !formData.businessName || !formData.phone || !formData.address) {
            setError('Please fill all required fields.');
            setLoading(false);
            return;
        }

        if (!/^\d{10}$/.test(formData.phone)) {
            setError('Please enter a valid 10-digit mobile number.');
            setLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/waitlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || 'Something went wrong.');
            }

            setSuccess(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4">
                <motion.div
                    className="w-full max-w-lg p-8 text-center bg-card rounded-xl shadow-2xl shadow-primary/10 border border-border"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                >
                    <CheckCircle className="mx-auto h-20 w-20 text-green-500 mb-6" />
                    <h1 className="text-3xl font-bold text-foreground">You&apos;re on the list!</h1>
                    <p className="text-muted-foreground mt-4">Thank you for joining the ServiZephyr waitlist. We&apos;re excited to have you on board and will notify you as soon as we&apos;re ready for you.</p>
                    <Link href="/">
                        <button className="mt-8 bg-primary text-primary-foreground font-bold py-3 px-8 rounded-lg text-lg hover:bg-primary/90 transition-transform transform hover:scale-105">
                            Back to Home
                        </button>
                    </Link>
                </motion.div>
            </div>
        );
    }


    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <motion.div
                className="w-full max-w-lg p-8 space-y-6 bg-card rounded-xl shadow-2xl shadow-primary/10 border border-border"
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
            >
                <div className="text-center">
                    <Feather className="mx-auto h-12 w-12 text-primary mb-4" />
                    <h1 className="text-3xl font-bold text-foreground">Join the Revolution</h1>
                    <p className="text-muted-foreground mt-2">Get early access to ServiZephyr to get heavy discounts on our plans.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1" htmlFor="name">Your Name</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1" htmlFor="businessName">Business Name</label>
                        <div className="relative">
                            <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <input type="text" name="businessName" id="businessName" value={formData.businessName} onChange={handleChange} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1" htmlFor="phone">Mobile Number</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <input type="tel" name="phone" id="phone" value={formData.phone} onChange={handleChange} required placeholder="10-digit number" className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1" htmlFor="email">Email Address (Optional)</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <input type="email" name="email" id="email" value={formData.email} onChange={handleChange} className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1" htmlFor="address">Business Address</label>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <textarea name="address" id="address" value={formData.address} onChange={handleChange} required rows={3} placeholder="Your complete restaurant or shop address" className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : 'Join the Waitlist'}
                    </button>
                </form>
            </motion.div>
        </div>
    );
}
