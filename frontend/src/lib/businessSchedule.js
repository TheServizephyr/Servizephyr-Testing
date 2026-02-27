const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const formatterCache = new Map();
const timezoneMinutesCache = new Map();
const TIMEZONE_CACHE_MS = 15000;

function getFormatter(timeZone) {
    if (formatterCache.has(timeZone)) {
        return formatterCache.get(timeZone);
    }

    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    formatterCache.set(timeZone, formatter);
    return formatter;
}

export function parseHHMMToMinutes(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours * 60 + minutes;
}

export function getMinutesInTimezone(timeZone = DEFAULT_TIMEZONE) {
    const nowTs = Date.now();
    const cached = timezoneMinutesCache.get(timeZone);
    if (cached && (nowTs - cached.at) < TIMEZONE_CACHE_MS) {
        return cached.minutes;
    }

    const parts = getFormatter(timeZone).formatToParts(new Date(nowTs));

    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    const minutes = hour * 60 + minute;
    timezoneMinutesCache.set(timeZone, { at: nowTs, minutes });
    return minutes;
}

export function shouldBusinessBeOpen(openingMinutes, closingMinutes, nowMinutes) {
    // Same open and close means 24x7 open.
    if (openingMinutes === closingMinutes) return true;

    // Same-day window, e.g. 09:00 -> 22:00.
    if (openingMinutes < closingMinutes) {
        return nowMinutes >= openingMinutes && nowMinutes < closingMinutes;
    }

    // Overnight window, e.g. 18:00 -> 02:00.
    return nowMinutes >= openingMinutes || nowMinutes < closingMinutes;
}

export function resolveAutoScheduleState(businessData = {}) {
    if (businessData.autoScheduleEnabled !== true) {
        return { enabled: false, valid: false, nextIsOpen: null, timezone: null };
    }

    const openingMinutes = parseHHMMToMinutes(businessData.openingTime);
    const closingMinutes = parseHHMMToMinutes(businessData.closingTime);
    if (openingMinutes === null || closingMinutes === null) {
        return { enabled: true, valid: false, nextIsOpen: null, timezone: null };
    }

    const timezone = businessData.timeZone || businessData.timezone || DEFAULT_TIMEZONE;
    let nowMinutes;
    try {
        nowMinutes = getMinutesInTimezone(timezone);
    } catch (_) {
        nowMinutes = getMinutesInTimezone(DEFAULT_TIMEZONE);
    }

    return {
        enabled: true,
        valid: true,
        timezone,
        openingMinutes,
        closingMinutes,
        nowMinutes,
        nextIsOpen: shouldBusinessBeOpen(openingMinutes, closingMinutes, nowMinutes)
    };
}

export function getEffectiveBusinessOpenStatus(businessData = {}) {
    const scheduleState = resolveAutoScheduleState(businessData);
    if (scheduleState.valid) {
        return scheduleState.nextIsOpen;
    }
    return businessData?.isOpen !== false;
}

export { DEFAULT_TIMEZONE };
