

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import styles from "./OwnerDashboard.module.css";
import { cn } from "@/lib/utils";


export default function SidebarLink({ item, isCollapsed, isDisabled, disabledIcon: DisabledIcon }) {
  const pathname = usePathname();
  const isActive = pathname === item.href;

  const textVariants = {
    expanded: { opacity: 1, width: "auto", transition: { duration: 0.2, delay: 0.1 } },
    collapsed: { opacity: 0, width: 0, transition: { duration: 0.1 } },
  };

  const linkContent = (
    <a
      className={cn(
        styles.sidebarLink,
        isActive && !isDisabled && styles.sidebarLinkActive,
        isDisabled && 'opacity-50 cursor-not-allowed',
        isCollapsed && styles.sidebarLinkCollapsed,
      )}
      title={isDisabled ? `${item.name} is currently restricted` : item.name}
      onClick={(e) => { if (isDisabled) e.preventDefault(); }}
    >
      <div className={styles.sidebarLinkInner}>
        <div className={cn(styles.linkIcon, "relative")}>
          {isDisabled && DisabledIcon ? (
            <DisabledIcon size={22} />
          ) : (
            <>
              <item.icon size={22} />
              {item.badge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-green-500 text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full shadow-sm animate-in zoom-in border border-background">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </>
          )}
        </div>
        <motion.span
          variants={textVariants}
          animate={isCollapsed ? "collapsed" : "expanded"}
          className={styles.linkText}
        >
          {item.name}
        </motion.span>
      </div>
    </a>
  );

  if (isDisabled) {
    return linkContent;
  }

  return (
    <Link href={item.href} passHref legacyBehavior>
      {linkContent}
    </Link>
  );
}
