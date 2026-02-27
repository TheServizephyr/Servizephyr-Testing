#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const SERVER_ROOT = path.resolve(__dirname, '..');
const ROOT = path.resolve(SERVER_ROOT, '..');
const INVENTORY_FILE = path.join(SERVER_ROOT, 'migration', 'endpoint-inventory.json');
const RENDER_AUTOSCALE_FILE = path.join(SERVER_ROOT, 'deploy', 'render-autoscale.json');
const FIRESTORE_INDEX_FILE = path.join(ROOT, 'firestore.indexes.json');
const K6_SMOKE_FILE = path.join(SERVER_ROOT, 'loadtest', 'k6-smoke.js');
const K6_PEAK_FILE = path.join(SERVER_ROOT, 'loadtest', 'k6-peak.js');

const HOT_ROUTES = [
  '/api/public/menu/:restaurantId',
  '/api/order/create',
  '/api/order/status/:orderId',
  '/api/order/active',
  '/api/order/settle-payment',
  '/api/owner/orders',
  '/api/owner/menu',
  '/api/owner/dine-in-tables',
  '/api/customer/hub-data',
];

const REQUIRED_INDEX_SIGNATURES = [
  'orders|restaurantId:ASCENDING|orderDate:DESCENDING',
  'orders|restaurantId:ASCENDING|status:ASCENDING|orderDate:DESCENDING',
  'orders|restaurantId:ASCENDING|deliveryType:ASCENDING|tableId:ASCENDING|status:ASCENDING',
  'orders|restaurantId:ASCENDING|dineInTabId:ASCENDING|status:ASCENDING',
  'orders|restaurantId:ASCENDING|tabId:ASCENDING|status:ASCENDING',
  'orders|restaurantId:ASCENDING|dineInToken:ASCENDING|status:ASCENDING',
  'orders|restaurantId:ASCENDING|customer.phone:ASCENDING|status:ASCENDING|orderDate:DESCENDING',
  'dineInTabs|restaurantId:ASCENDING|status:ASCENDING|closedAt:DESCENDING',
  'serviceRequests|status:ASCENDING|createdAt:DESCENDING',
];

function loadEnv() {
  dotenv.config({ path: path.join(SERVER_ROOT, '.env') });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureInventoryHotRoutesNative() {
  if (!fs.existsSync(INVENTORY_FILE)) {
    throw new Error(`Missing ${INVENTORY_FILE}. Run: npm run inventory:routes`);
  }

  const inventory = readJson(INVENTORY_FILE);
  const routeStatus = new Map();
  (inventory.routes || []).forEach((entry) => {
    if (!routeStatus.has(entry.route)) {
      routeStatus.set(entry.route, entry.status);
    }
    if (entry.status === 'native') {
      routeStatus.set(entry.route, 'native');
    }
  });

  const missing = HOT_ROUTES.filter((route) => routeStatus.get(route) !== 'native');
  if (missing.length > 0) {
    throw new Error(`Hot routes still not native: ${missing.join(', ')}`);
  }
}

function ensureCacheEnvReady() {
  const url = String(process.env.KV_REST_API_URL || '').trim();
  const token = String(process.env.KV_REST_API_TOKEN || '').trim();
  if (!url || !token) {
    throw new Error('Upstash cache env missing. Set KV_REST_API_URL and KV_REST_API_TOKEN.');
  }
}

function ensureLoadtestAssets() {
  if (!fs.existsSync(K6_SMOKE_FILE) || !fs.existsSync(K6_PEAK_FILE)) {
    throw new Error('Loadtest files missing in server/loadtest.');
  }
}

function ensureRenderAutoscaleProfile() {
  if (!fs.existsSync(RENDER_AUTOSCALE_FILE)) {
    throw new Error(`Missing ${RENDER_AUTOSCALE_FILE}`);
  }
  const profile = readJson(RENDER_AUTOSCALE_FILE);
  const min = Number(profile.minInstances || 0);
  const max = Number(profile.maxInstances || 0);
  const cpu = Number(profile.targetCPUPercent || 0);
  const mem = Number(profile.targetMemoryPercent || 0);

  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) {
    throw new Error('Invalid autoscale profile min/max instances.');
  }
  if (!Number.isFinite(cpu) || cpu <= 0 || cpu > 100) {
    throw new Error('Invalid autoscale profile targetCPUPercent.');
  }
  if (!Number.isFinite(mem) || mem <= 0 || mem > 100) {
    throw new Error('Invalid autoscale profile targetMemoryPercent.');
  }
}

function ensureFirestoreIndexCheckPasses() {
  if (!fs.existsSync(FIRESTORE_INDEX_FILE)) {
    throw new Error(`Missing ${FIRESTORE_INDEX_FILE}`);
  }

  const indexes = readJson(FIRESTORE_INDEX_FILE);
  const signatures = new Set(
    (indexes.indexes || []).map((index) => {
      const fields = (index.fields || [])
        .map((field) => `${field.fieldPath}:${field.order || field.arrayConfig || ''}`)
        .join('|');
      return `${index.collectionGroup}|${fields}`;
    })
  );

  const missing = REQUIRED_INDEX_SIGNATURES.filter((signature) => !signatures.has(signature));
  if (missing.length > 0) {
    throw new Error(`Missing required index signatures: ${missing.join(', ')}`);
  }
}

function main() {
  loadEnv();

  const checks = [
    { name: 'Hot endpoints native', fn: ensureInventoryHotRoutesNative },
    { name: 'Firestore indexes', fn: ensureFirestoreIndexCheckPasses },
    { name: 'Upstash cache env', fn: ensureCacheEnvReady },
    { name: 'Render autoscale profile', fn: ensureRenderAutoscaleProfile },
    { name: 'Loadtest assets', fn: ensureLoadtestAssets },
  ];

  const failures = [];
  checks.forEach((check) => {
    try {
      check.fn();
      process.stdout.write(`PASS  ${check.name}\n`);
    } catch (error) {
      failures.push({ name: check.name, error: error.message || String(error) });
      process.stderr.write(`FAIL  ${check.name}: ${error.message || error}\n`);
    }
  });

  if (failures.length > 0) {
    process.stderr.write(`\nCapacity readiness failed (${failures.length} checks).\n`);
    process.exit(1);
  }

  process.stdout.write('\nCapacity readiness check passed.\n');
}

main();
