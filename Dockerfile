# Vigil web (Next.js). Container for the `web` service in docker-compose.yml.
# NEXT_PUBLIC_AGENT_URL must be present at BUILD time — Next.js inlines
# NEXT_PUBLIC_ vars into the client bundle.
# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_AGENT_URL=""
ENV NEXT_PUBLIC_AGENT_URL=$NEXT_PUBLIC_AGENT_URL
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
