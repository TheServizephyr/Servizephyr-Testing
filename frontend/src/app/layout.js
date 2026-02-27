import { Alegreya, Playfair_Display } from 'next/font/google';
import "./globals.css";
import LayoutWrapper from '@/components/LayoutWrapper';
import PWARecoveryHandler from '@/components/PWARecoveryHandler';
import GlobalHapticHandler from '@/components/GlobalHapticHandler';
import RedirectHandler from '@/components/RedirectHandler';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ThemeProvider } from "@/components/ThemeProvider";
import Script from 'next/script';

// Font configuration
const alegreya = Alegreya({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-body',
});

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-headline',
});

export const metadata = {
  // Base URL for metadata resolution
  metadataBase: new URL('https://servizephyr.com'),

  title: {
    default: "ServiZephyr - AI-Powered Restaurant & Street Food Management",
    template: "%s | ServiZephyr"
  },
  description: "ServiZephyr is India's leading AI-powered restaurant management platform. Streamline orders, payments, dine-in operations, and delivery management for restaurants, cafes, and street food vendors.",
  keywords: [
    "restaurant management system", "POS software india", "food ordering app", "street food vendor app", "dine-in management", "inventory management", "QR code menu", "online food delivery system", "ServiZephyr", "Ashwani Baghel", "Utkarsh Patel",
    // Feature Keywords
    "digital token system", "smart queue management", "kitchen display system KDS", "whatsapp ordering bot", "contactless dining", "food court management", "waitlist management app",
    // Misspellings & Variations
    "Servi Zephyr", "Service Zephyr", "ServiZepher", "Zephyr Service", "Sarvi Zephyr", "Service Jephyr", "Servi Jeffer", "Zephyr App"
  ],
  authors: [{ name: "ServiZephyr Team" }, { name: "Ashwani Baghel", url: "https://servizephyr.com" }, { name: "Utkarsh Patel", url: "https://servizephyr.com" }],
  creator: "Ashwani Baghel & Utkarsh Patel",
  publisher: "ServiZephyr",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },

  // Canonical URL
  alternates: {
    canonical: '/',
    languages: {
      'en-US': '/en-US',
      'hi-IN': '/hi-IN',
    },
  },

  // Robot Directives
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  // Verification to prove ownership
  verification: {
    google: 'google-site-verification=YOUR_VERIFICATION_CODE', // Placeholder
    yandex: 'yandex-verification=YOUR_CODE',
  },

  category: 'technology',

  // PWA Configuration
  manifest: "/manifest.json",

  // Icons and Favicons
  icons: {
    icon: [
      { url: "/logo.png", sizes: "any" },
      { url: "/logo.png", sizes: "192x192", type: "image/png" },
      { url: "/logo.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/logo.png", sizes: "180x180", type: "image/png" },
    ],
  },

  // Apple Mobile Web App
  appleWebApp: {
    capable: true,
    title: "ServiZephyr",
    statusBarStyle: "black-translucent",
  },

  // Custom meta tags
  other: {
    'mobile-web-app-capable': 'yes',
  },

  // Open Graph (Facebook, LinkedIn)
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://servizephyr.com",
    siteName: "ServiZephyr",
    title: "ServiZephyr - AI-Powered Restaurant & Street Food Management",
    description: "Manage your food business with ease. Zero commissions, AI insights, and seamless WhatsApp integration.",
    images: [
      {
        url: "https://servizephyr.com/og-image.jpg", // Ensure this image exists or use logo
        width: 1200,
        height: 630,
        alt: "ServiZephyr - Restaurant Management Made Simple",
      },
    ],
  },

  // Twitter Card
  twitter: {
    card: "summary_large_image",
    title: "ServiZephyr - AI-Powered Restaurant OS",
    description: "The all-in-one OS for restaurants and street vendors. Order management, payments, and marketing on autopilot.",
    images: ["https://servizephyr.com/twitter-image.jpg"], // Ensure this exists
    creator: "@servizephyr",
  },

};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "ServiZephyr",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web, Android, iOS",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "INR"
  },
  "description": "AI-powered operating system for restaurants and street food vendors.",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "1250"
  },
  "author": {
    "@type": "Organization",
    "name": "ServiZephyr",
    "url": "https://servizephyr.com"
  }
};

export default function RootLayout({ children }) {
  const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return (
    <html lang="en" className={`${alegreya.variable} ${playfairDisplay.variable}`} suppressHydrationWarning>
      <head>
        {/* Dynamic theme-color based on color scheme */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />
        {/* Structured Data (JSON-LD) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,marker,routes&loading=async`}
          strategy="afterInteractive"
        />
        <Script src="https://checkout.razorpay.com/v1/checkout.js" />

        {/* Development: Filter Noisy Warnings */}
        <Script id="console-filter" strategy="beforeInteractive">
          {`
            if (typeof window !== 'undefined' && '${process.env.NODE_ENV}' === 'development') {
              const originalWarn = console.warn;
              const suppressPatterns = [
                'legacy prop',
                'has "fill" but is missing "sizes" prop',
                'priority property',
                'Did you forget to run the codemod',
                'Google Maps JavaScript API',
                'React DevTools',
                'Largest Contentful Paint',
              ];
              console.warn = function (...args) {
                const message = args.join(' ');
                if (suppressPatterns.some(pattern => message.includes(pattern))) return;
                originalWarn.apply(console, args);
              };
            }
            // Production: Silence All Console Logs
            if (typeof window !== 'undefined' && '${process.env.NODE_ENV}' === 'production') {
              console.log = function() {};
              console.warn = function() {};
              console.info = function() {};
              console.debug = function() {};
            }
          `}
        </Script>

        {/* PWA Service Worker Registration */}
        <Script id="sw-register" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator) {
              const isProd = '${process.env.NODE_ENV}' === 'production';
              window.addEventListener('load', async function() {
                if (isProd) {
                  navigator.serviceWorker.register('/service-worker.js')
                    .then(function(registration) {
                      console.log('[SW] Registration successful:', registration.scope);
                    })
                    .catch(function(error) {
                      console.log('[SW] Registration failed:', error);
                    });
                  return;
                }

                // Dev safety: stale SW often causes chunk load errors during HMR.
                try {
                  const registrations = await navigator.serviceWorker.getRegistrations();
                  await Promise.all(registrations.map(function(registration) {
                    return registration.unregister();
                  }));
                  if (window.caches && typeof window.caches.keys === 'function') {
                    const cacheKeys = await window.caches.keys();
                    await Promise.all(cacheKeys.map(function(cacheKey) {
                      return window.caches.delete(cacheKey);
                    }));
                  }
                  console.log('[SW] Dev mode cleanup complete (unregistered + cache cleared).');
                } catch (cleanupError) {
                  console.log('[SW] Dev mode cleanup failed:', cleanupError);
                }
              });
            }
          `}
        </Script>


        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <FirebaseClientProvider>
            <PWARecoveryHandler />
            <GlobalHapticHandler />
            <RedirectHandler />
            <LayoutWrapper>
              {children}
            </LayoutWrapper>
            <Toaster />
          </FirebaseClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
