export function calculateConfidence(p) {
  let score = 0;
  if (p.complaint_id) score += 40;
  if (p.vehicle_number) score += 30;
  if (p.category !== 'UNKNOWN') score += 15;
  if (p.issue_type !== 'GENERAL') score += 15;
  return score;
}
