"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { motion } from "framer-motion";
import styles from "./OwnerDashboard.module.css";

// Mock data for the chart
const data = [
  { name: "Mon", revenue: 4000 },
  { name: "Tue", revenue: 3000 },
  { name: "Wed", revenue: 5000 },
  { name: "Thu", revenue: 4500 },
  { name: "Fri", revenue: 6000 },
  { name: "Sat", revenue: 8000 },
  { name: "Sun", revenue: 7500 },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className={styles.chartTooltip}>
        <p className={styles.tooltipLabel}>{`${label}`}</p>
        <p className={styles.tooltipValue}>{`Revenue: ₹${payload[0].value.toLocaleString()}`}</p>
      </div>
    );
  }
  return null;
};

export default function RevenueChart() {
  return (
    <motion.div
      className={styles.chartContainer}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
    >
      <div className={styles.chartHeader}>
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600 font-bold text-xs">₹</div>
        <h3 className="font-semibold text-lg">Weekly Revenue</h3>
      </div>
      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#FBBF24" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#FBBF24" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#6B7280' }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: '#6B7280' }} tickFormatter={(value) => `₹${value / 1000}k`} />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#FBBF24', strokeWidth: 1, strokeDasharray: '3 3' }} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#FBBF24"
              strokeWidth={2}
              fill="url(#colorRevenue)"
              dot={{ r: 4, fill: '#FBBF24', stroke: '#fff', strokeWidth: 2 }}
              activeDot={{ r: 6, fill: '#fff', stroke: '#FBBF24', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
