'use client';

import { useState } from 'react';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, RefreshCw, Hash, Building2, User, ShoppingBag, Download, FileDown } from 'lucide-react';
import InfoDialog from '@/components/InfoDialog';

const TAB_CONFIG = {
  customer: {
    title: 'Customer Search',
    hint: 'Paste Customer ID (example: CS_2602...)',
    placeholder: 'CS_XXXXXXXXXXXX',
  },
  restaurant: {
    title: 'Restaurant Search',
    hint: 'Paste Restaurant ID (example: RS_2602...)',
    placeholder: 'RS_XXXXXXXXXXXX',
  },
  order: {
    title: 'Order Search',
    hint: 'Paste Customer Order ID or Firestore Order ID',
    placeholder: '2602XXXXXX or firestore_order_id',
  },
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString();
};

const formatCurrency = (value) => `Rs. ${Number(value || 0).toFixed(2)}`;
const normalizeAddressText = (address) => {
  if (!address) return '';
  if (typeof address === 'string') return address;
  return address.full || [
    address.street,
    address.area,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter(Boolean).join(', ');
};

const toSafeString = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const csvEscape = (value) => {
  const str = toSafeString(value).replace(/\r?\n/g, ' ').trim();
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const htmlEscape = (value) => toSafeString(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const buildFieldValueRows = (objectMap) =>
  Object.entries(objectMap).map(([field, value]) => [field, toSafeString(value)]);

const buildExportSections = (type, packet) => {
  const data = packet?.data || {};
  const audit = packet?.audit || {};
  const sections = [];

  sections.push({
    title: 'Audit Details',
    columns: ['Field', 'Value'],
    rows: [
      ...buildFieldValueRows({
        event: audit.event,
        requestId: audit.requestId,
        searchedAt: audit.searchedAt,
        searchType: audit.searchType,
        searchedId: audit.searchedId,
        adminUid: audit?.searchedBy?.uid,
        adminEmail: audit?.searchedBy?.email,
        endpoint: audit.endpoint,
      }),
      ...buildFieldValueRows(audit?.resultSummary || {}).map(([k, v]) => [`resultSummary.${k}`, v]),
    ],
  });

  if (type === 'customer') {
    sections.push({
      title: 'Customer Profile',
      columns: ['Field', 'Value'],
      rows: buildFieldValueRows({
        customerId: data?.customer?.customerId || data?.searchedId,
        uid: data?.customer?.uid,
        userType: data?.customer?.userType,
        name: data?.customer?.name,
        email: data?.customer?.email,
        phone: data?.customer?.phone,
        status: data?.customer?.status,
        joinDate: data?.customer?.createdAt,
        lastActivity: data?.stats?.lastActivity,
        totalOrders: data?.stats?.totalOrders,
        totalSpent: data?.stats?.totalSpent,
      }),
    });

    sections.push({
      title: 'Customer Addresses',
      columns: ['S.No', 'Address'],
      rows: (data?.customer?.addresses || []).map((addr, idx) => [idx + 1, normalizeAddressText(addr)]),
    });

    sections.push({
      title: 'Linked Restaurants',
      columns: ['Business ID', 'RS ID', 'Name', 'Business Type', 'Approval Status'],
      rows: (data?.linkedBusinesses || []).map((b) => [
        b.businessId || '',
        b.merchantId || '',
        b.name || '',
        b.businessType || '',
        b.approvalStatus || '',
      ]),
    });

    sections.push({
      title: 'Recent Orders',
      columns: ['Firestore Order ID', 'Customer Order ID', 'Status', 'Order Date', 'Delivery Type', 'Payment Method', 'Payment Status', 'Restaurant ID', 'Grand Total'],
      rows: (data?.recentOrders || []).map((o) => [
        o.firestoreOrderId || '',
        o.customerOrderId || '',
        o.status || '',
        o.orderDate || '',
        o.deliveryType || '',
        o.paymentMethod || '',
        o.paymentStatus || '',
        o.restaurantId || '',
        o.grandTotal ?? '',
      ]),
    });
  } else if (type === 'restaurant') {
    sections.push({
      title: 'Restaurant Profile',
      columns: ['Field', 'Value'],
      rows: buildFieldValueRows({
        merchantId: data?.restaurant?.merchantId || data?.searchedId,
        businessId: data?.restaurant?.businessId,
        name: data?.restaurant?.name,
        businessType: data?.restaurant?.businessType,
        approvalStatus: data?.restaurant?.approvalStatus,
        ownerId: data?.restaurant?.ownerId,
        createdAt: data?.restaurant?.createdAt,
        lastActivity: data?.stats?.lastActivity,
        totalOrders: data?.stats?.totalOrders,
        totalRevenue: data?.stats?.totalRevenue,
      }),
    });

    sections.push({
      title: 'Owner Details',
      columns: ['Field', 'Value'],
      rows: buildFieldValueRows({
        ownerId: data?.owner?.ownerId,
        ownerName: data?.owner?.name,
        ownerEmail: data?.owner?.email,
        ownerPhone: data?.owner?.phone,
        ownerStatus: data?.owner?.status,
      }),
    });

    sections.push({
      title: 'Recent Orders',
      columns: ['Firestore Order ID', 'Customer Order ID', 'Status', 'Order Date', 'Delivery Type', 'Payment Method', 'Payment Status', 'User ID', 'Grand Total'],
      rows: (data?.recentOrders || []).map((o) => [
        o.firestoreOrderId || '',
        o.customerOrderId || '',
        o.status || '',
        o.orderDate || '',
        o.deliveryType || '',
        o.paymentMethod || '',
        o.paymentStatus || '',
        o.userId || '',
        o.grandTotal ?? '',
      ]),
    });
  } else {
    sections.push({
      title: 'Order Summary',
      columns: ['Field', 'Value'],
      rows: buildFieldValueRows({
        customerOrderId: data?.order?.customerOrderId,
        firestoreOrderId: data?.order?.firestoreOrderId,
        status: data?.order?.status,
        orderDate: data?.order?.orderDate,
        deliveryType: data?.order?.deliveryType,
        paymentMethod: data?.order?.paymentMethod,
        paymentStatus: data?.order?.paymentStatus,
        restaurantId: data?.order?.restaurantId,
        userId: data?.order?.userId,
        customerName: data?.order?.customerName,
        customerPhone: data?.order?.customerPhone,
        customerAddress: data?.order?.customerAddress,
        subtotal: data?.order?.subtotal,
        cgst: data?.order?.cgst,
        sgst: data?.order?.sgst,
        gstAmount: data?.order?.gstAmount,
        deliveryCharge: data?.order?.deliveryCharge,
        tipAmount: data?.order?.tipAmount,
        grandTotal: data?.order?.grandTotal,
      }),
    });

    sections.push({
      title: 'Customer Details',
      columns: ['Field', 'Value'],
      rows: buildFieldValueRows({
        customerId: data?.customer?.customerId,
        uid: data?.customer?.uid || data?.order?.userId,
        name: data?.customer?.name || data?.order?.customerName,
        email: data?.customer?.email,
        phone: data?.customer?.phone || data?.order?.customerPhone,
        status: data?.customer?.status,
      }),
    });

    sections.push({
      title: 'Restaurant Details',
      columns: ['Field', 'Value'],
      rows: buildFieldValueRows({
        merchantId: data?.restaurant?.merchantId,
        businessId: data?.restaurant?.businessId || data?.order?.restaurantId,
        name: data?.restaurant?.name,
        businessType: data?.restaurant?.businessType,
        ownerId: data?.restaurant?.ownerId,
      }),
    });

    sections.push({
      title: 'Order Items',
      columns: ['Item Name', 'Qty', 'Price', 'Line Total'],
      rows: (data?.order?.items || []).map((item) => [
        item.name || '',
        item.qty ?? '',
        item.price ?? '',
        item.total ?? '',
      ]),
    });

    sections.push({
      title: 'Status Timeline',
      columns: ['Status', 'Timestamp', 'Notes'],
      rows: (data?.order?.statusHistory || []).map((entry) => [
        entry.status || '',
        entry.timestamp || '',
        entry.notes || '',
      ]),
    });
  }

  return sections;
};

const sectionsToCsv = (sections) => {
  const lines = [];
  sections.forEach((section, idx) => {
    lines.push(csvEscape(section.title));
    lines.push((section.columns || []).map(csvEscape).join(','));
    (section.rows || []).forEach((row) => {
      lines.push((row || []).map(csvEscape).join(','));
    });
    if (idx < sections.length - 1) {
      lines.push('');
      lines.push('');
    }
  });
  return `\uFEFF${lines.join('\n')}`;
};

const sectionsToExcelHtml = (sections) => {
  const tables = sections.map((section) => {
    const head = (section.columns || [])
      .map((col) => `<th>${htmlEscape(col)}</th>`)
      .join('');
    const body = (section.rows || [])
      .map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join('')}</tr>`)
      .join('');
    return `
      <h3>${htmlEscape(section.title || '')}</h3>
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
      <br/>
    `;
  }).join('');

  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; }
          h3 { margin: 18px 0 6px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 10px; }
          th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; }
        </style>
      </head>
      <body>${tables}</body>
    </html>
  `;
};

const sectionsToPrintHtml = (sections, meta = {}) => {
  const tables = sections.map((section) => {
    const head = (section.columns || [])
      .map((col) => `<th>${htmlEscape(col)}</th>`)
      .join('');
    const body = (section.rows || [])
      .map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join('')}</tr>`)
      .join('');
    return `
      <section class="block">
        <h3>${htmlEscape(section.title || '')}</h3>
        <table>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </section>
    `;
  }).join('');

  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>${htmlEscape(meta.title || 'Check IDs Audit Export')}</title>
        <style>
          @page { size: A4; margin: 14mm; }
          body { font-family: Arial, sans-serif; font-size: 11px; color: #111827; }
          .header { margin-bottom: 10px; border-bottom: 1px solid #d1d5db; padding-bottom: 8px; }
          .title { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
          .sub { font-size: 11px; color: #4b5563; margin: 0; }
          .block { margin-top: 14px; }
          h3 { margin: 0 0 6px; font-size: 13px; }
          table { border-collapse: collapse; width: 100%; table-layout: fixed; }
          th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; word-wrap: break-word; }
          th { background: #f3f4f6; font-weight: 700; }
          .note { margin-top: 10px; font-size: 10px; color: #6b7280; }
        </style>
      </head>
      <body>
        <header class="header">
          <h1 class="title">${htmlEscape(meta.title || 'Check IDs Audit Export')}</h1>
          <p class="sub">Generated at: ${htmlEscape(meta.generatedAt || new Date().toISOString())}</p>
        </header>
        ${tables}
        <p class="note">ServiZephyr Admin Audit Export</p>
        <script>
          window.addEventListener('load', function () {
            setTimeout(function () { window.print(); }, 200);
          });
        </script>
      </body>
    </html>
  `;
};

const triggerFileDownload = (content, fileName, mimeType) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const openPrintWindow = (html) => {
  if (typeof window === 'undefined') return false;
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const printWin = window.open(blobUrl, '_blank', 'width=1100,height=800');

    if (!printWin) {
      URL.revokeObjectURL(blobUrl);
      return false;
    }

    const cleanup = () => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch (_) {
        // no-op
      }
    };

    try {
      printWin.addEventListener('beforeunload', cleanup, { once: true });
    } catch (_) {
      setTimeout(cleanup, 60 * 1000);
    }

    setTimeout(() => {
      try {
        printWin.focus();
      } catch (_) {
        // no-op
      }
    }, 300);

    return true;
  } catch (_) {
    return false;
  }
};

function AuditSummaryCard({ audit }) {
  if (!audit) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit Summary</CardTitle>
        <CardDescription>Search trace for compliance and forensic review.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        <p><span className="text-muted-foreground">Event:</span> {audit.event || 'N/A'}</p>
        <p><span className="text-muted-foreground">Request ID:</span> {audit.requestId || 'N/A'}</p>
        <p><span className="text-muted-foreground">Searched At:</span> {formatDateTime(audit.searchedAt)}</p>
        <p><span className="text-muted-foreground">Search Type:</span> {audit.searchType || 'N/A'}</p>
        <p><span className="text-muted-foreground">Searched ID:</span> {audit.searchedId || 'N/A'}</p>
        <p><span className="text-muted-foreground">Admin UID:</span> {audit?.searchedBy?.uid || 'N/A'}</p>
        <p className="md:col-span-2"><span className="text-muted-foreground">Admin Email:</span> {audit?.searchedBy?.email || 'N/A'}</p>
      </CardContent>
    </Card>
  );
}

function OrdersPreviewTable({ orders = [] }) {
  if (!orders.length) {
    return <p className="text-sm text-muted-foreground">No recent orders found.</p>;
  }

  return (
    <div className="rounded-md border border-border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.firestoreOrderId}>
              <TableCell className="font-medium">{order.customerOrderId || order.firestoreOrderId}</TableCell>
              <TableCell>{order.status || 'N/A'}</TableCell>
              <TableCell>{formatDateTime(order.orderDate)}</TableCell>
              <TableCell className="text-right">{formatCurrency(order.grandTotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SearchResultRenderer({ type, result }) {
  if (!result) return null;

  if (type === 'customer') {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><User size={18} /> Customer Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <p><span className="text-muted-foreground">Customer ID:</span> {result.customer.customerId || result.searchedId}</p>
            <p><span className="text-muted-foreground">UID:</span> {result.customer.uid || 'N/A'}</p>
            <p><span className="text-muted-foreground">Name:</span> {result.customer.name || 'N/A'}</p>
            <p><span className="text-muted-foreground">Email:</span> {result.customer.email || 'N/A'}</p>
            <p><span className="text-muted-foreground">Phone:</span> {result.customer.phone || 'N/A'}</p>
            <p><span className="text-muted-foreground">Status:</span> {result.customer.status || 'N/A'}</p>
            <p><span className="text-muted-foreground">Join Date:</span> {formatDateTime(result.customer.createdAt)}</p>
            <p><span className="text-muted-foreground">Last Activity:</span> {formatDateTime(result.stats?.lastActivity)}</p>
            <p><span className="text-muted-foreground">Total Orders:</span> {result.stats?.totalOrders ?? 0}</p>
            <p><span className="text-muted-foreground">Total Spend:</span> {formatCurrency(result.stats?.totalSpent)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved Addresses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(result.customer.addresses || []).length > 0 ? (
              result.customer.addresses.map((addr, idx) => (
                <div key={`${idx}-${addr.full || 'address'}`} className="p-2 rounded-md bg-muted/50 border border-border">
                  {addr.full || 'N/A'}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No saved addresses.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Linked Restaurants</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(result.linkedBusinesses || []).length > 0 ? (
              result.linkedBusinesses.map((business) => (
                <div key={business.businessId} className="p-2 rounded-md bg-muted/50 border border-border">
                  <p className="font-medium">{business.name}</p>
                  <p className="text-muted-foreground">RS ID: {business.merchantId || 'N/A'} | Type: {business.businessType}</p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No linked restaurants found.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity (Orders)</CardTitle>
          </CardHeader>
          <CardContent>
            <OrdersPreviewTable orders={result.recentOrders || []} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (type === 'restaurant') {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Building2 size={18} /> Restaurant Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <p><span className="text-muted-foreground">Restaurant ID:</span> {result.restaurant.merchantId || result.searchedId}</p>
            <p><span className="text-muted-foreground">Business Doc ID:</span> {result.restaurant.businessId || 'N/A'}</p>
            <p><span className="text-muted-foreground">Name:</span> {result.restaurant.name || 'N/A'}</p>
            <p><span className="text-muted-foreground">Type:</span> {result.restaurant.businessType || 'N/A'}</p>
            <p><span className="text-muted-foreground">Status:</span> {result.restaurant.approvalStatus || 'N/A'}</p>
            <p><span className="text-muted-foreground">Owner ID:</span> {result.restaurant.ownerId || 'N/A'}</p>
            <p><span className="text-muted-foreground">Created:</span> {formatDateTime(result.restaurant.createdAt)}</p>
            <p><span className="text-muted-foreground">Last Activity:</span> {formatDateTime(result.stats?.lastActivity)}</p>
            <p><span className="text-muted-foreground">Total Orders:</span> {result.stats?.totalOrders ?? 0}</p>
            <p><span className="text-muted-foreground">Total Revenue:</span> {formatCurrency(result.stats?.totalRevenue)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Owner Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <p><span className="text-muted-foreground">Owner Name:</span> {result.owner?.name || 'N/A'}</p>
            <p><span className="text-muted-foreground">Owner Email:</span> {result.owner?.email || 'N/A'}</p>
            <p><span className="text-muted-foreground">Owner Phone:</span> {result.owner?.phone || 'N/A'}</p>
            <p><span className="text-muted-foreground">Owner Status:</span> {result.owner?.status || 'N/A'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity (Orders)</CardTitle>
          </CardHeader>
          <CardContent>
            <OrdersPreviewTable orders={result.recentOrders || []} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><ShoppingBag size={18} /> Order Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <p><span className="text-muted-foreground">Customer Order ID:</span> {result.order.customerOrderId || 'N/A'}</p>
          <p><span className="text-muted-foreground">Firestore Order ID:</span> {result.order.firestoreOrderId || 'N/A'}</p>
          <p><span className="text-muted-foreground">Status:</span> {result.order.status || 'N/A'}</p>
          <p><span className="text-muted-foreground">Order Date:</span> {formatDateTime(result.order.orderDate)}</p>
          <p><span className="text-muted-foreground">Delivery Type:</span> {result.order.deliveryType || 'N/A'}</p>
          <p><span className="text-muted-foreground">Payment Method:</span> {result.order.paymentMethod || 'N/A'}</p>
          <p><span className="text-muted-foreground">Payment Status:</span> {result.order.paymentStatus || 'N/A'}</p>
          <p><span className="text-muted-foreground">Grand Total:</span> {formatCurrency(result.order.grandTotal)}</p>
          <p><span className="text-muted-foreground">Subtotal:</span> {formatCurrency(result.order.subtotal)}</p>
          <p><span className="text-muted-foreground">Delivery Charge:</span> {formatCurrency(result.order.deliveryCharge)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer Info</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <p><span className="text-muted-foreground">Name:</span> {result.customer?.name || result.order.customerName || 'N/A'}</p>
          <p><span className="text-muted-foreground">Phone:</span> {result.customer?.phone || result.order.customerPhone || 'N/A'}</p>
          <p><span className="text-muted-foreground">UID:</span> {result.customer?.uid || result.order.userId || 'N/A'}</p>
          <p><span className="text-muted-foreground">Customer ID:</span> {result.customer?.customerId || 'N/A'}</p>
          <p className="md:col-span-2"><span className="text-muted-foreground">Address:</span> {result.order.customerAddress || result.customer?.addresses?.[0]?.full || 'N/A'}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Restaurant Info</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <p><span className="text-muted-foreground">Name:</span> {result.restaurant?.name || 'N/A'}</p>
          <p><span className="text-muted-foreground">RS ID:</span> {result.restaurant?.merchantId || 'N/A'}</p>
          <p><span className="text-muted-foreground">Business ID:</span> {result.restaurant?.businessId || result.order.restaurantId || 'N/A'}</p>
          <p><span className="text-muted-foreground">Type:</span> {result.restaurant?.businessType || 'N/A'}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ordered Items</CardTitle>
        </CardHeader>
        <CardContent>
          {(result.order.items || []).length > 0 ? (
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.order.items.map((item, idx) => (
                    <TableRow key={`${item.name}-${idx}`}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell className="text-right">{item.qty}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.price)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No items found on this order.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(result.order.statusHistory || []).length > 0 ? (
            result.order.statusHistory.map((entry, idx) => (
              <div key={`${entry.status}-${idx}`} className="p-2 rounded-md border border-border bg-muted/40">
                <p className="font-medium">{entry.status}</p>
                <p className="text-muted-foreground">{formatDateTime(entry.timestamp)}</p>
                {entry.notes ? <p className="text-muted-foreground">{entry.notes}</p> : null}
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No status history available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminCheckIdsPage() {
  const [activeTab, setActiveTab] = useState('customer');
  const [inputs, setInputs] = useState({ customer: '', restaurant: '', order: '' });
  const [results, setResults] = useState({ customer: null, restaurant: null, order: null });
  const [responsePackets, setResponsePackets] = useState({ customer: null, restaurant: null, order: null });
  const [errors, setErrors] = useState({ customer: '', restaurant: '', order: '' });
  const [loading, setLoading] = useState({ customer: false, restaurant: false, order: false });
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

  const setInput = (type, value) => {
    setInputs((prev) => ({ ...prev, [type]: value }));
  };

  const handleSearch = async (type) => {
    const id = (inputs[type] || '').trim();
    if (!id) {
      setErrors((prev) => ({ ...prev, [type]: 'Please paste an ID first.' }));
      return;
    }

    setErrors((prev) => ({ ...prev, [type]: '' }));
    setLoading((prev) => ({ ...prev, [type]: true }));

    try {
      const currentUser = auth.currentUser;
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/check-ids', {
        method: 'POST',
        headers,
        body: JSON.stringify({ type, id }),
      });
      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload.message || 'Failed to fetch details');
      }

      setResults((prev) => ({ ...prev, [type]: payload.data }));
      setResponsePackets((prev) => ({ ...prev, [type]: payload }));
      setErrors((prev) => ({ ...prev, [type]: '' }));
    } catch (error) {
      setResults((prev) => ({ ...prev, [type]: null }));
      setResponsePackets((prev) => ({ ...prev, [type]: null }));
      setErrors((prev) => ({ ...prev, [type]: error.message }));
      setInfoDialog({ isOpen: true, title: 'Search Failed', message: error.message });
    } finally {
      setLoading((prev) => ({ ...prev, [type]: false }));
    }
  };

  const handleExport = (type, format = 'csv') => {
    const packet = responsePackets[type];
    if (!packet) {
      setInfoDialog({ isOpen: true, title: 'No Data', message: 'Export karne ke liye pehle search result lao.' });
      return;
    }

    const sections = buildExportSections(type, packet);
    const rawId = (inputs[type] || packet?.audit?.searchedId || 'unknown').trim();
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'unknown';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'excel') {
      const html = sectionsToExcelHtml(sections);
      triggerFileDownload(
        html,
        `check-ids-${type}-${safeId}-${timestamp}.xls`,
        'application/vnd.ms-excel;charset=utf-8;'
      );
      return;
    }

    if (format === 'pdf') {
      const printHtml = sectionsToPrintHtml(sections, {
        title: `Check IDs Audit Export - ${type.toUpperCase()} - ${safeId}`,
        generatedAt: new Date().toISOString(),
      });
      const opened = openPrintWindow(printHtml);
      if (!opened) {
        setInfoDialog({
          isOpen: true,
          title: 'Popup Blocked',
          message: 'PDF window blocked ho gayi. Browser popup allow karo aur dubara Export PDF karo.',
        });
      }
      return;
    }

    const csv = sectionsToCsv(sections);
    triggerFileDownload(
      csv,
      `check-ids-${type}-${safeId}-${timestamp}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  const renderTabContent = (type) => (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Hash size={18} />
            {TAB_CONFIG[type].title}
          </CardTitle>
          <CardDescription>{TAB_CONFIG[type].hint}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={inputs[type]}
            onChange={(e) => setInput(type, e.target.value)}
            placeholder={TAB_CONFIG[type].placeholder}
            className="min-h-[90px]"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleSearch(type)} disabled={loading[type]}>
              {loading[type] ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search
            </Button>
            <Button variant="secondary" onClick={() => handleExport(type, 'csv')} disabled={!responsePackets[type]}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => handleExport(type, 'excel')} disabled={!responsePackets[type]}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
            <Button variant="secondary" onClick={() => handleExport(type, 'pdf')} disabled={!responsePackets[type]}>
              <FileDown className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setInput(type, '');
                setResults((prev) => ({ ...prev, [type]: null }));
                setResponsePackets((prev) => ({ ...prev, [type]: null }));
                setErrors((prev) => ({ ...prev, [type]: '' }));
              }}
            >
              Clear
            </Button>
          </div>
          {errors[type] ? <p className="text-sm text-destructive">{errors[type]}</p> : null}
        </CardContent>
      </Card>

      <AuditSummaryCard audit={responsePackets[type]?.audit} />
      <SearchResultRenderer type={type} result={results[type]} />
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Check IDs</h1>
        <p className="text-muted-foreground mt-1">
          ID paste karo aur full details turant verify karo for Customer, Restaurant, and Order.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-1 md:grid-cols-3">
          <TabsTrigger value="customer">Customer Search</TabsTrigger>
          <TabsTrigger value="restaurant">Restaurant Search</TabsTrigger>
          <TabsTrigger value="order">Order Search</TabsTrigger>
        </TabsList>

        <TabsContent value="customer" className="mt-4">
          {renderTabContent('customer')}
        </TabsContent>
        <TabsContent value="restaurant" className="mt-4">
          {renderTabContent('restaurant')}
        </TabsContent>
        <TabsContent value="order" className="mt-4">
          {renderTabContent('order')}
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Tips</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>1. Customer tab me `CS_...` format ID use karo.</p>
          <p>2. Restaurant tab me `RS_...` format ID use karo.</p>
          <p>3. Order tab me customer order ID ya firestore order doc ID dono chalenge.</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
