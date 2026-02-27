const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getEmployeeMe, patchEmployeeMe } = require('../services/employeeProfile.service');
const { getEmployeeInvitePreview, acceptEmployeeInvite } = require('../services/employeeInvite.service');
const { proxyToLegacy } = require('../services/legacyProxy.service');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const payload = await getEmployeeMe(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const payload = await patchEmployeeMe(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.get(
  '/accept-invite',
  asyncHandler(async (req, res) => {
    const result = await getEmployeeInvitePreview(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(result.status || 200).json(result.payload);
  })
);

router.post(
  '/accept-invite',
  asyncHandler(async (req, res) => {
    const payload = await acceptEmployeeInvite(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
