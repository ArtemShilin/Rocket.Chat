ARG BASE_IMAGE=rocketchat-local:8.9.0-workspace-v1
FROM ${BASE_IMAGE}
COPY canned-responses/package.json canned-responses/*.cjs /app/canned-responses/
COPY canned-responses/public /app/canned-responses/public
RUN node /app/canned-responses/install.cjs
