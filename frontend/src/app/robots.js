export default function robots() {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: [
                '/admin-dashboard/',
                '/owner-dashboard/',
                '/rider-dashboard/',
                '/customer-dashboard/',
                '/employee-dashboard/',
                '/street-vendor-dashboard/',
                '/api/',
            ],
        },
        sitemap: 'https://servizephyr.com/sitemap.xml',
    };
}
