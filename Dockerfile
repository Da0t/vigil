# Vigil web (Next.js, :3000). Multi-stage → slim standalone runtime image.
# NEXT_PUBLIC_AGENT_URL must be present at BUILD time (Next inlines NEXT_PUBLIC_*
# into the client bundle). For hosted deploys, pass the public agent origin:
#   docker build --build-arg NEXT_PUBLIC_AGENT_URL=https://agent.example.com -t vigil-web .
# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_AGENT_URL=""
ENV NEXT_PUBLIC_AGENT_URL=$NEXT_PUBLIC_AGENT_URL
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Next.js "standalone" output ships only the server + the minimal node_modules
# it actually uses — no devDependencies, no source tree.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=8s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
