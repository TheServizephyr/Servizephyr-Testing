'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function AdminWhatsappDirectPage() {
  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp Direct (Admin)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">This is the admin view for WhatsApp Direct. For full functionality use the owner dashboard interface or impersonate an owner.</p>
          <div className="flex gap-3">
            <Link href="/owner-dashboard/whatsapp-direct">
              <Button>Open Owner WhatsApp Direct</Button>
            </Link>
            <Link href="/admin-dashboard/mailbox">
              <Button variant="outline">Open Mailbox</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
