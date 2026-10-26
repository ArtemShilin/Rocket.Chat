const { HttpError } = require('./domain.cjs');

function *chunks(text, bytes = 2000) {
  let part = ''; let size = 0;
  for (const point of text) {
    const length = Buffer.byteLength(point);
    if (size && size + length > bytes) { yield part; part = ''; size = 0; }
    part += point; size += length;
  }
  if (part) yield part;
}

function average(vectors) {
  if (!vectors.length || !vectors[0]?.length) throw new HttpError(502, 'Пустой ответ модели поиска.');
  return vectors[0].map((_, index) => vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length);
}

function parseNote(content, allowed) {
  let result;
  try { result = JSON.parse(content); } catch { throw new HttpError(502, 'Модель вернула неполный ответ. Повторите запрос.'); }
  if (typeof result.answer !== 'string' || (result.citations !== undefined && !Array.isArray(result.citations))) throw new HttpError(502, 'Некорректный ответ модели.');
  const refs = [...new Set([...(result.citations || []), ...[...result.answer.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]))])];
  if (refs.some(n => !Number.isInteger(n) || !allowed.has(n))) throw new HttpError(502, 'Ответ содержит неизвестную ссылку.');
  let text = result.answer;
  if (!/[\p{L}]/u.test(text.replace(/\[\d+\]/g, ''))) throw new HttpError(502, 'Модель не сформировала текст ответа. Повторите запрос.');
  if (!/\[\d+\]/.test(text) && refs.length) text += ' ' + refs.map(n => `[${n}]`).join(' ');
  if (!refs.length) text = 'В этих сообщениях недостаточно подтверждённой информации.';
  return { text, refs };
}

// This is a context window size, not a limit on the number of input messages.
const CONTEXT_BYTES = 2000;

async function reduceAll(input, models, query, mode, progress = () => {}) {
  const levels = [];
  let calls = 0;
  async function reduce(items) {
    const allowed = new Set(items.flatMap(item => item.refs));
    if (!allowed.size) return { text: 'Недостаточно подтверждённых данных.', refs: [] };
    const content = await models.reduce(query, items, mode);
    progress({ modelCalls: ++calls });
    return parseNote(content, allowed);
  }
  async function carry(note, level = 0) {
    levels[level] ||= [];
    levels[level].push(note);
    const bytes = levels[level].reduce((sum, item) => sum + Buffer.byteLength(item.text), 0);
    if (levels[level].length >= 4 || (levels[level].length > 1 && bytes > CONTEXT_BYTES)) {
      const group = levels[level]; levels[level] = [];
      await carry(await reduce(group), level + 1);
    }
  }
  let batch = []; let size = 0;
  for await (const item of input) {
    const length = Buffer.byteLength(item.text);
    if (batch.length && (size + length > CONTEXT_BYTES || batch.length >= 16)) { await carry(await reduce(batch)); batch = []; size = 0; }
    batch.push(item); size += length;
  }
  if (batch.length) await carry(await reduce(batch));
  let notes = levels.reverse().flat();
  while (notes.length > 1) {
    const next = [];
    for (let index = 0; index < notes.length; index += 2) next.push(await reduce(notes.slice(index, index + 2)));
    notes = next;
  }
  return notes[0] || { text: 'Нет доступных текстовых сообщений.', refs: [] };
}

module.exports = { chunks, average, parseNote, reduceAll };
