'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFirebase } from '@/firebase';
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
    Edit,
    Copy,
    CheckCircle,
    RefreshCw,
    MessageSquare,
    Link as LinkIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OWNER_DASHBOARD_PAGES } from '@/lib/permissions';
import { cn } from '@/lib/utils';

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
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-green-50 dark:bg-green-900/30 p-6 text-center border-b border-green-200 dark:border-green-800">
                    <div className="w-16 h-16 bg-green-100 dark:bg-green-800/50 rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">Invite Link Created!</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                        Share this link with <span className="text-slate-900 dark:text-white font-medium">{email}</span>
                    </p>
                </div>

                {/* Link Box */}
                <div className="p-6">
                    <div className="bg-slate-100 dark:bg-slate-700/50 rounded-xl p-4 mb-4">
                        <div className="flex items-center gap-2 mb-2">
                            <LinkIcon className="w-4 h-4 text-slate-400" />
                            <span className="text-sm text-slate-500 dark:text-slate-400">Invitation Link</span>
                        </div>
                        <p className="text-slate-900 dark:text-white text-sm break-all font-mono bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-600">
                            {inviteLink}
                        </p>
                    </div>

                    <p className="text-slate-500 dark:text-slate-400 text-sm text-center mb-4">
                        They will join as <span className="text-blue-600 dark:text-blue-400 font-semibold capitalize">{role}</span> using Google login
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

    // Reset custom fields when role changes
    useEffect(() => {
        if (role !== 'custom') {
            setCustomRoleName('');
            setSelectedPages([]);
        } else {
            // Default to live-orders for custom role
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto">
            <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md max-h-[95vh] sm:max-h-[90vh] flex flex-col my-auto overflow-hidden">
                <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">Add Employee</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Send an invitation to join your team</p>
                </div>

                <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Email Address *
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="employee@email.com"
                            required
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Name (Optional)
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Employee name"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Phone Number
                        </label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="9876543210"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Role *
                        </label>
                        <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            required
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Custom Role Name *
                                </label>
                                <input
                                    type="text"
                                    value={customRoleName}
                                    onChange={(e) => setCustomRoleName(e.target.value)}
                                    placeholder="e.g., Supervisor, Kitchen Helper"
                                    required={isCustomRole}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Page Access * (Select pages this employee can view)
                                </label>
                                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
                                    {allDashboardPages?.map((page) => (
                                        <label
                                            key={page.id}
                                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedPages.includes(page.id)}
                                                onChange={() => handlePageToggle(page.id)}
                                                className="w-5 h-5 rounded border-slate-300 text-purple-500 focus:ring-purple-500"
                                            />
                                            <div>
                                                <p className="text-sm font-medium text-slate-900 dark:text-white">{page.label}</p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">{page.description}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                    {selectedPages.length} page(s) selected
                                </p>
                            </div>
                        </motion.div>
                    )}

                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
                        <p className="text-blue-700 dark:text-blue-300 text-sm">
                            📧 An email will be sent with a link to join your team. The employee will sign in with Google using this email.
                        </p>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={onClose}
                            className="flex-1"
                            disabled={loading}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!email || !role || (isCustomRole && (!customRoleName || selectedPages.length === 0)) || loading}
                            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white"
                        >
                            {loading ? 'Sending...' : 'Send Invitation'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}


// Employee Card
function EmployeeCard({ employee, onAction, isPending }) {
    const [showMenu, setShowMenu] = useState(false);
    const [copied, setCopied] = useState(false);

    const roleColors = {
        owner: 'bg-gradient-to-r from-yellow-100 to-orange-100 text-yellow-700 dark:from-yellow-900/40 dark:to-orange-900/40 dark:text-yellow-300',
        manager: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
        chef: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
        waiter: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
        cashier: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
        order_taker: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
        custom: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
    };

    const copyInviteLink = async () => {
        if (employee.inviteLink) {
            await navigator.clipboard.writeText(employee.inviteLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className={cn(
            "bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700",
            employee.status === 'inactive' && 'opacity-60',
            employee.isYou && 'ring-2 ring-blue-500/30'
        )}>
            <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center",
                    employee.isOwner
                        ? "bg-gradient-to-br from-yellow-400 to-orange-500"
                        : "bg-slate-100 dark:bg-slate-700"
                )}>
                    {isPending ? (
                        <Clock className="w-5 h-5 text-yellow-500" />
                    ) : employee.isOwner ? (
                        <span className="text-lg font-bold text-white">👑</span>
                    ) : (
                        <span className="text-lg font-bold text-slate-400">
                            {(employee.name || employee.email)?.[0]?.toUpperCase() || '?'}
                        </span>
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                            {employee.isYou ? '(You)' : (employee.name || 'Pending...')}
                        </h3>
                        {isPending && (
                            <span className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 px-2 py-0.5 rounded-full">
                                Pending
                            </span>
                        )}
                        {employee.status === 'inactive' && (
                            <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded-full">
                                Inactive
                            </span>
                        )}
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-sm truncate">{employee.email}</p>
                    <div className="mt-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${roleColors[employee.role] || 'bg-slate-100 text-slate-600'}`}>
                            {employee.roleDisplay || employee.role}
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="relative">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowMenu(!showMenu)}
                        className="text-slate-400 hover:text-slate-600"
                    >
                        <MoreVertical className="w-5 h-5" />
                    </Button>

                    {showMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setShowMenu(false)}
                            />
                            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-700 rounded-xl shadow-lg border border-slate-200 dark:border-slate-600 py-1 min-w-[160px] z-50">
                                {isPending && (
                                    <button
                                        onClick={() => { copyInviteLink(); setShowMenu(false); }}
                                        className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center gap-2"
                                    >
                                        {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                        {copied ? 'Copied!' : 'Copy Invite Link'}
                                    </button>
                                )}
                                {!isPending && employee.status === 'active' && (
                                    <button
                                        onClick={() => { onAction('deactivate', employee); setShowMenu(false); }}
                                        className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center gap-2"
                                    >
                                        <X className="w-4 h-4" />
                                        Deactivate
                                    </button>
                                )}
                                {!isPending && employee.status === 'inactive' && (
                                    <button
                                        onClick={() => { onAction('reactivate', employee); setShowMenu(false); }}
                                        className="w-full px-4 py-2 text-left text-sm text-green-600 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center gap-2"
                                    >
                                        <Check className="w-4 h-4" />
                                        Reactivate
                                    </button>
                                )}
                                <button
                                    onClick={() => { onAction('remove', employee); setShowMenu(false); }}
                                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    {isPending ? 'Cancel Invite' : 'Remove'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function EmployeesPage() {
    const { user } = useFirebase();
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
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [inviteDialog, setInviteDialog] = useState({ isOpen: false, link: '', email: '', role: '' });

    // Fetch employees
    const fetchEmployees = useCallback(async () => {
        if (!user) return;

        try {
            const token = await user.getIdToken();
            const url = buildEmployeesApiUrl();
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (response.ok) {
                const data = await response.json();
                // Mark which employee is the current user
                const employeesWithYou = (data.employees || []).map(emp => ({
                    ...emp,
                    isYou: emp.userId === data.currentUserId,
                }));
                setEmployees(employeesWithYou);
                setPendingInvites(data.pendingInvites || []);
                setInvitableRoles(data.invitableRoles || []);
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
                    customRoleName,     // For custom role: display name
                    customAllowedPages  // For custom role: array of page IDs
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
                if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
                setInviteDialog({
                    isOpen: true,
                    link: inviteLink,
                    email,
                    role: data.invitation?.roleDisplay || role,
                });
            }

            setSuccessMessage(`Invitation sent to ${email}!`);
            setTimeout(() => setSuccessMessage(''), 3000);

            // Add to pending list with invite link
            setPendingInvites(prev => [...prev, {
                email,
                name,
                role,
                roleDisplay: data.invitation?.roleDisplay || (role === 'custom' ? customRoleName : role),
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
            const token = await user.getIdToken();

            if (action === 'remove' && employee.status === 'pending') {
                // Cancel pending invite
                await fetch(buildEmployeesApiUrl('/api/owner/employees', { inviteCode: employee.id }), {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                setPendingInvites(prev => prev.filter(p => p.id !== employee.id));
            } else if (action === 'remove') {
                // Remove active employee
                await fetch(buildEmployeesApiUrl('/api/owner/employees', { employeeId: employee.userId }), {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                setEmployees(prev => prev.filter(e => e.userId !== employee.userId));
            } else {
                // Update employee status
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
                fetchEmployees(); // Refresh list
            }

            setSuccessMessage(`Employee ${action}d successfully!`);
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
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    const totalEmployees = employees.length;
    const activeEmployees = employees.filter(e => e.status === 'active').length;

    return (
        <div className="p-6">
            {/* Success Message */}
            {successMessage && (
                <div className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    {successMessage}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                        <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Team Members</h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                            {activeEmployees} active • {pendingInvites.length} pending
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={fetchEmployees}
                        className="text-slate-400"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </Button>
                    <Button
                        onClick={() => setShowAddModal(true)}
                        className="bg-blue-500 hover:bg-blue-600 text-white"
                    >
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add Employee
                    </Button>
                </div>
            </div>

            {/* Empty State */}
            {employees.length === 0 && pendingInvites.length === 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-12 text-center">
                    <div className="w-16 h-16 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Users className="w-8 h-8 text-slate-400" />
                    </div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">No Team Members Yet</h2>
                    <p className="text-slate-500 dark:text-slate-400 mb-6">
                        Add employees to help manage your business
                    </p>
                    <Button
                        onClick={() => setShowAddModal(true)}
                        className="bg-blue-500 hover:bg-blue-600 text-white"
                    >
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add Your First Employee
                    </Button>
                </div>
            )}

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
                <div className="mb-8">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-yellow-500" />
                        Pending Invitations ({pendingInvites.length})
                    </h2>
                    <div className="space-y-3">
                        {pendingInvites.map((invite, idx) => (
                            <EmployeeCard
                                key={invite.id || idx}
                                employee={invite}
                                isPending={true}
                                onAction={handleEmployeeAction}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Active Employees */}
            {employees.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <Shield className="w-5 h-5 text-green-500" />
                        Team Members ({employees.length})
                    </h2>
                    <div className="space-y-3">
                        {employees.map((employee, idx) => (
                            <EmployeeCard
                                key={employee.userId || idx}
                                employee={employee}
                                isPending={false}
                                onAction={handleEmployeeAction}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Add Employee Modal */}
            <AddEmployeeModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onSubmit={handleAddEmployee}
                invitableRoles={invitableRoles}
                loading={actionLoading}
                allDashboardPages={OWNER_DASHBOARD_PAGES}
            />

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
