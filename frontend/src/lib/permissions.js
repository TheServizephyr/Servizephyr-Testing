/**
 * ServiZephyr RBAC - Permission System
 * 
 * This file defines all roles and their permissions for the multi-tenant system.
 * 
 * ROLES:
 * - owner: Full control over everything
 * - manager: Almost everything except payment settings
 * - chef: Kitchen operations only
 * - waiter: Dine-in and table management
 * - cashier: Billing and payment processing
 * - order_taker: Create orders only
 */

// ============================================
// PERMISSION CONSTANTS
// ============================================

export const PERMISSIONS = {
    // Dashboard & Analytics
    VIEW_DASHBOARD: 'view_dashboard',
    VIEW_ANALYTICS: 'view_analytics',

    // Orders
    VIEW_ORDERS: 'view_orders',
    VIEW_ALL_ORDERS: 'view_all_orders',      // See all order types
    VIEW_KITCHEN_ORDERS: 'view_kitchen_orders', // Only kitchen relevant orders
    VIEW_DINE_IN_ORDERS: 'view_dine_in_orders', // Only dine-in orders
    CREATE_ORDER: 'create_order',
    UPDATE_ORDER_STATUS: 'update_order_status',
    MARK_ORDER_READY: 'mark_order_ready',
    MARK_ORDER_PREPARING: 'mark_order_preparing',
    CANCEL_ORDER: 'cancel_order',
    REFUND_ORDER: 'refund_order',
    MARK_ORDER_SERVED: 'mark_order_served',

    // Dine-in Management
    MANAGE_DINE_IN: 'manage_dine_in',
    VIEW_TABLES: 'view_tables',
    ASSIGN_TABLE: 'assign_table',
    ADD_TO_TAB: 'add_to_tab',
    CLOSE_TAB: 'close_tab',

    // Billing & Payments
    GENERATE_BILL: 'generate_bill',
    PROCESS_PAYMENT: 'process_payment',
    VIEW_PAYMENTS: 'view_payments',
    MANAGE_PAYMENT_SETTINGS: 'manage_payment_settings',

    // Manual Billing
    MANUAL_BILLING: {
        READ: 'manual_billing:read',
        WRITE: 'manual_billing:write',
    },

    // Menu Management
    VIEW_MENU: 'view_menu',
    EDIT_MENU: 'edit_menu',
    ADD_MENU_ITEM: 'add_menu_item',
    DELETE_MENU_ITEM: 'delete_menu_item',
    TOGGLE_ITEM_STOCK: 'toggle_item_stock', // Mark in/out of stock

    // Employee Management
    VIEW_EMPLOYEES: 'view_employees',
    MANAGE_EMPLOYEES: 'manage_employees',
    INVITE_EMPLOYEE: 'invite_employee',
    REMOVE_EMPLOYEE: 'remove_employee',

    // Customer Management
    VIEW_CUSTOMERS: 'view_customers',
    MANAGE_CUSTOMERS: 'manage_customers',

    // Settings
    VIEW_SETTINGS: 'view_settings',
    MANAGE_SETTINGS: 'manage_settings',
    MANAGE_OUTLET_SETTINGS: 'manage_outlet_settings',

    // Delivery
    VIEW_DELIVERY: 'view_delivery',
    MANAGE_DELIVERY: 'manage_delivery',
    ASSIGN_RIDER: 'assign_rider',

    // Coupons & Offers
    VIEW_COUPONS: 'view_coupons',
    MANAGE_COUPONS: 'manage_coupons',

    // Bookings
    VIEW_BOOKINGS: 'view_bookings',
    MANAGE_BOOKINGS: 'manage_bookings',
};

// ============================================
// ROLE DEFINITIONS
// ============================================

export const ROLES = {
    // ===== OWNER ROLES (NOT hirable as employees) =====
    OWNER: 'owner',                      // Restaurant/Shop owner
    STREET_VENDOR: 'street-vendor',      // Street vendor owner

    // ===== EMPLOYEE ROLES (Can be hired) =====
    MANAGER: 'manager',
    CHEF: 'chef',
    WAITER: 'waiter',
    CASHIER: 'cashier',
    ORDER_TAKER: 'order_taker',
    CUSTOM: 'custom',                    // Custom role with owner-defined permissions

    // ===== FUTURE ENTERPRISE ROLES =====
    HQ_ANALYST: 'hq_analyst',            // Read-only analytics for multi-outlet
    INVENTORY_MANAGER: 'inventory_manager',  // Stock/inventory management
};

// Normalize legacy/business-owner role variants to RBAC base roles.
// This keeps old role values (e.g. "restaurant-owner") compatible with
// centralized permission checks.
const ROLE_ALIAS_MAP = {
    'restaurant-owner': ROLES.OWNER,
    'shop-owner': ROLES.OWNER,
    'store-owner': ROLES.OWNER,
    'street_vendor': ROLES.STREET_VENDOR,
};

export function normalizeRole(role) {
    if (typeof role !== 'string') return role;
    const normalized = role.trim().toLowerCase();
    return ROLE_ALIAS_MAP[normalized] || normalized;
}

export function normalizeBusinessType(type) {
    if (typeof type !== 'string') return null;
    const normalized = type.trim().toLowerCase();
    if (normalized === 'street_vendor') return 'street-vendor';
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'restaurant' || normalized === 'street-vendor') {
        return normalized;
    }
    return null;
}

// ============================================
// ROLE DISPLAY NAMES (English - All India)
// ============================================
// Format: "Role Name (What they can access)"
// NOTE: OWNER and STREET_VENDOR are NOT included - they are not hirable employee roles

export const ROLE_DISPLAY_NAMES = {
    [ROLES.MANAGER]: 'Manager (All except Payouts)',
    [ROLES.CHEF]: 'Chef (Kitchen & Orders only)',
    [ROLES.WAITER]: 'Waiter (Orders, Dine-in, Bookings)',
    [ROLES.CASHIER]: 'Cashier (Orders & Billing)',
    [ROLES.ORDER_TAKER]: 'Order Taker (Create orders only)',
    [ROLES.CUSTOM]: 'Custom (Select pages)',
    // Future enterprise roles
    [ROLES.HQ_ANALYST]: 'HQ Analyst (Read-only Analytics)',
    [ROLES.INVENTORY_MANAGER]: 'Inventory Manager (Stock only)',
};

export const STORE_ROLE_DISPLAY_NAMES = {
    [ROLES.MANAGER]: 'Store Manager (Operations & Orders)',
    [ROLES.CHEF]: 'Packing Staff (Order Processing)',
    [ROLES.WAITER]: 'Counter Staff (Customer Assistance)',
    [ROLES.CASHIER]: 'Billing Staff (Payments & Orders)',
    [ROLES.ORDER_TAKER]: 'Sales Assistant (Create orders)',
    [ROLES.CUSTOM]: 'Custom (Select pages)',
    [ROLES.HQ_ANALYST]: 'HQ Analyst (Read-only Analytics)',
    [ROLES.INVENTORY_MANAGER]: 'Inventory Manager (Stock only)',
};

export const STREET_VENDOR_ROLE_DISPLAY_NAMES = {
    [ROLES.MANAGER]: 'Operations Manager (Orders & Stall Ops)',
    [ROLES.CHEF]: 'Cooking Staff (Preparation & Orders)',
    [ROLES.WAITER]: 'Service Staff (Customer Handling)',
    [ROLES.CASHIER]: 'Billing Staff (Payments & Orders)',
    [ROLES.ORDER_TAKER]: 'Order Assistant (Create orders)',
    [ROLES.CUSTOM]: 'Custom (Select pages)',
    [ROLES.HQ_ANALYST]: 'HQ Analyst (Read-only Analytics)',
    [ROLES.INVENTORY_MANAGER]: 'Inventory Manager (Stock only)',
};

export function getRoleDisplayName(role, businessType = 'restaurant') {
    const effectiveRole = normalizeRole(role);
    const normalizedBusinessType = normalizeBusinessType(businessType) || 'restaurant';
    if (normalizedBusinessType === 'store') {
        return STORE_ROLE_DISPLAY_NAMES[effectiveRole] || ROLE_DISPLAY_NAMES[effectiveRole] || effectiveRole;
    }
    if (normalizedBusinessType === 'street-vendor') {
        return STREET_VENDOR_ROLE_DISPLAY_NAMES[effectiveRole] || ROLE_DISPLAY_NAMES[effectiveRole] || effectiveRole;
    }
    return ROLE_DISPLAY_NAMES[effectiveRole] || effectiveRole;
}

// ============================================
// DASHBOARD PAGES FOR CUSTOM ROLE UI
// These match the actual sidebar menu items for each dashboard type
// ============================================

// Owner/Restaurant Dashboard Pages (matches Sidebar getMenuItems + getSettingsItems)
export const OWNER_DASHBOARD_PAGES = [
    { id: 'dashboard', label: 'Dashboard', description: 'Overview and quick stats' },
    { id: 'live-orders', label: 'Live Orders', description: 'View and manage incoming orders' },
    { id: 'menu', label: 'Menu Management', description: 'Edit menu items and categories' },
    { id: 'dine-in', label: 'Dine-in Tables', description: 'Manage tables and tabs' },
    { id: 'bookings', label: 'Bookings', description: 'Table reservations' },
    { id: 'employees', label: 'Team/Employees', description: 'View team members' },
    { id: 'customers', label: 'Customers', description: 'Customer list and data' },
    { id: 'whatsapp-direct', label: 'WhatsApp Direct', description: 'WhatsApp ordering link' },
    { id: 'analytics', label: 'Analytics', description: 'Sales and order analytics' },
    { id: 'delivery', label: 'Delivery', description: 'Delivery settings and riders' },
    { id: 'coupons', label: 'Coupons & Offers', description: 'Manage discounts' },
    { id: 'location', label: 'Location', description: 'Outlet location settings' },
    { id: 'connections', label: 'Connections', description: 'Integrations and bots' },
    { id: 'payouts', label: 'Payouts', description: 'Payment settings' },
    { id: 'settings', label: 'Settings', description: 'Outlet settings' },
];

// Street Vendor Dashboard Pages (matches street-vendor Sidebar)
export const STREET_VENDOR_DASHBOARD_PAGES = [
    { id: 'live-orders', label: 'Live Orders', description: 'View and manage incoming orders' },
    { id: 'menu', label: 'My Menu', description: 'Edit menu items and categories' },
    { id: 'employees', label: 'Team', description: 'View team members' },
    { id: 'analytics', label: 'Analytics', description: 'Sales and order analytics' },
    { id: 'qr', label: 'My QR Code', description: 'Generate and manage QR codes' },
    { id: 'coupons', label: 'Coupons & Offers', description: 'Manage discounts' },
    { id: 'profile', label: 'Profile', description: 'Business profile settings' },
    { id: 'payouts', label: 'Payouts', description: 'Payout settings' },
];

// Legacy export for backward compatibility (use OWNER_DASHBOARD_PAGES by default)
export const ALL_DASHBOARD_PAGES = OWNER_DASHBOARD_PAGES;

// ============================================
// ROLE → PERMISSIONS MAPPING
// ============================================

const P = PERMISSIONS; // Shorthand for cleaner code

export const ROLE_PERMISSIONS = {
    // OWNER - Full control over everything
    [ROLES.OWNER]: [
        // All string permissions
        ...Object.values(PERMISSIONS).filter(v => typeof v === 'string'),
        // Plus nested permission objects
        P.MANUAL_BILLING.READ,
        P.MANUAL_BILLING.WRITE,
    ],

    // STREET_VENDOR - Same as owner (for backward compatibility)
    [ROLES.STREET_VENDOR]: [
        ...Object.values(PERMISSIONS).filter(v => typeof v === 'string'),
        P.MANUAL_BILLING.READ,
        P.MANUAL_BILLING.WRITE,
    ],

    // MANAGER - Almost everything except payment settings & delete
    [ROLES.MANAGER]: [
        P.VIEW_DASHBOARD,
        P.VIEW_ANALYTICS,
        P.VIEW_ORDERS,
        P.VIEW_ALL_ORDERS,
        P.CREATE_ORDER,
        P.UPDATE_ORDER_STATUS,
        P.MARK_ORDER_READY,
        P.MARK_ORDER_PREPARING,
        P.CANCEL_ORDER,
        P.MARK_ORDER_SERVED,
        // P.REFUND_ORDER, // Only owner can refund
        P.MANAGE_DINE_IN,
        P.VIEW_TABLES,
        P.ASSIGN_TABLE,
        P.ADD_TO_TAB,
        P.CLOSE_TAB,
        P.GENERATE_BILL,
        P.PROCESS_PAYMENT,
        P.VIEW_PAYMENTS,
        // P.MANAGE_PAYMENT_SETTINGS, // Only owner
        P.VIEW_MENU,
        P.EDIT_MENU,
        P.ADD_MENU_ITEM,
        P.DELETE_MENU_ITEM,
        P.TOGGLE_ITEM_STOCK,
        P.MANUAL_BILLING.READ,
        P.MANUAL_BILLING.WRITE,
        P.VIEW_EMPLOYEES,
        P.MANAGE_EMPLOYEES, // Can manage employees below their level
        P.INVITE_EMPLOYEE,
        // P.REMOVE_EMPLOYEE, // Only owner
        P.VIEW_CUSTOMERS,
        P.MANAGE_CUSTOMERS,
        P.VIEW_SETTINGS,
        P.MANAGE_SETTINGS,
        // P.MANAGE_OUTLET_SETTINGS, // Only owner
        P.VIEW_DELIVERY,
        P.MANAGE_DELIVERY,
        P.ASSIGN_RIDER,
        P.VIEW_COUPONS,
        P.MANAGE_COUPONS,
        P.VIEW_BOOKINGS,
        P.MANAGE_BOOKINGS,
    ],

    // CHEF - Kitchen operations only
    [ROLES.CHEF]: [
        P.VIEW_ORDERS,
        P.VIEW_KITCHEN_ORDERS,
        P.MARK_ORDER_READY,
        P.MARK_ORDER_PREPARING,
        P.VIEW_MENU,
        P.TOGGLE_ITEM_STOCK, // Can mark items as out of stock
    ],

    // WAITER - Dine-in and table management
    [ROLES.WAITER]: [
        P.VIEW_ORDERS,
        P.VIEW_DINE_IN_ORDERS,
        P.CREATE_ORDER,
        P.MARK_ORDER_SERVED,
        P.MANAGE_DINE_IN,
        P.VIEW_TABLES,
        P.ASSIGN_TABLE,
        P.ADD_TO_TAB,
        P.CLOSE_TAB,
        P.GENERATE_BILL,
        P.VIEW_MENU,
    ],

    // CASHIER - Billing and payment processing
    [ROLES.CASHIER]: [
        P.VIEW_ORDERS,
        P.VIEW_ALL_ORDERS,
        P.CREATE_ORDER,
        P.MANAGE_DINE_IN,
        P.VIEW_TABLES,
        P.ADD_TO_TAB,
        P.CLOSE_TAB,
        P.GENERATE_BILL,
        P.PROCESS_PAYMENT,
        P.VIEW_PAYMENTS,
        P.MANUAL_BILLING.READ,
        P.MANUAL_BILLING.WRITE,
        P.VIEW_MENU,
    ],

    // ORDER_TAKER - Create orders only
    [ROLES.ORDER_TAKER]: [
        P.VIEW_ORDERS,
        P.VIEW_DINE_IN_ORDERS,
        P.CREATE_ORDER,
        P.VIEW_MENU,
        P.VIEW_TABLES,
    ],
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a role has a specific permission
 * @param {string} role - The role to check
 * @param {string} permission - The permission to check for
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
    if (!role || !permission) return false;

    const effectiveRole = normalizeRole(role);
    const rolePermissions = ROLE_PERMISSIONS[effectiveRole];
    if (!rolePermissions) return false;

    return rolePermissions.includes(permission);
}

/**
 * Get all permissions for a role
 * @param {string} role - The role
 * @returns {string[]} Array of permission strings
 */
export function getPermissionsForRole(role) {
    const effectiveRole = normalizeRole(role);
    return ROLE_PERMISSIONS[effectiveRole] || [];
}

/**
 * Check if user has any of the required permissions
 * @param {string[]} userPermissions - User's permissions array
 * @param {string[]} requiredPermissions - Required permissions (any one)
 * @returns {boolean}
 */
export function hasAnyPermission(userPermissions, requiredPermissions) {
    if (!userPermissions || !requiredPermissions) return false;
    return requiredPermissions.some(p => userPermissions.includes(p));
}

/**
 * Check if user has all of the required permissions
 * @param {string[]} userPermissions - User's permissions array
 * @param {string[]} requiredPermissions - Required permissions (all)
 * @returns {boolean}
 */
export function hasAllPermissions(userPermissions, requiredPermissions) {
    if (!userPermissions || !requiredPermissions) return false;
    return requiredPermissions.every(p => userPermissions.includes(p));
}

/**
 * Get role hierarchy level (higher = more permissions)
 * Used to ensure managers can't add other managers, only lower roles
 * @param {string} role
 * @returns {number}
 */
export function getRoleLevel(role) {
    const effectiveRole = normalizeRole(role);
    const levels = {
        [ROLES.OWNER]: 100,
        [ROLES.MANAGER]: 80,
        [ROLES.CASHIER]: 50,
        [ROLES.WAITER]: 40,
        [ROLES.CHEF]: 40,
        [ROLES.ORDER_TAKER]: 20,
    };
    return levels[effectiveRole] || 0;
}

/**
 * Check if roleA can manage roleB (invite/remove)
 * @param {string} roleA - The acting role
 * @param {string} roleB - The target role
 * @returns {boolean}
 */
export function canManageRole(roleA, roleB) {
    return getRoleLevel(roleA) > getRoleLevel(roleB);
}

/**
 * Get roles that a given role can invite
 * @param {string} role - The role doing the inviting
 * @returns {string[]} - Roles that can be invited (employee roles only)
 */
export function getInvitableRoles(role) {
    // Only allow inviting EMPLOYEE roles (not owner/street-vendor)
    const currentLevel = getRoleLevel(role);
    return EMPLOYEE_ROLES.filter(r => getRoleLevel(r) < currentLevel);
}

// ============================================
// EMPLOYEE ROLES (Excludes owner - for dropdowns)
// ============================================

export const EMPLOYEE_ROLES = [
    ROLES.MANAGER,
    ROLES.CHEF,
    ROLES.WAITER,
    ROLES.CASHIER,
    ROLES.ORDER_TAKER,
    ROLES.CUSTOM,    // Custom role with owner-defined pages
];

// ============================================
// ROLE → ALLOWED PAGES MAPPING (For Sidebar)
// ============================================

// Feature IDs that each role can access
export const ROLE_ALLOWED_PAGES = {
    // Owner has access to ALL pages
    [ROLES.OWNER]: 'all',

    // Street Vendor has access to ALL pages (same as owner)
    [ROLES.STREET_VENDOR]: 'all',

    // Manager - almost everything EXCEPT payouts (financial info is owner-only)
    [ROLES.MANAGER]: [
        'dashboard',
        'live-orders',
        'menu',
        'dine-in',
        'bookings',
        'employees',
        'customers',
        'whatsapp-direct',
        'analytics',
        'delivery',
        'coupons',
        'qr',
        'profile',
        'my-profile',
        // 'payouts' - intentionally excluded for managers (owner-only)
        'location',
        'connections',
        'settings',
    ],

    // Chef - only live orders (to see and mark orders ready)
    [ROLES.CHEF]: [
        'live-orders',  // Main dashboard shows live orders for street-vendor
        'menu',
        'my-profile',
    ],

    // Waiter - live orders and dine-in
    [ROLES.WAITER]: [
        'live-orders',
        'menu',
        'dine-in',
        'bookings',
        'my-profile',
    ],

    // Cashier - live orders and billing
    [ROLES.CASHIER]: [
        'live-orders',
        'menu',
        'dine-in',
        'my-profile',
    ],

    // Order Taker - only live orders
    [ROLES.ORDER_TAKER]: [
        'live-orders',
        'my-profile',
    ],
};

/**
 * Get allowed pages for a role
 * @param {string} role - User's role
 * @returns {string[] | 'all'} - Array of allowed feature IDs or 'all'
 */
export function getAllowedPages(role) {
    const effectiveRole = normalizeRole(role);
    return ROLE_ALLOWED_PAGES[effectiveRole] || [];
}

/**
 * Check if a role can access a specific page/feature
 * @param {string} role - User's role
 * @param {string} featureId - The page/feature ID
 * @param {string[]} customAllowedPages - Optional array of allowed pages for custom roles
 * @returns {boolean}
 */
export function canAccessPage(role, featureId, customAllowedPages = null) {
    const effectiveRole = normalizeRole(role);

    // For custom roles, use the provided customAllowedPages
    if (effectiveRole === ROLES.CUSTOM && customAllowedPages) {
        // Always allow my-profile for all employees
        if (featureId === 'my-profile') return true;
        return customAllowedPages.includes(featureId);
    }

    const allowedPages = ROLE_ALLOWED_PAGES[effectiveRole];
    if (!allowedPages) return false;
    if (allowedPages === 'all') return true;
    return allowedPages.includes(featureId);
}

// ============================================
// DEFAULT PERMISSIONS FOR NEW EMPLOYEES
// ============================================

export function getDefaultPermissionsForRole(role) {
    const effectiveRole = normalizeRole(role);
    return ROLE_PERMISSIONS[effectiveRole] || [];
}

