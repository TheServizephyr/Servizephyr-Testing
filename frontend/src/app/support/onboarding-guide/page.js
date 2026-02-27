
'use client';

import Image from 'next/image';

const GuideStep = ({ title, text, screenshot }) => (
    <div className="mt-8">
        <h3 className="text-2xl font-bold text-primary mb-3">{title}</h3>
        <p className="mb-4">{text}</p>
        {screenshot && (
            <div className="bg-muted border border-border rounded-lg p-4 my-4 text-center text-muted-foreground">
                <p className="font-semibold mb-2">[Screenshot Placeholder: {screenshot}]</p>
                <div className="bg-background h-48 w-full rounded-md flex items-center justify-center">
                    <p>Image of: {screenshot}</p>
                </div>
            </div>
        )}
    </div>
);

export default function OnboardingGuidePage() {
    return (
        <div className="bg-background text-foreground">
            <div className="container mx-auto max-w-4xl px-4 py-12 sm:py-16">
                <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-bold tracking-tighter mb-4 text-center">
                    How to Connect Your WhatsApp Bot
                </h1>
                 <p className="text-center text-lg text-muted-foreground mb-12">A Step-by-Step Guide for Restaurant Owners</p>

                <div className="prose prose-lg dark:prose-invert mx-auto text-muted-foreground">
                    <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Welcome to ServiZephyr! Chaliye 5 Minute Mein Apna WhatsApp Bot Launch Karte Hain.</h2>
                    <p>
                        Mubarak ho! Aapne ServiZephyr ke saath judkar apne business ko aage badhane ka sahi faisla liya hai. Yeh guide aapko aaram se, step-by-step batayegi ki aap kaise sirf 5-10 minute mein apna khud ka WhatsApp Ordering Bot live kar sakte hain. Aapko kisi technical knowledge ki zaroorat nahi hai.
                    </p>

                    <hr className="my-12" />

                    <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Part 1: Apne Bot Ko Dashboard Se Connect Karein (The Main Step)</h2>
                    
                    <GuideStep
                        title="Step 1: 'Connect Bot' Button Dhoondhein"
                        text="Apne ServiZephyr Owner Dashboard mein login karein. 'Connections' page par jaayein. Aapko 'Connect a New WhatsApp Bot' ka button dikhega. Shuruaat karne ke liye is par click karein."
                        screenshot="ServiZephyr Connections page showing the 'Connect a New WhatsApp Bot' button"
                    />

                    <GuideStep
                        title="Step 2: Facebook Ke Secure Popup Mein Login Karein"
                        text="Button par click karte hi, Facebook ka ek official popup window khulega. Ghabraiye mat, yeh 100% safe hai. Aap apna Facebook password ServiZephyr ko nahi, balki seedhe Facebook ko de rahe hain. Shuruaat karne ke liye apne personal Facebook account se login karein."
                        screenshot="Facebook popup appearing over the dashboard"
                    />
                    
                    <GuideStep
                        title="Step 3: Screen Par Diye Gaye Instructions Follow Karein"
                        text="Ab Facebook aapse kuch cheezein select karne ko kahega. Bas 'Continue' par click karte jaaiye. Aap ek naya Meta Business Account banayenge, ek naya WhatsApp Business Account banayenge, aur apne bot ke liye ek Display Name (jaise 'Sharma Sweets') set karenge."
                    />

                     <GuideStep
                        title="Step 4: Apna Phone Number Add Aur Verify Karein"
                        text="Ab sabse zaroori kadam. Facebook aapse ek naya phone number maangega jo aapke bot ke liye istemal hoga. Important: Yeh ek fresh number hona chahiye jispar pehle se WhatsApp na chal raha ho. Number daalne ke baad, 'Send Code' par click karein. Aapke uss number par ek OTP aayega. Us OTP ko isi popup ke andar daal kar 'Verify' karein."
                        screenshot="Phone number verification step inside the popup"
                    />

                     <GuideStep
                        title="Step 5: Finish!"
                        text="OTP verify hote hi, aapka kaam ho gaya! 'Finish' ya 'Done' par click karein. Popup apne aap band ho jaayega. Mubarak ho! Aapka WhatsApp bot aapke ServiZephyr dashboard se jud chuka hai!"
                    />

                    <hr className="my-12" />

                    <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Part 2: Zaroori Agle Kadam (Bot Ko Power Dene Ke Liye)</h2>
                    
                    <GuideStep
                        title="Business Verification Kyun Zaroori Hai?"
                        text="Ab aapka bot live hai, lekin shuruaat mein WhatsApp uspar kuch limit lagata hai. In limits ko hatane aur customer ka trust jeetne ke liye, aapko Meta ko batana padta hai ki aap ek asli business hain. Isko 'Business Verification' kehte hain. Kaise Karein? Apne Meta Business Manager mein jaakar, 'Security Center' tab ke andar 'Start Verification' par click karein. Aapko apne business se jude documents (jaise utility bill, registration certificate) upload karne pad sakte hain."
                        screenshot="Meta Business Manager's Security Center"
                    />

                     <GuideStep
                        title="Payment Method Kaise Add Karein?"
                        text="WhatsApp har mahine aapko 1,000 conversations free deta hai. Uske baad, har conversation ka ek chhota sa charge lagta hai. Iske liye aapko ek payment method (jaise credit card) add karna hota hai. Shuruaat mein, aapka bill ₹0 hi rahega. Kaise Karein? Apne Meta Business Manager ke 'Billing & Payments' section mein jaakar 'Add Payment Method' par click karein aur apni card details daal dein."
                        screenshot="Payment Methods page in Meta Business Manager"
                    />
                    
                    <hr className="my-12" />
                    
                    <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Part 3: Apne Message Templates Kaise Banayein?</h2>
                    
                    <GuideStep
                        title="Step 1: Template Manager Par Jaayein"
                        text="Apne ServiZephyr Dashboard ke 'Connections' page par wapas jaayein. Yahan aapko 'Manage WhatsApp Templates' ka ek section dikhega. 'Open Template Manager' button par click karein."
                        screenshot="ServiZephyr Connections page showing the 'Manage WhatsApp Templates' button"
                    />
                    
                     <GuideStep
                        title="Step 2: Naya Template Banayein"
                        text="'Open Template Manager' par click karte hi aap seedhe Meta ke official WhatsApp Manager page par pahunch jaayenge. Yahan, 'Create Template' button par click karein."
                        screenshot="Meta WhatsApp Manager interface with 'Create Template' button highlighted"
                    />
                    
                     <GuideStep
                        title="Step 3: Template Category Aur Details Bharein"
                        text="Meta aapse poochega ki aapka template kis baare mein hai. 'Marketing' ya 'Utility' chunein. Apne template ko ek naam dein (e.g., 'diwali_offer' ya 'order_status_update'). Phir, apne message ka content likhein. Aap variables (jaise customer ka naam, order number) jodne ke liye {{1}}, {{2}} jaise placeholders ka istemal kar sakte hain."
                        screenshot="Meta's template creation form"
                    />
                    
                     <GuideStep
                        title="Step 4: Template Ko Review Ke Liye Submit Karein"
                        text="Apna message likhne ke baad, 'Submit' par click karein. Meta ki team aapke template ko review karegi. Agar yeh unki policies ke mutabik hai, to yeh 5 minute se lekar kuch ghanton mein approve ho jaayega. Approved templates aap apni marketing campaigns mein istemal kar sakte hain."
                    />


                    <hr className="my-12" />

                     <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Ab Aap Taiyar Hain!</h2>
                     <p>
                        Aapka bot ab poori tarah se taiyar hai. Ab aap apne ServiZephyr dashboard se menu set up kar sakte hain, QR code generate kar sakte hain, aur commission-free orders lena shuru kar sakte hain. Agar aapko koi bhi dikkat aaye, to <a href='mailto:support@servizephyr.com' className='text-primary hover:underline'>support@servizephyr.com</a> par hamein email karne mein hichkichayein nahi.
                     </p>
                </div>
            </div>
        </div>
    );
}
