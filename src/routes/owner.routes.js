const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../middleware/asyncHandler');
const {
  getPublicOwnerSettings,
  getAuthenticatedOwnerSettings,
  patchAuthenticatedOwnerSettings,
} = require('../services/ownerSettings.service');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const { getOwnerOrders, updateOwnerOrders } = require('../services/ownerOrders.service');
const { getOwnerStatus } = require('../services/ownerStatus.service');
const {
  getOwnerDineInTables,
  postOwnerDineInTables,
  patchOwnerDineInTables,
  deleteOwnerDineInTable,
} = require('../services/ownerDineInTables.service');
const {
  getOwnerMenu,
  updateOwnerMenuItemAvailability,
  createOrUpdateOwnerMenuItem,
  deleteOwnerMenuItem,
  supportsNativeOwnerMenuPatch,
  patchOwnerMenu,
} = require('../services/ownerMenu.service');
const {
  getOwnerCoupons,
  createOwnerCoupon,
  updateOwnerCoupon,
  deleteOwnerCoupon,
} = require('../services/ownerCoupons.service');
const { createOwnerLinkedAccount } = require('../services/ownerLinkedAccount.service');
const {
  getOwnerEmployees,
  createOwnerEmployeeInvite,
  patchOwnerEmployee,
  deleteOwnerEmployee,
} = require('../services/ownerEmployees.service');
const { createOwnerMenuBulk } = require('../services/ownerMenuBulk.service');
const { getOwnerAnalytics } = require('../services/ownerAnalytics.service');
const { getOwnerConnections } = require('../services/ownerConnections.service');
const { getOwnerLocations, saveOwnerLocation } = require('../services/ownerLocations.service');
const { postOwnerCleanupStaleTabs } = require('../services/ownerCleanupStaleTabs.service');
const {
  getOwnerBookings,
  postPublicBooking,
  patchOwnerBooking,
} = require('../services/ownerBookings.service');
const {
  getOwnerCarSpots,
  postOwnerCarSpot,
  deleteOwnerCarSpot,
} = require('../services/ownerCarSpots.service');
const {
  getOwnerDeliverySettings,
  patchOwnerDeliverySettings,
} = require('../services/ownerDeliverySettings.service');
const {
  getOwnerOpenItems,
  postOwnerOpenItem,
  deleteOwnerOpenItem,
} = require('../services/ownerOpenItems.service');
const { getOwnerCustomers, patchOwnerCustomer } = require('../services/ownerCustomers.service');
const { getOwnerDashboardData } = require('../services/ownerDashboardData.service');
const {
  getOwnerServiceRequests,
  postPublicServiceRequest,
  patchOwnerServiceRequest,
} = require('../services/ownerServiceRequests.service');
const {
  getOwnerDineInHistory,
  postOwnerDineInHistoryUndo,
} = require('../services/ownerDineInHistory.service');
const {
  getOwnerDelivery,
  postOwnerDeliveryBoy,
  patchOwnerDeliveryBoy,
  deleteOwnerDeliveryBoy,
  postOwnerDeliveryInvite,
} = require('../services/ownerDelivery.service');
const {
  getOwnerInventory,
  postOwnerInventoryAdjust,
  postOwnerInventorySyncFromMenu,
} = require('../services/ownerInventory.service');
const { getOwnerPayouts } = require('../services/ownerPayouts.service');
const { postOwnerRefund } = require('../services/ownerRefund.service');
const {
  postOwnerCustomBillCreateOrder,
  postOwnerCustomBillHistory,
  getOwnerCustomBillHistory,
  patchOwnerCustomBillHistory,
} = require('../services/ownerCustomBill.service');
const { postOwnerWhatsAppOnboarding } = require('../services/ownerWhatsAppOnboarding.service');
const { getOwnerTables, postOwnerTables, patchOwnerTables } = require('../services/ownerTables.service');
const { postOwnerWhatsAppDirectUploadUrl } = require('../services/ownerWhatsAppDirectUpload.service');
const { postOwnerSettingsUploadQrUrl } = require('../services/ownerQrUpload.service');
const {
  getOwnerWhatsAppDirectConversations,
  patchOwnerWhatsAppDirectConversations,
  getOwnerWhatsAppDirectCustomerDetails,
  patchOwnerWhatsAppDirectCustomerDetails,
  getOwnerWhatsAppDirectMessages,
  postOwnerWhatsAppDirectMessage,
  patchOwnerWhatsAppDirectMessages,
} = require('../services/ownerWhatsAppDirect.service');

const router = express.Router();
router.use(express.json({ limit: '2mb' }));
const qrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const businessId = String(req.query.restaurantId || req.query.businessId || '').trim();
    const includeCoupons = ['1', 'true', 'yes'].includes(String(req.query.includeCoupons || '').toLowerCase());

    // Public mode: used by customer order/checkout flows
    if (businessId) {
      const payload = await getPublicOwnerSettings({
        businessId,
        includeCoupons,
      });
      res.setHeader('x-backend', 'render-v2');
      return res.status(200).json(payload);
    }

    const payload = await getAuthenticatedOwnerSettings(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const payload = await patchAuthenticatedOwnerSettings(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerStatus(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.get(
  '/coupons',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerCoupons(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.post(
  '/coupons',
  asyncHandler(async (req, res) => {
    const payload = await createOwnerCoupon(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(201).json(payload);
  })
);

router.patch(
  '/coupons',
  asyncHandler(async (req, res) => {
    const payload = await updateOwnerCoupon(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.delete(
  '/coupons',
  asyncHandler(async (req, res) => {
    const payload = await deleteOwnerCoupon(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.post(
  '/create-linked-account',
  asyncHandler(async (req, res) => {
    const payload = await createOwnerLinkedAccount(req);
    res.setHeader('x-backend', 'render-v2');
    return res.status(200).json(payload);
  })
);

router.get(
  '/employees',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerEmployees(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/employees',
  asyncHandler(async (req, res) => {
    const payload = await createOwnerEmployeeInvite(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(201).json(payload);
  })
);

router.patch(
  '/employees',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerEmployee(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.delete(
  '/employees',
  asyncHandler(async (req, res) => {
    const payload = await deleteOwnerEmployee(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/menu-bulk',
  asyncHandler(async (req, res) => {
    const payload = await createOwnerMenuBulk(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(201).json(payload);
  })
);

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerAnalytics(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/connections',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerConnections(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/locations',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerLocations(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/locations',
  asyncHandler(async (req, res) => {
    const payload = await saveOwnerLocation(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/locations',
  asyncHandler(async (req, res) => {
    const payload = await saveOwnerLocation(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/cleanup-stale-tabs',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerCleanupStaleTabs(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/bookings',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerBookings(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/bookings',
  asyncHandler(async (req, res) => {
    const payload = await postPublicBooking(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(201).json(payload);
  })
);

router.patch(
  '/bookings',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerBooking(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/car-spots',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerCarSpots(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/car-spots',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerCarSpot(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(payload.statusCode || 200).json({
      message: payload.message,
      spot: payload.spot,
    });
  })
);

router.delete(
  '/car-spots',
  asyncHandler(async (req, res) => {
    const payload = await deleteOwnerCarSpot(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/delivery-settings',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerDeliverySettings(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/delivery-settings',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerDeliverySettings(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/open-items',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerOpenItems(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/open-items',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerOpenItem(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(payload.statusCode || 200).json({
      item: payload.item,
      duplicate: payload.duplicate,
    });
  })
);

router.delete(
  '/open-items',
  asyncHandler(async (req, res) => {
    const payload = await deleteOwnerOpenItem(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerCustomers(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/customers',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerCustomer(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/dashboard-data',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerDashboardData(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/service-requests',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerServiceRequests(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/service-requests',
  asyncHandler(async (req, res) => {
    const payload = await postPublicServiceRequest(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(201).json(payload);
  })
);

router.patch(
  '/service-requests',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerServiceRequest(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/dine-in-history',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerDineInHistory(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/dine-in-history/undo',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerDineInHistoryUndo(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/custom-bill/create-order',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerCustomBillCreateOrder(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/custom-bill/history',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerCustomBillHistory(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/custom-bill/history',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerCustomBillHistory(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/custom-bill/history',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerCustomBillHistory(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/delivery',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerDelivery(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/delivery',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerDeliveryBoy(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(201).json(payload);
  })
);

router.patch(
  '/delivery',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerDeliveryBoy(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.delete(
  '/delivery',
  asyncHandler(async (req, res) => {
    const payload = await deleteOwnerDeliveryBoy(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/delivery/invite',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerDeliveryInvite(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/inventory',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerInventory(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/inventory/adjust',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerInventoryAdjust(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/inventory/sync-from-menu',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerInventorySyncFromMenu(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/payouts',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerPayouts(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/refund',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerRefund(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/whatsapp-onboarding',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerWhatsAppOnboarding(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

// Compatibility proxy routes for modules still running on legacy logic.
router.post(
  '/settings/upload-qr-url',
  qrUpload.single('file'),
  asyncHandler(async (req, res) => {
    const payload = await postOwnerSettingsUploadQrUrl(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/tables',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerTables(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/tables',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerTables(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(201).json(payload);
  })
);

router.patch(
  '/tables',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerTables(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/whatsapp-direct/conversations',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerWhatsAppDirectConversations(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/whatsapp-direct/conversations',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerWhatsAppDirectConversations(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/whatsapp-direct/customer-details',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerWhatsAppDirectCustomerDetails(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/whatsapp-direct/customer-details',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerWhatsAppDirectCustomerDetails(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/whatsapp-direct/messages',
  asyncHandler(async (req, res) => {
    const payload = await getOwnerWhatsAppDirectMessages(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/whatsapp-direct/messages',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerWhatsAppDirectMessage(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/whatsapp-direct/messages',
  asyncHandler(async (req, res) => {
    const payload = await patchOwnerWhatsAppDirectMessages(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/whatsapp-direct/upload-url',
  asyncHandler(async (req, res) => {
    const payload = await postOwnerWhatsAppDirectUploadUrl(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const { payload } = await getOwnerOrders(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/orders',
  asyncHandler(async (req, res) => {
    const { payload } = await updateOwnerOrders(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/dine-in-tables',
  asyncHandler(async (req, res) => {
    const { payload, cacheStatus } = await getOwnerDineInTables(req);
    res.setHeader('x-backend', 'render-v2');
    if (cacheStatus) res.setHeader('x-cache', cacheStatus);
    res.status(200).json(payload);
  })
);

router.get(
  '/menu',
  asyncHandler(async (req, res) => {
    const { payload, cacheStatus } = await getOwnerMenu(req);
    res.setHeader('x-backend', 'render-v2');
    if (cacheStatus) res.setHeader('x-cache', cacheStatus);
    res.status(200).json(payload);
  })
);

router.patch(
  '/menu',
  asyncHandler(async (req, res) => {
    const updates = req.body?.updates;
    if (updates && typeof updates === 'object' && updates.id) {
      const { payload } = await updateOwnerMenuItemAvailability(req);
      res.setHeader('x-backend', 'render-v2');
      return res.status(200).json(payload);
    }

    if (supportsNativeOwnerMenuPatch(req.body || {})) {
      const { payload } = await patchOwnerMenu(req);
      res.setHeader('x-backend', 'render-v2');
      return res.status(200).json(payload);
    }

    res.setHeader('x-backend', 'render-v2');
    return res.status(400).json({
      error: 'Unsupported owner menu patch payload for native backend.',
    });
  })
);

router.post(
  '/menu',
  asyncHandler(async (req, res) => {
    const { payload, statusCode } = await createOrUpdateOwnerMenuItem(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(statusCode || 200).json(payload);
  })
);

router.delete(
  '/menu',
  asyncHandler(async (req, res) => {
    const { payload } = await deleteOwnerMenuItem(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/dine-in-tables',
  asyncHandler(async (req, res) => {
    const { payload, statusCode } = await postOwnerDineInTables(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(statusCode || 200).json(payload);
  })
);

router.patch(
  '/dine-in-tables',
  asyncHandler(async (req, res) => {
    const { payload, statusCode } = await patchOwnerDineInTables(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(statusCode || 200).json(payload);
  })
);

router.delete(
  '/dine-in-tables',
  asyncHandler(async (req, res) => {
    const { payload } = await deleteOwnerDineInTable(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
