"use client";

import React from "react";
import AnalyticsCard from "./AnalyticsCard";
import { ShoppingCart, Users, Repeat } from "lucide-react";
import { motion } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.2,
    },
  },
};

export default function KPIGrid({ stats }) {
  const kpiData = [
    {
      title: "Today's Orders",
      value: stats.todayOrders,
      icon: <ShoppingCart size={24} className="text-yellow-500" />,
      prefix: "",
    },
    {
      title: "Today's Revenue",
      value: stats.revenue,
      icon: <div className="flex items-center justify-center w-full h-full rounded-full bg-green-100 text-green-600 font-bold text-lg">₹</div>,
      prefix: "₹",
    },
    {
      title: "Active Customers",
      value: stats.activeCustomers,
      icon: <Users size={24} className="text-blue-500" />,
      prefix: "",
    },
    {
      title: "Repeat Customers",
      value: stats.repeatCustomers,
      icon: <Repeat size={24} className="text-purple-500" />,
      prefix: "",
    },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
    >
      {kpiData.map((kpi, index) => (
        <AnalyticsCard
          key={index}
          title={kpi.title}
          value={kpi.value}
          icon={kpi.icon}
          prefix={kpi.prefix}
        />
      ))}
    </motion.div>
  );
}
