'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/**
 * Updates the theme-color meta tag dynamically based on the current theme.
 * This ensures the PWA status bar color matches the app's theme.
 * 
 * Usage: Add <ThemeColorUpdater /> inside any ThemeProvider.
 */
export default function ThemeColorUpdater() {
    const { theme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // Wait for client-side mount + hydration before checking theme
    useEffect(() => {
        // Small delay to ensure next-themes has fully hydrated
        const timer = setTimeout(() => {
            setMounted(true);
        }, 100);
        return () => clearTimeout(timer);
    }, []);

    // Update theme-color meta tag dynamically based on current theme
    useEffect(() => {
        if (!mounted) return;

        // resolvedTheme is the actual computed theme (considers system preference)
        // theme might be 'system', so always prefer resolvedTheme
        const actualTheme = resolvedTheme || theme || 'light';
        const themeColor = actualTheme === 'dark' ? '#0a0a0a' : '#ffffff';

        console.log('[ThemeColor] Theme:', actualTheme, '-> Color:', themeColor);

        // Find existing theme-color meta tags and update them
        const metaTags = document.querySelectorAll('meta[name="theme-color"]');
        metaTags.forEach(tag => {
            tag.setAttribute('content', themeColor);
        });

        // If no meta tag exists, create one
        if (metaTags.length === 0) {
            const meta = document.createElement('meta');
            meta.name = 'theme-color';
            meta.content = themeColor;
            document.head.appendChild(meta);
        }
    }, [mounted, theme, resolvedTheme]);

    return null; // This component doesn't render anything
}
