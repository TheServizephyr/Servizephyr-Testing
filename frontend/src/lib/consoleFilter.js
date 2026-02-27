// Console Warning Suppressor - Filters out noisy development warnings
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    const originalWarn = console.warn;
    const originalError = console.error;

    // Suppress specific warning patterns
    const suppressPatterns = [
        'legacy prop',
        'has "fill" but is missing "sizes" prop',
        'priority property',
        'Did you forget to run the codemod',
        'Google Maps JavaScript API',
        'React DevTools',
        'Largest Contentful Paint',
    ];

    console.warn = function (...args) {
        const message = args.join(' ');
        // Check if message matches any suppress pattern
        if (suppressPatterns.some(pattern => message.includes(pattern))) {
            return; // Suppress this warning
        }
        originalWarn.apply(console, args);
    };

    console.error = function (...args) {
        const message = args.join(' ');
        // Check if message matches any suppress pattern
        if (suppressPatterns.some(pattern => message.includes(pattern))) {
            return; // Suppress this error
        }
        originalError.apply(console, args);
    };
}
