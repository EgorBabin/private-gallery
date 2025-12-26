# multi-stage: build frontend -> nginx

#front
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend ./frontend
COPY .env ./frontend/.env
RUN cd frontend && npm run build

# nginx
FROM nginx:stable-alpine
RUN apk add --no-cache gettext

COPY nginx/docker-entrypoint.sh /docker-entrypoint.sh
COPY nginx/nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY nginx/conf.d/ /etc/nginx/conf.d/

COPY --from=builder /app/frontend/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.sh

EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
