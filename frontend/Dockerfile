FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm i
COPY . .
RUN npm run build

FROM alpine:3.23 AS runner
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/dist ./dist
CMD ["sh", "-c", "echo 'static ready in /app/dist' && tail -f /dev/null"]
