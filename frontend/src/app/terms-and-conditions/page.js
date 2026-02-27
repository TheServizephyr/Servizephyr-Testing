'use client';

export default function TermsAndConditionsPage() {
  return (
    <div className="bg-background text-foreground">
      <div className="container mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <h1 className="font-headline text-4xl sm:text-5xl font-bold tracking-tighter mb-8 text-center">Terms and Conditions</h1>
        <div className="prose prose-lg dark:prose-invert mx-auto text-muted-foreground">
          <p>Last updated: October 11, 2025</p>

          <p className="font-semibold text-lg">This website is managed by ASHWANI BAGHEL S/O MANOJ KUMAR</p>

          <p>Welcome to ServiZephyr! These terms and conditions (&quot;Terms&quot;) govern your use of our services.</p>

          <h2>1. Our Service</h2>
          <p>ServiZephyr is a technology platform that connects you (the customer) with our independent third-party restaurant partners (&quot;Restaurants&quot;).</p>

          <h2>2. Your Role (Customer)</h2>
          <p>You agree to provide accurate and complete information (name, address, phone number). You are responsible for the payment of your order.</p>

          <h2>3. Restaurant&apos;s Role</h2>
          <p>The Restaurant is solely responsible for the preparation of food, its quality, and packaging.</p>

          <h2>4. ServiZephyr&apos;s Role (Important)</h2>
          <p>ServiZephyr does not prepare, pack, or deliver food. We are only a technology provider that connects you with the Restaurant. The ultimate responsibility for food quality, delivery time, or any other service lies with the Restaurant. We will assist in resolving any disputes between the customer and the Restaurant.</p>

          <h2>5. Limitation of Liability</h2>
          <p>To the maximum extent permitted by law, ServiZephyr shall not be liable for any indirect, incidental, or consequential damages.</p>

          <h2>6. Changes</h2>
          <p>We may modify these Terms at any time. Your continued use of the service after any changes means that you agree to the new Terms.</p>
        </div>
      </div>
    </div>
  );
}
