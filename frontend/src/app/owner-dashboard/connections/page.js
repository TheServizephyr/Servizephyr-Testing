
'use client';

import { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Bot, PlusCircle, CheckCircle, AlertCircle, RefreshCw, Loader2, HelpCircle, MessageSquare, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { staggerChildren: 0.1, duration: 0.5 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
};

const ConnectionCard = ({ restaurantName, whatsAppNumber, status }) => (
  <motion.div
    variants={itemVariants}
    className="bg-card border border-border rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
  >
    <div className="flex items-center gap-4">
      <div className="bg-primary/10 p-3 rounded-full">
        <Bot className="h-6 w-6 text-primary" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-foreground">{restaurantName}</h3>
        <p className="text-sm text-muted-foreground mt-1">{whatsAppNumber}</p>
      </div>
    </div>
    <div className="flex items-center gap-2 self-end sm:self-center">
      {status === 'Connected' ? (
        <CheckCircle className="text-green-500" />
      ) : (
        <AlertCircle className="text-yellow-500" />
      )}
      <span className={`font-semibold ${status === 'Connected' ? 'text-green-500' : 'text-yellow-500'}`}>
        {status}
      </span>
    </div>
  </motion.div>
);

function ConnectionsPageContent() {
  const [fbLoading, setFbLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState([]);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
  const employeeOfOwnerId = searchParams.get('employee_of');

  const fetchConnections = async (isManualRefresh = false) => {
    if (!isManualRefresh) setDataLoading(true);
    setError('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Authentication required to fetch connections.");
      const idToken = await user.getIdToken();

      let url = '/api/owner/connections';
      if (impersonatedOwnerId) {
        url += `?impersonate_owner_id=${impersonatedOwnerId}`;
      } else if (employeeOfOwnerId) {
        url += `?employee_of=${employeeOfOwnerId}`;
      }

      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to fetch connections.');
      }

      const data = await res.json();
      setConnections(data.connections || []);

    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      if (!isManualRefresh) setDataLoading(false);
    }
  };

  useEffect(() => {
    // Load the Facebook SDK script
    if (document.getElementById('facebook-jssdk')) {
      initializeFacebookSDK();
    } else {
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.onload = initializeFacebookSDK;
      document.head.appendChild(script);
    }

    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        fetchConnections();
      } else {
        setDataLoading(false);
      }
    });

    return () => unsubscribe();
  }, [impersonatedOwnerId, employeeOfOwnerId]);

  const initializeFacebookSDK = () => {
    if (window.FB) {
      setSdkLoaded(true);
    }
  };

  const sendCodeToBackend = async (authCode) => {
    setError('');
    setFbLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("You must be logged in to connect a bot.");

      const idToken = await user.getIdToken();

      const response = await fetch('/api/owner/whatsapp-onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ code: authCode }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to connect WhatsApp bot.");
      }

      alert("WhatsApp bot connected successfully! Refreshing connections...");
      await fetchConnections(true); // Manually refresh list

    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setFbLoading(false);
    }
  };

  const handleFacebookLogin = () => {
    if (fbLoading || !sdkLoaded) {
      setError("Facebook SDK is not ready yet. Please wait a moment.");
      return;
    }

    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    console.log("DEBUG: App ID being used for login is:", appId);
    if (!appId) {
      setError("Facebook App ID is not configured. Please contact support.");
      return;
    }

    window.FB.init({
      appId: appId,
      version: 'v19.0',
      xfbml: true,
    });

    const config_id = "808539835091857";
    const scopes = 'whatsapp_business_management,business_management';

    window.FB.login(function (response) {
      if (response.authResponse && response.authResponse.code) {
        const authCode = response.authResponse.code;
        console.log("Received auth code from Facebook:", authCode);
        sendCodeToBackend(authCode);
      } else {
        console.log('User cancelled login or did not fully authorize.');
        console.log("DEBUG: App ID used for login was:", process.env.NEXT_PUBLIC_FACEBOOK_APP_ID);
        setError('Login cancelled or not fully authorized.');
      }
    }, {
      config_id: config_id,
      response_type: 'code',
      override_default_response_type: true,
      scope: scopes
    });
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-4 md:p-6 text-foreground min-h-screen bg-background space-y-6"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your WhatsApp Bot Connections</h1>
          <p className="text-muted-foreground mt-1">Manage your outlet&apos;s WhatsApp bots here.</p>
          <p className="text-sm text-primary mt-2 flex items-center gap-2">
            <HelpCircle size={16} />
            Need help getting started? <Link href="/support/onboarding-guide" className="underline font-semibold hover:text-primary/80">Read our simple step-by-step guide.</Link>
          </p>
        </div>
        <div className="flex gap-4">
          <Button onClick={() => fetchConnections(true)} variant="outline" disabled={dataLoading}>
            <RefreshCw size={16} className={dataLoading ? "animate-spin" : ""} />
            <span className="ml-2">Refresh</span>
          </Button>
          <Button onClick={handleFacebookLogin} disabled={fbLoading || !sdkLoaded} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            {fbLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle size={20} className="mr-2" />}
            {fbLoading ? 'Connecting...' : 'Connect a New WhatsApp Bot'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive-foreground border border-destructive/30 rounded-lg">
          <p><strong>Error:</strong> {error}</p>
        </div>
      )}

      <div className="space-y-4">
        {dataLoading ? (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
            <p className="mt-4 text-lg font-semibold">Loading your connections...</p>
          </div>
        ) : connections.length > 0 ? (
          connections.map(conn => (
            <ConnectionCard key={conn.id} {...conn} />
          ))
        ) : (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl">
            <Bot size={48} className="mx-auto" />
            <p className="mt-4 text-lg font-semibold">No WhatsApp Bots Connected</p>
            <p>Click the button above to connect your first bot and start receiving orders.</p>
          </div>
        )}
      </div>

      <motion.div
        variants={itemVariants}
        className="bg-card border border-border rounded-xl p-6"
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-muted p-3 rounded-full">
              <MessageSquare className="h-6 w-6 text-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Manage WhatsApp Templates</h3>
              <p className="text-sm text-muted-foreground mt-1">Create and manage your message templates (e.g., for promotions) in the Meta Business Suite.</p>
            </div>
          </div>
          <a
            href="https://business.facebook.com/wa/manage/message-templates/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0"
          >
            <Button variant="outline">
              Open Template Manager <ExternalLink size={16} className="ml-2" />
            </Button>
          </a>
        </div>
      </motion.div>

    </motion.div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
      <ConnectionsPageContent />
    </Suspense>
  )
}
