#!/bin/sh
# Fresh demo state: reseed history and add a few live inspections for the Recent list.
cd "$(dirname "$0")/../.."
(cd api && .venv/bin/python -m app.seed --reset | tail -1)
for n in 01 05 07 12; do
  curl -s -X POST localhost:8000/api/inspect -F image=@data/samples/sample_$n.jpg -F part_id=IMP-200 \
    -F machine="Furnace 2" -F shift=C -F batch=H-2411 -F supplier="Supplier B" -o /dev/null -w "prerun $n %{http_code}\n" &
done
wait
