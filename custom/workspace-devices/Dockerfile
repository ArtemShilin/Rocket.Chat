ARG BASE_IMAGE=rocketchat-local:8.9.0-ai-v2
FROM ${BASE_IMAGE}
COPY local-ai/chunks.cjs local-ai/archive.cjs /app/local-ai/
COPY local-ai/public /app/local-ai/public
COPY workspace-devices/package.json workspace-devices/*.cjs /app/workspace-devices/
COPY workspace-devices/public /app/workspace-devices/public
RUN node /app/workspace-devices/install.cjs
