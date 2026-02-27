
'use client';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Trash2, UserX, Clock } from 'lucide-react';

const mockFeed = [
    { id: 1, user: 'Rohan Sharma', avatar: 'https://picsum.photos/seed/rohan/40/40', time: '2h ago', content: 'Just tried the new Schezwan Pizza from Pizza Paradise! Absolutely amazing. 🔥 #Foodie', image: 'https://picsum.photos/seed/pizza/400/200' },
    { id: 2, user: 'Priya Desai', avatar: 'https://picsum.photos/seed/priya/40/40', time: '5h ago', content: 'Weekend vibes mean Curry Corner! Their Butter Chicken is legendary.' },
    { id: 3, user: 'Amit Patel', avatar: 'https://picsum.photos/seed/amit/40/40', time: '1d ago', content: 'Anyone has recommendations for the best burgers in town? Tried Burger Barn, looking for something new.' },
];

const PostCard = ({ post }) => (
    <Card>
        <CardContent className="p-4">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                    <Avatar>
                        <AvatarImage src={post.avatar} />
                        <AvatarFallback>{post.user.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                        <p className="font-semibold">{post.user}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={12}/> {post.time}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="text-red-500 hover:bg-red-500/10 hover:text-red-500">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete Post
                    </Button>
                     <Button variant="outline" size="sm">
                        <UserX className="mr-2 h-4 w-4" /> Block User
                    </Button>
                </div>
            </div>
            <p className="mt-4 text-foreground">{post.content}</p>
            {post.image && (
                <div className="mt-4 relative w-full h-[300px] rounded-lg overflow-hidden">
                    <Image
                        src={post.image}
                        alt="Post content"
                        fill
                        unoptimized
                        sizes="(max-width: 768px) 100vw, 640px"
                        className="object-cover"
                    />
                </div>
            )}
        </CardContent>
    </Card>
);

export default function AdminCommunityPage() {
    
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };
    
    const itemVariants = {
        hidden: { y: 20, opacity: 0 },
        visible: { y: 0, opacity: 1 }
    };

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Community Feed Moderation</h1>
            <div className="space-y-4">
                {mockFeed.map(post => (
                    <motion.div key={post.id} variants={itemVariants}>
                        <PostCard post={post} />
                    </motion.div>
                ))}
            </div>
        </motion.div>
    );
}
