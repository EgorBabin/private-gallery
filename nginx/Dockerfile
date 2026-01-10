# multi-stage: build frontend -> nginx

# frontend
FROM node:20-alpine AS builder
WORKDIR /app

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend ./frontend
COPY .env ./frontend/.env
RUN cd frontend && npm run build


# nginx
FROM nginx:stable-alpine

COPY nginx/nginx.conf /etc/nginx/nginx.conf

COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]