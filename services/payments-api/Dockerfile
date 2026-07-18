# Vigil payments-api / mock prod (:4100). BUILD CONTEXT IS THE REPO ROOT.
#   docker build -f services/payments-api/Dockerfile -t vigil-payments .
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY services/shared/package.json services/shared/package-lock.json ./services/shared/
RUN cd services/shared && npm ci --omit=dev
COPY services/shared/ ./services/shared/

COPY services/payments-api/package.json services/payments-api/package-lock.json ./services/payments-api/
RUN cd services/payments-api && npm ci --omit=dev
COPY services/payments-api/tsconfig.json ./services/payments-api/
COPY services/payments-api/src ./services/payments-api/src

COPY src/lib ./src/lib

WORKDIR /app/services/payments-api
EXPOSE 4100
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://localhost:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/index.ts"]
