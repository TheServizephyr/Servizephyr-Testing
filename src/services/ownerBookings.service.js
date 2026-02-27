const { FieldValue, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');
const { resolveOwnerContext, PERMISSIONS } = require('./accessControl.service');

function toComparableDate(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  return parsed.getTime();
}

function mapBooking(doc) {
  return {
    id: doc.id,
    ...(doc.data() || {}),
  };
}

async function getOwnerBookings(req) {
  const owner = await resolveOwnerContext(req, {
    requiredPermissions: [PERMISSIONS.VIEW_DINE_IN_ORDERS, PERMISSIONS.MANAGE_DINE_IN],
  });

  const bookingsRef = owner.businessSnap.ref.collection('bookings');
  let snap;
  try {
    snap = await bookingsRef.orderBy('bookingDateTime', 'desc').get();
  } catch {
    const fallback = await bookingsRef.get();
    const docs = [...fallback.docs].sort(
      (a, b) => toComparableDate(b.data()?.bookingDateTime) - toComparableDate(a.data()?.bookingDateTime)
    );
    return { bookings: docs.map(mapBooking) };
  }

  return {
    bookings: snap.docs.map(mapBooking),
  };
}

async function postPublicBooking(body = {}) {
  const firestore = await getFirestore();
  const restaurantId = String(body.restaurantId || '').trim();
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const guests = body.guests;
  const bookingDateTime = body.bookingDateTime;

  if (!restaurantId || !name || !phone || !guests || !bookingDateTime) {
    throw new HttpError(400, 'Missing required booking data.');
  }

  const businessRef = firestore.collection('restaurants').doc(restaurantId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) {
    throw new HttpError(404, `Business with ID ${restaurantId} not found.`);
  }

  const bookingRef = businessRef.collection('bookings').doc();
  await bookingRef.set({
    id: bookingRef.id,
    customerName: name,
    customerPhone: phone,
    partySize: guests,
    bookingDateTime: new Date(bookingDateTime),
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    notes: '',
  });

  return {
    message: 'Booking request sent successfully!',
    id: bookingRef.id,
  };
}

async function patchOwnerBooking(req, body = {}) {
  const owner = await resolveOwnerContext(req, {
    checkRevoked: true,
    requiredPermissions: [PERMISSIONS.MANAGE_DINE_IN],
  });

  const bookingId = String(body.bookingId || '').trim();
  const status = String(body.status || '').trim().toLowerCase();
  if (!bookingId || !status) {
    throw new HttpError(400, 'Booking ID and new status are required.');
  }

  const validStatuses = new Set(['pending', 'confirmed', 'cancelled', 'completed']);
  if (!validStatuses.has(status)) {
    throw new HttpError(400, 'Invalid status provided.');
  }

  const bookingRef = owner.businessSnap.ref.collection('bookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) {
    throw new HttpError(404, 'Booking not found.');
  }

  await bookingRef.update({
    status,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    message: `Booking marked as ${status}.`,
  };
}

module.exports = {
  getOwnerBookings,
  postPublicBooking,
  patchOwnerBooking,
};
