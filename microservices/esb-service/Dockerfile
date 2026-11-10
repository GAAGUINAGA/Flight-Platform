# Contexto de build: raíz del repositorio. Igual que el de webhooks-service (también usa Prisma): openssl en las dos etapas,
# porque Prisma elige su motor (debian-openssl-3.0.x) según el openssl presente al generar el cliente. Sin binaryTargets.
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
RUN npm run build -w @flight-platform/esb-service

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd --system flight && useradd --system --gid flight flight
COPY --from=build --chown=flight:flight /app /app
USER flight
ENV PORT=8080
CMD ["node", "microservices/esb-service/dist/main.js"]
