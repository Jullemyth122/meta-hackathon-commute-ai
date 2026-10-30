/** How the phone apps say distances, times and money. */

export function metres(m: number): string {
  if (m < 950) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function minutes(s: number): string {
  if (s < 45) return 'now';
  if (s < 90) return '1 min';
  return `${Math.round(s / 60)} min`;
}

/**
 * The simulation's time of day `s` seconds after `clockS` (its clock now,
 * seconds since midnight), e.g. "6:54 AM": never the computer's own clock,
 * which can be hours apart from the simulated day.
 */
export function clockIn(s: number, clockS: number): string {
  const t = Math.round(((((clockS + s) % 86_400) + 86_400) % 86_400) / 60);
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "₱14.00", "₱16,601.84": always centavos, thousands grouped. */
export const peso = (php: number) =>
  `₱${php.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
