export interface Position {
  lat: number;
  lng: number;
  accuracyM: number;
}

/** Current position, or null when denied, unavailable or slower than `timeoutMs`. Never throws. */
export function getPosition(timeoutMs = 8000): Promise<Position | null> {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}
