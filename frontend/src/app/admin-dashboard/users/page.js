

'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { MoreVertical, Eye, UserX, UserCheck, Search, RefreshCw, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import InfoDialog from '@/components/InfoDialog';


const UserRow = ({ user, serial, onUpdateStatus, onRemoveGuest, onRemoveUser, onOpenDetails, onOpenActivity }) => {
  const formatDate = (value, withTime = false) => {
    if (!value) return 'N/A';
    const d = new Date(value);
    if (isNaN(d.getTime())) return 'N/A';
    return withTime ? d.toLocaleString() : d.toLocaleDateString();
  };

  const statusClasses = {
    Active: 'bg-green-500/10 text-green-400',
    Blocked: 'bg-red-500/10 text-red-400',
  };

  const roleClasses = {
    Owner: 'bg-primary/10 text-primary',
    Customer: 'bg-blue-500/10 text-blue-400',
    'Guest Customer': 'bg-indigo-500/10 text-indigo-300',
    'Street Vendor': 'bg-orange-500/10 text-orange-400',
    'Shop Owner': 'bg-purple-500/10 text-purple-400',
    Rider: 'bg-cyan-500/10 text-cyan-400',
    Admin: 'bg-red-500/10 text-red-400'
  }

  return (
    <TableRow className="cursor-pointer hover:bg-muted/30" onClick={() => onOpenDetails(user)}>
      <TableCell className="w-10 text-muted-foreground">{serial}</TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarImage src={user.profilePictureUrl || `https://picsum.photos/seed/${user.id}/40/40`} />
            <AvatarFallback>{user.name?.charAt(0) || 'U'}</AvatarFallback>
          </Avatar>
          <span className="font-medium">{user.name}</span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell text-muted-foreground">{user.email}</TableCell>
      <TableCell className="hidden lg:table-cell text-muted-foreground">{user.phone}</TableCell>
      <TableCell className="hidden xl:table-cell text-muted-foreground max-w-[260px] truncate">{user.address || 'No Address'}</TableCell>
      <TableCell>
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${roleClasses[user.role]}`}>
          {user.role}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">{formatDate(user.joinDate)}</TableCell>
      <TableCell className="hidden lg:table-cell">
        {formatDate(user.lastActivity, true)}
      </TableCell>
      <TableCell>
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClasses[user.status]}`}>
          {user.status}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpenActivity(user); }}>
              <Eye className="mr-2 h-4 w-4" /> View Activity
            </DropdownMenuItem>
            {(user.role === 'Owner' || user.role === 'Street Vendor' || user.role === 'Shop Owner') && (
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                const dashboardPath = user.role === 'Street Vendor'
                  ? '/street-vendor-dashboard'
                  : '/owner-dashboard';
                window.location.href = `${dashboardPath}?impersonate_owner_id=${user.id}&session_expiry=${Date.now() + (2 * 60 * 60 * 1000)}`;
              }}>
                <Eye className="mr-2 h-4 w-4" /> View as Owner
              </DropdownMenuItem>
            )}
            {user.role === 'Customer' && (
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                window.location.href = `/customer-dashboard?impersonate_user_id=${user.id}&session_expiry=${Date.now() + (2 * 60 * 60 * 1000)}`;
              }}>
                <Eye className="mr-2 h-4 w-4" /> View as Customer
              </DropdownMenuItem>
            )}
            {user.role === 'Rider' && (
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                window.location.href = `/rider-dashboard?impersonate_user_id=${user.id}&session_expiry=${Date.now() + (2 * 60 * 60 * 1000)}`;
              }}>
                <Eye className="mr-2 h-4 w-4" /> View as Rider
              </DropdownMenuItem>
            )}
            {user.status === 'Active' ? (
              <DropdownMenuItem className="text-red-500" onClick={(e) => { e.stopPropagation(); onUpdateStatus(user.id, 'Blocked', user.userType); }}><UserX className="mr-2 h-4 w-4" /> Block User</DropdownMenuItem>
            ) : (
              <DropdownMenuItem className="text-green-500" onClick={(e) => { e.stopPropagation(); onUpdateStatus(user.id, 'Active', user.userType); }}><UserCheck className="mr-2 h-4 w-4" /> Unblock User</DropdownMenuItem>
            )}
            {user.role === 'Guest Customer' && (
              <DropdownMenuItem className="text-red-500" onClick={(e) => { e.stopPropagation(); onRemoveGuest(user.id); }}>
                <Trash2 className="mr-2 h-4 w-4" /> Remove Guest
              </DropdownMenuItem>
            )}
            {user.role === 'Customer' && user.userType === 'user' && (
              <DropdownMenuItem className="text-red-500" onClick={(e) => { e.stopPropagation(); onRemoveUser(user.id); }}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete Customer
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
  const [detailOpen, setDetailOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedUserDetail, setSelectedUserDetail] = useState(null);
  const [selectedUserActivity, setSelectedUserActivity] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      // Attach Firebase ID token for admin-protected endpoints
      const currentUser = auth.currentUser;
      const headers = {};
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/users', { headers });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to fetch users');
      }
      const data = await res.json();
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUserDeepData = async (user) => {
    setDetailLoading(true);
    try {
      const currentUser = auth.currentUser;
      const headers = {};
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const userType = user.userType || (user.role === 'Guest Customer' ? 'guest' : 'user');
      const res = await fetch(`/api/admin/users/${user.id}?userType=${userType}`, { headers });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to fetch user details');
      }
      const data = await res.json();
      setSelectedUserDetail(data.user || null);
      setSelectedUserActivity(Array.isArray(data.activity) ? data.activity : []);
    } catch (err) {
      setInfoDialog({ isOpen: true, title: 'Error', message: err.message });
      setSelectedUserDetail(null);
      setSelectedUserActivity([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleOpenDetails = async (user) => {
    setSelectedUser(user);
    setDetailOpen(true);
    await fetchUserDeepData(user);
  };

  const handleOpenActivity = async (user) => {
    setSelectedUser(user);
    setActivityOpen(true);
    await fetchUserDeepData(user);
  };

  const handleUpdateStatus = async (userId, newStatus, userType = 'user') => {
    try {
      // Attach Firebase ID token for admin-protected endpoints
      const currentUser = auth.currentUser;
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ userId, status: newStatus, userType, action: 'status' })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to update user');
      }
      fetchUsers();
    } catch (err) {
      setInfoDialog({ isOpen: true, title: "Error", message: err.message });
    }
  };

  const handleRemoveGuest = async (userId) => {
    const confirmed = window.confirm('Remove this guest profile from admin list?');
    if (!confirmed) return;
    try {
      const currentUser = auth.currentUser;
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ userId, userType: 'guest', action: 'remove' })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to remove guest');
      }
      fetchUsers();
    } catch (err) {
      setInfoDialog({ isOpen: true, title: "Error", message: err.message });
    }
  };

  const handleRemoveUser = async (userId) => {
    const confirmed = window.confirm('Delete this UID customer from active list?');
    if (!confirmed) return;
    try {
      const currentUser = auth.currentUser;
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ userId, userType: 'user', action: 'remove' })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to delete user');
      }
      fetchUsers();
    } catch (err) {
      setInfoDialog({ isOpen: true, title: "Error", message: err.message });
    }
  };

  const filteredUsers = (role) =>
    users.filter((u) =>
      u.role === role &&
      (
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
        String(u.phone || '').toLowerCase().includes(search.toLowerCase())
      )
    );

  const getRoleCount = (role) => filteredUsers(role).length;

  const formatDateValue = (value, withTime = false) => {
    if (!value) return 'N/A';
    const d = new Date(value);
    if (isNaN(d.getTime())) return 'N/A';
    return withTime ? d.toLocaleString() : d.toLocaleDateString();
  };

  const renderTableContent = (role) => {
    if (loading) {
      return (
        <TableRow>
          <TableCell colSpan={10} className="text-center p-8">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          </TableCell>
        </TableRow>
      );
    }
    if (error) {
      return (
        <TableRow>
          <TableCell colSpan={10} className="text-center p-8 text-destructive">
            Error: {error}
          </TableCell>
        </TableRow>
      );
    }
    const data = filteredUsers(role);
    if (data.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={10} className="text-center p-8 text-muted-foreground">
            No users found for this role.
          </TableCell>
        </TableRow>
      )
    }
    return data.map((u, idx) => (
      <UserRow
        key={u.id}
        user={u}
        serial={idx + 1}
        onUpdateStatus={handleUpdateStatus}
        onRemoveGuest={handleRemoveGuest}
        onRemoveUser={handleRemoveUser}
        onOpenDetails={handleOpenDetails}
        onOpenActivity={handleOpenActivity}
      />
    ));
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />
      <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
      <Tabs defaultValue="owners">
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
          <TabsList className="w-full flex justify-start overflow-x-auto no-scrollbar gap-2 bg-muted/50 p-1 h-auto rounded-xl">
            <TabsTrigger value="owners" className="flex-shrink-0 rounded-lg">Owners ({getRoleCount('Owner')})</TabsTrigger>
            <TabsTrigger value="customers" className="flex-shrink-0 rounded-lg">Customers ({getRoleCount('Customer')})</TabsTrigger>
            <TabsTrigger value="guest-customers" className="flex-shrink-0 rounded-lg">Guest Customers ({getRoleCount('Guest Customer')})</TabsTrigger>
            <TabsTrigger value="street-vendors" className="flex-shrink-0 rounded-lg">Street Vendors ({getRoleCount('Street Vendor')})</TabsTrigger>
            <TabsTrigger value="shop-owners" className="flex-shrink-0 rounded-lg">Shop Owners ({getRoleCount('Shop Owner')})</TabsTrigger>
            <TabsTrigger value="riders" className="flex-shrink-0 rounded-lg">Riders ({getRoleCount('Rider')})</TabsTrigger>
            <TabsTrigger value="admins" className="flex-shrink-0 rounded-lg">Admins ({getRoleCount('Admin')})</TabsTrigger>
          </TabsList>
          <div className="relative w-full md:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="hidden lg:table-cell">Phone</TableHead>
                  <TableHead className="hidden xl:table-cell">Address</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Join Date</TableHead>
                  <TableHead className="hidden lg:table-cell">Last Activity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TabsContent value="owners" className="contents">
                  {renderTableContent('Owner')}
                </TabsContent>
                <TabsContent value="customers" className="contents">
                  {renderTableContent('Customer')}
                </TabsContent>
                <TabsContent value="guest-customers" className="contents">
                  {renderTableContent('Guest Customer')}
                </TabsContent>
                <TabsContent value="street-vendors" className="contents">
                  {renderTableContent('Street Vendor')}
                </TabsContent>
                <TabsContent value="shop-owners" className="contents">
                  {renderTableContent('Shop Owner')}
                </TabsContent>
                <TabsContent value="riders" className="contents">
                  {renderTableContent('Rider')}
                </TabsContent>
                <TabsContent value="admins" className="contents">
                  {renderTableContent('Admin')}
                </TabsContent>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Tabs>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customer Details</DialogTitle>
            <DialogDescription>
              Complete profile information including addresses and latest order reference.
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading details...</div>
          ) : selectedUserDetail ? (
            <div className="space-y-6">
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDetailOpen(false);
                    setActivityOpen(true);
                  }}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View Activity
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="font-medium">{selectedUserDetail.name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Role</p>
                  <p className="font-medium">{selectedUserDetail.role || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p className="font-medium">{selectedUserDetail.phone || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="font-medium break-all">{selectedUserDetail.email || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Join Date</p>
                  <p className="font-medium">{formatDateValue(selectedUserDetail.joinDate, true)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Activity</p>
                  <p className="font-medium">{formatDateValue(selectedUserDetail.lastActivity, true)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-medium">{selectedUserDetail.status || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Orders</p>
                  <p className="font-medium">{selectedUserDetail.totalOrders ?? 0}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs text-muted-foreground">Last Order Customer Order ID</p>
                  <p className="font-medium">{selectedUserDetail.lastOrderCustomerOrderId || 'N/A'}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">All Saved Addresses</p>
                {Array.isArray(selectedUserDetail.addresses) && selectedUserDetail.addresses.length > 0 ? (
                  <div className="space-y-2">
                    {selectedUserDetail.addresses.map((addr, idx) => (
                      <div key={`${idx}-${addr.full || 'addr'}`} className="rounded-md border border-border p-3 text-sm">
                        <p className="font-medium">Address #{idx + 1}</p>
                        <p className="text-muted-foreground break-words">{addr.full || 'N/A'}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No addresses found.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-muted-foreground">No detail data found.</div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customer Activity</DialogTitle>
            <DialogDescription>
              Recent order history and status activity for {selectedUser?.name || 'selected user'}.
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading activity...</div>
          ) : selectedUserActivity.length > 0 ? (
            <div className="space-y-3">
              {selectedUserActivity.map((act) => (
                <div key={act.orderId} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      Order ID: <span className="text-primary">{act.customerOrderId || act.orderId}</span>
                    </p>
                    <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                      {act.status || 'unknown'}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground grid grid-cols-1 md:grid-cols-2 gap-1">
                    <p>Date: {formatDateValue(act.orderDate, true)}</p>
                    <p>Amount: Rs. {act.totalAmount ?? 0}</p>
                    <p>Delivery Type: {act.deliveryType || 'N/A'}</p>
                    <p>Restaurant: {act.restaurantId || 'N/A'}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-muted-foreground">No activity found for this user.</div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
