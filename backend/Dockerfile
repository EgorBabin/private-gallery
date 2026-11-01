# Один образ для backend и photo-worker (см. docker-compose.yaml).
# Alpine (musl) вместо полного Debian: образ в несколько раз меньше,
# и у sharp нет фрагментации памяти glibc, из-за которой worker постоянно рос.
FROM node:24-alpine3.22

# Конвертеры форматов, которые не открывает sharp (utils/sourceDecoder.js):
#   libheif-tools -> heif-dec: HEIC/HEIF с iPhone (HEVC через libde265)
#   libraw-tools  -> dcraw_emu: RAW камер (ARW, CR2/CR3, NEF, DNG, RAF, ORF...)
RUN apk add --no-cache libheif-tools libraw-tools

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

USER node
EXPOSE 3000

# node напрямую, без npm: на один процесс меньше и корректный SIGTERM
CMD ["node", "server.js"]
