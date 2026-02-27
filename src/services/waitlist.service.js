const { FieldValue, getFirestore } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

async function postWaitlistEntry(req) {
  const firestore = await getFirestore();
  const body = req.body || {};

  const name = String(body.name || '').trim();
  const businessName = String(body.businessName || '').trim();
  const phone = normalizePhone(body.phone);
  const email = String(body.email || '').trim();
  const address = String(body.address || '').trim();

  if (!name || !businessName || !phone || !address) {
    throw new HttpError(400, 'Name, Business Name, Phone, and Address are required.');
  }

  if (!/^\d{10}$/.test(phone)) {
    throw new HttpError(400, 'Invalid phone number format. Must be 10 digits.');
  }

  const waitlistRef = firestore.collection('waitlist_entries');
  const existing = await waitlistRef.where('phone', '==', phone).limit(1).get();
  if (!existing.empty) {
    throw new HttpError(409, 'This phone number is already on the waitlist.');
  }

  const newEntryRef = waitlistRef.doc();
  await newEntryRef.set({
    id: newEntryRef.id,
    name,
    businessName,
    phone,
    email: email || null,
    address,
    createdAt: FieldValue.serverTimestamp(),
    status: 'pending',
  });

  return {
    message: 'Successfully joined the waitlist!',
  };
}

module.exports = {
  postWaitlistEntry,
};
