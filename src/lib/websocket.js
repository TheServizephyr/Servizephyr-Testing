const { randomUUID } = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { config } = require('../config/env');
const { logger } = require('./logger');
const { verifyIdToken, getFirestore } = require('./firebaseAdmin');

let wsServerInstance = null;
const clientSubscriptions = new Map();
const socketAuthContexts = new Map();

const INSTANCE_ID = randomUUID().slice(0, 12);
let relayTimer = null;
let relayLastSeenMs = Date.now();
let relayTick = 0;

const BUSINESS_COLLECTIONS = ['restaurants', 'shops', 'street_vendors'];
const PRIVILEGED_ROLES = new Set([
  'admin',
  'owner',
  'restaurant-owner',
  'shop-owner',
  'street-vendor',
  'manager',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function parseSearchParams(url) {
  try {
    return new URL(url || '/', 'http://localhost').searchParams;
  } catch {
    return new URL('http://localhost').searchParams;
  }
}

function parseInitialChannels(url) {
  const channels = new Set();
  const params = parseSearchParams(url);

  const directChannel = normalizeText(params.get('channel'));
  if (directChannel) channels.add(directChannel);

  const listParam = normalizeText(params.get('channels'));
  if (listParam) {
    listParam
      .split(',')
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .forEach((value) => channels.add(value));
  }

  const restaurantId = normalizeText(params.get('restaurantId'));
  if (restaurantId) channels.add(`owner:${restaurantId}`);

  const riderId = normalizeText(params.get('riderId'));
  if (riderId) channels.add(`rider:${riderId}`);

  const orderId = normalizeText(params.get('orderId'));
  if (orderId) channels.add(`order:${orderId}`);

  return channels;
}

function isSupportedChannel(channel) {
  const safe = normalizeText(channel);
  return /^owner:[A-Za-z0-9_-]+$/.test(safe)
    || /^rider:[A-Za-z0-9_-]+$/.test(safe)
    || /^order:[A-Za-z0-9_-]+$/.test(safe);
}

function getSocketChannels(socket) {
  if (!clientSubscriptions.has(socket)) {
    clientSubscriptions.set(socket, new Set());
  }
  return clientSubscriptions.get(socket);
}

function subscribeSocket(socket, channels = []) {
  const target = getSocketChannels(socket);
  channels.forEach((channel) => {
    const safe = normalizeText(channel);
    if (safe) target.add(safe);
  });
  return target.size;
}

function unsubscribeSocket(socket, channels = []) {
  const target = getSocketChannels(socket);
  channels.forEach((channel) => {
    const safe = normalizeText(channel);
    if (safe) target.delete(safe);
  });
  return target.size;
}

function socketMatchesChannels(socket, requiredChannels = []) {
  if (!requiredChannels.length) return true;
  const subscribed = clientSubscriptions.get(socket);
  if (!subscribed || subscribed.size === 0) return false;
  return requiredChannels.some((channel) => subscribed.has(channel));
}

function getQueryOrderToken(url) {
  const params = parseSearchParams(url);
  return normalizeText(
    params.get('token')
    || params.get('trackingToken')
    || params.get('dineInToken')
    || ''
  );
}

async function buildAuthContext(req) {
  const params = parseSearchParams(req?.url);
  const authHeader = normalizeText(req?.headers?.authorization || '');
  const queryAuthToken = normalizeText(params.get('authToken') || params.get('idToken') || '');
  const rawToken = authHeader.startsWith('Bearer ')
    ? normalizeText(authHeader.slice('Bearer '.length))
    : queryAuthToken;

  const context = {
    uid: '',
    role: '',
    userData: {},
    queryOrderToken: getQueryOrderToken(req?.url),
  };

  if (!rawToken) return context;

  try {
    const decoded = await verifyIdToken(rawToken);
    const uid = normalizeText(decoded?.uid || '');
    if (!uid) return context;

    const firestore = await getFirestore();
    const userDoc = await firestore.collection('users').doc(uid).get();
    const userData = userDoc.exists ? (userDoc.data() || {}) : {};

    return {
      ...context,
      uid,
      role: normalizeText(userData.role || '').toLowerCase(),
      userData,
    };
  } catch {
    return context;
  }
}

async function hasBusinessAccess({ firestore, authContext, businessId }) {
  const uid = normalizeText(authContext?.uid || '');
  const safeBusinessId = normalizeText(businessId);
  if (!uid || !safeBusinessId) return false;

  const role = normalizeText(authContext?.role || '').toLowerCase();
  if (role === 'admin') return true;
  if (!PRIVILEGED_ROLES.has(role)) return false;

  for (const collectionName of BUSINESS_COLLECTIONS) {
    const businessDoc = await firestore.collection(collectionName).doc(safeBusinessId).get();
    if (!businessDoc.exists) continue;
    const businessData = businessDoc.data() || {};
    if (normalizeText(businessData.ownerId) === uid) return true;
    break;
  }

  const linkedOutlets = Array.isArray(authContext?.userData?.linkedOutlets)
    ? authContext.userData.linkedOutlets
    : [];
  return linkedOutlets.some(
    (outlet) => outlet?.outletId === safeBusinessId && normalizeText(outlet?.status).toLowerCase() === 'active'
  );
}

async function authorizeChannel({ channel, authContext, messageToken = '' }) {
  const safeChannel = normalizeText(channel);
  if (!isSupportedChannel(safeChannel)) {
    return { ok: false, reason: 'unsupported_channel' };
  }

  const [scope, value] = safeChannel.split(':');
  const firestore = await getFirestore();

  if (scope === 'owner') {
    if (!authContext?.uid) return { ok: false, reason: 'auth_required' };
    const allowed = await hasBusinessAccess({
      firestore,
      authContext,
      businessId: value,
    });
    return allowed
      ? { ok: true }
      : { ok: false, reason: 'owner_scope_denied' };
  }

  if (scope === 'rider') {
    if (!authContext?.uid) return { ok: false, reason: 'auth_required' };
    if (authContext.role === 'admin') return { ok: true };
    return authContext.uid === value
      ? { ok: true }
      : { ok: false, reason: 'rider_scope_denied' };
  }

  const orderDoc = await firestore.collection('orders').doc(value).get();
  if (!orderDoc.exists) return { ok: false, reason: 'order_not_found' };

  const orderData = orderDoc.data() || {};
  const providedToken = normalizeText(messageToken || authContext?.queryOrderToken || '');
  if (providedToken) {
    if (
      providedToken === normalizeText(orderData.trackingToken)
      || providedToken === normalizeText(orderData.dineInToken)
    ) {
      return { ok: true };
    }
  }

  if (!authContext?.uid) return { ok: false, reason: 'order_auth_required' };
  if (
    authContext.uid === normalizeText(orderData.userId)
    || authContext.uid === normalizeText(orderData.customerId)
    || authContext.uid === normalizeText(orderData.deliveryBoyId)
    || authContext.uid === normalizeText(orderData.restaurantId)
  ) {
    return { ok: true };
  }

  const allowed = await hasBusinessAccess({
    firestore,
    authContext,
    businessId: normalizeText(orderData.restaurantId),
  });
  return allowed
    ? { ok: true }
    : { ok: false, reason: 'order_scope_denied' };
}

async function filterAuthorizedChannels({ channels = [], authContext, messageToken = '' }) {
  const uniqueChannels = Array.from(new Set(
    channels.map((value) => normalizeText(value)).filter(Boolean)
  ));

  const allowed = [];
  const rejected = [];

  for (const channel of uniqueChannels) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await authorizeChannel({ channel, authContext, messageToken });
      if (result.ok) {
        allowed.push(channel);
      } else {
        rejected.push({ channel, reason: result.reason || 'denied' });
      }
    } catch {
      rejected.push({ channel, reason: 'auth_error' });
    }
  }

  return { allowed, rejected };
}

function serializeEnvelope(envelope = {}) {
  return JSON.stringify({
    type: envelope.type || 'event',
    channels: Array.isArray(envelope.channels) ? envelope.channels : [],
    payload: envelope.payload !== undefined ? envelope.payload : null,
    at: envelope.at || new Date().toISOString(),
  });
}

function broadcastEnvelope(envelope = {}) {
  if (!wsServerInstance) return { delivered: 0 };

  const channels = Array.isArray(envelope.channels)
    ? envelope.channels.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  const serialized = serializeEnvelope({ ...envelope, channels });

  let delivered = 0;
  wsServerInstance.clients.forEach((socket) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!socketMatchesChannels(socket, channels)) return;
    try {
      socket.send(serialized);
      delivered += 1;
    } catch {
      // Ignore send failures; socket close will be handled by ws.
    }
  });

  return { delivered };
}

async function writeRelayEnvelope(envelope = {}) {
  if (!config.websocket.distributedEnabled) return;

  const firestore = await getFirestore();
  const retentionMs = Math.max(60000, Number(config.websocket.distributedRetentionMs || 180000));

  await firestore.collection(config.websocket.distributedCollection).doc(envelope.id).set({
    id: envelope.id,
    type: envelope.type,
    channels: envelope.channels,
    payload: envelope.payload,
    at: envelope.at,
    sourceInstance: envelope.sourceInstance,
    createdAtMs: envelope.createdAtMs,
    expiresAt: new Date(envelope.createdAtMs + retentionMs),
  });
}

async function cleanupRelayCollection(firestore) {
  const retentionMs = Math.max(60000, Number(config.websocket.distributedRetentionMs || 180000));
  const cutoff = Date.now() - retentionMs;

  const stale = await firestore
    .collection(config.websocket.distributedCollection)
    .where('createdAtMs', '<', cutoff)
    .orderBy('createdAtMs', 'asc')
    .limit(100)
    .get()
    .catch(() => null);

  if (!stale || stale.empty) return;

  const batch = firestore.batch();
  stale.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function pollRelayEvents() {
  if (!config.websocket.distributedEnabled || !wsServerInstance) return;

  const firestore = await getFirestore();
  const snap = await firestore
    .collection(config.websocket.distributedCollection)
    .where('createdAtMs', '>', relayLastSeenMs)
    .orderBy('createdAtMs', 'asc')
    .limit(100)
    .get();

  if (!snap.empty) {
    snap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const createdAtMs = Number(data.createdAtMs || 0);
      relayLastSeenMs = Math.max(relayLastSeenMs, createdAtMs);

      if (normalizeText(data.sourceInstance) === INSTANCE_ID) return;

      broadcastEnvelope({
        type: normalizeText(data.type) || 'event',
        channels: Array.isArray(data.channels) ? data.channels : [],
        payload: data.payload !== undefined ? data.payload : null,
        at: normalizeText(data.at) || new Date(createdAtMs || Date.now()).toISOString(),
      });
    });
  }

  relayTick += 1;
  if (relayTick % 60 === 0) {
    await cleanupRelayCollection(firestore).catch(() => null);
  }
}

function startRelayLoop() {
  if (!config.websocket.distributedEnabled || relayTimer) return;

  const pollMs = Math.max(250, Number(config.websocket.distributedPollMs || 1000));
  relayLastSeenMs = Date.now() - pollMs;

  relayTimer = setInterval(() => {
    pollRelayEvents().catch((error) => {
      logger.warn({ err: error?.message || String(error) }, 'WS relay poll failed');
    });
  }, pollMs);

  if (typeof relayTimer.unref === 'function') {
    relayTimer.unref();
  }

  logger.info(
    {
      instanceId: INSTANCE_ID,
      pollMs,
      collection: config.websocket.distributedCollection,
    },
    'WebSocket distributed relay enabled'
  );
}

function buildEnvelope(event = {}) {
  const channels = Array.isArray(event.channels)
    ? event.channels.map((value) => normalizeText(value)).filter(Boolean)
    : [];

  return {
    id: randomUUID(),
    type: normalizeText(event.type) || 'event',
    channels,
    payload: event.payload !== undefined ? event.payload : null,
    at: new Date().toISOString(),
    sourceInstance: INSTANCE_ID,
    createdAtMs: Date.now(),
  };
}

function publishWebsocketEvent(event = {}) {
  const envelope = buildEnvelope(event);
  const result = broadcastEnvelope(envelope);

  if (wsServerInstance && config.websocket.distributedEnabled) {
    writeRelayEnvelope(envelope).catch((error) => {
      logger.warn({ err: error?.message || String(error) }, 'WS relay publish failed');
    });
  }

  return result;
}

async function handleSocketMessage(socket, raw) {
  try {
    const text = raw.toString();
    if (text === 'ping') {
      socket.send('pong');
      return;
    }

    const parsed = JSON.parse(text);
    const messageType = normalizeText(parsed?.type).toLowerCase();
    const channels = Array.isArray(parsed?.channels) ? parsed.channels : [];

    if (messageType === 'subscribe') {
      const authContext = socketAuthContexts.get(socket) || {
        uid: '',
        role: '',
        userData: {},
        queryOrderToken: '',
      };

      const { allowed, rejected } = await filterAuthorizedChannels({
        channels,
        authContext,
        messageToken: normalizeText(parsed?.token || ''),
      });

      const total = subscribeSocket(socket, allowed);
      socket.send(JSON.stringify({
        type: 'subscribed',
        channels: Array.from(getSocketChannels(socket)),
        accepted: allowed,
        rejected,
        total,
      }));
      return;
    }

    if (messageType === 'unsubscribe') {
      const total = unsubscribeSocket(socket, channels);
      socket.send(JSON.stringify({
        type: 'unsubscribed',
        channels: Array.from(getSocketChannels(socket)),
        total,
      }));
    }
  } catch {
    // Ignore malformed frames.
  }
}

function attachWebSocket(httpServer) {
  if (!config.websocket.enabled) return null;

  const wss = new WebSocketServer({
    server: httpServer,
    path: config.websocket.path,
  });

  wss.on('connection', (socket, req) => {
    (async () => {
      const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
      const authContext = await buildAuthContext(req);
      socketAuthContexts.set(socket, authContext);

      const initialRequestedChannels = Array.from(parseInitialChannels(req.url));
      const { allowed, rejected } = await filterAuthorizedChannels({
        channels: initialRequestedChannels,
        authContext,
      });

      if (allowed.length > 0) {
        subscribeSocket(socket, allowed);
      }

      logger.info(
        {
          clientIp,
          uid: authContext.uid || 'anonymous',
          subscribed: allowed.length,
          rejected: rejected.length,
        },
        'WS client connected'
      );

      socket.send(JSON.stringify({
        type: 'welcome',
        message: 'ServiZephyr WS connected',
        channels: Array.from(getSocketChannels(socket)),
        rejectedChannels: rejected,
        at: new Date().toISOString(),
      }));

      socket.on('message', (raw) => {
        handleSocketMessage(socket, raw).catch(() => null);
      });

      socket.on('close', () => {
        clientSubscriptions.delete(socket);
        socketAuthContexts.delete(socket);
        logger.info({ clientIp, uid: authContext.uid || 'anonymous' }, 'WS client disconnected');
      });
    })().catch((error) => {
      logger.warn({ err: error?.message || String(error) }, 'WS connection init failed');
      try {
        socket.close(1008, 'Unauthorized');
      } catch {
        // Ignore
      }
    });
  });

  wsServerInstance = wss;
  startRelayLoop();

  logger.info(
    {
      path: config.websocket.path,
      distributedRelay: config.websocket.distributedEnabled,
    },
    'WebSocket server enabled'
  );
  return wss;
}

module.exports = {
  attachWebSocket,
  publishWebsocketEvent,
};
