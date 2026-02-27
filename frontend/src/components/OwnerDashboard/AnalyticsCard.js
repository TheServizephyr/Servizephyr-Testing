"use client";

import { motion, useSpring, useInView } from "framer-motion";
import { useEffect, useRef } from "react";
import styles from "./OwnerDashboard.module.css";

const cardVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: [0.25, 1, 0.5, 1],
    },
  },
};

function AnimatedNumber({ value, prefix = "" }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const spring = useSpring(0, {
    damping: 50,
    stiffness: 200,
  });

  useEffect(() => {
    if (isInView) {
      spring.set(value);
    }
  }, [spring, value, isInView]);

  useEffect(() => {
    const unsubscribe = spring.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = `${prefix}${Math.round(latest).toLocaleString()}`;
      }
    });
    return unsubscribe;
  }, [spring, prefix]);

  return <span ref={ref} />;
}

export default function AnalyticsCard({ title, value, icon, prefix }) {
  return (
    <motion.div
      variants={cardVariants}
      className={styles.analyticsCard}
      whileHover={{ y: -5 }}
    >
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{title}</h3>
        <div className={styles.cardIconWrapper}>{icon}</div>
      </div>
      <div className={styles.cardValue}>
        <AnimatedNumber value={value} prefix={prefix} />
      </div>
    </motion.div>
  );
}
