
// Applying user's changes.
/** @type {import('next').NextConfig} */

// Load environment variables from .env.local for local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: './.env.local' });
}

const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');
const backendBaseUrl = trimTrailingSlash(
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL || process.env.BACKEND_BASE_URL || ''
);

if (!backendBaseUrl) {
  console.warn('[next.config] NEXT_PUBLIC_BACKEND_BASE_URL/BACKEND_BASE_URL not set. API proxy disabled.');
}

const nextConfig = {
  async rewrites() {
    if (!backendBaseUrl) return [];

    // Force all `/api/*` calls to backend-v2 before filesystem route matching.
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${backendBaseUrl}/api/:path*`,
        },
      ],
    };
  },
  async headers() {
    const baseHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
      // Required for Firebase/Google popup auth flows to avoid window.close/window.closed COOP warnings.
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    ];

    if (process.env.NODE_ENV === 'production') {
      baseHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      });
    }

    return [
      {
        source: '/:path*',
        headers: baseHeaders,
      },
    ];
  },
  env: {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  },
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
    ],
    // Suppress legacy Image warnings in development
    dangerouslyAllowSVG: true,
    unoptimized: process.env.NODE_ENV === 'development',
  },
  // Suppress console warnings in development
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Suppress Next.js Image legacy prop warnings
      config.infrastructureLogging = {
        level: 'error',
      };
    }
    return config;
  },
  // Disable x-powered-by header
  poweredByHeader: false,
  // Suppress React DevTools suggestion
  reactStrictMode: true,
  // 🟢 FORCE BUILD SUCCESS: Ignore ESLint and TS errors during build
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig
