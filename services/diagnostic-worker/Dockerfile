FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 4400
CMD ["npx", "tsx", "src/index.ts"]
