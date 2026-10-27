ARG BASE_IMAGE=rocketchat-local:8.9.0-canned-v1
FROM ${BASE_IMAGE}
COPY message-views/package.json message-views/*.cjs /app/message-views/
COPY message-views/public /app/message-views/public
RUN node /app/message-views/install.cjs
