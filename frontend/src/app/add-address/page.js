
'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Search, LocateFixed, Loader2, ArrowLeft, AlertTriangle, Save, Home, Building, User, Phone, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import dynamic from 'next/dynamic';
import { useUser } from '@/firebase';
import { Textarea } from '@/components/ui/textarea';
import InfoDialog from '@/components/InfoDialog';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';

const GoogleMap = dynamic(() => import('@/components/GoogleMap'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-muted flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
});

const TokenVerificationLock = ({ message }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Lock size={48} className="text-destructive mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Session Invalid</h1>
        <p className="mt-2 text-muted-foreground max-w-md">{message}</p>
        <p className="mt-4 text-sm text-muted-foreground">Please initiate a new session by sending a message to the restaurant on WhatsApp.</p>
    </div>
);

const DEFAULT_MAP_CENTER = { lat: 22.9734, lng: 78.6569 }; // India center fallback

const AddAddressPageInternal = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const geocodeTimeoutRef = useRef(null);
    const searchDebounceRef = useRef(null);
    const initialLocationResolvedRef = useRef(false);

    const { user, isUserLoading } = useUser();

    // Security State
    const [isTokenValid, setIsTokenValid] = useState(false);
    const [tokenError, setTokenError] = useState('');
    const [verifiedGuestId, setVerifiedGuestId] = useState('');
    const phone = searchParams.get('phone');
    const token = searchParams.get('token');
    const ref = searchParams.get('ref'); // CAPTURE REF for guest sessions
    const activeOrderId = searchParams.get('activeOrderId');
    const tableId = searchParams.get('table');
    const prefilledNameFromUrl = searchParams.get('name') || '';

    const [mapCenter, setMapCenter] = useState(DEFAULT_MAP_CENTER);
    const [addressDetails, setAddressDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [permissionError, setPermissionError] = useState(null); // NEW: Persistent permission error
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const [recipientName, setRecipientName] = useState('');
    const [recipientPhone, setRecipientPhone] = useState('');
    const [fullAddress, setFullAddress] = useState('');
    const [addressDetail, setAddressDetail] = useState('');
    const [landmark, setLandmark] = useState('');
    const [addressLabel, setAddressLabel] = useState('Home');
    const [customAddressLabel, setCustomAddressLabel] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [isSearchingAddress, setIsSearchingAddress] = useState(false);
    const [searchFeedback, setSearchFeedback] = useState('');

    const returnUrl = searchParams.get('returnUrl') || '/';
    const useCurrent =
        searchParams.get('useCurrent') === 'true' ||
        searchParams.get('currentLocation') === 'true';

    useEffect(() => {
        const verifySessionToken = async () => {
            // Backward compatible flow: if no token in URL, allow direct entry.
            if (!token) {
                setIsTokenValid(true);
                return;
            }

            try {
                const payload = { token };
                if (phone) payload.phone = phone;
                if (ref) payload.ref = ref;
                if (tableId) payload.tableId = tableId;

                const verifyRes = await fetch('/api/auth/verify-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                const verifyData = await verifyRes.json().catch(() => ({}));
                if (!verifyRes.ok) {
                    setTokenError(verifyData.message || 'Session verification failed. Please request a new link.');
                    setIsTokenValid(false);
                    return;
                }

                if (verifyData?.guestId) {
                    setVerifiedGuestId(String(verifyData.guestId));
                }
                setIsTokenValid(true);
            } catch (err) {
                setTokenError('Session verification failed. Please request a new link.');
                setIsTokenValid(false);
            }
        };

        verifySessionToken();
    }, [token, phone, ref, tableId]);

    const reverseGeocode = useCallback(async (coords) => {
        if (geocodeTimeoutRef.current) clearTimeout(geocodeTimeoutRef.current);
        geocodeTimeoutRef.current = setTimeout(async () => {
            setLoading(true); setError('');
            // Note: We do NOT clear permissionError here, so it persists until manual retry
            try {
                const res = await fetch(`/api/public/location/geocode?lat=${coords.lat}&lng=${coords.lng}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Failed to fetch address details.');
                setAddressDetails({
                    street: data.street || '',
                    city: data.city || data.town || data.village || '',
                    pincode: data.pincode || '',
                    state: data.state || '',
                    country: data.country || 'IN',
                    latitude: coords.lat,
                    longitude: coords.lng
                });
                setFullAddress(data.formatted_address || '');
                setSearchQuery(data.formatted_address || '');
            } catch (err) {
                setError('Could not fetch address details for this pin location.');
                setAddressDetails(null);
            } finally {
                setLoading(false);
            }
        }, 500);
    }, []);

    const handleMapIdle = useCallback((coords) => reverseGeocode(coords), [reverseGeocode]);

    const getIpApproximateLocation = useCallback(async () => {
        setLoading(true);
        setError('Detecting your approximate location...');

        try {
            const res = await fetch('/api/public/location/ip', { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.message || 'Could not detect IP location.');
            }

            const lat = Number(data?.lat);
            const lng = Number(data?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                throw new Error('IP location did not return valid coordinates.');
            }

            const coords = { lat, lng };
            setMapCenter(coords);
            setSearchFeedback('Approximate location detected from network. You can adjust pin.');
            reverseGeocode(coords);
        } catch (ipErr) {
            console.warn('[Add Address] IP location failed:', ipErr?.message || ipErr);
            setMapCenter(DEFAULT_MAP_CENTER);
            setSearchFeedback('');
            setLoading(false);
            setError('Could not detect location from network. Please search manually or use current location.');
        }
    }, [reverseGeocode]);

    const getCurrentGeolocation = useCallback(() => {
        setLoading(true);
        setError('Fetching your location...');
        setPermissionError(null); // Clear previous permission errors on retry

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
                setMapCenter(coords); reverseGeocode(coords); setError('');
            },
            (err) => {
                setLoading(false);
                let message = "Could not fetch location. Please search manually.";
                let isPermIssue = false;

                if (err.code === 1) {
                    message = "Location access blocked. Please enable permissions in your browser settings to use current location.";
                    isPermIssue = true;
                } else if (err.code === 3) {
                    message = "Location request timed out. Please check signal or retry.";
                    isPermIssue = true;
                }

                if (isPermIssue) {
                    setPermissionError(message); // Persist this!
                    getIpApproximateLocation();
                } else {
                    setError(message);
                }
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );
    }, [reverseGeocode, getIpApproximateLocation]);

    const fetchLocationSuggestions = useCallback(async (query, options = {}) => {
        const { showFeedback = false } = options;
        const trimmed = String(query || '').trim();
        if (trimmed.length < 3) {
            setSuggestions([]);
            if (showFeedback) {
                setSearchFeedback('Please type at least 3 characters to search.');
            }
            return [];
        }

        try {
            setIsSearchingAddress(true);
            if (showFeedback) setSearchFeedback('Searching address...');
            const res = await fetch(`/api/public/location/search?query=${encodeURIComponent(trimmed)}`);
            const data = await res.json().catch(() => ([]));
            if (!res.ok) {
                const msg = data?.message || 'Search failed.';
                throw new Error(msg);
            }
            const safe = Array.isArray(data) ? data : [];
            setSuggestions(safe);
            if (showFeedback) {
                setSearchFeedback(safe.length > 0 ? `Found ${safe.length} result${safe.length > 1 ? 's' : ''}.` : 'No matching address found. Try nearby landmark/locality.');
            }
            return safe;
        } catch (err) {
            console.error('[Add Address] Search API error:', err);
            setSuggestions([]);
            if (showFeedback) {
                setSearchFeedback(`Search failed: ${err?.message || 'Unknown error'}`);
            }
            return [];
        } finally {
            setIsSearchingAddress(false);
        }
    }, []);

    useEffect(() => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

        const normalizedSearch = searchQuery.trim();
        const normalizedFull = fullAddress.trim();

        if (normalizedSearch.length > 2 && normalizedSearch !== normalizedFull) {
            searchDebounceRef.current = setTimeout(() => {
                fetchLocationSuggestions(normalizedSearch, { showFeedback: false });
            }, 300);
        } else {
            setSuggestions([]);
            if (normalizedSearch.length === 0) setSearchFeedback('');
        }

        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [searchQuery, fullAddress, fetchLocationSuggestions]);

    const handleSuggestionClick = useCallback((suggestion) => {
        const displayAddress = [suggestion?.placeName, suggestion?.placeAddress].filter(Boolean).join(', ');
        setSearchQuery(displayAddress || suggestion?.placeAddress || suggestion?.placeName || '');
        setSuggestions([]);
        setSearchFeedback('Address selected. Map updated.');
        setPermissionError(null);
        setError('');

        const lat = Number(suggestion?.latitude);
        const lng = Number(suggestion?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            setError('Selected address is missing coordinates. Please pick another result.');
            return;
        }

        const coords = { lat, lng };
        setMapCenter(coords);
        reverseGeocode(coords);
    }, [reverseGeocode]);

    const handleManualSearchSubmit = useCallback(async (e) => {
        e.preventDefault();
        const query = searchQuery.trim();
        if (query.length < 3) return;

        const results = await fetchLocationSuggestions(query, { showFeedback: true });

        if (Array.isArray(results) && results.length > 0) {
            handleSuggestionClick(results[0]);
        } else {
            setSearchFeedback('No address match found. Try a nearby landmark or area name.');
        }
    }, [searchQuery, fetchLocationSuggestions, handleSuggestionClick]);

    // Separate effect for initial data prefill to prevent overwriting user input
    useEffect(() => {
        let isMounted = true;
        const prefillData = async () => {
            try {
                let hasPhoneFromLookup = false;
                let hasNameFromLookup = false;

                if (prefilledNameFromUrl && isMounted) {
                    setRecipientName(prev => prev || prefilledNameFromUrl);
                    hasNameFromLookup = true;
                }

                // CRITICAL: Support both ref-based (new) and phone-based (legacy) flows
                // prioritizing logged-in user via Auth header

                const headers = { 'Content-Type': 'application/json' };
                if (user) {
                    try {
                        const idToken = await user.getIdToken();
                        headers['Authorization'] = `Bearer ${idToken}`;
                    } catch (e) {
                        console.warn("Error getting ID token:", e);
                    }
                }

                if (ref) {
                    // New flow: Use ref to lookup customer (token not required)
                    const res = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            ref,
                            guestId: verifiedGuestId || undefined
                        })
                    });
                    if (res.ok && isMounted) {
                        const customerData = await res.json();
                        console.log('[Add Address] Customer data from ref:', customerData);
                        const refName = String(customerData?.name || '').trim();
                        const refPhone = String(customerData?.phone || '').replace(/\D/g, '').slice(-10);
                        // Skip 'Guest' — it's a default fallback, not a real name
                        const isRealName = refName && refName.toLowerCase() !== 'guest' && refName.toLowerCase() !== 'user';
                        if (isRealName) {
                            setRecipientName(prev => prev || refName);
                            hasNameFromLookup = true;
                        }
                        if (refPhone) {
                            setRecipientPhone(prev => prev || refPhone);
                            hasPhoneFromLookup = true;
                            return; // Ref gave phone, done
                        }
                    }
                }

                // Legacy flow: Use phone param or logged-in user phone
                const phoneToUse = phone || user?.phoneNumber;
                if (phoneToUse) {
                    const normalizedPhoneFromUrlOrAuth = String(phoneToUse).replace(/\D/g, '').slice(-10);
                    if (normalizedPhoneFromUrlOrAuth) {
                        setRecipientPhone(prev => prev || normalizedPhoneFromUrlOrAuth);
                        hasPhoneFromLookup = true;
                    }
                    const res = await fetch('/api/customer/lookup', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ phone: phoneToUse })
                    });
                    if (res.ok && isMounted) {
                        const customerData = await res.json();
                        const phoneLookupName = String(customerData?.name || '').trim();
                        const phoneLookupPhone = String(customerData?.phone || '').replace(/\D/g, '').slice(-10);
                        if (phoneLookupName) {
                            setRecipientName(prev => prev || phoneLookupName);
                            hasNameFromLookup = true;
                        }
                        if (phoneLookupPhone) {
                            setRecipientPhone(prev => prev || phoneLookupPhone);
                            hasPhoneFromLookup = true;
                        }
                    }
                }

                // Fallback: get phone/name from active order itself (useful when URL has ref but no phone)
                if ((!hasPhoneFromLookup || !hasNameFromLookup) && activeOrderId && token) {
                    try {
                        const statusRes = await fetch(`/api/order/status/${activeOrderId}?token=${encodeURIComponent(token)}`);
                        if (statusRes.ok) {
                            const statusData = await statusRes.json();
                            const order = statusData?.order || {};
                            const orderName = String(order.customerName || '').trim();
                            const orderPhone = String(order.customerPhone || '').replace(/\D/g, '').slice(-10);
                            if (orderName && !hasNameFromLookup) {
                                setRecipientName(prev => prev || orderName);
                                hasNameFromLookup = true;
                            }
                            if (orderPhone && !hasPhoneFromLookup) {
                                setRecipientPhone(prev => prev || orderPhone);
                                hasPhoneFromLookup = true;
                            }
                        }
                    } catch (statusErr) {
                        console.warn('[Add Address] Could not fetch fallback order details:', statusErr?.message || statusErr);
                    }
                }

                // Fallback to User Display Name
                if (user && isMounted) {
                    setRecipientName(prev => prev || user.displayName || '');
                }
            } catch (e) {
                console.warn("Could not prefill customer data:", e);
            }
        };

        if (isTokenValid) {
            prefillData();
        }

        return () => { isMounted = false; };
    }, [isTokenValid, user, phone, ref, token, prefilledNameFromUrl, activeOrderId, verifiedGuestId]); // Removed addressDetails dependencies

    // Effect for initial location resolution (only once after token validation)
    useEffect(() => {
        if (!isTokenValid || initialLocationResolvedRef.current) return;

        initialLocationResolvedRef.current = true;
        if (useCurrent) {
            getCurrentGeolocation();
        } else {
            getIpApproximateLocation();
        }
    }, [isTokenValid, useCurrent, getCurrentGeolocation, getIpApproximateLocation]);


    const handleConfirmLocation = async () => {
        if (!addressDetails || !recipientName.trim() || !recipientPhone.trim() || !fullAddress.trim() || !addressDetail.trim()) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Please fill all required fields: Contact Person, Phone, Map Address, and Address Details." });
            return;
        }
        if (!/^\d{10}$/.test(recipientPhone.trim())) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Please enter a valid 10-digit phone number." });
            return;
        }

        setIsSaving(true);

        const finalLabel = (addressLabel === 'Other' && customAddressLabel.trim()) ? customAddressLabel.trim() : addressLabel;

        const cleanedAddressDetail = addressDetail.trim();
        const cleanedFullAddress = fullAddress.trim();
        const combinedAddress = [cleanedAddressDetail, cleanedFullAddress].filter(Boolean).join(', ');

        const addressToSave = {
            id: `addr_${Date.now()}`,
            label: finalLabel,
            name: recipientName.trim(),
            phone: recipientPhone.trim(),
            street: addressDetails.street,
            addressDetail: cleanedAddressDetail,
            landmark: landmark.trim(),
            city: addressDetails.city,
            state: addressDetails.state,
            pincode: addressDetails.pincode,
            country: addressDetails.country,
            full: combinedAddress,
            mapAddress: cleanedFullAddress,
            latitude: parseFloat(addressDetails.latitude),
            longitude: parseFloat(addressDetails.longitude),
        };

        localStorage.setItem('customerLocation', JSON.stringify(addressToSave));

        try {
            const sessionIdentifierPhone = phone || user?.phoneNumber || recipientPhone;

            const apiPayload = {
                address: addressToSave,
                phone: sessionIdentifierPhone,
                // Pass Guest Identifiers for V2 Flow
                ref: searchParams.get('ref'),
                token: token,
                activeOrderId
            };

            const headers = { 'Content-Type': 'application/json' };
            if (user) {
                const idToken = await user.getIdToken();
                headers['Authorization'] = `Bearer ${idToken}`;
            }

            const res = await fetch('/api/user/addresses', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(apiPayload)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to save address.');
            }

            router.push(returnUrl);

        } catch (err) {
            setInfoDialog({ isOpen: true, title: "Error", message: `Could not save location: ${err.message}` });
        } finally {
            setIsSaving(false);
        }
    };

    if (tokenError) {
        return <TokenVerificationLock message={tokenError} />;
    }

    if (!isTokenValid) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>;
    }


    return (
        <div className="h-screen w-screen flex flex-col bg-background text-foreground">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '', type: '' })} title={infoDialog.title} message={infoDialog.message} type={infoDialog.type} />
            <header className="p-4 border-b border-border flex items-center gap-4 flex-shrink-0 z-10 bg-background/80 backdrop-blur-sm">
                <Button variant="ghost" size="icon" onClick={() => router.push(returnUrl)}><ArrowLeft /></Button>
                <h1 className="text-xl font-bold">Add Address Details</h1>
            </header>

            <div className="flex-grow flex flex-col md:flex-row">
                <div className="md:w-1/2 h-64 md:h-full flex-shrink-0 relative">
                    {/* Show Loading Overlay over map while fetching location */}
                    {loading && (
                        <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                            <GoldenCoinSpinner />
                            <p className="mt-4 font-semibold text-lg animate-pulse">Fetching your location...</p>
                        </div>
                    )}
                    <GoogleMap center={mapCenter} onIdle={handleMapIdle} />
                </div>

                <div className="p-4 flex-grow overflow-y-auto space-y-4 md:w-1/2">
                    <form onSubmit={handleManualSearchSubmit} className="space-y-2">
                        <Label htmlFor="addressSearch">Search address manually (if location permission denied)</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="addressSearch"
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Type address and press Enter"
                                className="pl-9 pr-20 h-11"
                            />
                            <Button
                                type="submit"
                                variant="outline"
                                size="sm"
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8"
                                disabled={searchQuery.trim().length < 3 || isSearchingAddress}
                            >
                                {isSearchingAddress ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                            </Button>
                        </div>
                        {searchFeedback && (
                            <p className="text-xs text-muted-foreground">{searchFeedback}</p>
                        )}
                        {suggestions.length > 0 && (
                            <div className="border border-border rounded-lg bg-card shadow-md max-h-52 overflow-y-auto">
                                {suggestions.map((s) => (
                                    <button
                                        type="button"
                                        key={s.eLoc}
                                        onClick={() => handleSuggestionClick(s)}
                                        className="w-full text-left p-3 hover:bg-muted border-b border-border last:border-b-0"
                                    >
                                        <p className="text-sm font-semibold">{s.placeName}</p>
                                        <p className="text-xs text-muted-foreground">{s.placeAddress}</p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </form>

                    <Button variant="secondary" className="w-full h-12 shadow-lg flex items-center gap-2 pr-4 bg-white text-black hover:bg-gray-200 dark:bg-stone-800 dark:text-white dark:hover:bg-stone-700" onClick={getCurrentGeolocation} disabled={loading && error.includes('Fetching')}>
                        {(loading && error.includes('Fetching')) ? <Loader2 className="animate-spin" /> : <LocateFixed />} Use My Current Location
                    </Button>
                    {permissionError && (
                        <div className="text-amber-700 dark:text-amber-300 text-sm font-medium p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                            {permissionError}
                        </div>
                    )}
                    {loading && !addressDetails ? (
                        <div className="flex items-center justify-center gap-3 p-4">
                            <Loader2 className="animate-spin text-primary" />
                            <span className="text-muted-foreground">{error || 'Fetching address details...'}</span>
                        </div>
                    ) : error && !addressDetails ? (
                        <div className="text-destructive text-center font-semibold p-4 bg-destructive/10 rounded-lg flex items-center justify-center gap-2">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    ) : addressDetails ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                            <div>
                                <Label htmlFor="fullAddress">Complete Address *</Label>
                                <Textarea id="fullAddress" value={fullAddress} onChange={e => setFullAddress(e.target.value)} placeholder="e.g. House No. 42, Shivam Vihar, Near Post Office" required rows={3} className="mt-1" />
                                <p className="text-xs text-muted-foreground mt-1">Drag the map pin to get the address, then edit it here if needed.</p>
                            </div>
                            <div>
                                <Label htmlFor="addressDetail">Address Details *</Label>
                                <Input
                                    id="addressDetail"
                                    value={addressDetail}
                                    onChange={e => setAddressDetail(e.target.value)}
                                    placeholder="e.g. Floor 2, House No 93, Street/Gali name"
                                    required
                                />
                                <p className="text-xs text-muted-foreground mt-1">Eg: Floor, house no, street/gali, apartment/block - this helps rider find exact drop point.</p>
                            </div>
                            <div><Label htmlFor="landmark">Landmark (Optional)</Label><Input id="landmark" value={landmark} onChange={e => setLandmark(e.target.value)} placeholder="e.g., Near Post Office" /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><Label htmlFor="recipientName">Contact Person *</Label><Input id="recipientName" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Your Name" required /></div>
                                <div><Label htmlFor="recipientPhone">Contact Number *</Label><Input id="recipientPhone" type="tel" value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} placeholder="10-digit number" required /></div>
                            </div>
                            <div>
                                <Label>Save address as</Label>
                                <div className="flex items-start flex-wrap gap-2 mt-2">
                                    <Button type="button" variant={addressLabel === 'Home' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Home')}><Home size={14} className="mr-2" /> Home</Button>
                                    <Button type="button" variant={addressLabel === 'Work' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Work')}><Building size={14} className="mr-2" /> Work</Button>
                                    <Button type="button" variant={addressLabel === 'Other' ? 'secondary' : 'outline'} size="sm" onClick={() => setAddressLabel('Other')}><MapPin size={14} className="mr-2" /> Other</Button>
                                    <AnimatePresence>
                                        {addressLabel === 'Other' && (
                                            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="overflow-hidden">
                                                <Input type="text" value={customAddressLabel} onChange={e => setCustomAddressLabel(e.target.value)} placeholder="Custom Label (e.g., Gym)" className="h-9" />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                            <div className="p-4 border-t border-border mt-4">
                                <Button onClick={handleConfirmLocation} disabled={loading || isSaving || !addressDetails || !addressDetail.trim() || !fullAddress.trim()} className="w-full h-12 text-lg font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                                    {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />} {isSaving ? 'Saving...' : 'Save Address & Continue'}
                                </Button>
                            </div>
                        </motion.div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

const AddAddressPage = () => (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><GoldenCoinSpinner /></div>}>
        <AddAddressPageInternal />
    </Suspense>
);

export default AddAddressPage;
