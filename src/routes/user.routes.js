const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const { postUserDelete } = require('../services/userDelete.service');
const {
  getUserAddresses,
  postUserAddress,
  deleteUserAddress,
} = require('../services/userAddresses.service');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

router.get(
  '/addresses',
  asyncHandler(async (req, res) => {
    const payload = await getUserAddresses(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/addresses',
  asyncHandler(async (req, res) => {
    const payload = await postUserAddress(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.delete(
  '/addresses',
  asyncHandler(async (req, res) => {
    const payload = await deleteUserAddress(req, req.body || {});
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/delete',
  asyncHandler(async (req, res) => {
    const payload = await postUserDelete(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
