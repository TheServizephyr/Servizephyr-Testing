'use client';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Save, UserPlus, Trash2 } from 'lucide-react';


const mockAdmins = [
    { id: 1, name: 'Super Admin', email: 'admin@servizephyr.com', role: 'Super Admin' },
    { id: 2, name: 'Support Admin', email: 'support@servizephyr.com', role: 'Moderator' },
];

export default function AdminSettingsPage() {
    
    const itemVariants = {
        hidden: { y: 20, opacity: 0 },
        visible: { y: 0, opacity: 1, transition: { duration: 0.5 } }
    };

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
            
            <motion.div variants={itemVariants}>
                <Card>
                    <CardHeader>
                        <CardTitle>Global Announcements</CardTitle>
                        <CardDescription>Post an announcement banner that will be visible to all restaurant owners on their dashboard.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                             <Label htmlFor="announcement-text">Announcement Text</Label>
                             <Textarea id="announcement-text" placeholder="e.g., Scheduled maintenance on Sunday at 2 AM." />
                        </div>
                    </CardContent>
                    <CardFooter className="border-t px-6 py-4">
                        <Button><Save className="mr-2 h-4 w-4"/>Post Announcement</Button>
                    </CardFooter>
                </Card>
            </motion.div>

             <motion.div variants={itemVariants}>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle>Admin Account Management</CardTitle>
                            <CardDescription>Add or remove administrators for the platform.</CardDescription>
                        </div>
                        <Button variant="outline"><UserPlus className="mr-2 h-4 w-4"/> Add New Admin</Button>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {mockAdmins.map(admin => (
                                    <TableRow key={admin.id}>
                                        <TableCell className="font-medium">{admin.name}</TableCell>
                                        <TableCell>{admin.email}</TableCell>
                                        <TableCell>{admin.role}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-500 hover:bg-red-500/10">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    );
}
