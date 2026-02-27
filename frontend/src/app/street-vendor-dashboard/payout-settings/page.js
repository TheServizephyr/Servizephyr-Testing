
'use client';

import { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Banknote, AlertTriangle, CheckCircle, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

export const dynamic = 'force-dynamic';

function PayoutSettingsPageContent() {
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [accountId, setAccountId] = useState('');
    const router = useRouter();

    const [beneficiaryName, setBeneficiaryName] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
    const [ifsc, setIfsc] = useState('');


    useEffect(() => {
        const fetchUserData = async () => {
             setLoading(true);
             const user = auth.currentUser;
             if (user) {
                 const idToken = await user.getIdToken();
                 // Using the owner settings API as it can fetch data for any business type
                 const res = await fetch('/api/owner/settings', { headers: { 'Authorization': `Bearer ${idToken}` }});
                 if (res.ok) {
                     const data = await res.json();
                     if (data.razorpayAccountId) {
                         setAccountId(data.razorpayAccountId);
                     }
                 }
             }
             setLoading(false);
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchUserData();
            } else {
                router.push('/');
            }
        });
        
        return () => unsubscribe();
    }, [router]);

    const handleLinkAccount = async (e) => {
        e.preventDefault();
        
        if (accountNumber !== confirmAccountNumber) {
            setError("Account numbers do not match. Please re-enter.");
            return;
        }

        if (!beneficiaryName || !accountNumber || !ifsc) {
            setError("Please fill all bank details correctly.");
            return;
        }

        setIsSubmitting(true);
        setError('');
        
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication failed.");
            
            const idToken = await user.getIdToken();

            const payload = {
                beneficiaryName,
                accountNumber,
                ifsc
            };

            const response = await fetch('/api/owner/create-linked-account', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                 },
                 body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Failed to link bank account.");
            }
            
            setAccountId(result.accountId);

        } catch (err) {
            console.error("Payout Settings Error:", err);
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    if (loading) {
         return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <GoldenCoinSpinner />
            </div>
        )
    }

    if (accountId) {
        return (
             <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center h-full text-center p-8 bg-card border border-border rounded-xl"
            >
                <CheckCircle className="h-20 w-20 text-green-500" />
                <h2 className="mt-6 text-2xl font-bold">Bank Account Linked Successfully!</h2>
                <p className="mt-2 max-w-md text-muted-foreground">Your Razorpay Linked Account ID is:</p>
                <p className="mt-2 text-lg font-mono p-3 bg-muted rounded-md border border-border text-foreground">{accountId}</p>
                <p className="mt-4 text-sm text-muted-foreground">You are all set to receive payouts. No further action is needed.</p>
                 <Button onClick={() => router.push('/street-vendor-dashboard')} className="mt-6">Back to Dashboard</Button>
            </motion.div>
        )
    }

    return (        
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 md:p-6 text-foreground min-h-screen bg-background"
        >
             <header className="flex items-center gap-4 mb-8">
                <Button variant="ghost" size="icon" onClick={() => router.push('/street-vendor-dashboard')}><ArrowLeft/></Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Onboarding & Payouts</h1>
                    <p className="text-muted-foreground mt-1">Link your bank account to receive payments from online orders.</p>
                </div>
            </header>

            <div className="max-w-4xl mx-auto">
                <form onSubmit={handleLinkAccount}>
                    <div className="bg-card border border-border rounded-xl p-8">
                        <div className="text-center mb-8">
                            <Banknote className="mx-auto h-16 w-16 text-primary mb-4" />
                            <h3 className="text-xl font-semibold text-foreground">Enable Payouts via Razorpay Route</h3>
                            <p className="mt-2 text-muted-foreground max-w-lg mx-auto">
                                To receive your earnings, please provide your bank details below. This will securely create a Razorpay Linked Account for your business.
                            </p>
                        </div>
                        
                        <div className="space-y-6 max-w-md mx-auto">
                             <div>
                                <Label htmlFor="beneficiaryName">Account Holder Name</Label>
                                <Input id="beneficiaryName" type="text" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} required placeholder="e.g., Baaghi Chai" />
                                <p className="text-xs text-muted-foreground mt-1">This must exactly match the name on your bank account.</p>
                             </div>
                             <div>
                                <Label htmlFor="accountNumber">Bank Account Number</Label>
                                <Input id="accountNumber" type="text" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required placeholder="Enter your account number" />
                             </div>
                             <div>
                                <Label htmlFor="confirmAccountNumber">Confirm Bank Account Number</Label>
                                <Input id="confirmAccountNumber" type="text" value={confirmAccountNumber} onChange={(e) => setConfirmAccountNumber(e.target.value)} required placeholder="Re-enter your account number" />
                             </div>
                             <div>
                                <Label htmlFor="ifsc">IFSC Code</Label>
                                <Input id="ifsc" type="text" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} required placeholder="Enter your bank's IFSC code" />
                             </div>
                        </div>
                        
                        {error && (
                            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md max-w-md mx-auto">
                                <AlertTriangle size={16}/> {error}
                            </div>
                        )}
                        
                        <div className="text-center mt-8">
                            <Button 
                                type="submit"
                                className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground text-lg py-6 px-8" 
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : null}
                                {isSubmitting ? 'Creating Account...' : 'Create Linked Account Now'}
                            </Button>
                        </div>
                    </div>
                </form>
            </div>
        </motion.div>        
    );
}

export default function PayoutSettingsPage() {
    return (
        <Suspense fallback={<div className="flex h-screen w-full items-center justify-center"><GoldenCoinSpinner /></div>}>
            <PayoutSettingsPageContent />
        </Suspense>
    )
}
