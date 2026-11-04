#!/bin/sh
# Record every take from a fresh demo state, in a safe order: the rule edit is undone before
# other takes, and the teach step (which writes to the defect library) runs last.
cd "$(dirname "$0")/../.."
scripts/demo/fresh.sh
node scripts/demo/record.mjs rules
curl -s -X PUT localhost:8000/api/parts/IMP-200 -H "Content-Type: application/json" -d @demo/part-IMP-200.orig.json -o /dev/null -w "rule restored %{http_code}\n"
node scripts/demo/record.mjs insights line inspect
