/**
 * Metro Manila traditional jeepney fare, as used by the prototype:
 * ₱14 for the first 4 km, then ₱2 per started km. Students, seniors and PWD
 * get 20% off, rounded to the nearest 25 centavos.
 *
 * Fares change by LTFRB order. Keep these numbers in one place and check them
 * against the current fare matrix before showing them to riders.
 */

export interface FareRule {
  base: number;
  baseKm: number;
  perKm: number;
  discountPct: number;
}

export const PH_TRADITIONAL_JEEPNEY: FareRule = { base: 14, baseKm: 4, perKm: 2, discountPct: 20 };

export function fareFor(km: number, discounted = false, rule = PH_TRADITIONAL_JEEPNEY): number {
  // Small epsilon so 4.0000001 km from float maths does not cost an extra peso.
  const extraKm = Math.max(0, Math.ceil(km - rule.baseKm - 1e-9));
  const full = rule.base + extraKm * rule.perKm;
  return discounted ? Math.round(full * (1 - rule.discountPct / 100) * 4) / 4 : full;
}
