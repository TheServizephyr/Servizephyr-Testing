"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Trash2, Edit } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import styles from "./OwnerDashboard.module.css";

const VegNonVegIcon = ({ isVeg }) => {
    return (
        <div className={`flex items-center justify-center w-5 h-5 border rounded-sm ${isVeg ? 'border-green-500' : 'border-red-500'}`}>
            <div className={`w-3 h-3 rounded-full ${isVeg ? 'bg-green-500' : 'bg-red-500'}`}></div>
        </div>
    );
};

export default function MenuTable({ dishes, onDelete, onToggle, onUpdate }) {

    const handleEdit = (dish) => {
        // In a real app, this would open a form/modal with the dish data
        console.log("Editing:", dish.name);
        // Example of updating price:
        // onUpdate({ ...dish, price: dish.price + 10 });
    };

    return (
        <motion.div
            className={styles.tableContainer}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <div className={styles.tableWrapper} style={{ maxHeight: 'calc(100vh - 250px)' }}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th style={{ width: '40%' }}>Dish</th>
                            <th>Category</th>
                            <th>Price</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {dishes.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="text-center p-8 text-gray-500">
                                    No dishes on the menu. Click &quot;Add New Dish&quot; to start.
                                </td>
                            </tr>
                        ) : (
                            dishes.map((dish, idx) => (
                                <motion.tr
                                    key={dish.id}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ duration: 0.3, delay: idx * 0.05 }}
                                    whileHover={{ backgroundColor: 'rgba(251, 191, 36, 0.05)' }}
                                >
                                    <td>
                                        <div className="flex items-center gap-4">
                                            <Image
                                                src={dish.imageUrl}
                                                alt={dish.name}
                                                width={50}
                                                height={50}
                                                className="rounded-md object-cover"
                                            />
                                            <div>
                                                <p className="font-semibold text-gray-800">{dish.name}</p>
                                                <p className="text-xs text-gray-500 truncate" style={{ maxWidth: '250px' }}>{dish.description}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <span className="text-xs text-yellow-600 bg-yellow-100 px-2 py-1 rounded-full w-fit">
                                            {dish.category}
                                        </span>
                                    </td>
                                    <td className="font-medium">₹{dish.price.toLocaleString()}</td>
                                    <td>
                                        <VegNonVegIcon isVeg={dish.isVeg} />
                                    </td>
                                    <td>
                                        <Switch
                                            id={`avail-${dish.id}`}
                                            checked={dish.isAvailable}
                                            onCheckedChange={() => onToggle(dish.id)}
                                            aria-label="Toggle dish availability"
                                        />
                                    </td>
                                    <td>
                                        <div className="flex items-center space-x-2">
                                            <button
                                                onClick={() => handleEdit(dish)}
                                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-100 rounded-full transition-colors"
                                                title="Edit Dish"
                                            >
                                                <Edit size={18} />
                                            </button>
                                            <button
                                                onClick={() => onDelete(dish.id)}
                                                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-100 rounded-full transition-colors"
                                                title="Delete Dish"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </td>
                                </motion.tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </motion.div>
    );
}
