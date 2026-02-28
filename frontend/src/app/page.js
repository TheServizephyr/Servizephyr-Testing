
'use client'

import { motion, useInView, animate } from 'framer-motion'
import { CheckCircle, Bot, Zap, Rocket, Users, ArrowRight, Star, ShoppingCart, BarChart2, MessageSquare, Briefcase, Store, Soup, Pizza, Feather, Check, Salad, Link as LinkIcon, Edit, Share2, Camera, Split, LayoutDashboard, Truck, Hash, Bell, Clock, QrCode, PackageCheck, ShoppingBag } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import React, { useEffect, useRef, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import placeholderData from '@/app/lib/placeholder-images.json'
import { cn } from '@/lib/utils'


const MotionLink = motion(Link);

const sectionVariants = {
  hidden: { opacity: 0, y: 50 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.1,
      duration: 0.5,
      ease: 'easeOut',
    },
  }),
};

const AnimatedNumber = ({ value, suffix = '', prefix = '' }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (isInView) {
      const controls = animate(0, value, {
        duration: 2,
        ease: "easeOut",
        onUpdate: (latest) => {
          setDisplayValue(Math.floor(latest));
        },
      });
      return () => controls.stop();
    }
  }, [isInView, value]);

  return (
    <span ref={ref}>
      {prefix}{displayValue}{suffix}
    </span>
  );
};

const AnimatedWhatShop = () => {
  const [part1, setPart1] = useState('');
  const [part2, setPart2] = useState('');
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const sequence = async () => {
      while (isMounted.current) {
        // 1. Type WhatsApp
        setPart1('');
        setPart2('');
        const whatsAppText = "WhatsApp";
        for (let i = 1; i <= whatsAppText.length; i++) {
          if (!isMounted.current) return;
          setPart1(whatsAppText.substring(0, i));
          await new Promise(res => setTimeout(res, 80));
        }
        await new Promise(res => setTimeout(res, 1200));
        if (!isMounted.current) return;

        // 2. Delete App
        for (let i = "App".length; i >= 1; i--) {
          if (!isMounted.current) return;
          setPart1("Whats" + "App".substring(0, i - 1));
          await new Promise(res => setTimeout(res, 120));
        }
        setPart1("Whats");
        await new Promise(res => setTimeout(res, 400));
        if (!isMounted.current) return;

        // 3. Type Shop
        const shopText = 'Shop';
        let tempShopText = '';
        for (const char of shopText) {
          if (!isMounted.current) return;
          tempShopText += char;
          setPart2(tempShopText);
          await new Promise(res => setTimeout(res, 150));
        }
        await new Promise(res => setTimeout(res, 2500));
        if (!isMounted.current) return;

        // 4. Delete WhatShop
        const fullText = "WhatShop";
        for (let i = fullText.length; i >= 0; i--) {
          if (!isMounted.current) return;
          setPart1(fullText.substring(0, i));
          setPart2('');
          await new Promise(res => setTimeout(res, 60));
        }
        await new Promise(res => setTimeout(res, 500));
        if (!isMounted.current) return;
      }
    };

    sequence();

    return () => {
      isMounted.current = false;
    }

  }, []);

  return (
    <h2
      className="font-headline text-4xl sm:text-5xl md:text-6xl tracking-tighter leading-tight font-bold transition-colors duration-500"
      style={{ minHeight: '70px' }}
    >
      <span style={{ color: '#25D366' }}>{part1}</span>
      <span style={{ color: 'hsl(var(--primary))' }}>{part2}</span>
      <span className="animate-ping" style={{ color: 'hsl(var(--muted-foreground))' }}>|</span>
    </h2>
  );
};

const AnimatedSubheadline = () => {
  const [part1, setPart1] = useState('');
  const [part2, setPart2] = useState('');
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const sequence = async () => {
      while (isMounted.current) {
        // 1. Type WhatsApp
        setPart1('');
        setPart2('');
        const whatsAppText = "WhatsApp";
        for (let i = 1; i <= whatsAppText.length; i++) {
          if (!isMounted.current) return;
          setPart1(whatsAppText.substring(0, i));
          await new Promise(res => setTimeout(res, 80));
        }
        await new Promise(res => setTimeout(res, 1200));
        if (!isMounted.current) return;

        // 2. Delete App
        for (let i = "App".length; i >= 1; i--) {
          if (!isMounted.current) return;
          setPart1("Whats" + "App".substring(0, i - 1));
          await new Promise(res => setTimeout(res, 120));
        }
        setPart1("Whats");
        await new Promise(res => setTimeout(res, 400));
        if (!isMounted.current) return;

        // 3. Type Shop
        const shopText = 'Shop';
        let tempShopText = '';
        for (const char of shopText) {
          if (!isMounted.current) return;
          tempShopText += char;
          setPart2(tempShopText);
          await new Promise(res => setTimeout(res, 150));
        }
        await new Promise(res => setTimeout(res, 2500));
        if (!isMounted.current) return;

        // 4. Delete WhatShop
        const fullText = "WhatShop";
        for (let i = fullText.length; i >= 0; i--) {
          if (!isMounted.current) return;
          setPart1(fullText.substring(0, i));
          setPart2('');
          await new Promise(res => setTimeout(res, 60));
        }
        await new Promise(res => setTimeout(res, 500));
        if (!isMounted.current) return;
      }
    };

    sequence();

    return () => {
      isMounted.current = false;
    }

  }, []);

  return (
    <h3 className="text-xl md:text-2xl text-muted-foreground">
      Take direct orders from customers via <span className="inline-block" style={{ minWidth: '150px' }}><span style={{ color: '#25D366' }}>{part1}</span><span style={{ color: 'hsl(var(--primary))' }}>{part2}</span></span> - <span className="text-primary font-semibold">For All Food Businesses</span>.
    </h3>
  );
};

const FeatureCard = ({ icon, title, description, benefits }) => {
  return (
    <div
      className="bg-card border border-border rounded-xl p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
    >
      <div className="flex items-center gap-4 mb-4">
        <div className="p-3 bg-primary/10 rounded-full text-primary">{icon}</div>
        <h4 className="text-xl font-bold text-foreground">{title}</h4>
      </div>
      <p className="text-muted-foreground text-sm mb-4">{description}</p>
      <ul className="space-y-2">
        {benefits.map((benefit, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Check size={16} className="text-green-500 mt-1 flex-shrink-0" />
            <span className="text-muted-foreground">{benefit}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const UniqueFeatureCard = ({ icon, title, description, custom }) => (
  <motion.div
    variants={cardVariants}
    custom={custom}
    className="bg-card border border-border rounded-xl p-8 text-center flex flex-col items-center hover:shadow-lg hover:border-primary transition-all duration-300"
  >
    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 border-2 border-primary text-primary mb-6">
      {icon}
    </div>
    <h4 className="text-2xl font-bold text-foreground mb-3">{title}</h4>
    <p className="text-muted-foreground flex-grow">{description}</p>
  </motion.div>
);


export default function Home() {
  const [animationFinished, setAnimationFinished] = useState(true);

  return (
    <>
      <main className="bg-background">
        {process.env.NODE_ENV === 'development' && (
          <div className="fixed bottom-4 right-4 z-[1000] bg-yellow-400 text-black p-4 rounded-lg shadow-lg">
            <h3 className="font-bold text-lg">Local Test Links</h3>
            <Link href="/order/baaghi-chai" className="block hover:underline">
              Test Order Page
            </Link>
          </div>
        )}

        {/* Hero Section */}
        <section className="relative w-full flex flex-col justify-center items-center py-20 md:py-32">
          <video
            src="/Animated_Hero_Video_for_Website.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="absolute top-0 left-0 min-w-full min-h-full object-cover sm:object-cover z-0 opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/30 via-background/70 to-background/30 z-10"></div>

          <div className="relative container px-4 md:px-6 text-center z-20">
            <div className="max-w-4xl mx-auto flex flex-col items-center">
              <h1 className="font-headline text-4xl sm:text-5xl md:text-7xl tracking-tighter leading-tight text-foreground">
                Business, Customer, and Control.
              </h1>

              <h2 className="font-headline text-5xl sm:text-6xl md:text-8xl tracking-tighter leading-tight font-bold text-primary mt-6">
                All Yours.
              </h2>

              <h3 className="text-xl md:text-2xl text-muted-foreground mt-8 max-w-2xl">
                WhatsApp ordering platform for restaurants and food businesses. Zero commission. Full control.
              </h3>

              <motion.div
                className="flex flex-col items-center w-full mt-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              >
                <h4 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                  Cut Commission. Boost Profits by <span className="text-green-500">25%+.</span>
                </h4>
                <MotionLink
                  href="/join-waitlist"
                  className="mt-8 bg-primary text-primary-foreground font-bold py-4 px-10 rounded-lg text-xl hover:bg-primary/90 transition-transform transform hover:scale-105 inline-flex items-center gap-3 shadow-lg shadow-primary/30"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Feather size={24} /> Join the Waitlist Now
                </MotionLink>
              </motion.div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <motion.section
          id="how-it-works"
          className="container mx-auto py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
          <h2 className="mb-4 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">
            Get Started in 3 Simple Steps
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-lg text-muted-foreground md:text-xl">
            Launch your own WhatsApp ordering system in minutes. No technical expertise required.
          </p>
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Dashed line for desktop */}
            <div className="absolute top-12 left-0 right-0 h-px -translate-y-1/2 hidden md:block">
              <svg width="100%" height="100%">
                <line x1="0" y1="50%" x2="100%" y2="50%" strokeWidth="2" stroke="hsl(var(--border))" strokeDasharray="8 8" />
              </svg>
            </div>

            {[
              {
                icon: <LinkIcon className="h-8 w-8" />,
                title: "1. Connect Your Number",
                description: "Fill a simple, secure form from Meta to link your business WhatsApp number. It takes less than 5 minutes."
              },
              {
                icon: <Edit className="h-8 w-8" />,
                title: "2. Customize Your Store",
                description: "Easily upload your full menu or product catalog with photos and prices through our intuitive dashboard."
              },
              {
                icon: <Share2 className="h-8 w-8" />,
                title: "3. Launch & Grow",
                description: "Share your unique ordering link with customers and start accepting commission-free orders directly on WhatsApp."
              }
            ].map((step, i) => (
              <motion.div key={i} custom={i} variants={cardVariants} className="relative bg-background p-6 text-center">
                <div className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 border-2 border-primary text-primary shadow-lg mb-6">
                  {step.icon}
                </div>
                <h3 className="mb-2 text-xl font-bold text-foreground">{step.title}</h3>
                <p className="text-muted-foreground">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Product Showcase Section */}
        <motion.section
          id="product"
          className="bg-card py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
          <div className="container mx-auto px-4">
            <h2 className="mb-4 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">The Command Center You&apos;ve Always Wanted</h2>
            <p className="mx-auto mb-16 max-w-3xl text-center text-lg text-muted-foreground md:text-xl">
              Stop guessing, start growing. Our dashboard gives you a bird&apos;s-eye view of your entire operation, with actionable insights to boost your bottom line.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Feature 1: Live Order Dashboard */}
              <motion.div
                className="flex flex-col"
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0, transition: { duration: 0.7 } }}
                viewport={{ once: true, amount: 0.5 }}
              >
                <div className="p-6 bg-background rounded-t-lg">
                  <h3 className="text-2xl font-bold text-primary">Live Order Dashboard</h3>
                  <p className="mt-2 text-muted-foreground">Never miss an order. Get a real-time stream of incoming WhatsApp orders on a clean, intuitive interface. Manage status, accept, and dispatch with a single click.</p>
                </div>
                <div className="flex-grow p-2 bg-muted rounded-b-lg border border-border">
                  <div className="rounded-lg border bg-background p-1.5 shadow-lg">
                    {/* USER: Replace this with your screenshot */}
                    <Image
                      src="/live-orders.png" // BHAI: Yahan apne live orders page ka screenshot daalna. Example: "/live-orders.png"
                      alt="Live Order Dashboard Mockup"
                      width={1000} // Screenshot ki width
                      height={600} // Screenshot ki height
                      className="rounded-md"
                    />
                  </div>
                </div>
              </motion.div>

              {/* Feature 2: Analytics */}
              <motion.div
                className="flex flex-col"
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0, transition: { duration: 0.7, delay: 0.2 } }}
                viewport={{ once: true, amount: 0.5 }}
              >
                <div className="p-6 bg-background rounded-t-lg">
                  <h3 className="text-2xl font-bold text-primary">Growth Engine: Analytics</h3>
                  <p className="mt-2 text-muted-foreground">Track your revenue, top-selling items, and busiest hours to make smarter business decisions. All the data you need, beautifully visualized.</p>
                </div>
                <div className="flex-grow p-2 bg-muted rounded-b-lg border border-border">
                  <div className="rounded-lg border bg-background p-1.5 shadow-lg">
                    {/* USER: Replace this with your screenshot */}
                    <Image
                      src="/analytics.png" // BHAI: Yahan apne analytics page ka screenshot daalna. Example: "/analytics.png"
                      alt="Analytics Chart Mockup"
                      width={1000} // Screenshot ki width
                      height={600} // Screenshot ki height
                      className="rounded-md"
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.section>

        {/* Feature Breakdown Section - REBUILT AND FIXED */}
        <motion.section
          id="features"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
          className="container mx-auto px-4 py-20 sm:py-28"
        >
          <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Your All-in-One Growth Engine</h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-lg text-muted-foreground md:text-xl">
            From seamless ordering to powerful analytics and marketing, ServiZephyr is packed with features designed to help you succeed.
          </p>
          <Tabs defaultValue="ordering" className="w-full">
            <TabsList className="relative grid w-full grid-cols-1 md:grid-cols-3 bg-muted p-1 h-auto rounded-lg">
              <TabsTrigger value="ordering" className="relative h-10"><ShoppingCart className="mr-2 h-4 w-4" /> WhatsApp Ordering</TabsTrigger>
              <TabsTrigger value="dashboard" className="h-10"><BarChart2 className="mr-2 h-4 w-4" /> Owner Command Center</TabsTrigger>
              <TabsTrigger value="growth" className="h-10"><Rocket className="mr-2 h-4 w-4" /> Growth Toolkit</TabsTrigger>
            </TabsList>

            <TabsContent value="ordering" className="mt-8">
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                <FeatureCard
                  icon={<MessageSquare />}
                  title="Live Interactive Menu"
                  description="Let customers order from a beautiful, interactive menu directly on WhatsApp. No apps, no logins, no friction."
                  benefits={["No app download needed", "Familiar and fast interface", "Reduces ordering friction"]}
                />
                <FeatureCard
                  icon={<Zap />}
                  title="Integrated Payments"
                  description="Securely accept payments via UPI, Credit/Debit Cards, and Netbanking right in the chat."
                  benefits={["Supports all major payment methods", "Instant payment confirmations", "Reduces COD dependency"]}
                />
                <FeatureCard
                  icon={<Bot />}
                  title="Automated Communication"
                  description="Keep customers informed with automated confirmations, status updates, and feedback requests."
                  benefits={["Saves staff time", "Improves customer experience", "Builds trust and transparency"]}
                />
              </div>
            </TabsContent>
            <TabsContent value="dashboard" className="mt-8">
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                <FeatureCard
                  icon={<BarChart2 />}
                  title="Real-time Analytics"
                  description="Track revenue, top-selling items, and busiest hours to make smarter business decisions."
                  benefits={["Identify popular dishes", "Optimize your pricing strategy", "Understand sales trends instantly"]}
                />
                <FeatureCard
                  icon={<Salad />}
                  title="Dynamic Menu Control"
                  description="Update your menu, change prices, or mark items 'out of stock' from anywhere, at any time."
                  benefits={["Instantly reflect changes to customers", "Avoid disappointed customers", "Run flash sales or daily specials easily"]}
                />
                <FeatureCard
                  icon={<Users />}
                  title="Customer Hub (CRM)"
                  description="Finally, own your customer data. See who your most loyal customers are and understand their habits."
                  benefits={["Identify your VIPs", "View order history and preferences", "Build long-term relationships"]}
                />
              </div>
            </TabsContent>
            <TabsContent value="growth" className="mt-8">
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                <FeatureCard
                  icon={<Rocket />}
                  title="WhatsApp Marketing"
                  description="Send promotions, new menu alerts, and festival offers directly to your customers&apos; phones."
                  benefits={["Highest open rates in the industry", "Run targeted campaigns for specific customer segments", "Drive repeat business effectively"]}
                />
                <FeatureCard
                  icon={<Star />}
                  title="Feedback &amp; Reviews"
                  description="Automatically request feedback after every order to improve your service and build social proof."
                  benefits={["Address issues proactively", "Understand customer satisfaction", "Encourage positive online reviews"]}
                />
                <FeatureCard
                  icon={<CheckCircle />}
                  title="QR Code Ordering"
                  description="Generate unique QR codes for tables, flyers, or packaging that open your WhatsApp menu instantly."
                  benefits={["Enable contactless dine-in ordering", "Bridge offline marketing with online sales", "Track campaign effectiveness"]}
                />
              </div>
            </TabsContent>
          </Tabs>
        </motion.section>

        {/* Unique Features Section */}
        <motion.section
          id="unique-features"
          className="py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
          <h2 className="mb-4 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Features That No One Else Offers</h2>
          <p className="mx-auto mb-16 max-w-3xl text-center text-lg text-muted-foreground md:text-xl">
            We&apos;ve built tools with cutting-edge technology to solve the real-world problems of your business.
          </p>
          <div className="container mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
            <UniqueFeatureCard
              custom={1}
              icon={<Camera size={32} />}
              title="AI Menu Scan"
              description="Bring your menu online in 5 minutes with our AI. Zero data entry, zero hassle."
            />
            <UniqueFeatureCard
              custom={2}
              icon={<Split size={32} />}
              title="Smart Split-Payments"
              description="End the hassle of splitting bills. Customers can now split payments by dish or equally among themselves."
            />
            <UniqueFeatureCard
              custom={3}
              icon={<LayoutDashboard size={32} />}
              title="The Real Command Center"
              description="Manage Delivery, Dine-in, and Table Bookings all from a single, unified dashboard."
            />
          </div>
        </motion.section>


        {/* Street Vendor Special Section */}
        <motion.section
          className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20 py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
          <div className="container mx-auto px-4">
            <h2 className="mb-4 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground flex items-center justify-center gap-3">
              Built for Street Vendors <ShoppingBag className="h-10 w-10 md:h-12 md:w-12 text-primary" />
            </h2>
            <p className="mx-auto mb-12 max-w-3xl text-center text-lg text-muted-foreground md:text-xl">
              From chai stalls to food trucks, we&apos;ve built features specifically for street food heroes.
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard
                icon={<Hash />}
                title="Token-Based System"
                description="No table numbers needed. Generate unique tokens (like 73-UY) for each order."
                benefits={[
                  "Easy for customers to remember",
                  "Clear order identification",
                  "Professional appearance"
                ]}
              />
              <FeatureCard
                icon={<Clock />}
                title="Pre-Order Management"
                description="Customers order in advance, you prepare when ready, they collect when it&apos;s done."
                benefits={[
                  "Reduce wait times",
                  "Better kitchen planning",
                  "Happy customers"
                ]}
              />
              <FeatureCard
                icon={<PackageCheck />}
                title="Smart Packaging Charges"
                description="Automatically add packaging charges for takeaway orders."
                benefits={[
                  "Recover packaging costs",
                  "Transparent billing",
                  "Configurable amounts"
                ]}
              />
              <FeatureCard
                icon={<QrCode />}
                title="QR Menu Ordering"
                description="No physical menu needed. Customers scan QR, browse, and order instantly."
                benefits={[
                  "Save printing costs",
                  "Always up-to-date menu",
                  "Contactless ordering"
                ]}
              />
              <FeatureCard
                icon={<Bell />}
                title="Order Ready Notifications"
                description="Auto-notify customers when their order is ready for pickup."
                benefits={[
                  "Reduce crowding",
                  "Better customer experience",
                  "Efficient operations"
                ]}
              />
              <FeatureCard
                icon={<Zap />}
                title="Zero Overhead"
                description="No waiters, no tables, no dine-in complexity. Pure takeaway focus."
                benefits={[
                  "Lower operational costs",
                  "Simplified workflow",
                  "Focus on food quality"
                ]}
              />
            </div>
          </div>
        </motion.section>


        {/* Target Audience Section */}
        <motion.section
          className="bg-card py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
          <div className="container mx-auto px-4">
            <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Built for Every Kind of Food Business - Big or Small</h2>
            <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
              {[
                { icon: <Store className="h-10 w-10 text-primary" />, name: 'QSRs' },
                { icon: <Briefcase className="h-10 w-10 text-primary" />, name: 'Cloud Kitchens' },
                { icon: <Soup className="h-10 w-10 text-primary" />, name: 'Restaurants' },
                { icon: <Pizza className="h-10 w-10 text-primary" />, name: 'Cafes & Bakeries' },
                { icon: <Truck className="h-10 w-10 text-primary" />, name: 'Food Trucks' },
              ].map((item, i) => (
                <motion.div key={item.name} custom={i} variants={cardVariants} className="flex flex-col items-center text-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-background shadow-inner">
                    {item.icon}
                  </div>
                  <h3 className="mt-4 text-xl font-bold text-foreground">{item.name}</h3>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* Comparison Table Section */}
        <motion.section
          className="bg-background py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
          <div className="container mx-auto px-4">
            <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">The Choice is Clear</h2>
            <div className="mx-auto max-w-4xl">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%] text-lg text-foreground">Feature</TableHead>
                    <TableHead className="text-center text-lg text-green-500 font-bold">ServiZephyr</TableHead>
                    <TableHead className="text-center text-lg text-yellow-500 font-bold">Food Aggregators</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { feature: "Platform Commission", servizephyr: "0%", aggregators: "18% - 30%" },
                    { feature: "Customer Data Ownership", servizephyr: "You Own It", aggregators: "They Own It" },
                    { feature: "Direct Marketing", servizephyr: "Yes (WhatsApp)", aggregators: "No" },
                    { feature: "Menu Control & Pricing", servizephyr: "Full Control", aggregators: "Limited / Conditional" },
                    { feature: "Payment Gateway Charges", servizephyr: "As per actuals", aggregators: "Included in commission" },
                    { feature: "Brand Building", servizephyr: "Your Own Brand", aggregators: "On Their Platform" },
                    { feature: "Street Vendor Support", servizephyr: "Full Support", aggregators: "Not Available" },
                  ].map(item => (
                    <TableRow key={item.feature}>
                      <TableCell className="font-medium text-foreground">{item.feature}</TableCell>
                      <TableCell className="text-center font-bold text-green-500"><CheckCircle className="inline-block mr-2 h-5 w-5" />{item.servizephyr}</TableCell>
                      <TableCell className="text-center font-bold text-primary">{item.aggregators}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </motion.section>

        {/* Pricing Section */}
        <motion.section
          id="pricing"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
          className="bg-card py-20 sm:py-28"
        >
          <div className="container mx-auto flex flex-col items-center px-4">
            <h2 className="text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Simple & Transparent Pricing</h2>
            <div className="mt-12 w-full max-w-md rounded-2xl border-2 border-primary bg-background p-8 shadow-2xl shadow-primary/20 transition-transform duration-300 hover:scale-105">
              <h3 className="text-3xl font-bold text-center text-foreground">Pro Plan</h3>
              <p className="mt-4 text-center text-5xl font-bold text-foreground">₹999/month</p>
              <ul className="mt-8 space-y-4">
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Unlimited Orders</li>
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> WhatsApp Bot</li>
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Owner Dashboard</li>
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Menu Management</li>
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Growth Toolkit</li>
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Customer Hub (CRM)</li>
              </ul>
              <MotionLink
                href="/join-waitlist"
                className="btn-shine mt-8 inline-flex h-12 w-full items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground shadow-lg shadow-primary/50 transition-transform duration-300 hover:scale-105"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Join the Waitlist
              </MotionLink>
            </div>
          </div>
        </motion.section>

        {/* FAQ Section */}
        <motion.section
          id="faq"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
          className="container mx-auto px-4 py-20 sm:py-28"
        >
          <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Frequently Asked Questions</h2>
          <div className="mx-auto max-w-3xl">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger className="text-foreground">Do I need any technical knowledge?</AccordionTrigger>
                <AccordionContent>
                  Not at all! ServiZephyr is designed to be extremely easy to use. Our dashboard is completely user-friendly. If you can use WhatsApp, you can use ServiZephyr.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger className="text-foreground">How long does the setup take?</AccordionTrigger>
                <AccordionContent>
                  The entire setup takes no more than 5-10 minutes. You just need to sign up, scan a QR code to connect your WhatsApp number, and your system will be live.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger className="text-foreground">Can I easily change my menu?</AccordionTrigger>
                <AccordionContent>
                  Yes, absolutely. From your dashboard, you can add new items, change their prices, or mark an item as &quot;out of stock&quot; anytime, from anywhere. Everything updates in real-time.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4">
                <AccordionTrigger className="text-foreground">Will I get customer support?</AccordionTrigger>
                <AccordionContent>
                  Yes. We provide dedicated WhatsApp and email support to all our Pro plan users to help you with any issues or questions you might have.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </motion.section>

      </main>
    </>
  )
}
