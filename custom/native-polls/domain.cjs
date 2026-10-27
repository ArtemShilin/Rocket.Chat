const { HttpError } = require('../local-ai/domain.cjs');
const { randomUUID } = require('node:crypto');
const validId = value => typeof value === 'string' && /^[\w-]{1,200}$/.test(value);
function exact(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) throw new HttpError(400, 'Некорректный запрос.');
}
function createInput(body, now = new Date()) {
  exact(body, ['roomId', 'question', 'description', 'options', 'multiple', 'maxSelections', 'anonymous', 'results', 'closesAt']);
  if (!validId(body.roomId)) throw new HttpError(400, 'Выберите комнату.');
  const text = (value, max, label, required = true) => {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new HttpError(400, label);
    return value.trim();
  };
  const question = text(body.question, 240, 'Вопрос: от 1 до 240 символов.');
  const description = text(body.description ?? '', 1000, 'Описание: до 1000 символов.', false);
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 12) throw new HttpError(400, 'Добавьте от 2 до 12 вариантов.');
  const labels = body.options.map(value => text(value, 200, 'Вариант: от 1 до 200 символов.'));
  if (new Set(labels.map(value => value.toLocaleLowerCase('ru'))).size !== labels.length) throw new HttpError(400, 'Варианты должны различаться.');
  if (typeof body.multiple !== 'boolean' || typeof body.anonymous !== 'boolean' || !['always', 'after-vote'].includes(body.results)) throw new HttpError(400, 'Проверьте настройки опроса.');
  const maxSelections = body.multiple ? body.maxSelections : 1;
  if (!Number.isInteger(maxSelections) || maxSelections < 1 || maxSelections > labels.length) throw new HttpError(400, 'Некорректное число выбранных вариантов.');
  let closesAt = null;
  if (body.closesAt !== null && body.closesAt !== undefined) {
    if (typeof body.closesAt !== 'string') throw new HttpError(400, 'Некорректный срок.');
    closesAt = new Date(body.closesAt);
    if (!Number.isFinite(+closesAt) || closesAt <= now || +closesAt > +now + 366 * 86400000) throw new HttpError(400, 'Срок должен быть в будущем, не дальше года.');
  }
  return { roomId: body.roomId, question, description, options: labels.map(label => ({ id: randomUUID(), label })), multiple: body.multiple, maxSelections, anonymous: body.anonymous, results: body.results, closesAt };
}
function voteInput(body, poll) {
  exact(body, ['pollId', 'selections']);
  if (!Array.isArray(body.selections) || body.selections.length > poll.maxSelections || new Set(body.selections).size !== body.selections.length || !body.selections.every(id => typeof id === 'string' && poll.options.some(option => option.id === id))) throw new HttpError(400, 'Выберите допустимые варианты.');
  return [...body.selections].sort();
}
const isClosed = (poll, now = new Date()) => poll.status === 'closed' || Boolean(poll.closesAt && poll.closesAt <= now);
const resultsVisible = (poll, own, now) => isClosed(poll, now) || poll.results === 'always' || Boolean(own?.length);
module.exports = { exact, validId, createInput, voteInput, isClosed, resultsVisible };
