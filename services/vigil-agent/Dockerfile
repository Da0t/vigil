# Vigil orchestrator (:4000). BUILD CONTEXT IS THE REPO ROOT.
#   docker build -f services/vigil-agent/Dockerfile -t vigil-agent .
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY services/shared/package.json services/shared/package-lock.json ./services/shared/
RUN cd services/shared && npm ci --omit=dev
COPY services/shared/ ./services/shared/

COPY services/vigil-agent/package.json services/vigil-agent/package-lock.json ./services/vigil-agent/
RUN cd services/vigil-agent && npm ci --omit=dev
COPY services/vigil-agent/tsconfig.json ./services/vigil-agent/
COPY services/vigil-agent/src ./services/vigil-agent/src

# AGENT_ROUTES is a VALUE import from the wire contract — required at runtime.
COPY src/lib ./src/lib

WORKDIR /app/services/vigil-agent
EXPOSE 4000
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/server.ts"]
