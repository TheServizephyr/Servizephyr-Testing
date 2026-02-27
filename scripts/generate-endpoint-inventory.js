#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const API_DIRS = [
  path.join(ROOT, 'src', 'app', 'api'),
  path.join(ROOT, 'src', 'api'),
];

const OUTPUT_DIR = path.join(ROOT, 'server', 'migration');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'endpoint-inventory.json');

const NATIVE_PATTERNS = [
  /^\/api\/public\/bootstrap\/:restaurantId$/,
  /^\/api\/public\/menu\/:restaurantId$/,
  /^\/api\/owner\/settings$/,
  /^\/api\/owner\/status$/,
  /^\/api\/owner\/orders$/,
  /^\/api\/owner\/coupons$/,
  /^\/api\/owner\/bookings$/,
  /^\/api\/owner\/car-spots$/,
  /^\/api\/owner\/create-linked-account$/,
  /^\/api\/owner\/delivery-settings$/,
  /^\/api\/owner\/employees$/,
  /^\/api\/owner\/menu-bulk$/,
  /^\/api\/owner\/analytics$/,
  /^\/api\/owner\/cleanup-stale-tabs$/,
  /^\/api\/owner\/connections$/,
  /^\/api\/owner\/locations$/,
  /^\/api\/owner\/open-items$/,
  /^\/api\/owner\/customers$/,
  /^\/api\/owner\/dashboard-data$/,
  /^\/api\/owner\/custom-bill\/create-order$/,
  /^\/api\/owner\/custom-bill\/history$/,
  /^\/api\/owner\/delivery$/,
  /^\/api\/owner\/delivery\/invite$/,
  /^\/api\/owner\/dine-in-tables$/,
  /^\/api\/owner\/dine-in-history$/,
  /^\/api\/owner\/dine-in-history\/undo$/,
  /^\/api\/owner\/inventory$/,
  /^\/api\/owner\/inventory\/adjust$/,
  /^\/api\/owner\/inventory\/sync-from-menu$/,
  /^\/api\/owner\/menu$/,
  /^\/api\/owner\/payouts$/,
  /^\/api\/owner\/refund$/,
  /^\/api\/owner\/service-requests$/,
  /^\/api\/owner\/settings\/upload-qr-url$/,
  /^\/api\/owner\/tables$/,
  /^\/api\/owner\/whatsapp-direct\/conversations$/,
  /^\/api\/owner\/whatsapp-direct\/customer-details$/,
  /^\/api\/owner\/whatsapp-direct\/messages$/,
  /^\/api\/owner\/whatsapp-direct\/upload-url$/,
  /^\/api\/owner\/whatsapp-onboarding$/,
  /^\/api\/order\/active$/,
  /^\/api\/order\/cancel$/,
  /^\/api\/order\/create$/,
  /^\/api\/order\/mark-paid$/,
  /^\/api\/order\/settle-payment$/,
  /^\/api\/order\/status\/:orderId$/,
  /^\/api\/order\/update$/,
  /^\/api\/delivery\/calculate-charge$/,
  /^\/api\/customer\/lookup$/,
  /^\/api\/customer\/register$/,
  /^\/api\/customer\/profile$/,
  /^\/api\/customer\/hub-data$/,
  /^\/api\/customer\/analytics$/,
  /^\/api\/employee\/me$/,
  /^\/api\/employee\/accept-invite$/,
  /^\/api\/admin\/dashboard-stats$/,
  /^\/api\/admin\/analytics$/,
  /^\/api\/admin\/log-impersonation$/,
  /^\/api\/admin\/listings$/,
  /^\/api\/admin\/listing-analytics$/,
  /^\/api\/admin\/users$/,
  /^\/api\/admin\/users\/:userId$/,
  /^\/api\/admin\/audit-logs$/,
  /^\/api\/admin\/check-ids$/,
  /^\/api\/admin\/mailbox$/,
  /^\/api\/admin\/retry-webhook$/,
  /^\/api\/admin\/waitlist$/,
  /^\/api\/admin\/ops-telemetry$/,
  /^\/api\/admin\/read-telemetry$/,
  /^\/api\/admin\/restaurants$/,
  /^\/api\/admin\/migrate-custom-categories$/,
  /^\/api\/admin\/migrate-custom-categories\/cleanup$/,
  /^\/api\/admin\/migrate-delivery-settings$/,
  /^\/api\/admin\/migrate-delivery-settings\/cleanup$/,
  /^\/api\/admin\/migration\/display-ids$/,
  /^\/api\/auth\/check-role$/,
  /^\/api\/auth\/complete-profile$/,
  /^\/api\/auth\/forgot-password$/,
  /^\/api\/auth\/generate-session-token$/,
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/login-google$/,
  /^\/api\/auth\/signup-owner$/,
  /^\/api\/auth\/verify-token$/,
  /^\/api\/discover\/locations$/,
  /^\/api\/location\/geocode$/,
  /^\/api\/location\/search$/,
  /^\/api\/public\/location\/geocode$/,
  /^\/api\/public\/location\/ip$/,
  /^\/api\/public\/location\/search$/,
  /^\/api\/public\/locations$/,
  /^\/api\/public\/restaurant-overview\/:restaurantId$/,
  /^\/api\/rider\/accept-invite$/,
  /^\/api\/rider\/optimize-route$/,
  /^\/api\/telemetry\/client-event$/,
  /^\/api\/test$/,
  /^\/api\/test-admin$/,
  /^\/api\/user\/addresses$/,
  /^\/api\/user\/delete$/,
  /^\/api\/waitlist$/,
  /^\/api\/cron\/cleanup-retention$/,
  /^\/api\/payment\/create-order$/,
  /^\/api\/payment\/create-split-order$/,
  /^\/api\/payment\/status$/,
  /^\/api\/payment\/split-status$/,
  /^\/api\/payment\/phonepe\/initiate$/,
  /^\/api\/payment\/phonepe\/status\/:orderId$/,
  /^\/api\/payment\/phonepe\/token$/,
  /^\/api\/payment\/phonepe\/refund$/,
  /^\/api\/payment\/phonepe\/callback$/,
  /^\/api\/payment\/upi-qr-card$/,
  /^\/api\/ai\/scan-menu$/,
  /^\/api\/rider\/dashboard$/,
  /^\/api\/rider\/accept-order$/,
  /^\/api\/rider\/update-order-status$/,
  /^\/api\/rider\/reached-restaurant$/,
  /^\/api\/rider\/start-delivery$/,
  /^\/api\/rider\/attempt-delivery$/,
  /^\/api\/rider\/mark-failed$/,
  /^\/api\/rider\/return-order$/,
  /^\/api\/rider\/update-payment-status$/,
  /^\/api\/rider\/send-payment-request$/,
  /^\/api\/dine-in\/table-status$/,
  /^\/api\/dine-in\/create-tab$/,
  /^\/api\/dine-in\/join-table$/,
  /^\/api\/dine-in\/tab-status\/:tabId$/,
  /^\/api\/dine-in\/initiate-payment$/,
  /^\/api\/dine-in\/unlock-payment$/,
  /^\/api\/dine-in\/clean-table$/,
  /^\/api\/webhooks\/razorpay$/,
  /^\/api\/whatsapp\/webhook$/,
];

function toRoutePathFromFile(filePath, baseDir) {
  const rel = path.relative(baseDir, filePath).replace(/\\/g, '/');
  const withoutRoute = rel.replace(/\/route\.(js|ts)$/, '');
  const parts = withoutRoute
    .split('/')
    .filter(Boolean)
    .map((part) => {
      const dynamic = part.match(/^\[(.+)\]$/);
      if (dynamic) return `:${dynamic[1]}`;
      return part;
    });
  return `/api/${parts.join('/')}`;
}

function walkRouteFiles(dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkRouteFiles(abs));
      continue;
    }
    if (/route\.(js|ts)$/.test(entry.name)) {
      results.push(abs);
    }
  }
  return results;
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    map.set(keyFn(item), item);
  }
  return Array.from(map.values());
}

function main() {
  const allRoutes = [];

  for (const apiDir of API_DIRS) {
    const files = walkRouteFiles(apiDir);
    for (const filePath of files) {
      const route = toRoutePathFromFile(filePath, apiDir);
      const source = path.relative(ROOT, filePath).replace(/\\/g, '/');
      const native = NATIVE_PATTERNS.some((re) => re.test(route));
      allRoutes.push({
        route,
        source,
        status: native ? 'native' : 'proxy',
      });
    }
  }

  const uniqueRoutes = dedupeBy(allRoutes, (item) => `${item.route}|${item.source}`)
    .sort((a, b) => a.route.localeCompare(b.route));

  const summary = uniqueRoutes.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === 'native') acc.native += 1;
      else acc.proxy += 1;
      return acc;
    },
    { total: 0, native: 0, proxy: 0 }
  );

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        root: path.relative(ROOT, ROOT) || '.',
        summary,
        routes: uniqueRoutes,
      },
      null,
      2
    )
  );

  process.stdout.write(
    `Generated ${OUTPUT_FILE}\nTotal: ${summary.total}, Native: ${summary.native}, Proxy: ${summary.proxy}\n`
  );
}

main();
