const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const {
  handleWhatsAppWebhookGet,
  handleWhatsAppWebhookPost,
} = require('../services/whatsappWebhook.service');

const router = express.Router();
router.use(
  express.raw({
    type: '*/*',
    limit: '10mb',
  })
);

router.get(
  '/webhook',
  asyncHandler(async (req, res) => {
    const result = await handleWhatsAppWebhookGet(req);
    if (result.contentType) res.type(result.contentType);
    if (typeof result.body === 'string') {
      res.status(result.statusCode || 200).send(result.body);
      return;
    }
    res.setHeader('x-backend', 'render-v2');
    res.status(result.statusCode || 200).json(result.body || {});
  })
);

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const result = await handleWhatsAppWebhookPost(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(result.statusCode || 200).json(result.body || {});
  })
);

module.exports = router;
