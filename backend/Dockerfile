FROM node:25.2.1 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm i

FROM node:25.2.1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "server.js"]
