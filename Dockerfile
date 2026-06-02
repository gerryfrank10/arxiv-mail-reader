# syntax=docker/dockerfile:1
#
# Production image for arxiv-mail-reader.
#
# Stage 1 builds the Vite frontend into dist/.
# Stage 2 is a small runtime that runs the Express server, which (with
# NODE_ENV=production) serves dist/ AND the /api/* routes on a single port.
#
# Build + run via docker-compose (see docker-compose.yml, profile "app"):
#     npm run app:up

# ---------- stage 1: build the frontend ----------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_*-prefixed vars at BUILD time, so the Google OAuth client
# id (if you use "Sign in with Google") must be passed as a build arg. Leave
# empty to hide the Google button and use IMAP login.
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

RUN npm run build

# ---------- stage 2: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only production dependencies are needed to run the server.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Server code, CLI scripts, and the built frontend.
COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/dist ./dist

# Uploaded book files land here (mounted as a volume in compose so they persist).
RUN mkdir -p /app/uploads
ENV UPLOAD_ROOT=/app/uploads

EXPOSE 3001

# Liveness: the server answers /api/db/status as soon as it's up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/api/db/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
