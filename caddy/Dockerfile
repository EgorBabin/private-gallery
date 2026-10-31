# multi-stage: build frontend -> caddy

# frontend
FROM node:24-alpine AS builder
WORKDIR /app

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# в сборку попадают только публичные VITE_* (они и так видны в браузере),
# .env с секретами в образ и кэш сборки не копируется
ARG VITE_NAME=
ARG VITE_DOMAIN=
ARG VITE_PROTOCOL=https://
ARG VITE_MAX_UPLOAD_IMAGES=15
ENV VITE_NAME=$VITE_NAME \
    VITE_DOMAIN=$VITE_DOMAIN \
    VITE_PROTOCOL=$VITE_PROTOCOL \
    VITE_MAX_UPLOAD_IMAGES=$VITE_MAX_UPLOAD_IMAGES

COPY frontend ./frontend
RUN cd frontend && npm run build


# caddy: HTTPS + статика + прокси /api
FROM caddy:2.10-alpine

COPY caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/frontend/dist /srv
