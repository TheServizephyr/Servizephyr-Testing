'use client';

import { Target, Zap, Shield, TrendingUp, Heart, Linkedin, Twitter, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import Image from 'next/image';

export default function AboutPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 relative overflow-hidden">
            {/* Animated background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-pulse" />
                <div className="absolute bottom-20 right-10 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse delay-1000" />
            </div>

            <div className="relative container mx-auto max-w-6xl px-4 py-12 sm:py-20">
                {/* Hero Section */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center mb-16"
                >
                    <h1 className="font-headline text-5xl sm:text-6xl font-bold tracking-tighter mb-6 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                        About ServiZephyr
                    </h1>
                    <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
                        Empowering restaurants with cutting-edge technology to deliver exceptional dining experiences
                    </p>
                </motion.div>

                {/* Vision Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-2xl p-8 backdrop-blur-sm mb-12"
                >
                    <div className="flex items-center gap-3 mb-6">
                        <Target className="h-8 w-8 text-primary" />
                        <h2 className="text-3xl font-bold">Our Vision</h2>
                    </div>
                    <p className="text-lg text-muted-foreground leading-relaxed">
                        Our mission is to provide the restaurant industry with a digital ecosystem that doesn&apos;t just process orders, but transforms the entire dining experience. We&apos;re combining cutting-edge technology with simplicity to boost both efficiency and sales for restaurants of all sizes.
                    </p>
                </motion.div>

                {/* What We Offer Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mb-12"
                >
                    <h2 className="text-3xl font-bold text-center mb-10">What We Offer: Complete Restaurant Management</h2>
                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Feature Card 1 */}
                        <div className="group bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-6 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5">
                            <div className="flex items-start gap-4">
                                <div className="bg-gradient-to-br from-green-500/20 to-green-500/10 p-3 rounded-xl group-hover:scale-110 transition-transform">
                                    <Zap className="h-6 w-6 text-green-500" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-bold mb-2">WhatsApp-Powered Ordering</h3>
                                    <p className="text-muted-foreground">
                                        Customers can order directly via WhatsApp without downloading any app. Seamless, familiar, and instant ordering experience.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Feature Card 2 */}
                        <div className="group bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-6 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5">
                            <div className="flex items-start gap-4">
                                <div className="bg-gradient-to-br from-blue-500/20 to-blue-500/10 p-3 rounded-xl group-hover:scale-110 transition-transform">
                                    <TrendingUp className="h-6 w-6 text-blue-500" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-bold mb-2">Real-time Management Dashboards</h3>
                                    <p className="text-muted-foreground">
                                        Powerful dashboards for owners and admins to track orders, manage inventory, and analyze performance metrics in real-time.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Feature Card 3 */}
                        <div className="group bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-6 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5">
                            <div className="flex items-start gap-4">
                                <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/10 p-3 rounded-xl group-hover:scale-110 transition-transform">
                                    <Shield className="h-6 w-6 text-purple-500" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-bold mb-2">Secure Payment Integration</h3>
                                    <p className="text-muted-foreground">
                                        Integrated with Razorpay for secure, effortless transactions. Multiple payment options including UPI, cards, and wallets.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Feature Card 4 */}
                        <div className="group bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-6 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5">
                            <div className="flex items-start gap-4">
                                <div className="bg-gradient-to-br from-orange-500/20 to-orange-500/10 p-3 rounded-xl group-hover:scale-110 transition-transform">
                                    <Heart className="h-6 w-6 text-orange-500" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-bold mb-2">Scalable Solutions</h3>
                                    <p className="text-muted-foreground">
                                        Built with both small cafes and large restaurant chains in mind. Our platform scales with your business growth.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Leadership Team Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="mb-12"
                >
                    <h2 className="text-3xl font-bold text-center mb-10">The Leadership Team</h2>
                    <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                        {/* Founder 1 - Ashwani Baghel */}
                        <div className="group bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-8 hover:border-primary/50 transition-all duration-300 hover:shadow-xl">
                            <div className="flex flex-col items-center text-center">
                                {/* Photo Placeholder */}
                                <div className="relative w-32 h-32 mb-6">
                                    <div className="w-full h-full rounded-full bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center text-5xl font-bold text-primary-foreground group-hover:scale-110 transition-transform shadow-lg">
                                        AB
                                    </div>
                                    {/* Optional: Uncomment when you have actual photos */}
                                    {/* <Image 
                    src="/team/ashwani-baghel.jpg"
                    alt="Ashwani Baghel"
                    fill
                    className="rounded-full object-cover"
                  /> */}
                                </div>

                                <h3 className="text-2xl font-bold mb-1">Ashwani Baghel</h3>
                                <p className="text-primary font-semibold mb-4">Co-Founder & CEO</p>

                                <p className="text-muted-foreground leading-relaxed mb-6">
                                    Ashwani leads ServiZephyr&apos;s Technical Architecture and Marketing Strategy. He oversees everything from product development to market positioning, ensuring the software remains scalable, fast, and aligned with modern industry standards.
                                </p>

                                {/* Social Links Placeholder */}
                                <div className="flex gap-4">
                                    <a href="https://www.linkedin.com/in/ashwani-baghel" className="p-2 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors">
                                        <Linkedin className="h-5 w-5 text-primary" />
                                    </a>
                                    <a href="https://x.com/BaghelAshw76944" className="p-2 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors">
                                        <Twitter className="h-5 w-5 text-primary" />
                                    </a>
                                    <a href="mailto:ashwanibaghel@servizephyr.com" className="p-2 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors">
                                        <Mail className="h-5 w-5 text-primary" />
                                    </a>
                                </div>
                            </div>
                        </div>

                        {/* Co-Founder - Utkarsh Patel */}
                        <div className="group bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-8 hover:border-primary/50 transition-all duration-300 hover:shadow-xl">
                            <div className="flex flex-col items-center text-center">
                                {/* Photo Placeholder */}
                                <div className="relative w-32 h-32 mb-6">
                                    <div className="w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-blue-500/50 flex items-center justify-center text-5xl font-bold text-white group-hover:scale-110 transition-transform shadow-lg">
                                        UP
                                    </div>
                                    {/* Optional: Uncomment when you have actual photos */}
                                    {/* <Image 
                    src="/team/utkarsh-patel.jpg"
                    alt="Utkarsh Patel"
                    fill
                    className="rounded-full object-cover"
                  /> */}
                                </div>

                                <h3 className="text-2xl font-bold mb-1">Utkarsh Patel</h3>
                                <p className="text-blue-500 font-semibold mb-4">Co-Founder & CTO</p>

                                <p className="text-muted-foreground leading-relaxed mb-6">
                                    Utkarsh drives Marketing Initiatives and Product Innovation. His focus is on bringing out-of-the-box ideas that enhance user experience. He works on market trends and creative strategies to keep ServiZephyr ahead of the competition.
                                </p>

                                {/* Social Links Placeholder */}
                                <div className="flex gap-4">
                                    <a href="https://www.linkedin.com/in/utkarsh-patel-973047298" className="p-2 rounded-full bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
                                        <Linkedin className="h-5 w-5 text-blue-500" />
                                    </a>
                                    <a href="#" className="p-2 rounded-full bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
                                        <Twitter className="h-5 w-5 text-blue-500" />
                                    </a>
                                    <a href="mailto:utkarsh@servizephyr.com" className="p-2 rounded-full bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
                                        <Mail className="h-5 w-5 text-blue-500" />
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Commitment Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-8"
                >
                    <h2 className="text-3xl font-bold text-center mb-6">Our Commitment</h2>
                    <p className="text-lg text-muted-foreground leading-relaxed text-center max-w-4xl mx-auto">
                        We&apos;re providing restaurants with the tools they need to survive and thrive in the modern age. Our commitment goes beyond just software – we&apos;re your partner in digital growth, helping you build stronger customer relationships and drive sustainable business success.
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
