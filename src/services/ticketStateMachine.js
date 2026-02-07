// src/services/ticketStateMachine.js

export const TICKET_STATES = {
  OPEN: "OPEN",
  ASSIGNED: "ASSIGNED",
  EN_ROUTE: "EN_ROUTE",
  ON_SITE: "ON_SITE",
  RESOLVED_PENDING_VERIFICATION: "RESOLVED_PENDING_VERIFICATION",
  RESOLVED: "RESOLVED",
}

const ALLOWED_TRANSITIONS = {
  OPEN: ["ASSIGNED"],
  ASSIGNED: ["EN_ROUTE"],
  EN_ROUTE: ["ON_SITE"],
  ON_SITE: ["RESOLVED_PENDING_VERIFICATION"],
  RESOLVED_PENDING_VERIFICATION: ["RESOLVED"],
}

export function assertValidTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from] || []

  if (!allowed.includes(to)) {
    throw new Error(`Invalid ticket transition: ${from} → ${to}`)
  }
}
