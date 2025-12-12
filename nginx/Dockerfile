FROM nginx:stable-alpine

RUN apk add --no-cache gettext

COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY conf.d/ /etc/nginx/conf.d/
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
