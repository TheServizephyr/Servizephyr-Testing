/**
 * Frontend Console Logger
 * Logs only in development, silent in production
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

export const consoleLog = (...args) => {
    if (isDevelopment) {
        console.log(...args);
    }
};

export const consoleWarn = (...args) => {
    if (isDevelopment) {
        console.warn(...args);
    }
};

export const consoleError = (...args) => {
    // Always log errors
    console.error(...args);
};

// Export as default for easy import
export default {
    log: consoleLog,
    warn: consoleWarn,
    error: consoleError,
};
