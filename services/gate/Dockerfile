# Vigil gate service (:4200). BUILD CONTEXT IS THE REPO ROOT — it needs
# services/shared (env/auth/http) alongside its own source. Build with:
#   docker build -f services/gate/Dockerfile -t vigil-gate .
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Shared package (env/auth/http + zod): install prod deps, then copy source.
COPY services/shared/package.json services/shared/package-lock.json ./services/shared/
RUN cd services/shared && npm ci --omit=dev
COPY services/shared/ ./services/shared/

# Gate: prod deps (includes tsx, the prod TS runtime), then source.
COPY services/gate/package.json services/gate/package-lock.json ./services/gate/
RUN cd services/gate && npm ci --omit=dev
COPY services/gate/tsconfig.json ./services/gate/
COPY services/gate/src ./services/gate/src

# Shared wire contract (type-only import here; copied for completeness).
COPY src/lib ./src/lib

WORKDIR /app/services/gate
EXPOSE 4200
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://localhost:4200/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/server.ts"]
