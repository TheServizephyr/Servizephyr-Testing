'use client';

export const APP_NOTIFICATION_EVENT = 'servizephyr:notify';

export function emitAppNotification(payload) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(APP_NOTIFICATION_EVENT, { detail: payload }));
}

