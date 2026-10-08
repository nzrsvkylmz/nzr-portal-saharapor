# --- build aşaması ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- çalışma aşaması ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
# migrate.mjs için drizzle-orm: Next onu sunucu paketine gömdüğünden standalone
# node_modules'ta paket olarak YOKTUR; builder'dan kopyalanır (sıfır bağımlılık).
# pg ve bağımlılıkları standalone çıktıda zaten mevcut.
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
