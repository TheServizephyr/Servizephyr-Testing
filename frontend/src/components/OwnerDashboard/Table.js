
"use client";

import styles from "./OwnerDashboard.module.css";
import { motion } from "framer-motion";
import { ListChecks, Undo2 } from "lucide-react";
import { formatDistanceToNowStrict } from 'date-fns';
import Link from 'next/link';

const MotionTr = motion.tr;

const statusFlow = ["pending", "confirmed", "preparing", "dispatched", "delivered"];

const getStatusClass = (currentStatus) => {
  switch (currentStatus) {
    case "delivered":
      return styles.statusDelivered;
    case "confirmed":
      return styles.statusConfirmed;
    case "preparing":
      return styles.statusPreparing;
    case "dispatched":
    case "Out for Delivery":
      return styles.statusOutOfDelivery;
    case "pending":
    default:
      return styles.statusPending;
  }
};

const OrderStatusAction = ({ status, onStatusChange }) => {
  const currentIndex = statusFlow.indexOf(status);
  const isCompleted = currentIndex === statusFlow.length - 1;
  const isFirstStep = currentIndex === 0;

  const getNextActionText = () => {
    if (isCompleted) return "Completed";
    switch (status) {
      case "pending":
        return "Confirm Order";
      case "confirmed":
        return "Start Preparing";
      case "preparing":
        return "Dispatch Order";
      case "dispatched":
        return "Mark Delivered";
      default:
        return "";
    }
  };

  const handleNextAction = () => {
    if (!isCompleted) {
      onStatusChange(statusFlow[currentIndex + 1]);
    }
  };
  
  const handleRevertAction = () => {
    if (!isFirstStep) {
      onStatusChange(statusFlow[currentIndex - 1]);
    }
  };

  return (
    <div className={styles.actionCell}>
      {!isFirstStep && (
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleRevertAction}
          className={`${styles.revertButton}`}
          title="Revert to previous status"
        >
          <Undo2 size={14} />
        </motion.button>
      )}
      <button
        onClick={handleNextAction}
        disabled={isCompleted}
        className={`${styles.actionButton} ${getStatusClass(status)}`}
      >
        {getNextActionText()}
      </button>
    </div>
  );
};


export default function Table({ data = [], onStatusChange, loading }) {

  return (
    <motion.div
      className="bg-gray-800/50 border border-gray-700 rounded-xl"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
    >
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead className="bg-gray-800">
            <tr>
              <th className="p-4 text-left text-sm font-semibold text-gray-400">Order ID</th>
              <th className="p-4 text-left text-sm font-semibold text-gray-400">Customer</th>
              <th className="p-4 text-left text-sm font-semibold text-gray-400">Time</th>
              <th className="p-4 text-left text-sm font-semibold text-gray-400">Amount</th>
              <th className="p-4 text-left text-sm font-semibold text-gray-400">Status</th>
              <th className="p-4 text-left text-sm font-semibold text-gray-400" style={{ width: '220px' }}>Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {loading ? (
                Array.from({length: 5}).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-3/4"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/2"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/4"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/3"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-1/2"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-700 rounded w-full"></div></td>
                    </tr>
                ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan="7" className="text-center p-8 text-gray-500">
                  No orders found.
                </td>
              </tr>
            ) : (
              data.map((order, idx) => (
                <MotionTr
                  key={order.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                  className="hover:bg-gray-700/50"
                >
                  <td className="p-4 font-mono text-sm text-white">{order.id}</td>
                  <td className="p-4 font-medium text-white">{order.customer}</td>
                  <td className="p-4 text-sm text-gray-300">
                     {formatDistanceToNowStrict(new Date(order.orderDate.seconds * 1000))} ago
                  </td>
                  <td className="p-4 font-medium text-white">₹{order.amount.toLocaleString()}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${getStatusClass(order.status)}`}>
                        {order.status}
                    </span>
                  </td>
                  <td>
                    <OrderStatusAction
                      status={order.status}
                      onStatusChange={(newStatus) => onStatusChange(order.id, newStatus)}
                    />
                  </td>
                </MotionTr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
