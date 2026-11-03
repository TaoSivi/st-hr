/**
 * Two-tone line icons: a dark outline with one bright accent, rounded ends, 2 px strokes on a 24 px grid.
 * Colours come from --ico-line and --ico-accent so the same icon reads on a light page and on the dark menu.
 */
type Parts = { line: string[]; accent?: string[] };

const ICONS = {
  menu: { line: ['M4 7h16', 'M4 17h16'], accent: ['M4 12h10'] },
  bell: { line: ['M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9'], accent: ['M10 20.5a2 2 0 0 0 4 0'] },
  profile: { line: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8'], accent: ['M4.5 21a7.5 7.5 0 0 1 15 0'] },
  directory: { line: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7', 'M2.5 20a6.5 6.5 0 0 1 13 0'], accent: ['M16 4.3a3.5 3.5 0 0 1 0 6.4', 'M18 14.2a6.5 6.5 0 0 1 3.5 5.8'] },
  reports: { line: ['M5 20v-8', 'M12 20V5', 'M19 20v-5'], accent: ['M3 20.5h18'] },
  clockFix: { line: ['M21 12a9 9 0 1 1-2.6-6.4'], accent: ['M12 7v5l3 2', 'M21 4v5.5h-5.5'] },
  clock: { line: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18'], accent: ['M12 7v5l3 2'] },
  shift: { line: ['M5 8h13', 'M19 16H6'], accent: ['M15 4.5 19 8l-4 3.5', 'M9 12.5 5 16l4 3.5'] },
  schedule: { line: ['M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1', 'M8 3v3', 'M16 3v3'], accent: ['M4 10h16', 'M9 15l2 2 4-4'] },
  ot: { line: ['M8 4h8v3H8z', 'M6.5 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5'], accent: ['M12 11v3.5l2 1.5'] },
  expense: { line: ['M3 7a2 2 0 0 1 2-2h13v3', 'M3 7v11a2 2 0 0 0 2 2h15V8H5a2 2 0 0 1-2-1'], accent: ['M16.5 14h.01'] },
  certificate: { line: ['M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1'], accent: ['M7 9h10', 'M7 12.5h5', 'M16 17.5l1.5 3.5 1.5-3.5'] },
  pay: { line: ['M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z'], accent: ['M9 8h6', 'M9 12h6', 'M9 16h3'] },
  advance: { line: ['M3 7h18v10H3z'], accent: ['M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5', 'M6.5 12h.01', 'M17.5 12h.01'] },
  scan: { line: ['M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6z'], accent: ['M9 12l2.2 2.2L15.5 10'] },
  leave: { line: ['M21 3 3 10.5l7 2.5 2.5 7z'], accent: ['M10 13l5-5'] },
  leaveCancel: { line: ['M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1', 'M8 3v3', 'M16 3v3'], accent: ['M4 10h16', 'M10 14l4 4', 'M14 14l-4 4'] },
  device: { line: ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1'], accent: ['M11 18h2', 'M10 6.5h4'] },
  face: { line: ['M4 8V5a1 1 0 0 1 1-1h3', 'M16 4h3a1 1 0 0 1 1 1v3', 'M20 16v3a1 1 0 0 1-1 1h-3', 'M8 20H5a1 1 0 0 1-1-1v-3'], accent: ['M9 10v1', 'M15 10v1', 'M9.5 15c1.5 1.5 3.5 1.5 5 0'] },
  dashboard: { line: ['M4 4h7v7H4z', 'M13 13h7v7h-7z'], accent: ['M13 4h7v5h-7z', 'M4 14h7v6H4z'] },
  map: { line: ['M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5z'], accent: ['M9 4v13.5', 'M15 6.5V20'] },
  about: { line: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18'], accent: ['M12 11v5.5', 'M12 7.8h.01'] },
  privacy: { line: ['M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6z'], accent: ['M9.5 12.5h5V16h-5z', 'M10.5 12.5v-1a1.5 1.5 0 0 1 3 0v1'] },
  settings: { line: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7'], accent: ['M12 2.5v3', 'M12 18.5v3', 'M2.5 12h3', 'M18.5 12h3', 'M5.3 5.3l2.1 2.1', 'M16.6 16.6l2.1 2.1', 'M18.7 5.3l-2.1 2.1', 'M7.4 16.6l-2.1 2.1'] },
  logout: { line: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3'], accent: ['M11 8l4 4-4 4', 'M15 12H4'] },
  pin: { line: ['M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11'], accent: ['M12 12.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8'] },
  refresh: { line: ['M20 12a8 8 0 1 1-2.4-5.7'], accent: ['M20 4v5h-5'] },
  audit: { line: ['M6 3h9l4 4v14H6z'], accent: ['M14 3v5h5', 'M9.5 13h6', 'M9.5 17h4'] }
} satisfies Record<string, Parts>;

export type IconName = keyof typeof ICONS;

export default function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const p: Parts = ICONS[name];
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p.line.map(d => <path key={d} className="l" d={d} />)}
      {p.accent?.map(d => <path key={d} className="a" d={d} />)}
    </svg>
  );
}
