ARG BASE_IMAGE=rocketchat-local:8.9.0-devices-v1
FROM ${BASE_IMAGE}
COPY account-devices/server.cjs /app/account-devices/server.cjs
COPY local-ai/package.json local-ai/domain.cjs local-ai/archive.cjs local-ai/chunks.cjs local-ai/jobs.cjs local-ai/core-reader.cjs local-ai/server.cjs local-ai/install.cjs /app/local-ai/
COPY local-ai/public /app/local-ai/public
RUN node /app/local-ai/install.cjs
