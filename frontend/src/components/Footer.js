
import Link from 'next/link'
import { Twitter, Linkedin, Instagram } from 'lucide-react'
import Image from 'next/image'

const Footer = () => {
  return (
    <footer id="contact" className="bg-card py-12 border-t border-border/40">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/logo.png" alt="ServiZephyr Logo" width={40} height={40} className="h-10 w-auto" />
              <h3 className="text-lg font-bold text-foreground">ServiZephyr</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Your own WhatsApp ordering bot & growth toolkit.</p>
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">Quick Links</h3>
            <ul className="mt-4 space-y-2">
              <li><Link href="/#features" className="text-sm text-muted-foreground hover:text-primary">Features</Link></li>
              <li><Link href="/#pricing" className="text-sm text-muted-foreground hover:text-primary">Pricing</Link></li>
              <li><Link href="/#faq" className="text-sm text-muted-foreground hover:text-primary">FAQ</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">Legal</h3>
            <ul className="mt-4 space-y-2">
              <li><Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary">Privacy Policy</Link></li>
              <li><Link href="/terms-and-conditions" className="text-sm text-muted-foreground hover:text-primary">Terms & Conditions</Link></li>
              {/* <li><Link href="/shipping-policy" className="text-sm text-muted-foreground hover:text-primary">Shipping Policy</Link></li> */}
              <li><Link href="/cancellation-and-refunds" className="text-sm text-muted-foreground hover:text-primary">Cancellation & Refunds</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">Connect</h3>
            <ul className="mt-4 space-y-2">
              <li><Link href="/about" className="text-sm text-muted-foreground hover:text-primary">About Us</Link></li>
              <li><Link href="/contact" className="text-sm text-muted-foreground hover:text-primary">Contact Us</Link></li>
            </ul>
            <div className="mt-4 flex space-x-4">
              <a href="https://x.com/servizephyr" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" aria-label="Twitter"><Twitter /></a>
              <a href="https://www.linkedin.com/company/servizephyr/" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" aria-label="LinkedIn"><Linkedin /></a>
              <a href="https://www.instagram.com/servizephyr?igsh=amdtNWtnOHA0Zmho" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" aria-label="Instagram"><Instagram /></a>
            </div>
          </div>
        </div>
        <div className="mt-12 border-t border-border pt-8 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} ServiZephyr. All rights reserved.
        </div>
      </div>
    </footer>
  )
}

export default Footer
