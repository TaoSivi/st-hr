import type { Employee } from '../domain/types';
import { initials } from './format';

/** The employee's profile photo, or their initials until they add one. */
export default function Avatar({ e, size = 38 }: { e: Pick<Employee, 'name' | 'photo'>; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {e.photo ? <img src={e.photo} alt={e.name} /> : initials(e.name)}
    </span>
  );
}
