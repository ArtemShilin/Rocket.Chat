ARG BASE_IMAGE=registry.rocket.chat/rocketchat/rocket.chat:8.9.0@sha256:295f7b2c38fc3542024dc404f887eb2e13276b66e5854d31d86bcd069f6ce6dc
FROM ${BASE_IMAGE}
USER root
WORKDIR /app/account-devices
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY domain.cjs server.cjs install.cjs ./
COPY public ./public
COPY data/city.mmdb data/manifest.json ./data/
RUN node install.cjs
USER rocketchat
WORKDIR /app/bundle
