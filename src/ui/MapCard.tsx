import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Branch } from '../domain/types';
import type { Position } from '../device/geo';

/** Map with each branch's allowed radius and the phone's position. Tiles need internet; the rest still works offline. */
export default function MapCard({ branches, pos, children }: { branches: Branch[]; pos: Position | null; children?: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const me = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const center = branches[0] ? [branches[0].lat, branches[0].lng] as [number, number] : [17.9757, 102.6331] as [number, number];
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView(center, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; me.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const layer = L.layerGroup().addTo(m);
    for (const b of branches) {
      L.circle([b.lat, b.lng], { radius: b.radiusM, color: '#0ABAB5', weight: 2, fillOpacity: 0.15 }).addTo(layer);
      L.marker([b.lat, b.lng], { icon: L.divIcon({ className: '', html: '<div class="map-shop">ST</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) })
        .bindTooltip(b.name).addTo(layer);
    }
    return () => { layer.remove(); };
  }, [branches]);

  useEffect(() => {
    const m = map.current;
    if (!m || !pos) return;
    if (!me.current) me.current = L.circleMarker([pos.lat, pos.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(m);
    else me.current.setLatLng([pos.lat, pos.lng]);
    m.setView([pos.lat, pos.lng], m.getZoom());
  }, [pos]);

  const recenter = () => pos && map.current?.setView([pos.lat, pos.lng], 17);

  return (
    <div className="mapcard">
      <div ref={el} className="mapcard-map" />
      <button className="map-btn" onClick={recenter} aria-label="ໄປຕຳແໜ່ງຂອງຂ້ອຍ" disabled={!pos}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
      </button>
      <div className="mapcard-overlay">{children}</div>
    </div>
  );
}
