#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  const fullPath = path.join(SERVER_ROOT, relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

function assertMatch(source, regex, message) {
  if (!regex.test(source)) {
    throw new Error(message);
  }
}

function assertNoMatch(source, regex, message) {
  if (regex.test(source)) {
    throw new Error(message);
  }
}

function main() {
  const ownerRoutes = read('src/routes/owner.routes.js');
  const paymentRoutes = read('src/routes/payment.routes.js');
  const aiRoutes = read('src/routes/ai.routes.js');
  const whatsappRoutes = read('src/routes/whatsapp.routes.js');

  // Owner custom bill create-order
  assertMatch(
    ownerRoutes,
    /router\.post\(\s*'\/custom-bill\/create-order'[\s\S]{0,600}postOwnerCustomBillCreateOrder/,
    'P0 route missing native handler: POST /api/owner/custom-bill/create-order'
  );
  assertNoMatch(
    ownerRoutes,
    /router\.post\(\s*'\/custom-bill\/create-order'[\s\S]{0,300}proxyToLegacy/,
    'P0 route still proxied: POST /api/owner/custom-bill/create-order'
  );

  // Owner WhatsApp Direct routes
  const ownerDirectRoutes = [
    { method: 'get', path: '/whatsapp-direct/conversations', handler: 'getOwnerWhatsAppDirectConversations' },
    { method: 'patch', path: '/whatsapp-direct/conversations', handler: 'patchOwnerWhatsAppDirectConversations' },
    { method: 'get', path: '/whatsapp-direct/customer-details', handler: 'getOwnerWhatsAppDirectCustomerDetails' },
    { method: 'patch', path: '/whatsapp-direct/customer-details', handler: 'patchOwnerWhatsAppDirectCustomerDetails' },
    { method: 'get', path: '/whatsapp-direct/messages', handler: 'getOwnerWhatsAppDirectMessages' },
    { method: 'post', path: '/whatsapp-direct/messages', handler: 'postOwnerWhatsAppDirectMessage' },
    { method: 'patch', path: '/whatsapp-direct/messages', handler: 'patchOwnerWhatsAppDirectMessages' },
  ];

  ownerDirectRoutes.forEach((route) => {
    const nativeRe = new RegExp(
      `router\\.${route.method}\\(\\s*'${route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]{0,600}${route.handler}`
    );
    const proxyRe = new RegExp(
      `router\\.${route.method}\\(\\s*'${route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]{0,300}proxyToLegacy`
    );
    assertMatch(ownerRoutes, nativeRe, `P0 route missing native handler: ${route.method.toUpperCase()} /api/owner${route.path}`);
    assertNoMatch(ownerRoutes, proxyRe, `P0 route still proxied: ${route.method.toUpperCase()} /api/owner${route.path}`);
  });

  // Payment UPI QR card
  assertMatch(
    paymentRoutes,
    /router\.get\(\s*'\/upi-qr-card'[\s\S]{0,500}getUpiQrCardImage/,
    'P0 route missing native handler: GET /api/payment/upi-qr-card'
  );
  assertNoMatch(
    paymentRoutes,
    /router\.get\(\s*'\/upi-qr-card'[\s\S]{0,250}proxyToLegacy/,
    'P0 route still proxied: GET /api/payment/upi-qr-card'
  );

  // AI scan-menu
  assertMatch(
    aiRoutes,
    /router\.post\(\s*'\/scan-menu'[\s\S]{0,400}scanMenuFromImage/,
    'P0 route missing native handler: POST /api/ai/scan-menu'
  );
  assertNoMatch(
    aiRoutes,
    /router\.post\(\s*'\/scan-menu'[\s\S]{0,250}proxyToLegacy/,
    'P0 route still proxied: POST /api/ai/scan-menu'
  );

  // WhatsApp webhook
  assertMatch(
    whatsappRoutes,
    /router\.get\(\s*'\/webhook'[\s\S]{0,500}handleWhatsAppWebhookGet/,
    'P0 route missing native handler: GET /api/whatsapp/webhook'
  );
  assertMatch(
    whatsappRoutes,
    /router\.post\(\s*'\/webhook'[\s\S]{0,500}handleWhatsAppWebhookPost/,
    'P0 route missing native handler: POST /api/whatsapp/webhook'
  );
  assertNoMatch(
    whatsappRoutes,
    /router\.(get|post)\(\s*'\/webhook'[\s\S]{0,250}proxyToLegacy/,
    'P0 route still proxied: /api/whatsapp/webhook'
  );

  process.stdout.write('P0 native route assertions passed.\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
