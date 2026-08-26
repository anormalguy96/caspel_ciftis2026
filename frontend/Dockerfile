# --- Build stage ------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Build-time public config. Vite inlines VITE_* at build time, so these must
# be present here — setting them at runtime has no effect on a static bundle.
ARG VITE_PUBLIC_SITE_URL
ARG VITE_PUBLIC_CIFTIS_URL
ARG VITE_DISPLAY_RESET_SECONDS
ENV VITE_PUBLIC_SITE_URL=$VITE_PUBLIC_SITE_URL \
    VITE_PUBLIC_CIFTIS_URL=$VITE_PUBLIC_CIFTIS_URL \
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
  CMD curl -fsS http://127.0.0.1/ciftis || exit 1

CMD ["nginx", "-g", "daemon off;"]
