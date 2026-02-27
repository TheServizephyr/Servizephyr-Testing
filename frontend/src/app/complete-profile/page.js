'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { User, Store, Shield, ShoppingCart, Phone, Key, ArrowRight, MapPin, HelpCircle, Bike, Map, Check } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';
import InfoDialog from '@/components/InfoDialog';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';


const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function CompleteProfile() {
  const router = useRouter();
  const [role, setRole] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState({
    street: '',
    city: 'Ghaziabad',
    state: 'Uttar Pradesh',
    postalCode: '201206',
    country: 'IN'
  });
  const [phone, setPhone] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
  const [termsAccepted, setTermsAccepted] = useState(false);

  const roles = [
    { id: 'street-vendor', label: 'Street Vendor (Food Stall)', icon: Map, enabled: true },
    { id: 'customer', label: 'Customer', icon: User, enabled: true },
    { id: 'restaurant-owner', label: 'Restaurant Owner', icon: Store, enabled: true },
    { id: 'shop-owner', label: 'Store Owner', icon: ShoppingCart, enabled: true },
    { id: 'rider', label: 'Rider', icon: Bike, enabled: true },
    { id: 'admin', label: 'Admin', icon: Shield, enabled: true }
  ];

  const handleRoleClick = (roleConfig) => {
    if (roleConfig.enabled) {
      setRole(roleConfig.id);
    } else {
      setInfoDialog({
        isOpen: true,
        title: 'Coming Soon!',
        message: `The dashboard for "${roleConfig.label}" will be launched soon. Stay tuned!`
      });
    }
  };


  useEffect(() => {
    console.log("[DEBUG] complete-profile: useEffect running.");
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        console.log("[DEBUG] complete-profile: onAuthStateChanged fired. User found:", user.email);
        try {
          const idToken = await user.getIdToken();
          const res = await fetch('/api/auth/check-role', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${idToken}` },
          });

          if (res.ok) {
            const { role, businessType } = await res.json();
            console.log(`[DEBUG] complete-profile: Fetched role from API: '${role}', BusinessType: '${businessType}'`);
            localStorage.setItem('role', role);
            if (businessType) {
              const resolvedBusinessType =
                businessType === 'street_vendor'
                  ? 'street-vendor'
                  : (businessType === 'shop' ? 'store' : businessType);
              localStorage.setItem('businessType', resolvedBusinessType);
            }

            if (role === 'owner' || role === 'restaurant-owner' || role === 'shop-owner') {
              router.push('/owner-dashboard');
            } else if (role === 'admin') {
              router.push('/admin-dashboard');
            } else if (role === 'rider') {
              router.push('/rider-dashboard');
            } else if (role === 'street-vendor') {
              router.push('/street-vendor-dashboard');
            } else {
              router.push('/customer-dashboard');
            }
          } else if (res.status === 404) {
            console.log("[DEBUG] complete-profile: User has no role (404). Staying on page.");
            const urlParams = new URLSearchParams(window.location.search);
            const phoneFromUrl = urlParams.get('phone');
            setPhone(user.phoneNumber || phoneFromUrl || '');
            setLoading(false);
          } else {
            const errorData = await res.json();
            throw new Error(errorData.message || 'Failed to verify user status.');
          }
        } catch (error) {
          console.error("[DEBUG] complete-profile: Error in auth logic.", error);
          setError("Could not verify user status. Please try again.");
          setLoading(false);
        }
      } else {
        // CRITICAL FIX: Wait for auth state to settle before redirecting
        // Firebase auth state change can take a moment to propagate after login
        // If we redirect too quickly, we might kick out new users mid-login!
        console.log("[DEBUG] complete-profile: No user found yet. Waiting to see if auth state updates...");

        // Give Firebase 2 seconds to populate auth state after login redirect
        const timeoutId = setTimeout(() => {
          console.log("[DEBUG] complete-profile: Auth state still null after wait. Redirecting to home.");
          router.push('/');
        }, 2000);

        // Clean up timeout if component unmounts
        return () => clearTimeout(timeoutId);
      }
    });

    return () => unsubscribe();
  }, [router]);

  const validatePhoneNumber = (number) => {
    const phoneRegex = /^\d{10}$/;
    return phoneRegex.test(number);
  }

  const handleAddressChange = (field, value) => {
    setAddress(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    console.log("[DEBUG] complete-profile: handleSubmit triggered.");

    if (!role) {
      setError('Please select a role.');
      setLoading(false);
      return;
    }

    const isBusinessOwner = role === 'restaurant-owner' || role === 'shop-owner' || role === 'street-vendor';
    if (isBusinessOwner && !termsAccepted) {
      setError('You must agree to the Terms of Service to continue.');
      setLoading(false);
      return;
    }

    const normalizedPhone = phone.slice(-10);

    if (!validatePhoneNumber(normalizedPhone)) {
      setError('Please enter a valid 10-digit mobile number.');
      setLoading(false);
      return;
    }

    if (role === 'admin' && secretKey.trim() !== "admin123") {
      setError('Invalid Admin Secret Key. Try: admin123');
      setLoading(false);
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("User not authenticated. Please login again.");
      }

      let businessType = null;
      if (role === 'restaurant-owner') businessType = 'restaurant';
      else if (role === 'shop-owner') businessType = 'store';
      else if (role === 'street-vendor') businessType = 'street-vendor';

      const finalUserData = {
        uid: user.uid,
        email: user.email,
        name: user.displayName || 'New User',
        phone: normalizedPhone,
        role: role,
        businessType: businessType,
        profilePictureUrl: user.photoURL || `https://picsum.photos/seed/${user.uid}/200/200`,
        notifications: {
          newOrders: true,
          dailySummary: false,
          marketing: true,
        },
      };

      let businessData = null;
      if (isBusinessOwner) {
        if (!businessName || !address.street || !address.city || !address.state || !address.postalCode) {
          throw new Error("Business name and full address are required for owners.");
        }
        businessData = {
          name: businessName,
          address: address,
          ownerId: user.uid,
          ownerPhone: normalizedPhone,
          approvalStatus: 'pending',
          botPhoneNumberId: null,
          businessType: finalUserData.businessType,
        };
      }

      console.log("[DEBUG] complete-profile: Calling /api/auth/complete-profile with payload:", { finalUserData, businessData, businessType });
      const idToken = await user.getIdToken();
      const res = await fetch('/api/auth/complete-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          finalUserData,
          businessData,
          businessType: finalUserData.businessType
        })
      });

      const result = await res.json();
      console.log("[DEBUG] complete-profile: API response:", result);
      if (!res.ok) {
        throw new Error(result.message || 'An error occurred during profile setup.');
      }

      localStorage.setItem('role', role);
      if (isBusinessOwner) {
        localStorage.setItem('businessType', businessType);
      }

      if (role === 'restaurant-owner' || role === 'shop-owner') {
        router.push('/owner-dashboard');
      } else if (role === 'admin') {
        router.push('/admin-dashboard');
      } else if (role === 'rider') {
        router.push('/rider-dashboard');
      } else if (role === 'street-vendor') {
        router.push('/street-vendor-dashboard');
      } else {
        router.push('/customer-dashboard');
      }

    } catch (err) {
      console.error("[DEBUG] complete-profile: Profile completion error:", err);
      setError(err.message);
      setLoading(false);
    }
  };

  const renderRoleFields = () => {
    const isBusinessOwner = role === 'restaurant-owner' || role === 'shop-owner' || role === 'street-vendor';
    let businessLabel = 'Business Name';
    if (role === 'restaurant-owner') businessLabel = 'Restaurant Name';
    else if (role === 'shop-owner') businessLabel = 'Store Name';
    else if (role === 'street-vendor') businessLabel = 'Stall / Thela Name';


    if (isBusinessOwner) {
      return (
        <motion.div variants={cardVariants} initial="hidden" animate="visible" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">{businessLabel}</label>
            <div className="relative">
              <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
            </div>
          </div>

          <div className="space-y-2 p-4 border border-dashed border-border rounded-lg">
            <h4 className="font-semibold flex items-center gap-2"><MapPin size={16} /> Business Address</h4>
            <input type="text" value={address.street} onChange={(e) => handleAddressChange('street', e.target.value)} placeholder="Street Address" required className="w-full p-2 rounded-md bg-input border border-border" />
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={address.city} onChange={(e) => handleAddressChange('city', e.target.value)} placeholder="City" required className="w-full p-2 rounded-md bg-input border border-border" />
              <input type="text" value={address.postalCode} onChange={(e) => handleAddressChange('postalCode', e.target.value)} placeholder="Postal Code" required className="w-full p-2 rounded-md bg-input border border-border" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={address.state} onChange={(e) => handleAddressChange('state', e.target.value)} placeholder="State" required className="w-full p-2 rounded-md bg-input border border-border" />
              <input type="text" value={address.country} onChange={(e) => handleAddressChange('country', e.target.value)} placeholder="Country" required className="w-full p-2 rounded-md bg-input border border-border" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Your Mobile Number (10 digits)</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-border">
            <h4 className="font-semibold text-foreground">Terms of Service &amp; Vendor Policy</h4>
            <div className="h-40 overflow-y-auto p-3 bg-muted/50 border border-border rounded-md text-xs text-muted-foreground space-y-2">
              <p><strong>1. Our Role:</strong> ServiZephyr provides a technology platform to connect you (the &quot;Vendor&quot;) with customers. We are responsible for the digital infrastructure, including the order management dashboard and payment processing integration. We are not responsible for food quality, preparation, or delivery.</p>
              <p><strong>2. Vendor Responsibilities:</strong> You are solely responsible for: a) Keeping your menu, pricing, and item availability updated. b) The quality, safety, and preparation of all items sold. c) Fulfilling orders accepted through the platform in a timely manner. d) Complying with all local laws and regulations, including food safety standards (FSSAI) and taxation (GST).</p>
              <p><strong>3. Payments &amp; Payouts:</strong> For online payments, funds will be settled to your linked bank account via our payment partner (Razorpay) after deducting applicable transaction fees. The payout schedule will be as per the payment partner&apos;s policy (typically T+2 working days). We are not liable for any delays from the bank&apos;s end.</p>
              <p><strong>4. Data Usage:</strong> You own your customer data. ServiZephyr will not sell or share your customer list with third parties. We will use anonymized, aggregate data to improve our services. By using our platform, you agree to our Privacy Policy.</p>
              <p><strong>5. Account Termination &amp; Fraud:</strong> We reserve the right to suspend or permanently terminate your account without notice if we detect fraudulent activities, including but not limited to: creating fake orders, manipulating prices, providing false information, or receiving excessive customer complaints about quality or service. Engaging in any activity that harms the platform&apos;s reputation or its users will lead to immediate termination.</p>
              <p><strong>6. Service Fees:</strong> You agree to the subscription fees as outlined in our pricing plan. Failure to pay subscription fees may result in the suspension of your services.</p>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="terms" checked={termsAccepted} onCheckedChange={setTermsAccepted} />
              <label htmlFor="terms" className="text-sm font-medium leading-none text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                I have read and agree to the Terms of Service &amp; Vendor Policy.
              </label>
            </div>
          </div>
        </motion.div>
      );
    }

    switch (role) {
      case 'customer':
      case 'rider':
        return (
          <motion.div variants={cardVariants} initial="hidden" animate="visible" className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Mobile Number (10 digits)</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
              </div>
            </div>
          </motion.div>
        );
      case 'admin':
        return (
          <motion.div variants={cardVariants} initial="hidden" animate="visible" className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Mobile Number (10 digits)</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Secret Key</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
              </div>
            </div>
          </motion.div>
        );
      default:
        return null;
    }
  };

  if (loading && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <GoldenCoinSpinner />
      </div>
    );
  }

  return (
    <>
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <motion.div
          className="w-full max-w-2xl p-8 space-y-6 bg-card rounded-xl shadow-2xl shadow-primary/10 border border-border"
          variants={cardVariants}
          initial="hidden"
          animate="visible"
        >
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground">One Last Step!</h1>
            <p className="text-muted-foreground mt-2">Tell us a bit about yourself to get started.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">I am a...</label>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleRoleClick(r)}
                    className={cn(
                      'relative flex flex-col items-center justify-center p-4 rounded-md border-2 transition-all duration-200',
                      role === r.id ? 'border-primary bg-primary/10 shadow-lg' : 'border-border',
                      r.enabled ? 'cursor-pointer hover:border-primary/50' : 'opacity-50 cursor-not-allowed grayscale',
                      r.enabled && role !== r.id ? 'hover:border-primary/50' : ''
                    )}
                  >
                    {r.enabled && role === r.id && (
                      <motion.div layoutId="activeRole" className="absolute inset-0 bg-primary/10 rounded-md"></motion.div>
                    )}
                    <r.icon className={cn(`h-8 w-8 mb-2`, (r.enabled && role === r.id) ? 'text-primary' : 'text-foreground')} />
                    <span className="font-semibold text-sm text-center">{r.label}</span>
                    {!r.enabled && <span className="absolute top-1 right-1 text-[9px] font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">Soon</span>}
                  </button>
                ))}
              </div>
            </div>

            {renderRoleFields()}

            {error && <p className="text-red-500 text-sm text-center bg-red-500/10 p-3 rounded-md border border-red-500/20">{error}</p>}

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <button
                type="submit"
                disabled={loading || !role || (role === 'street-vendor' && !termsAccepted)}
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                  <>
                    Complete Profile <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => router.push('/contact')}
                className="w-full sm:w-auto flex justify-center items-center py-3 px-4 border rounded-md shadow-sm text-sm font-medium text-muted-foreground bg-muted hover:bg-muted/80 transition-colors"
              >
                <HelpCircle className="mr-2 h-5 w-5" /> Need Help?
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
}

