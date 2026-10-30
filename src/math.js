// Audited savings formula. Integer cents throughout so the figure is exact and reproducible.
//   annual_savings = seats × 12 × (list × (1 + uplift) − target)
// Fixture A: 140 × 12 × ($165.00 × 1.18 − $84.70) = 140 × 12 × $110.00 = $184,800
export const AUDITED_PRICING = {
  list_per_seat_month_cents: 16500,
  target_per_seat_month_cents: 8470,
  default_uplift_pct: 18,
};

export const FORMULA = 'seats × 12 × (list × (1 + uplift) − target)';

export function parseUpliftPct(text) {
  const match = String(text ?? '').match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

export function savingsDelta({ seats, upliftPct }, pricing = AUDITED_PRICING) {
  const uplift = upliftPct ?? pricing.default_uplift_pct;
  const upliftedCents = Math.round((pricing.list_per_seat_month_cents * (100 + uplift)) / 100);
  const perSeatDeltaCents = upliftedCents - pricing.target_per_seat_month_cents;
  const annualCents = seats * 12 * perSeatDeltaCents;
  return {
    seats,
    uplift_pct: uplift,
    uplift_source: upliftPct == null ? 'default' : 'signal',
    list_per_seat_month: pricing.list_per_seat_month_cents / 100,
    uplifted_per_seat_month: upliftedCents / 100,
    target_per_seat_month: pricing.target_per_seat_month_cents / 100,
    per_seat_month_delta: perSeatDeltaCents / 100,
    annual_savings: Math.round(annualCents / 100),
    formula: FORMULA,
  };
}

export function formatUsd(amount) {
  return `$${Number(amount).toLocaleString('en-US')}`;
}
