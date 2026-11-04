#!/bin/sh
# Start the API, wait for it (first boot seeds demo history), then serve the web app on $PORT.
set -e
cd /app/api && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
for i in $(seq 120); do
  python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')" 2>/dev/null && break
  sleep 1
done
cd /app/web && exec node server.js
