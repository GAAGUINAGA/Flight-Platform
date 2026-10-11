FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY platform/api-gateway/package.json ./platform/api-gateway/package.json
RUN npm ci
COPY packages ./packages
COPY contracts ./contracts
COPY platform/api-gateway ./platform/api-gateway
COPY tsconfig.base.json ./
RUN npm run build -w @flight-platform/api-gateway

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/platform/api-gateway ./platform/api-gateway
COPY --from=build /app/contracts ./platform/api-gateway/contracts
USER node
WORKDIR /app/platform/api-gateway
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
