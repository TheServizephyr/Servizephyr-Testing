function normalizePhone(phone) {
  const raw = String(phone || '').replace(/\D/g, '');
  if (!raw) return '';
  if (raw.startsWith('91') && raw.length === 12) return raw.slice(2);
  if (raw.length > 10) return raw.slice(-10);
  return raw;
}

function deobfuscateGuestId(publicRef) {
  try {
    if (!publicRef || publicRef.length < 5) return null;
    const encodedRaw = String(publicRef).substring(4);
    const paddingNeeded = (4 - (encodedRaw.length % 4)) % 4;
    const encoded = `${encodedRaw}${'='.repeat(paddingNeeded)}`;
    const saltedId = Buffer.from(encoded, 'base64').toString('utf-8');

    let guestId = '';
    for (let i = 0; i < saltedId.length; i += 1) {
      if ((i + 1) % 4 !== 0) guestId += saltedId[i];
    }
    return guestId || null;
  } catch {
    return null;
  }
}

function obfuscateGuestId(guestId) {
  if (!guestId) return null;

  const noiseChars = 'XpOr9LaZwQ';
  let saltedId = '';
  const chars = String(guestId).split('');

  chars.forEach((char, index) => {
    saltedId += char;
    if ((index + 1) % 3 === 0) {
      saltedId += noiseChars[Math.floor(Math.random() * noiseChars.length)];
    }
  });

  const encoded = Buffer.from(saltedId).toString('base64').replace(/=/g, '');
  const prefix = Math.random().toString(36).slice(2, 6).padEnd(4, 'x').slice(0, 4);
  return `${prefix}${encoded}`;
}

function toDateSafe(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

module.exports = {
  normalizePhone,
  obfuscateGuestId,
  deobfuscateGuestId,
  toDateSafe,
};
