ARG BASE_IMAGE=rocketchat-local:8.9.0-canned-v1
FROM ${BASE_IMAGE}
COPY native-polls/package.json native-polls/*.cjs /app/native-polls/
COPY native-polls/public /app/native-polls/public
RUN node /app/native-polls/install.cjs
