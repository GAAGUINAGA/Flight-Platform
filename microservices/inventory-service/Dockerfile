# Contexto de build: ra?z del repositorio.
#   docker build -f microservices/inventory-service/Dockerfile -t inventory-service .
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY microservices ./microservices
COPY platform ./platform
COPY contracts/proto ./contracts/proto
RUN npm ci
RUN npm run build -w @flight-platform/shared
RUN npm run build -w @flight-platform/inventory-service

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN groupadd --system flight && useradd --system --gid flight flight
COPY --from=build --chown=flight:flight /app /app
USER flight
CMD ["node", "microservices/inventory-service/dist/main.js"]
