const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { logAdminImpersonation } = require('../services/adminImpersonation.service');
const { getAdminDashboardStats } = require('../services/adminDashboardStats.service');
const { getAdminAnalytics } = require('../services/adminAnalytics.service');
const { getAdminListings, patchAdminListings } = require('../services/adminListings.service');
const { getAdminListingAnalytics } = require('../services/adminListingAnalytics.service');
const { getAdminUsers, patchAdminUsers, getAdminUserById } = require('../services/adminUsers.service');
const { getAdminAuditLogs } = require('../services/adminAuditLogs.service');
const { checkAdminIds } = require('../services/adminCheckIds.service');
const {
  getAdminMailboxReports,
  postAdminMailboxReport,
  patchAdminMailboxReport,
} = require('../services/adminMailbox.service');
const { retryAdminWebhook } = require('../services/adminRetryWebhook.service');
const { getAdminWaitlist } = require('../services/adminWaitlist.service');
const { getAdminOpsTelemetry, getAdminReadTelemetry } = require('../services/adminOpsTelemetry.service');
const {
  getAdminMigrationDisplayIds,
  postAdminMigrateDeliverySettings,
  postAdminCleanupDeliverySettings,
  postAdminMigrateCustomCategories,
  postAdminCleanupCustomCategories,
} = require('../services/adminMigrations.service');
const { proxyToLegacy } = require('../services/legacyProxy.service');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

router.post(
  '/log-impersonation',
  asyncHandler(async (req, res) => {
    const payload = await logAdminImpersonation(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/dashboard-stats',
  asyncHandler(async (req, res) => {
    const payload = await getAdminDashboardStats(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const payload = await getAdminAnalytics(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/listings',
  asyncHandler(async (req, res) => {
    const payload = await getAdminListings(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/listings',
  asyncHandler(async (req, res) => {
    const payload = await patchAdminListings(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/restaurants',
  asyncHandler(async (req, res) => {
    const payload = await getAdminListings(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/restaurants',
  asyncHandler(async (req, res) => {
    const payload = await patchAdminListings(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/listing-analytics',
  asyncHandler(async (req, res) => {
    const payload = await getAdminListingAnalytics(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const payload = await getAdminUsers(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/users',
  asyncHandler(async (req, res) => {
    const payload = await patchAdminUsers(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    const payload = await getAdminUserById(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const payload = await getAdminAuditLogs(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/check-ids',
  asyncHandler(async (req, res) => {
    const payload = await checkAdminIds(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/mailbox',
  asyncHandler(async (req, res) => {
    const payload = await getAdminMailboxReports(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/mailbox',
  asyncHandler(async (req, res) => {
    const result = await postAdminMailboxReport(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(result.status || 201).json(result.payload);
  })
);

router.patch(
  '/mailbox',
  asyncHandler(async (req, res) => {
    const payload = await patchAdminMailboxReport(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/retry-webhook',
  asyncHandler(async (req, res) => {
    const result = await retryAdminWebhook(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(result.status || 200).json(result.payload);
  })
);

router.get(
  '/waitlist',
  asyncHandler(async (req, res) => {
    const payload = await getAdminWaitlist(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/ops-telemetry',
  asyncHandler(async (req, res) => {
    const payload = await getAdminOpsTelemetry(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/read-telemetry',
  asyncHandler(async (req, res) => {
    const payload = await getAdminReadTelemetry(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/migration/display-ids',
  asyncHandler(async (req, res) => {
    const payload = await getAdminMigrationDisplayIds(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/migrate-delivery-settings',
  asyncHandler(async (req, res) => {
    const payload = await postAdminMigrateDeliverySettings(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/migrate-delivery-settings/cleanup',
  asyncHandler(async (req, res) => {
    const payload = await postAdminCleanupDeliverySettings(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/migrate-custom-categories',
  asyncHandler(async (req, res) => {
    const payload = await postAdminMigrateCustomCategories(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/migrate-custom-categories/cleanup',
  asyncHandler(async (req, res) => {
    const payload = await postAdminCleanupCustomCategories(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
