FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json

RUN npm ci

COPY shared ./shared
COPY server ./server

RUN DATABASE_URL="postgresql://tower:tower@postgres:5432/tower?schema=public" npx prisma generate --schema server/prisma/schema.prisma
RUN npm run build --workspace shared && npm run build --workspace server

FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=4000

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/scripts ./server/scripts
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist

EXPOSE 4000

CMD ["npm", "run", "start", "--workspace", "server"]
