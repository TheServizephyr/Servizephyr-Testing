'use client';

export default function PrivacyPolicy() {
  return (
    <div className="bg-background text-foreground">
      <div className="container mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <h1 className="font-headline text-4xl sm:text-5xl font-bold tracking-tighter mb-8 text-center">Privacy Policy</h1>
        <div className="prose prose-lg dark:prose-invert mx-auto text-muted-foreground">
          <p>Last Updated: October 11, 2025</p>

          <p>ServiZephyr (&quot;us&quot;, &quot;we&quot;, or &quot;our&quot;) takes your privacy seriously. This Privacy Policy explains what information we collect and how we use it.</p>

          <h2>1. What Information Do We Collect?</h2>
          <ul>
            <li><strong>Personal Information:</strong> When you place an order, we collect your name, phone number, and delivery address.</li>
            <li><strong>Order Information:</strong> We save the details of your order (what was ordered, from which restaurant, and the total value).</li>
            <li><strong>Technical Information:</strong> We may use cookies and analytics tools to collect usage data (such as which pages you visit) to improve our service.</li>
          </ul>

          <h2>2. How Do We Use Your Information?</h2>
          <ul>
            <li>To process your orders and forward them to our restaurant partners.</li>
            <li>To send you order status updates (like &quot;Order Confirmed&quot;, &quot;Out for Delivery&quot;) on WhatsApp.</li>
            <li>To provide you with customer support.</li>
            <li>To improve and personalize our services.</li>
            <li>With your permission, to inform you about new offers and promotions.</li>
          </ul>

          <h2>2A. Delivery Order Customer Notice</h2>
          <p>
            For <strong>delivery orders only</strong>, we collect and process delivery-specific information such as your delivery address,
            phone number, and location details (if you share location) to assign delivery, estimate distance/charges, and complete order tracking.
          </p>
          <ul>
            <li>This delivery information is visible only to the relevant restaurant team and assigned delivery partner on a need-to-know basis.</li>
            <li>We use this information for order fulfillment, delivery support, fraud prevention, and service quality monitoring.</li>
            <li>We do not use your delivery address for unrelated marketing without your consent.</li>
          </ul>

          <h2>3. Who Do We Share Your Information With?</h2>
          <ul>
            <li><strong>Restaurant Partners:</strong> To fulfill your order, we share your name, order details, and address with the restaurant from which you have ordered.</li>
            <li><strong>Payment Gateways:</strong> To process your payment, we use trusted payment gateways like Razorpay.</li>
            <li><strong>Legal Requirements:</strong> If required by law, we may have to share your information with government agencies.</li>
          </ul>
          <p>We do not sell your personal information to any third party.</p>

          <h2>4. Data Security</h2>
          <p>We use industry-standard security measures to keep your information safe.</p>

          <h2>5. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy, you can email us at <a href="mailto:ashwanibaghel@servizephyr.com">ashwanibaghel@servizephyr.com</a>.</p>
        </div>
      </div>
    </div>
  );
}
