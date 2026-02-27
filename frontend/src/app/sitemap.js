export default function sitemap() {
    const baseUrl = 'https://servizephyr.com';

    // Core static routes
    const routes = [
        '',
        '/about',
        '/contact',
        '/privacy',
        '/terms-and-conditions',
        '/join',
    ].map((route) => ({
        url: `${baseUrl}${route}`,
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: route === '' ? 1 : 0.8,
    }));

    return [...routes];
}
