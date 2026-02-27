'use client';

import { Mail, Phone, MapPin, Users, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative container mx-auto max-w-5xl px-4 py-12 sm:py-20">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Let&apos;s Connect</span>
          </div>
          <h1 className="font-headline text-5xl sm:text-6xl font-bold tracking-tighter mb-4 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Get in Touch
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Have questions or want to partner with us? We&apos;re here to help elevate your restaurant experience.
          </p>
        </motion.div>

        {/* Main Contact Cards Grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Email Card */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="group relative bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-6 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className="flex items-start gap-4">
              <div className="bg-gradient-to-br from-primary/20 to-primary/10 p-3 rounded-xl group-hover:scale-110 transition-transform">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold mb-2">Email Us</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  For inquiries, support, or partnerships
                </p>
                <a
                  href="mailto:contact@servizephyr.com"
                  className="inline-flex items-center text-primary font-semibold hover:underline group-hover:gap-2 transition-all"
                >
                  contact@servizephyr.com
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </a>
              </div>
            </div>
          </motion.div>

          {/* Phone Card */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="group relative bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-6 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className="flex items-start gap-4">
              <div className="bg-gradient-to-br from-green-500/20 to-green-500/10 p-3 rounded-xl group-hover:scale-110 transition-transform">
                <Phone className="h-6 w-6 text-green-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold mb-2">Call or WhatsApp</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Available for quick assistance
                </p>
                <a
                  href="tel:+919027872803"
                  className="inline-flex items-center text-green-500 font-semibold hover:underline group-hover:gap-2 transition-all"
                >
                  +91 90278 72803
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </a>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Address Card - Full Width */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="group bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-6 mb-8 hover:border-primary/50 transition-all duration-300"
        >
          <div className="flex items-start gap-4">
            <div className="bg-gradient-to-br from-blue-500/20 to-blue-500/10 p-3 rounded-xl group-hover:scale-110 transition-transform">
              <MapPin className="h-6 w-6 text-blue-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold mb-2">Our Address</h3>
              <p className="text-muted-foreground leading-relaxed">
                Shivam Vihar Colony, Muradnagar<br />
                Ghaziabad, Uttar Pradesh 201206<br />
                India
              </p>
            </div>
          </div>
        </motion.div>

        {/* Founders Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-2xl p-8 backdrop-blur-sm"
        >
          <div className="flex items-center justify-center gap-2 mb-6">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="text-2xl font-bold text-center">Meet the Founders</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Founder 1 */}
            <div className="text-center group">
              <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center text-3xl font-bold text-primary-foreground group-hover:scale-110 transition-transform">
                AB
              </div>
              <h3 className="text-xl font-bold mb-1">Ashwani Baghel</h3>
              <p className="text-sm text-primary font-medium">Co-Founder & CEO</p>
            </div>

            {/* Founder 2 */}
            <div className="text-center group">
              <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-500 to-blue-500/50 flex items-center justify-center text-3xl font-bold text-white group-hover:scale-110 transition-transform">
                UP
              </div>
              <h3 className="text-xl font-bold mb-1">Utkarsh Patel</h3>
              <p className="text-sm text-blue-500 font-medium">Co-Founder & CTO</p>
            </div>
          </div>
          <p className="text-center text-muted-foreground mt-6 max-w-2xl mx-auto">
            Together, we&apos;re building the future of restaurant management with cutting-edge AI technology and seamless automation.
          </p>
        </motion.div>

        {/* Footer Note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center text-sm text-muted-foreground mt-12"
        >
          ServiZephyr © 2025 · Built with ❤️ in India
        </motion.p>
      </div>
    </div>
  );
}
