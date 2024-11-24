// utils/geofence.ts
export function isWithinRadius(
    userLat: number,
    userLng: number,
    targetLat: number,
    targetLng: number,
    radiusInKm: number
  ): boolean {
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  
    const earthRadiusInKm = 6371; // Radius of the Earth in kilometers
  
    const dLat = toRadians(targetLat - userLat);
    const dLng = toRadians(targetLng - userLng);
  
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(userLat)) *
        Math.cos(toRadians(targetLat)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
  
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = earthRadiusInKm * c;
  
    return distance <= radiusInKm;
  }  