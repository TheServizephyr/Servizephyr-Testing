'use client';

import React from 'react';
import styles from './GoldenCoinSpinner.module.css';
import ServizephyrLogo from './ServizephyrLogo';

const GoldenCoinSpinner = () => {
  return (
    <div className={styles.container}>
        <div className={styles.coinContainer}>
            <div className={styles.coin}>
                <div className={`${styles.side} ${styles.front}`}>
                    <ServizephyrLogo className={styles.logoSvg} />
                </div>
                <div className={`${styles.side} ${styles.back}`}>
                    <h1>Servizephyr</h1>
                    <span>EST 2025</span>
                </div>
                {/* This pseudo-element is handled by CSS */}
            </div>
        </div>
        <p className="mt-4 text-lg font-semibold text-muted-foreground animate-pulse">Loading Your Dashboard...</p>
    </div>
  );
};

export default GoldenCoinSpinner;
