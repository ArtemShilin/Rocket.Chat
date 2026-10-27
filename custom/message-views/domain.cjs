const { createHash } = require('node:crypto');
const { HttpError } = require('../local-ai/domain.cjs');
const RETENTION_MS = 90 * 86400000;
const validId = value => typeof value === 'string' && /^[\w-]{1,200}$/.test(value);

function validate(body, acknowledge = false) {
  const keys = acknowledge ? ['messageId', 'version'] : ['messageId'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key)) || !validId(body.messageId)) {
    throw new HttpError(400, 'Некорректное сообщение.');
  }
  if (acknowledge && (typeof body.version !== 'string' || !/^[a-f0-9]{64}$/.test(body.version))) {
    throw new HttpError(400, 'Откройте текущую версию сообщения.');
  }
  return body;
}

function versionOf(message) {
  if (!message || message._hidden || message.private || message.t || message.e2e || !message.u?._id || typeof message.msg !== 'string' || !message.msg.trim()) {
    throw new HttpError(404, 'Текстовое сообщение недоступно.');
  }
  return createHash('sha256').update(JSON.stringify([message._id, message.msg, message.editedAt || null])).digest('hex');
}

module.exports = { RETENTION_MS, validId, validate, versionOf };
