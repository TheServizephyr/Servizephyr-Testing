#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_FILE = path.join(ROOT, 'firestore.indexes.json');

const REQUIRED_INDEXES = [
  {
    collectionGroup: 'orders',
    fields: [
      { fieldPath: 'restaurantId', order: 'ASCENDING' },
      { fieldPath: 'orderDate', order: 'DESCENDING' },
    ],
    reason: 'Owner/customer order feeds',
  },
  {
    collectionGroup: 'orders',
    fields: [
      { fieldPath: 'restaurantId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'orderDate', order: 'DESCENDING' },
    ],
    reason: 'Live order filters',
  },
  {
    collectionGroup: 'orders',
    fields: [
      { fieldPath: 'restaurantId', order: 'ASCENDING' },
      { fieldPath: 'deliveryType', order: 'ASCENDING' },
      { fieldPath: 'tableId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ],
    reason: 'Dine-in capacity/status queries',
  },
  {
    collectionGroup: 'orders',
    fields: [
      { fieldPath: 'restaurantId', order: 'ASCENDING' },
      { fieldPath: 'dineInTabId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ],
    reason: 'Tab settlement + cleanup',
  },
  {
    collectionGroup: 'orders',
    fields: [
      { fieldPath: 'restaurantId', order: 'ASCENDING' },
      { fieldPath: 'tabId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ],
    reason: 'Legacy tab-id compatibility queries',
  },
  {
    collectionGroup: 'orders',
    fields: [
      { fieldPath: 'restaurantId', order: 'ASCENDING' },
      { fieldPath: 'dineInToken', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ],
    reason: 'Token-based tab fallback queries',
  },
  {
    collectionGroup: 'orders',
    fields: [
      { fieldPath: 'restaurantId', order: 'ASCENDING' },
      { fieldPath: 'customer.phone', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'orderDate', order: 'DESCENDING' },
    ],
    reason: 'Customer lookup in owner orders',
  },
  {
    collectionGroup: 'dineInTabs',
    fields: [
      { fieldPath: 'restaurantId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'closedAt', order: 'DESCENDING' },
    ],
    reason: 'Dine-in history timelines',
  },
  {
    collectionGroup: 'serviceRequests',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
    reason: 'Owner dine-in requests',
  },
];

function fieldSignature(fields = []) {
  return fields
    .map((field) => {
      const mode = field.order || field.arrayConfig || '';
      return `${field.fieldPath}:${mode}`;
    })
    .join('|');
}

function indexSignature(index = {}) {
  return `${index.collectionGroup}|${fieldSignature(index.fields || [])}`;
}

function readIndexes() {
  const raw = fs.readFileSync(INDEX_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  const indexes = Array.isArray(parsed.indexes) ? parsed.indexes : [];
  return new Set(indexes.map(indexSignature));
}

function main() {
  if (!fs.existsSync(INDEX_FILE)) {
    process.stderr.write(`Missing ${INDEX_FILE}\n`);
    process.exit(1);
  }

  const existing = readIndexes();
  const missing = REQUIRED_INDEXES.filter((index) => !existing.has(indexSignature(index)));

  if (missing.length === 0) {
    process.stdout.write(`Firestore index check passed (${REQUIRED_INDEXES.length} required indexes present).\n`);
    return;
  }

  process.stderr.write(`Missing ${missing.length} required Firestore index definitions:\n`);
  missing.forEach((index) => {
    process.stderr.write(
      `- [${index.collectionGroup}] ${fieldSignature(index.fields)} (${index.reason})\n`
    );
  });
  process.exit(1);
}

main();
