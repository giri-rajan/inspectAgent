# One container for Hugging Face Spaces: Next.js on :7860 (public) proxies /api and /files to FastAPI on :8000.
# Local multi-container setup is docker-compose.yml.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ .
ENV API_URL=http://127.0.0.1:8000 STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM python:3.11-slim
COPY --from=web /usr/local/bin/node /usr/local/bin/node
RUN useradd -m -u 1000 user
WORKDIR /app
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api/app api/app
COPY data/samples data/samples
COPY --from=web /web/.next/standalone web/
COPY --from=web /web/.next/static web/.next/static
COPY --from=web /web/public web/public
COPY scripts/start-space.sh /app/start.sh
RUN chown -R user:user /app && chmod +x /app/start.sh
USER user
ENV DATA_DIR=/app/data API_URL=http://127.0.0.1:8000 PORT=7860 HOSTNAME=0.0.0.0 NODE_ENV=production
EXPOSE 7860
CMD ["/app/start.sh"]
