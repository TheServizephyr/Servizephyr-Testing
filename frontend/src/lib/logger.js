/**
 * STRUCTURED LOGGER
 * 
 * JSON-formatted logging for production observability.
 * Compatible with Vercel logs, Datadog, Loki, etc.
 * 
 * Phase 5 Stage 4.3
 */

export const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

/**
 * Core logging function
 * Outputs structured JSON logs with optional correlationId for distributed tracing
 * 
 * PRODUCTION: Only ERROR logs are shown
 * DEVELOPMENT: All logs are shown
 */
export function log(level, message, context = {}) {
    const isDevelopment = process.env.NODE_ENV !== 'production';

    // In production, only log errors
    if (!isDevelopment && level !== LOG_LEVELS.ERROR) {
        return; // Silent in production for non-errors
    }

    const logEntry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...context
    };

    // Add correlationId for distributed tracing (auto-extracted from context)
    // Enables tracing: webhook → order → notification flow
    if (context.correlationId || context.orderId || context.eventId) {
        logEntry.correlationId = context.correlationId || context.orderId || context.eventId;
    }

    // Output as JSON for searchability
    const output = JSON.stringify(logEntry);

    // Use appropriate console method
    switch (level) {
        case LOG_LEVELS.DEBUG:
            console.debug(output);
            break;
        case LOG_LEVELS.INFO:
            console.info(output);
            break;
        case LOG_LEVELS.WARN:
            console.warn(output);
            break;
        case LOG_LEVELS.ERROR:
            console.error(output);
            break;
        default:
            console.log(output);
    }
}

/**
 * Logger convenience methods
 */
export const logger = {
    /**
     * Debug-level logging (verbose)
     */
    debug: (message, context = {}) => {
        log(LOG_LEVELS.DEBUG, message, context);
    },

    /**
     * Info-level logging (normal operations)
     */
    info: (message, context = {}) => {
        log(LOG_LEVELS.INFO, message, context);
    },

    /**
     * Warning-level logging (concerning but not critical)
     */
    warn: (message, context = {}) => {
        log(LOG_LEVELS.WARN, message, context);
    },

    /**
     * Error-level logging (critical issues)
     */
    error: (message, context = {}) => {
        log(LOG_LEVELS.ERROR, message, context);
    }
};

/**
 * Example usage:
 * 
 * // Simple log
 * logger.info('Order created', {
 *   orderId: 'xyz123',
 *   paymentMethod: 'razorpay',
 *   amount: 100,
 *   userId: 'user123'
 * });
 * 
 * // With correlationId (for tracing across services)
 * logger.info('Webhook processed', {
 *   eventId: 'evt_abc123',
 *   orderId: 'xyz123',
 *   gateway: 'razorpay',
 *   correlationId: 'evt_abc123' // Enables distributed tracing
 * });
 * 
 * Output:
 * {
 *   "level": "info",
 *   "message": "Webhook processed",
 *   "timestamp": "2026-01-08T06:00:00.000Z",
 *   "eventId": "evt_abc123",
 *   "orderId": "xyz123",
 *   "gateway": "razorpay",
 *   "correlationId": "evt_abc123"
 * }
 */
