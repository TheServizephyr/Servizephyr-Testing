const { z } = require('zod');
const { getFirestore, FieldValue, verifyIdToken } = require('../lib/firebaseAdmin');
const { HttpError } = require('../utils/httpError');

const MENU_ITEM_SCHEMA = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  categoryTitle: z.string().optional(),
  isVeg: z.boolean().optional(),
  portions: z.array(z.object({
    name: z.string().min(1),
    price: z.number(),
  })).min(1),
  tags: z.array(z.string()).optional(),
});

const MENU_SCAN_SCHEMA = z.object({
  items: z.array(MENU_ITEM_SCHEMA).min(1),
});

function extractBearer(req) {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Authorization token missing or malformed.');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError(401, 'Authorization token missing or malformed.');
  }
  return token;
}

async function resolveVendorForUser(req) {
  const idToken = extractBearer(req);
  let decoded;
  try {
    decoded = await verifyIdToken(idToken, true);
  } catch {
    throw new HttpError(401, 'Token verification failed.');
  }

  const uid = String(decoded?.uid || '').trim();
  if (!uid) {
    throw new HttpError(401, 'Invalid token.');
  }

  const firestore = await getFirestore();
  const userDoc = await firestore.collection('users').doc(uid).get();
  const userData = userDoc.exists ? (userDoc.data() || {}) : {};
  const role = String(userData.role || '').trim().toLowerCase();

  const impersonatedOwnerId = String(req.query.impersonate_owner_id || '').trim();
  const targetOwnerId = role === 'admin' && impersonatedOwnerId ? impersonatedOwnerId : uid;

  const vendorSnap = await firestore
    .collection('street_vendors')
    .where('ownerId', '==', targetOwnerId)
    .limit(1)
    .get();

  if (vendorSnap.empty) {
    throw new HttpError(404, 'No street vendor profile found for this user.');
  }

  return {
    firestore,
    vendorId: vendorSnap.docs[0].id,
    vendorRef: vendorSnap.docs[0].ref,
  };
}

function parseDataUri(dataUri) {
  const raw = String(dataUri || '').trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new HttpError(400, 'Invalid imageDataUri format. Expected base64 data URI.');
  }
  return {
    mimeType: match[1],
    base64Data: match[2],
  };
}

function getGeminiConfig() {
  const apiKey = String(
    process.env.GEMINI_API_KEY
    || process.env.GOOGLE_GENAI_API_KEY
    || process.env.GOOGLE_API_KEY
    || ''
  ).trim();
  if (!apiKey) {
    throw new HttpError(500, 'Gemini API key is not configured.');
  }

  const model = String(process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest').trim();
  return { apiKey, model };
}

function normalizeCategoryId(value) {
  const safe = String(value || '').trim().toLowerCase();
  if (!safe) return 'general';
  return safe
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'general';
}

function normalizeCategoryTitle(value, categoryId) {
  const text = String(value || '').trim();
  if (text) return text.slice(0, 60);
  if (!categoryId || categoryId === 'general') return 'General';
  return categoryId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .slice(0, 60);
}

function normalizeScannedItems(items = []) {
  return items.map((item) => {
    const categoryId = normalizeCategoryId(item.categoryId);
    const portions = Array.isArray(item.portions) && item.portions.length > 0
      ? item.portions.map((portion) => ({
        name: String(portion.name || 'Full').trim() || 'Full',
        price: Number.isFinite(Number(portion.price)) ? Number(portion.price) : 0,
      }))
      : [{ name: 'Full', price: 0 }];

    return {
      name: String(item.name || '').trim(),
      description: String(item.description || '').trim(),
      categoryId,
      categoryTitle: normalizeCategoryTitle(item.categoryTitle, categoryId),
      isVeg: item.isVeg !== false,
      portions,
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
    };
  }).filter((item) => item.name && item.portions.length > 0);
}

function extractJsonTextFromGemini(payload = {}) {
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n').trim();
  if (!text) {
    throw new HttpError(502, 'Gemini returned an empty response.');
  }

  // Strip markdown code fences if model wraps JSON.
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  return fencedMatch ? fencedMatch[1].trim() : text;
}

async function callGeminiForMenu({ imageDataUri }) {
  const { apiKey, model } = getGeminiConfig();
  const { mimeType, base64Data } = parseDataUri(imageDataUri);

  const prompt = [
    'You are an expert menu digitizer for Indian street food vendors.',
    'Extract menu items from this image and return strict JSON only.',
    'Response schema:',
    '{"items":[{"name":"string","description":"string","categoryId":"lowercase-dash","categoryTitle":"string","isVeg":true,"portions":[{"name":"Full","price":120}],"tags":["optional"]}]}',
    'Rules:',
    '- Include all main items visible in the menu.',
    '- If only one price exists, use one portion named "Full".',
    '- Infer isVeg=false for chicken/mutton/egg/fish etc, otherwise true.',
    '- Keep categoryTitle as shown in menu when visible.',
    '- Do not include extra commentary or markdown.',
  ].join('\n');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || 'Gemini request failed.';
    throw new HttpError(response.status || 502, message);
  }

  const jsonText = extractJsonTextFromGemini(payload);
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new HttpError(502, 'Gemini response was not valid JSON.');
  }

  const validated = MENU_SCAN_SCHEMA.safeParse(parsed);
  if (!validated.success) {
    throw new HttpError(502, 'Gemini response shape invalid for menu scan.');
  }

  return normalizeScannedItems(validated.data.items);
}

async function ensureCategories({ vendorRef, batch, items }) {
  const existingSnap = await vendorRef.collection('custom_categories').get();
  const existing = {};
  existingSnap.docs.forEach((doc) => {
    existing[doc.id] = doc.data() || {};
  });

  const newCategoryIds = Array.from(new Set(
    items.map((item) => item.categoryId).filter((id) => id && id !== 'general' && !existing[id])
  ));

  if (newCategoryIds.length === 0) return;

  const maxOrderSnap = await vendorRef
    .collection('custom_categories')
    .orderBy('order', 'desc')
    .limit(1)
    .get();
  let maxOrder = maxOrderSnap.empty ? 0 : Number(maxOrderSnap.docs[0].data()?.order || 0);

  newCategoryIds.forEach((categoryId) => {
    const categoryTitle = items.find((item) => item.categoryId === categoryId)?.categoryTitle
      || normalizeCategoryTitle('', categoryId);
    maxOrder += 1;
    batch.set(vendorRef.collection('custom_categories').doc(categoryId), {
      id: categoryId,
      title: categoryTitle,
      order: maxOrder,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function saveScannedItems({ firestore, vendorRef, items }) {
  const batch = firestore.batch();
  await ensureCategories({ vendorRef, batch, items });

  const menuCollectionRef = vendorRef.collection('menu');
  items.forEach((item) => {
    const itemRef = menuCollectionRef.doc();
    batch.set(itemRef, {
      id: itemRef.id,
      name: item.name,
      description: item.description || '',
      categoryId: item.categoryId || 'general',
      isVeg: item.isVeg !== false,
      portions: item.portions,
      tags: item.tags || [],
      isAvailable: true,
      order: 999,
    });
  });

  await batch.commit();
}

async function scanMenuFromImage(req, body = {}) {
  const imageDataUri = String(body.imageDataUri || '').trim();
  if (!imageDataUri) {
    throw new HttpError(400, 'Image data is required.');
  }

  const { firestore, vendorRef } = await resolveVendorForUser(req);
  const items = await callGeminiForMenu({ imageDataUri });
  if (!items.length) {
    throw new HttpError(400, 'AI could not detect any menu items. Please try a clearer image.');
  }

  await saveScannedItems({ firestore, vendorRef, items });

  return {
    message: `Successfully scanned and added ${items.length} items to your menu!`,
    itemsAdded: items.length,
  };
}

module.exports = {
  scanMenuFromImage,
};
