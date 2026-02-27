const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const { createPaymentOrder, getSplitPaymentStatus } = require('../services/splitPayment.service');
const { initiatePhonePePayment } = require('../services/phonepe.service');
const { getPhonePeStatusForOrder } = require('../services/phonepeStatus.service');
const { processPhonePeWebhook } = require('../services/phonepeWebhook.service');
const { getPhonePeTokenForInternal } = require('../services/phonepeToken.service');
const { createPhonePeRefund } = require('../services/phonepeRefund.service');
const { getUpiQrCardImage } = require('../services/paymentUpiQrCard.service');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

router.post(
  '/create-order',
  asyncHandler(async (req, res) => {
    const payload = await createPaymentOrder(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

// Backward compatibility alias used by some older clients.
router.post(
  '/create-split-order',
  asyncHandler(async (req, res) => {
    const payload = await createPaymentOrder(req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const splitId = String(req.query.splitId || '').trim();
    const payload = await getSplitPaymentStatus(splitId);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/split-status',
  asyncHandler(async (req, res) => {
    const splitId = String(req.query.splitId || '').trim();
    const payload = await getSplitPaymentStatus(splitId);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/phonepe/initiate',
  asyncHandler(async (req, res) => {
    const amount = req.body?.amount;
    const orderId = req.body?.orderId;
    const payload = await initiatePhonePePayment({ amount, orderId });
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/phonepe/status/:orderId',
  asyncHandler(async (req, res) => {
    const payload = await getPhonePeStatusForOrder({
      req,
      orderId: req.params.orderId,
    });
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/phonepe/callback',
  asyncHandler(async (req, res) => {
    const payload = await processPhonePeWebhook({
      req,
      body: req.body || {},
    });
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/phonepe/token',
  asyncHandler(async (req, res) => {
    const payload = await getPhonePeTokenForInternal(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/phonepe/refund',
  asyncHandler(async (req, res) => {
    const payload = await createPhonePeRefund(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/upi-qr-card',
  asyncHandler(async (req, res) => {
    const result = await getUpiQrCardImage(req);
    res.setHeader('x-backend', 'render-v2');
    res.setHeader('Cache-Control', result.cacheControl);
    res.type(result.contentType);
    res.status(200).send(result.body);
  })
);

// Any other payment route currently continues on legacy backend.
router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
