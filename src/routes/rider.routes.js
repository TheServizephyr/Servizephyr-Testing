const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getRiderDashboard, updateRiderDashboard } = require('../services/riderDashboard.service');
const {
  acceptRiderOrders,
  updateRiderOrderStatus,
  reachedRestaurantRiderOrders,
  startRiderDelivery,
  attemptRiderDelivery,
  markRiderDeliveryFailed,
  returnRiderOrders,
  updateRiderPaymentStatus,
  sendRiderPaymentRequest,
} = require('../services/riderOrders.service');
const { acceptRiderInvite } = require('../services/riderInvite.service');
const { optimizeRiderRoute } = require('../services/riderRouteOptimization.service');
const { proxyToLegacy } = require('../services/legacyProxy.service');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const result = await getRiderDashboard(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.patch(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const result = await updateRiderDashboard(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/accept-invite',
  asyncHandler(async (req, res) => {
    const payload = await acceptRiderInvite(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/accept-order',
  asyncHandler(async (req, res) => {
    const result = await acceptRiderOrders(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.patch(
  '/update-order-status',
  asyncHandler(async (req, res) => {
    const result = await updateRiderOrderStatus(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/update-order-status',
  asyncHandler(async (req, res) => {
    const result = await updateRiderOrderStatus(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/reached-restaurant',
  asyncHandler(async (req, res) => {
    const result = await reachedRestaurantRiderOrders(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/start-delivery',
  asyncHandler(async (req, res) => {
    const result = await startRiderDelivery(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/attempt-delivery',
  asyncHandler(async (req, res) => {
    const result = await attemptRiderDelivery(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/mark-failed',
  asyncHandler(async (req, res) => {
    const result = await markRiderDeliveryFailed(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/return-order',
  asyncHandler(async (req, res) => {
    const result = await returnRiderOrders(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/update-payment-status',
  asyncHandler(async (req, res) => {
    const result = await updateRiderPaymentStatus(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/send-payment-request',
  asyncHandler(async (req, res) => {
    const result = await sendRiderPaymentRequest(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/optimize-route',
  asyncHandler(async (req, res) => {
    const payload = await optimizeRiderRoute(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/send-payment-request',
  asyncHandler(async (req, res) => {
    const result = await sendRiderPaymentRequest(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

// Keep unimplemented rider routes on legacy until migrated.
router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
