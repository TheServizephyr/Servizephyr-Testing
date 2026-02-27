function isClientRuntime() {
    return typeof window !== 'undefined';
}

export function sendClientTelemetryEvent(event, payload = {}) {
    if (!isClientRuntime()) return;
    if (!event) return;

    const body = JSON.stringify({
        event,
        ...payload,
        path: window.location?.pathname || '',
        at: Date.now(),
    });

    try {
        if (navigator?.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon('/api/telemetry/client-event', blob);
            return;
        }
    } catch {
        // Fallback to fetch below.
    }

    fetch('/api/telemetry/client-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
    }).catch(() => {
        // Best-effort only.
    });
}
