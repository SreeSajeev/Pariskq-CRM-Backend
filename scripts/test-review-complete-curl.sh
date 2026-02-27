#!/usr/bin/env bash
# Test "Complete Review" (Needs Review) via curl.
# Usage:
#   export API_BASE="http://localhost:3000"   # or your backend URL
#   export TICKET_ID="<uuid-of-ticket-with-needs_review>"
#   ./scripts/test-review-complete-curl.sh
#
# Get a ticket ID first:
#   curl -s "$API_BASE/tickets" | jq '.[0].id'

set -e
API_BASE="${API_BASE:-http://localhost:3000}"
TICKET_ID="${TICKET_ID:?Set TICKET_ID (e.g. export TICKET_ID=your-ticket-uuid)}"

echo "PATCH $API_BASE/tickets/$TICKET_ID/review-complete"
echo ""

curl -s -X PATCH "$API_BASE/tickets/$TICKET_ID/review-complete" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "Breakdown",
    "issue_type": "Engine",
    "location": "Mumbai Depot",
    "vehicle_number": "MH01AB1234",
    "priority": false
  }' | jq .
