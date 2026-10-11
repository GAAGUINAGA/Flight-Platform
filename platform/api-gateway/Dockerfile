FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY contracts ./contracts
COPY platform/api-gateway ./platform/api-gateway
RUN npm ci
RUN npm run build -w @flight-platform/shared
RUN npm run build -w @flight-platform/api-gateway

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN groupadd --system flight && useradd --system --gid flight flight
COPY --from=build --chown=flight:flight /app /app
USER flight
EXPOSE 8080
CMD ["node", "platform/api-gateway/dist/src/main.js"]
