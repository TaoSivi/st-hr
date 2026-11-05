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

export interface Place { name: string; lat: number; lng: number }

/**
 * Look a place or an address up by name (OpenStreetMap's free Nominatim service: no key; it is asked only when someone presses Search,
 * as its usage rules require, and only the words typed are sent). Throws a short message the screen can show.
 */
export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch, limit = 6): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) throw new Error('ພິມຊື່ບ່ອນໃຫ້ຍາວກວ່ານີ້');
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&accept-language=lo,th,en&q=${encodeURIComponent(q)}`;
  let res: Response;
  try { res = await fetchImpl(url, { headers: { Accept: 'application/json' } }); } catch { throw new Error('ຄົ້ນຫາບໍ່ໄດ້ — ກວດອິນເຕີເນັດ'); }
  if (!res.ok) throw new Error(res.status === 429 ? 'ຄົ້ນຫາຖີ່ເກີນໄປ — ລໍສັກຄູ່ແລ້ວລອງໃໝ່' : 'ຄົ້ນຫາບໍ່ໄດ້ ລອງໃໝ່ພາຍຫຼັງ');
  const rows = (await res.json().catch(() => null)) as { display_name?: unknown; lat?: unknown; lon?: unknown }[] | null;
  if (!Array.isArray(rows)) throw new Error('ຄົ້ນຫາບໍ່ໄດ້ ລອງໃໝ່ພາຍຫຼັງ');
  return rows.flatMap(r => {
    const lat = Number(r.lat), lng = Number(r.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && typeof r.display_name === 'string' ? [{ name: r.display_name, lat, lng }] : [];
  });
}
