const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { proxyToLegacy } = require('../services/legacyProxy.service');
const {
  postAuthLogin,
  postAuthLoginGoogleAck,
  postAuthForgotPassword,
  postAuthSignupOwnerDeprecated,
  postAuthCheckRole,
} = require('../services/auth.service');
const {
  postAuthGenerateSessionToken,
  postAuthVerifyToken,
} = require('../services/authSession.service');
const { postAuthCompleteProfile } = require('../services/authCompleteProfile.service');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const payload = await postAuthLogin(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/login-google',
  asyncHandler(async (_req, res) => {
    const payload = await postAuthLoginGoogleAck();
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const payload = await postAuthForgotPassword(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/signup-owner',
  asyncHandler(async (_req, res) => {
    const result = await postAuthSignupOwnerDeprecated();
    res.setHeader('x-backend', 'render-v2');
    res.status(result.status || 410).json(result.payload);
  })
);

router.post(
  '/check-role',
  asyncHandler(async (req, res) => {
    const payload = await postAuthCheckRole(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/generate-session-token',
  asyncHandler(async (req, res) => {
    const payload = await postAuthGenerateSessionToken(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.post(
  '/verify-token',
  asyncHandler(async (req, res) => {
    const result = await postAuthVerifyToken(req);
    if (result.cookie) {
      res.cookie(result.cookie.name, result.cookie.value, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: result.cookie.maxAgeMs,
      });
    }
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(result.payload);
  })
);

router.post(
  '/complete-profile',
  asyncHandler(async (req, res) => {
    const payload = await postAuthCompleteProfile(req);
    res.setHeader('x-backend', 'render-v2');
    res.status(200).json(payload);
  })
);

router.all(
  '*',
  asyncHandler(async (req, res) => proxyToLegacy(req, res))
);

module.exports = router;
