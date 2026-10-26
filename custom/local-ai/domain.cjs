const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function validateRequest(body, action) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Некорректный запрос.');
  const allowed = action === 'answer' ? ['query', 'messageIds'] : action === 'summary' ? ['roomId'] : ['query', 'roomId'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new HttpError(400, 'Неизвестный параметр запроса.');
  const id = value => typeof value === 'string' && /^[\w-]{1,200}$/.test(value);
  if (action !== 'summary' && (typeof body.query !== 'string' || body.query.trim().length < 2)) {
    throw new HttpError(400, 'Введите вопрос длиной от 2 символов.');
  }
  if (body.roomId !== undefined && !id(body.roomId)) throw new HttpError(400, 'Некорректный канал.');
  if (action === 'summary' && !id(body.roomId)) throw new HttpError(400, 'Выберите канал для сводки.');
  if (action === 'answer' && (!Array.isArray(body.messageIds) || !body.messageIds.length || !body.messageIds.every(id))) {
    throw new HttpError(400, 'Некорректные источники ответа.');
  }
  return body;
}

function visibleText(message) {
  if (!message || message.t || typeof message.msg !== 'string' || !message.msg.trim()) return null;
  return message.msg.trim();
}

const textHash = text => crypto.createHash('sha256').update(text).digest('hex');

function cosine(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function keywordScore(query, text) {
  const normalize = value => value.toLowerCase().replaceAll('ё', 'е');
  const words = [...new Set(normalize(query).match(/[\p{L}\p{N}_-]{2,}/gu) || [])];
  const target = normalize(text);
  return words.length ? words.filter(word => target.includes(word)).length / words.length : 0;
}

function rank(query, queryVector, messages) {
  return messages.map(message => {
    const semantic = cosine(queryVector, message.vector);
    const keyword = keywordScore(query, message.text);
    return { ...message, score: 0.75 * semantic + 0.25 * keyword, semantic, keyword };
  }).filter(message => message.semantic >= 0.35 || message.keyword >= 0.5)
    .sort((a, b) => b.score - a.score);
}

function source(message, room) {
  const prefix = { c: 'channel', p: 'group', d: 'direct' }[room.t];
  return {
    id: message._id, roomId: room.rid, roomName: room.fname || room.name || room.rid,
    text: visibleText(message), author: message.u?.name || message.u?.username || 'Участник',
    date: message.ts, url: `/${prefix}/${encodeURIComponent(room.name || room.rid)}?msg=${encodeURIComponent(message._id)}`,
  };
}

function groundedAnswer(content, sources) {
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new HttpError(502, 'Модель вернула неполный ответ. Попробуйте повторить запрос.'); }
  if (typeof parsed.answer !== 'string' || parsed.answer.length > 6000 || !Array.isArray(parsed.citations)) {
    throw new HttpError(502, 'Не удалось проверить ответ модели.');
  }
  const inline = [...parsed.answer.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
  if ([...inline, ...parsed.citations].some(n => !Number.isInteger(n) || n < 1 || n > sources.length)) {
    throw new HttpError(502, 'Модель указала неизвестный источник. Ответ не показан.');
  }
  if (!inline.length && parsed.citations.length) {
    return parsed.answer.trim() + ' ' + [...new Set(parsed.citations)].map(n => `[${n}]`).join(' ');
  }
  if (!inline.length) return 'В найденных сообщениях недостаточно подтверждений для ответа. Проверьте источники ниже или уточните вопрос.';
  return parsed.answer;
}

module.exports = { HttpError, validateRequest, visibleText, textHash, cosine, keywordScore, rank, source, groundedAnswer };
