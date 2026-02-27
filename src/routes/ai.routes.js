const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { scanMenuFromImage } = require('../services/aiScanMenu.service');

const router = express.Router();
router.use(express.json({ limit: '20mb' }));

router.post(
  '/scan-menu',
  asyncHandler(async (req, res) => {
    const payload = await scanMenuFromImage(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

module.exports = router;
