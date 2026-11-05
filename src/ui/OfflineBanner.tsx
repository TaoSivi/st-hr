import { useEffect, useState } from 'react';

/** How many clock-ins are waiting on this phone for the signal (all companies; there is normally one). */
function unsent(): number {
  try {
    return Object.keys(localStorage).filter(k => k.startsWith('sthr-outbox:')).reduce((n, k) => {
      try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return n + (Array.isArray(v) ? v.length : 0); } catch { return n; }
    }, 0);
  } catch { return 0; }
}

/** A small note at the top while there is no signal (and while saved clock-ins are still waiting to be sent), so nobody wonders whether a scan counted. */
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [waiting, setWaiting] = useState(unsent);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const t = setInterval(() => setWaiting(unsent()), 3000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t); };
  }, []);
  if (online && waiting === 0) return null;
  return (
    <div className="offline-note" role="status">
      {online ? `ກຳລັງສົ່ງ ${waiting} ລາຍການທີ່ບັນທຶກໄວ້` : `ບໍ່ມີເນັດ — ສະແກນເຂົ້າ/ອອກໄດ້ ຈະສົ່ງເມື່ອມີເນັດ${waiting ? ` · ລໍສົ່ງ ${waiting}` : ''}`}
    </div>
  );
}
