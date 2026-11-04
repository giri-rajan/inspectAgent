.PHONY: setup api web dev seed reset test lint build kaggle

PY := api/.venv/bin/python

setup:            ## install backend + frontend dependencies and seed demo data
	cd api && uv venv -p 3.11 .venv -q && uv pip install -q -p .venv/bin/python -r requirements.txt
	cd web && npm install
	cd api && .venv/bin/python -m app.seed

api:              ## FastAPI on :8000
	cd api && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

web:              ## Next.js on :3000 (proxies /api to :8000)
	cd web && npx next dev -H 0.0.0.0 -p 3000

dev:              ## run both
	$(MAKE) -j2 api web

web-https:        ## HTTPS dev server so phones on the LAN can use the camera
	cd web && npx next dev -H 0.0.0.0 -p 3000 --experimental-https

seed:
	cd api && .venv/bin/python -m app.seed

reset:            ## wipe inspections and re-seed history
	cd api && .venv/bin/python -m app.seed --reset

test:
	cd api && .venv/bin/python -m pytest -q tests

lint:
	cd web && npx tsc --noEmit && npx eslint src

build:
	cd web && npx next build

kaggle:           ## optional: real casting photos (needs ~/.kaggle/kaggle.json)
	./scripts/fetch_kaggle.sh
