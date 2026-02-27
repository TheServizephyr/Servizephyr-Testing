import { cn } from "@/lib/utils";

/**
 * Reusable Order Status Badge Component
 * 
 * Displays order status with consistent styling across all pages
 * 
 * @param {string} status - Order status (pending, confirmed, delivered, etc.)
 * @param {string} className - Optional additional CSS classes
 */
export function OrderStatusBadge({ status, className }) {
    const statusConfig = {
        pending: { label: 'New', color: 'bg-blue-500/20 text-blue-400' },
        confirmed: { label: 'Confirmed', color: 'bg-purple-500/20 text-purple-400' },
        preparing: { label: 'Preparing', color: 'bg-yellow-500/20 text-yellow-400' },
        ready_for_pickup: { label: 'Ready', color: 'bg-orange-500/20 text-orange-400' },
        dispatched: { label: 'Dispatched', color: 'bg-cyan-500/20 text-cyan-400' },
        delivered: { label: 'Delivered', color: 'bg-green-500/20 text-green-400' },
        picked_up: { label: 'Picked Up', color: 'bg-green-500/20 text-green-400' },
        rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-400' },
        cancelled: { label: 'Cancelled', color: 'bg-gray-500/20 text-gray-400' },
    };

    const config = statusConfig[status] || {
        label: status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown',
        color: 'bg-gray-500/20 text-gray-400'
    };

    return (
        <span className={cn(
            "px-2 py-1 rounded-full text-xs font-semibold inline-block",
            config.color,
            className
        )}>
            {config.label}
        </span>
    );
}
