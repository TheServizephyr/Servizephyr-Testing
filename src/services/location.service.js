const { config } = require('../config/env');
const { HttpError } = require('../utils/httpError');

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requireGoogleMapsApiKey() {
  const apiKey = String(config.googleMapsApiKey || '').trim();
  if (!apiKey) {
    throw new HttpError(500, 'Geocoding/Search service is not configured on the server.');
  }
  return apiKey;
}

function getAddressComponent(components = [], type, preferShort = false) {
  const component = components.find((c) => Array.isArray(c?.types) && c.types.includes(type));
  if (!component) return '';
  return preferShort ? component.short_name || '' : component.long_name || '';
}

async function getReverseGeocode(req) {
  const apiKey = requireGoogleMapsApiKey();
  const lat = String(req.query?.lat || '').trim();
  const lng = String(req.query?.lng || '').trim();

  if (!lat || !lng) {
    throw new HttpError(400, 'Latitude and longitude are required.');
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
    const addr = data.results[0] || {};
    const components = Array.isArray(addr.address_components) ? addr.address_components : [];

    return {
      street: getAddressComponent(components, 'route') || getAddressComponent(components, 'sublocality_level_1') || '',
      city: getAddressComponent(components, 'locality') || getAddressComponent(components, 'administrative_area_level_2'),
      state: getAddressComponent(components, 'administrative_area_level_1'),
      pincode: getAddressComponent(components, 'postal_code'),
      country: getAddressComponent(components, 'country', true),
      formatted_address: addr.formatted_address || 'Address not found',
    };
  }

  const errorMessage = data.error_message || `Google Maps returned status ${data.status || response.status}`;
  throw new HttpError(response.status || 502, errorMessage);
}

async function getSearchLocations(req) {
  const apiKey = requireGoogleMapsApiKey();
  const query = String(req.query?.query || '').trim();

  if (!query) {
    throw new HttpError(400, 'Search query is required.');
  }

  const autocompleteUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&components=country:in`;
  const response = await fetch(autocompleteUrl);
  const data = await response.json().catch(() => ({}));

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    const errorMessage = data.error_message || `Google Maps returned status ${data.status || response.status}`;
    throw new HttpError(response.status || 502, errorMessage);
  }

  const firstPredictionDescription = data?.predictions?.[0]?.description || '';

  const suggestionPromises = (Array.isArray(data.predictions) ? data.predictions : []).map(async (prediction) => {
    try {
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=geometry,name,formatted_address&key=${apiKey}`;
      const detailsRes = await fetch(detailsUrl);
      const detailsData = await detailsRes.json().catch(() => ({}));

      if (detailsData.status !== 'OK') return null;

      return {
        placeName: prediction?.structured_formatting?.main_text || prediction?.description || '',
        placeAddress: prediction?.structured_formatting?.secondary_text || detailsData?.result?.formatted_address || '',
        latitude: detailsData?.result?.geometry?.location?.lat,
        longitude: detailsData?.result?.geometry?.location?.lng,
        eLoc: prediction.place_id,
      };
    } catch {
      return null;
    }
  });

  let suggestedLocations = (await Promise.all(suggestionPromises)).filter(Boolean);

  if (suggestedLocations.length === 0) {
    try {
      const geocodeInput = firstPredictionDescription || query;
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(geocodeInput)}&region=in&key=${apiKey}`;
      const geocodeRes = await fetch(geocodeUrl);
      const geocodeData = await geocodeRes.json().catch(() => ({}));

      if (geocodeData.status === 'OK' && Array.isArray(geocodeData.results) && geocodeData.results.length > 0) {
        const first = geocodeData.results[0] || {};
        const lat = first?.geometry?.location?.lat;
        const lng = first?.geometry?.location?.lng;

        if (typeof lat === 'number' && typeof lng === 'number') {
          suggestedLocations = [
            {
              placeName: first.formatted_address?.split(',')?.[0] || query,
              placeAddress: first.formatted_address || query,
              latitude: lat,
              longitude: lng,
              eLoc: `geocode_${lat}_${lng}`,
            },
          ];
        }
      }
    } catch {
      // Keep endpoint resilient; empty array is still valid for caller UX.
    }
  }

  return suggestedLocations;
}

function normalizeIp(rawIp = '') {
  const ip = String(rawIp || '').trim();
  if (!ip) return '';
  const first = ip.split(',')[0].trim();
  return first.replace(/^::ffff:/, '');
}

function parseIpProviderResult(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const lat = toFiniteNumber(payload.latitude ?? payload.lat);
  const lng = toFiniteNumber(payload.longitude ?? payload.lon ?? payload.lng);
  if (lat === null || lng === null) return null;

  return {
    lat,
    lng,
    city: payload.city || '',
    region: payload.region || payload.regionName || '',
    country: payload.country_name || payload.country || '',
  };
}

async function getIpLocation(req) {
  const headerLat = toFiniteNumber(req.headers['x-vercel-ip-latitude']);
  const headerLng = toFiniteNumber(req.headers['x-vercel-ip-longitude']);
  if (headerLat !== null && headerLng !== null) {
    return {
      lat: headerLat,
      lng: headerLng,
      city: String(req.headers['x-vercel-ip-city'] || ''),
      region: String(req.headers['x-vercel-ip-country-region'] || ''),
      country: String(req.headers['x-vercel-ip-country'] || ''),
      source: 'vercel_headers',
    };
  }

  const ipFromHeader = normalizeIp(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '');
  const providers = [
    ipFromHeader
      ? `https://ipapi.co/${encodeURIComponent(ipFromHeader)}/json/`
      : 'https://ipapi.co/json/',
    ipFromHeader
      ? `https://ipwho.is/${encodeURIComponent(ipFromHeader)}`
      : 'https://ipwho.is/',
  ];

  for (const url of providers) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;

      const data = await res.json().catch(() => null);
      const parsed = parseIpProviderResult(data);
      if (!parsed) continue;

      return {
        ...parsed,
        source: url.includes('ipapi.co') ? 'ipapi' : 'ipwhois',
      };
    } catch {
      // Try next provider
    }
  }

  throw new HttpError(404, 'Unable to resolve IP location.');
}

module.exports = {
  getReverseGeocode,
  getSearchLocations,
  getIpLocation,
};
