FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src

# Generate Prisma client for container runtime and build TS output.
RUN npm run prisma:generate && npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Prisma schema + migrations + config so the deploy-time `prisma migrate deploy`
# (Railway pre-deploy command) can run inside the runtime image. Copied before
# install so the @prisma/client postinstall can resolve the schema.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated

EXPOSE 3000

CMD ["npm", "start"]
