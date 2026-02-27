'use client';

import { useState } from 'react';
import { Dialog, DialogPortal, DialogOverlay, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertTriangle, Send, Loader2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useUser } from '@/firebase/provider';

const InfoDialog = ({ isOpen, onClose, title, message, type }) => {
  const [isSending, setIsSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const normalizedText = `${title || ''} ${message || ''}`.toLowerCase();
  const isError = type === 'error'
    || normalizedText.includes('error')
    || normalizedText.includes('failed')
    || normalizedText.includes('invalid')
    || normalizedText.includes('exceeded')
    || normalizedText.includes('capacity');
  const isWarning = type === 'warning'
    || normalizedText.includes('warning')
    || normalizedText.includes('restricted')
    || normalizedText.includes('not available')
    || normalizedText.includes('unavailable')
    || normalizedText.includes('out of range');
  const isLoading = normalizedText.includes('processing')
    || normalizedText.includes('loading')
    || normalizedText.includes('wait')
    || normalizedText.includes('please wait');
  const pathname = usePathname();
  const { user } = useUser();

  const captureErrorContext = () => {
    // Capture exact timestamp with timezone
    const now = new Date();
    const timestamp = now.toISOString();
    const localTime = now.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });

    // Get browser and device info
    const userAgent = navigator.userAgent;
    const browserInfo = {
      userAgent,
      language: navigator.language,
      platform: navigator.platform,
      vendor: navigator.vendor,
      cookieEnabled: navigator.cookieEnabled,
    };

    // Get screen info
    const screenInfo = {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
    };

    // Get window info
    const windowInfo = {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };

    return {
      timestamp,
      localTime,
      page: {
        url: window.location.href,
        pathname,
        referrer: document.referrer,
        title: document.title,
      },
      user: user ? {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        phoneNumber: user.phoneNumber,
      } : { type: 'Guest' },
      browser: browserInfo,
      screen: screenInfo,
      window: windowInfo,
    };
  };

  const handleSendReport = async () => {
    setIsSending(true);
    try {
      const context = captureErrorContext();

      const reportPayload = {
        errorTitle: title,
        errorMessage: message,
        description: 'Reported via InfoDialog',
        pathname: pathname,
        user: context.user,
        context,
        timestamp: context.timestamp,
        localTime: context.localTime,
      };

      const response = await fetch('/api/admin/mailbox', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reportPayload),
      });

      if (!response.ok) {
        throw new Error("Failed to send report.");
      }

      setReportSent(true);
      setTimeout(() => {
        onClose();
        setTimeout(() => setReportSent(false), 500);
      }, 2000);

    } catch (error) {
      console.error("Failed to send report:", error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogPortal>
        <DialogOverlay className="z-[9998]" />
        <DialogContent className="bg-card border-border text-foreground z-[9999]">
          <DialogHeader className="flex flex-col items-center text-center">
            {isError ? (
              <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            ) : isWarning ? (
              <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
            ) : isLoading ? (
              <Loader2 className="h-12 w-12 text-primary mb-4 animate-spin" />
            ) : (
              <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
            )}
            <DialogTitle className="text-xl">{title}</DialogTitle>
            {message && <DialogDescription className="pt-2 whitespace-pre-line break-words">{message}</DialogDescription>}
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row sm:justify-center gap-2">
            <Button onClick={onClose} className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground">OK</Button>
            {isError && (
              <Button onClick={handleSendReport} variant="secondary" className="w-full sm:w-auto" disabled={isSending || reportSent}>
                {isSending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...
                  </>
                ) : reportSent ? (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4 text-green-500" /> Report Sent!
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" /> Send Report to Admin
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};

export default InfoDialog;
