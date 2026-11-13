# Servicio GraphQL (F12c-1). Contexto de build: raíz del repositorio. Sin base de datos ni Prisma: no necesita openssl.
# El .proto y los demás servicios no se usan, pero `npm ci` necesita ver todos los workspaces del package-lock.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY microservices ./microservices
COPY platform ./platform
RUN npm ci
RUN npm run build -w @flight-platform/graphql

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system flight && useradd --system --gid flight flight
COPY --from=build --chown=flight:flight /app /app
USER flight
ENV PORT=8080
EXPOSE 8080
CMD ["node", "platform/graphql/dist/main.js"]
