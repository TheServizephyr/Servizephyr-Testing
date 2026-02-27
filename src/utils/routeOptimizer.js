function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a = (
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  );

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function generatePermutations(arr) {
  if (arr.length === 0) return [[]];
  if (arr.length === 1) return [arr];

  const result = [];
  for (let i = 0; i < arr.length; i += 1) {
    const current = arr[i];
    const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
    const remainingPerms = generatePermutations(remaining);
    for (const perm of remainingPerms) {
      result.push([current, ...perm]);
    }
  }

  return result;
}

function buildDistanceMatrix(restaurant, customers) {
  const locations = [restaurant, ...customers];
  const n = locations.length;
  const distanceMatrix = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dist = haversineDistance(
        locations[i].lat,
        locations[i].lng,
        locations[j].lat,
        locations[j].lng
      );
      distanceMatrix[i][j] = dist;
      distanceMatrix[j][i] = dist;
    }
  }

  return { distanceMatrix };
}

function calculateRouteDistance(route, distanceMatrix, returnToOrigin = true) {
  let totalDistance = 0;
  totalDistance += distanceMatrix[0][route[0]];

  for (let i = 0; i < route.length - 1; i += 1) {
    totalDistance += distanceMatrix[route[i]][route[i + 1]];
  }

  if (returnToOrigin) {
    totalDistance += distanceMatrix[route[route.length - 1]][0];
  }

  return totalDistance;
}

function calculateDistanceSaved(originalOrder, optimizedOrder, distanceMatrix) {
  const originalIndices = originalOrder.map((_, i) => i + 1);
  const optimizedIndices = optimizedOrder.map((order) => originalOrder.indexOf(order) + 1);
  const originalDistance = calculateRouteDistance(originalIndices, distanceMatrix);
  const optimizedDistance = calculateRouteDistance(optimizedIndices, distanceMatrix);
  return originalDistance - optimizedDistance;
}

function greedyRouteOptimization(restaurant, customers) {
  const startTime = Date.now();
  const visitedSet = new Set();
  const route = [];
  let currentLocation = restaurant;
  let totalDistance = 0;

  while (route.length < customers.length) {
    let nearestCustomer = null;
    let nearestDistance = Infinity;
    let nearestIndex = -1;

    customers.forEach((customer, index) => {
      if (visitedSet.has(index)) return;
      const dist = haversineDistance(
        currentLocation.lat,
        currentLocation.lng,
        customer.lat,
        customer.lng
      );
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestCustomer = customer;
        nearestIndex = index;
      }
    });

    if (nearestCustomer) {
      route.push(nearestCustomer);
      visitedSet.add(nearestIndex);
      totalDistance += nearestDistance;
      currentLocation = {
        lat: nearestCustomer.lat,
        lng: nearestCustomer.lng,
      };
    }
  }

  totalDistance += haversineDistance(
    currentLocation.lat,
    currentLocation.lng,
    restaurant.lat,
    restaurant.lng
  );

  return {
    success: true,
    optimizedRoute: route,
    totalDistance,
    computationTime: Date.now() - startTime,
    method: 'greedy',
    metrics: {
      restaurantLocation: restaurant,
      deliveryCount: customers.length,
      note: 'Used greedy approximation for > 9 deliveries',
    },
  };
}

function optimizeDeliveryRoute(restaurant, customers, options = {}) {
  const startTime = Date.now();

  if (!restaurant || !restaurant.lat || !restaurant.lng) {
    throw new Error('Invalid restaurant location');
  }
  if (!Array.isArray(customers) || customers.length === 0) {
    throw new Error('No customers to optimize');
  }
  if (customers.length > 9) {
    return greedyRouteOptimization(restaurant, customers);
  }

  const { distanceMatrix } = buildDistanceMatrix(restaurant, customers);
  const customerIndices = customers.map((_, i) => i + 1);
  const allPermutations = generatePermutations(customerIndices);

  let bestRoute = null;
  let bestDistance = Infinity;

  for (const route of allPermutations) {
    const distance = calculateRouteDistance(route, distanceMatrix, options.returnToOrigin !== false);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRoute = route;
    }
  }

  const optimizedSequence = bestRoute.map((idx) => customers[idx - 1]);
  const computationTime = Date.now() - startTime;

  return {
    success: true,
    optimizedRoute: optimizedSequence,
    totalDistance: bestDistance,
    computationTime,
    metrics: {
      restaurantLocation: restaurant,
      deliveryCount: customers.length,
      permutationsEvaluated: allPermutations.length,
      distanceSaved: calculateDistanceSaved(customers, optimizedSequence, distanceMatrix),
    },
  };
}

function formatRouteForGoogleMaps(optimizedRoute, restaurantLocation = null) {
  if (!Array.isArray(optimizedRoute) || optimizedRoute.length === 0) return '';

  let url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving';

  const waypointStr = optimizedRoute
    .map((order) => `${order.lat},${order.lng}`)
    .join('|');
  if (waypointStr) {
    url += `&waypoints=${waypointStr}`;
  }

  if (restaurantLocation && restaurantLocation.lat && restaurantLocation.lng) {
    url += `&destination=${restaurantLocation.lat},${restaurantLocation.lng}`;
  } else {
    const lastCustomer = optimizedRoute[optimizedRoute.length - 1];
    url += `&destination=${lastCustomer.lat},${lastCustomer.lng}`;
  }

  return url;
}

module.exports = {
  optimizeDeliveryRoute,
  formatRouteForGoogleMaps,
};
