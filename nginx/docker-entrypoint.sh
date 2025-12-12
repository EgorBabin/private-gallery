#!/bin/sh
set -e

: "${SERVER_NAME:=localhost}"

envsubst '${SERVER_NAME}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/nginx.conf

# on nginx
exec "$@"
