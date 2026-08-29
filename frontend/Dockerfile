# --- Build stage ------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Build-time public config. Vite inlines VITE_* at build time, so these must
# be present here — setting them at runtime has no effect on a static bundle.
# The deployment mode is chosen here and baked into the bundle. Selecting a
# different mode is a rebuild with different args, never a source edit.
#   subdomain : VITE_APP_BASE_PATH=/         VITE_PUBLIC_URL=https://ciftis.caspel.com
#   path mode : VITE_APP_BASE_PATH=/ciftis/  VITE_PUBLIC_URL=https://caspel.com/ciftis
ARG VITE_APP_BASE_PATH=/
ARG VITE_PUBLIC_URL
ARG VITE_DISPLAY_RESET_SECONDS
ENV VITE_APP_BASE_PATH=$VITE_APP_BASE_PATH \
    VITE_PUBLIC_URL=$VITE_PUBLIC_URL \
    VITE_DISPLAY_RESET_SECONDS=$VITE_DISPLAY_RESET_SECONDS

# Copy manifests first so dependency layers cache independently of source.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Typecheck, test, then build. A red test must fail the image, not ship in it.
RUN npm run typecheck \
 && npm run test \
 && npm run build

# --- Runtime stage ----------------------------------------------------
FROM nginx:alpine

# Curl is used by the compose healthcheck.
RUN apk add --no-cache curl

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
