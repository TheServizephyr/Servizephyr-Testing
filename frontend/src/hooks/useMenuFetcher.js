import { useState, useCallback, useEffect } from 'react';
import { collection, getDocs, query, orderBy, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * Reusable hook for fetching restaurant menu from Firestore
 * 
 * @param {string} restaurantId - The restaurant ID to fetch menu for
 * @returns {object} { menu, loading, error, refetch }
 */
export function useMenuFetcher(restaurantId) {
    const [menu, setMenu] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchMenu = useCallback(async () => {
        if (!restaurantId) {
            setLoading(false);
            setMenu([]);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            console.log(`[useMenuFetcher] Fetching menu for: ${restaurantId}`);

            const restaurantRef = doc(db, 'restaurants', restaurantId);
            const menuRef = collection(restaurantRef, 'menu');
            const menuQuery = query(menuRef, orderBy('category'));
            const snapshot = await getDocs(menuQuery);

            const items = [];
            snapshot.forEach((docSnap) => {
                items.push({ id: docSnap.id, ...docSnap.data() });
            });

            console.log(`[useMenuFetcher] Loaded ${items.length} menu items`);
            setMenu(items);
        } catch (err) {
            console.error('[useMenuFetcher] Error fetching menu:', err);
            setError(err);
            setMenu([]);
        } finally {
            setLoading(false);
        }
    }, [restaurantId]);

    useEffect(() => {
        fetchMenu();
    }, [fetchMenu]);

    return {
        menu,
        loading,
        error,
        refetch: fetchMenu
    };
}
