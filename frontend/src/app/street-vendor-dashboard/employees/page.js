'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Users,
    UserPlus,
    Mail,
    Shield,
    MoreVertical,
    Check,
    X,
    Clock,
    Trash2,
    Copy,
    CheckCircle,
    RefreshCw,
    ChefHat,
    MessageSquare,
    Link as LinkIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ROLE_DISPLAY_NAMES, STREET_VENDOR_DASHBOARD_PAGES } from '@/lib/permissions';

// Invite Link Dialog Component
function InviteLinkDialog({ isOpen, onClose, inviteLink, email, role }) {
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const handleCopy = async () => {
        await navigator.clipboard.writeText(inviteLink);
        setCopied(true);
        if (navigator.vibrate) navigator.vibrate(50);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleWhatsAppShare = () => {
        const message = encodeURIComponent(
            `You're invited to join our team!\n\nClick this link to accept:\n${inviteLink}\n\nJust sign in with Google to get started.`
        );
        window.open(`https://wa.me/?text=${message}`, '_blank');
        if (navigator.vibrate) navigator.vibrate(50);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-card border border-border rounded-2xl w-full max-w-md overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-green-500/20 p-6 text-center border-b border-green-500/30">
                    <div className="w-16 h-16 bg-green-500/30 rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckCircle className="w-8 h-8 text-green-500" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground">Invite Link Created!</h2>
                    <p className="text-muted-foreground text-sm mt-1">
                        Share this link with <span className="text-foreground font-medium">{email}</span>
                    </p>
                </div>

                {/* Link Box */}
                <div className="p-6">
                    <div className="bg-muted rounded-xl p-4 mb-4">
                        <div className="flex items-center gap-2 mb-2">
                            <LinkIcon className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Invitation Link</span>
                        </div>
                        <p className="text-foreground text-sm break-all font-mono bg-background rounded-lg p-3 border border-border">
                            {inviteLink}
                        </p>
                    </div>

                    <p className="text-muted-foreground text-sm text-center mb-4">
                        They will join as <span className="text-primary font-semibold capitalize">{role}</span> using Google login
                    </p>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-3">
                        <Button
                            onClick={handleCopy}
                            variant="outline"
                            className="h-12 text-base font-semibold"
                        >
                            {copied ? (
                                <>
                                    <CheckCircle className="w-5 h-5 mr-2 text-green-500" />
                                    Copied!
                                </>
                            ) : (
                                <>
                                    <Copy className="w-5 h-5 mr-2" />
                                    Copy Link
                                </>
                            )}
                        </Button>
                        <Button
                            onClick={handleWhatsAppShare}
                            className="h-12 text-base font-semibold bg-green-600 hover:bg-green-700 text-white"
                        >
                            <MessageSquare className="w-5 h-5 mr-2" />
                            WhatsApp
                        </Button>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 pb-6">
                    <Button
                        onClick={onClose}
                        variant="secondary"
                        className="w-full"
                    >
                        Done
                    </Button>
                </div>
            </motion.div>
        </motion.div>
    );
}

// Add Employee Modal
function AddEmployeeModal({ isOpen, onClose, onSubmit, invitableRoles, loading, allDashboardPages }) {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState('');
    const [customRoleName, setCustomRoleName] = useState('');
    const [selectedPages, setSelectedPages] = useState([]);

    useEffect(() => {
        if (isOpen) {
            setEmail('');
            setName('');
            setPhone('');
            setRole('');
            setCustomRoleName('');
            setSelectedPages([]);
        }
    }, [isOpen]);

    // Reset custom fields when role changes
    useEffect(() => {
        if (role !== 'custom') {
            setCustomRoleName('');
            setSelectedPages([]);
        } else {
            setSelectedPages(['live-orders', 'my-profile']);
        }
    }, [role]);

    if (!isOpen) return null;

    const handlePageToggle = (pageId) => {
        setSelectedPages(prev =>
            prev.includes(pageId)
                ? prev.filter(p => p !== pageId)
                : [...prev, pageId]
        );
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!email || !role) return;
        if (role === 'custom' && (!customRoleName || selectedPages.length === 0)) return;

        onSubmit({
            email,
            name,
            phone,
            role,
            customRoleName: role === 'custom' ? customRoleName : null,
            customAllowedPages: role === 'custom' ? selectedPages : null
        });
    };

    const isCustomRole = role === 'custom';

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[95vh] sm:max-h-[90vh] flex flex-col my-auto overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 sm:p-6 border-b border-border flex-shrink-0">
                    <h2 className="text-xl font-bold text-foreground">Add Employee</h2>
                    <p className="text-muted-foreground text-sm">Add a new team member</p>
                </div>

                <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                            Email Address *
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="employee@email.com"
                            required
                            className="w-full px-4 py-3 rounded-xl border border-border bg-input text-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                            Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Employee name"
                            className="w-full px-4 py-3 rounded-xl border border-border bg-input text-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                            Phone Number
                        </label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="9876543210"
                            className="w-full px-4 py-3 rounded-xl border border-border bg-input text-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                            Role *
                        </label>
                        <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            required
                            className="w-full px-4 py-3 rounded-xl border border-border bg-input text-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
                        >
                            <option value="">Select a role</option>
                            {invitableRoles?.map((r) => (
                                <option key={r.value} value={r.value}>
                                    {r.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Custom Role Options */}
                    {isCustomRole && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="space-y-4"
                        >
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1">
                                    Custom Role Name *
                                </label>
                                <input
                                    type="text"
                                    value={customRoleName}
                                    onChange={(e) => setCustomRoleName(e.target.value)}
                                    placeholder="e.g., Supervisor, Kitchen Helper"
                                    required={isCustomRole}
                                    className="w-full px-4 py-3 rounded-xl border border-border bg-input text-foreground focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-foreground mb-2">
                                    Page Access * (Select pages this employee can view)
                                </label>
                                <div className="bg-muted rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
                                    {allDashboardPages?.map((page) => (
                                        <label
                                            key={page.id}
                                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted-foreground/10 cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedPages.includes(page.id)}
                                                onChange={() => handlePageToggle(page.id)}
                                                className="w-5 h-5 rounded border-border text-purple-500 focus:ring-purple-500"
                                            />
                                            <div>
                                                <p className="text-sm font-medium text-foreground">{page.label}</p>
                                                <p className="text-xs text-muted-foreground">{page.description}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {selectedPages.length} page(s) selected
                                </p>
                            </div>
                        </motion.div>
                    )}

                    <div className="bg-primary/10 rounded-xl p-4 border border-primary/30">
                        <p className="text-primary text-sm">
                            📧 Share the link via WhatsApp or SMS. Employee will join via Google login.
                        </p>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={onClose}
                            className="flex-1"
                            disabled={loading}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!email || !role || (isCustomRole && (!customRoleName || selectedPages.length === 0)) || loading}
                            className="flex-1 bg-primary hover:bg-primary/90"
                        >
                            {loading ? 'Sending...' : 'Create Link'}
                        </Button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}

// Employee Card
function EmployeeCard({ employee, onAction, isPending }) {
    const [showMenu, setShowMenu] = useState(false);
    const [copied, setCopied] = useState(false);

    const roleColors = {
        owner: 'bg-gradient-to-r from-yellow-500/30 to-orange-500/30 text-yellow-500 border-yellow-500/50',
        manager: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
        chef: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
        waiter: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        cashier: 'bg-green-500/20 text-green-400 border-green-500/30',
        order_taker: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
        custom: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    };

    const copyInviteLink = async () => {
        if (employee.inviteLink) {
            await navigator.clipboard.writeText(employee.inviteLink);
            setCopied(true);
            // Haptic feedback
            if (navigator.vibrate) navigator.vibrate(50);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
                "bg-card rounded-xl p-4 border border-border",
                employee.status === 'inactive' && 'opacity-60',
                employee.isYou && 'ring-2 ring-primary/30'
            )}
        >
            <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center",
                    employee.isOwner ? "bg-gradient-to-br from-yellow-400 to-orange-500" : "bg-muted"
                )}>
                    {isPending ? (
                        <Clock className="w-5 h-5 text-yellow-500" />
                    ) : employee.isOwner ? (
                        <span className="text-lg font-bold text-white">👑</span>
                    ) : (
                        <span className="text-lg font-bold text-muted-foreground">
                            {(employee.name || employee.email)?.[0]?.toUpperCase() || '?'}
                        </span>
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground truncate">
                            {employee.isYou ? '(You)' : (employee.name || 'Pending...')}
                        </h3>
                        {isPending && (
                            <span className="text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full">
                                Pending
                            </span>
                        )}
                        {employee.status === 'inactive' && (
                            <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full">
                                Inactive
                            </span>
                        )}
                    </div>
                    <p className="text-muted-foreground text-sm truncate">{employee.email}</p>
                    <div className="mt-2">
                        <span className={cn("text-xs px-2 py-1 rounded-full border", roleColors[employee.role] || 'bg-muted text-muted-foreground')}>
                            {employee.roleDisplay?.hi || employee.roleDisplay?.en || employee.roleDisplay || employee.role}
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="relative">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowMenu(!showMenu)}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <MoreVertical className="w-5 h-5" />
                    </Button>

                    <AnimatePresence>
                        {showMenu && (
                            <>
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setShowMenu(false)}
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    className="absolute right-0 top-full mt-1 bg-card rounded-xl shadow-lg border border-border py-1 min-w-[160px] z-50"
                                >
                                    {isPending && (
                                        <button
                                            onClick={() => { copyInviteLink(); setShowMenu(false); }}
                                            className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted flex items-center gap-2"
                                        >
                                            {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                            {copied ? 'Copied!' : 'Copy Link'}
                                        </button>
                                    )}
                                    {!isPending && employee.status === 'active' && (
                                        <button
                                            onClick={() => { onAction('deactivate', employee); setShowMenu(false); }}
                                            className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted flex items-center gap-2"
                                        >
                                            <X className="w-4 h-4" />
                                            Deactivate
                                        </button>
                                    )}
                                    {!isPending && employee.status === 'inactive' && (
                                        <button
                                            onClick={() => { onAction('reactivate', employee); setShowMenu(false); }}
                                            className="w-full px-4 py-2 text-left text-sm text-green-400 hover:bg-muted flex items-center gap-2"
                                        >
                                            <Check className="w-4 h-4" />
                                            Reactivate
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { onAction('remove', employee); setShowMenu(false); }}
                                        className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        {isPending ? 'Cancel' : 'Remove'}
                                    </button>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </motion.div>
    );
}

export default function StreetVendorEmployeesPage() {
    const { user } = useUser();
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');

    const buildEmployeesApiUrl = useCallback((basePath = '/api/owner/employees', extraParams = {}) => {
        const url = new URL(basePath, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.set('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.set('employee_of', employeeOfOwnerId);
        }

        Object.entries(extraParams).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        });

        return `${url.pathname}${url.search}`;
    }, [impersonatedOwnerId, employeeOfOwnerId]);

    const [employees, setEmployees] = useState([]);
    const [pendingInvites, setPendingInvites] = useState([]);
    const [invitableRoles, setInvitableRoles] = useState([]);
    const [currentUserId, setCurrentUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [inviteDialog, setInviteDialog] = useState({ isOpen: false, link: '', email: '', role: '' });

    // Haptic feedback
    const vibrateOnClick = () => {
        if (navigator.vibrate) navigator.vibrate(10);
    };

    // Fetch employees
    const fetchEmployees = useCallback(async () => {
        if (!user) return;

        try {
            const token = await user.getIdToken();
            const url = buildEmployeesApiUrl();
            console.log('[Employees Page] Fetching from:', url);
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (response.ok) {
                const data = await response.json();

                // DEBUG: Log full API response
                console.log('[Employees Page] API Response:', JSON.stringify({
                    currentUserId: data.currentUserId,
                    employeesCount: data.employees?.length,
                    employees: data.employees?.map(e => ({ userId: e.userId, role: e.role, name: e.name, isOwner: e.isOwner })),
                    pendingCount: data.pendingInvites?.length,
                }));

                // Mark which employee is the current user
                const employeesWithYou = (data.employees || []).map(emp => ({
                    ...emp,
                    isYou: emp.userId === data.currentUserId,
                }));
                setEmployees(employeesWithYou);
                setPendingInvites(data.pendingInvites || []);
                setInvitableRoles(data.invitableRoles || []);
                setCurrentUserId(data.currentUserId);
            }
        } catch (error) {
            console.error('Error fetching employees:', error);
        } finally {
            setLoading(false);
        }
    }, [user, buildEmployeesApiUrl]);

    useEffect(() => {
        fetchEmployees();
    }, [fetchEmployees]);

    // Handle add employee
    const handleAddEmployee = async ({ email, name, phone, role, customRoleName, customAllowedPages }) => {
        try {
            setActionLoading(true);
            vibrateOnClick();

            const token = await user.getIdToken();
            const response = await fetch(buildEmployeesApiUrl(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email,
                    name,
                    phone,
                    role,
                    customRoleName,
                    customAllowedPages
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to invite employee');
            }

            setShowAddModal(false);

            // Show invite link dialog
            const inviteLink = data.invitation?.inviteLink;
            if (inviteLink) {
                // Haptic success
                if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
                setInviteDialog({ isOpen: true, link: inviteLink, email, role });
            }

            setSuccessMessage('Invitation sent!');
            setTimeout(() => setSuccessMessage(''), 3000);

            setPendingInvites(prev => [...prev, {
                email,
                name,
                role,
                roleDisplay: role === 'custom' ? customRoleName : ROLE_DISPLAY_NAMES[role],
                status: 'pending',
                inviteLink: inviteLink,
            }]);

        } catch (error) {
            alert(error.message);
        } finally {
            setActionLoading(false);
        }
    };

    // Handle employee actions
    const handleEmployeeAction = async (action, employee) => {
        try {
            setActionLoading(true);
            vibrateOnClick();
            const token = await user.getIdToken();

            if (action === 'remove' && employee.status === 'pending') {
                await fetch(buildEmployeesApiUrl('/api/owner/employees', { inviteCode: employee.id }), {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                setPendingInvites(prev => prev.filter(p => p.id !== employee.id));
            } else if (action === 'remove') {
                await fetch(buildEmployeesApiUrl('/api/owner/employees', { employeeId: employee.userId }), {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                setEmployees(prev => prev.filter(e => e.userId !== employee.userId));
            } else {
                await fetch(buildEmployeesApiUrl(), {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        employeeId: employee.userId,
                        action,
                    }),
                });
                fetchEmployees();
            }

            setSuccessMessage('Action successful!');
            setTimeout(() => setSuccessMessage(''), 3000);

        } catch (error) {
            console.error('Action error:', error);
            alert('Failed to perform action');
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
            </div>
        );
    }

    const activeEmployees = employees.filter(e => e.status === 'active').length;

    return (
        <div className="p-4 md:p-6 min-h-screen bg-background text-foreground">
            {/* Success Message */}
            <AnimatePresence>
                {successMessage && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2"
                    >
                        <CheckCircle className="w-5 h-5" />
                        {successMessage}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center">
                        <Users className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Team Members</h1>
                        <p className="text-muted-foreground text-sm">
                            {activeEmployees} active • {pendingInvites.length} pending
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { vibrateOnClick(); fetchEmployees(); }}
                        className="text-muted-foreground"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </Button>
                    <Button
                        onClick={() => { vibrateOnClick(); setShowAddModal(true); }}
                        className="bg-primary hover:bg-primary/90"
                    >
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add
                    </Button>
                </div>
            </div>

            {/* Empty State */}
            {employees.length === 0 && pendingInvites.length === 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card rounded-2xl p-12 text-center border border-border"
                >
                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                        <ChefHat className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h2 className="text-xl font-semibold text-foreground mb-2">No Team Members Yet</h2>
                    <p className="text-muted-foreground mb-6">
                        Add your staff to help manage orders
                    </p>
                    <Button
                        onClick={() => { vibrateOnClick(); setShowAddModal(true); }}
                        className="bg-primary hover:bg-primary/90"
                    >
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add Your First Employee
                    </Button>
                </motion.div>
            )}

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
                <div className="mb-8">
                    <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-yellow-500" />
                        Pending Invitations ({pendingInvites.length})
                    </h2>
                    <div className="space-y-3">
                        <AnimatePresence>
                            {pendingInvites.map((invite, idx) => (
                                <EmployeeCard
                                    key={invite.id || idx}
                                    employee={invite}
                                    isPending={true}
                                    onAction={handleEmployeeAction}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            )}

            {/* Active Employees */}
            {employees.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                        <Shield className="w-5 h-5 text-green-500" />
                        Team Members ({employees.length})
                    </h2>
                    <div className="space-y-3">
                        <AnimatePresence>
                            {employees.map((employee, idx) => (
                                <EmployeeCard
                                    key={employee.userId || idx}
                                    employee={employee}
                                    isPending={false}
                                    onAction={handleEmployeeAction}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            )}

            {/* Add Employee Modal */}
            <AnimatePresence>
                {showAddModal && (
                    <AddEmployeeModal
                        isOpen={showAddModal}
                        onClose={() => setShowAddModal(false)}
                        onSubmit={handleAddEmployee}
                        invitableRoles={invitableRoles}
                        loading={actionLoading}
                        allDashboardPages={STREET_VENDOR_DASHBOARD_PAGES}
                    />
                )}
            </AnimatePresence>

            {/* Invite Link Dialog */}
            <AnimatePresence>
                {inviteDialog.isOpen && (
                    <InviteLinkDialog
                        isOpen={inviteDialog.isOpen}
                        onClose={() => setInviteDialog({ isOpen: false, link: '', email: '', role: '' })}
                        inviteLink={inviteDialog.link}
                        email={inviteDialog.email}
                        role={inviteDialog.role}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
