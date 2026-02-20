export const TICKET_STATES = {
  OPEN: "OPEN",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  ASSIGNED: "ASSIGNED",
  ON_SITE: "ON_SITE",
  RESOLVED_PENDING_VERIFICATION: "RESOLVED_PENDING_VERIFICATION",
  RESOLVED: "RESOLVED",
}

const ALLOWED_TRANSITIONS = {
  OPEN: ["ASSIGNED"],
  NEEDS_REVIEW: ["OPEN"],
  ASSIGNED: ["ON_SITE"],
  ON_SITE: ["RESOLVED_PENDING_VERIFICATION"],
  RESOLVED_PENDING_VERIFICATION: ["RESOLVED"],
}

export function assertValidTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from] || []
  if (!allowed.includes(to)) {
    throw new Error(`Invalid ticket transition: ${from} → ${to}`)
  }
}
