const express = require('express');
const { config } = require('../config/env');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getActiveOrders } = require('../services/orderActive.service');
const { getOrderStatus } = require('../services/orderStatus.service');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const { createOrderNative, shouldUseLegacyCreateOrder } = require('../services/orderCreate.service');
const { patchOrderUpdate } = require('../services/orderUpdate.service');
const { postOrderCancel } = require('../services/orderCancel.service');
const { postOrderMarkPaid } = require('../services/orderMarkPaid.service');
const { postOrderSettlePayment } = require('../services/orderSettlePayment.service');

const router = express.Router();
router.use(express.json({ limit: '2mb' }));

router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const payload = await getActiveOrders(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/status/:orderId',
  asyncHandler(async (req, res) => {
    const { payload, cacheStatus, liteMode } = await getOrderStatus({
      req,
      orderId: req.params.orderId,
    });
    res.setHeader('x-backend', 'render-v2');
    res.setHeader('x-cache', cacheStatus);
    if (liteMode) {
      res.setHeader('x-mode', 'lite');
    }
    res.status(200).json(payload);
  })
);

router.post(
  '/create',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const fallback = shouldUseLegacyCreateOrder(body);
    if (fallback.useLegacy) {
      if (!config.legacy.enableProxy) {
        res.setHeader('x-backend', 'render-v2');
        res.setHeader('x-order-create-mode', `native:unsupported:${fallback.reason}`);
        return res.status(422).json({
          error: 'Unsupported order creation flow in native backend.',
          reason: fallback.reason,
        });
      }

      res.setHeader('x-order-create-mode', `legacy:${fallback.reason}`);
      return proxyToLegacy(req, res);
    }

    const result = await createOrderNative({ req, body });
    res.setHeader('x-backend', 'render-v2');
    res.setHeader('x-order-create-mode', result.duplicate ? 'native:duplicate' : 'native:new');
    return res.status(200).json(result.payload);
  })
);

router.patch(
  '/update',
  asyncHandler(async (req, res) => {
    const payload = await patchOrderUpdate(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/cancel',
  asyncHandler(async (req, res) => {
    const payload = await postOrderCancel(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/mark-paid',
  asyncHandler(async (req, res) => {
    const payload = await postOrderMarkPaid(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/settle-payment',
  asyncHandler(async (req, res) => {
    const payload = await postOrderSettlePayment(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

module.exports = router;
