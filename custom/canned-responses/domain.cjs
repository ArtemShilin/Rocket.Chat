const { HttpError } = require('../local-ai/domain.cjs');
const idPattern = /^[a-f0-9-]{36}$/;
function validate(body, remove = false) {
  const allowed = remove ? ['id', 'revision'] : ['id', 'revision', 'shortcut', 'text', 'scope'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new HttpError(400, 'Некорректный запрос.');
  if (body.id !== undefined && (typeof body.id !== 'string' || !idPattern.test(body.id))) throw new HttpError(400, 'Некорректный ID.');
  if ((remove || body.id !== undefined) && (!body.id || !Number.isSafeInteger(body.revision) || body.revision < 1)) throw new HttpError(400, 'Укажите версию шаблона.');
  if (!body.id && body.revision !== undefined) throw new HttpError(400, 'Версия допустима только при изменении.');
  if (remove) return { id: body.id, revision: body.revision };
  if (typeof body.shortcut !== 'string' || !/^[a-zA-Z0-9а-яА-ЯёЁ_-]{1,48}$/.test(body.shortcut)) throw new HttpError(400, 'Название: до 48 букв, цифр, дефисов или подчёркиваний.');
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 10000) throw new HttpError(400, 'Текст: от 1 до 10000 символов.');
  if (!['personal', 'shared'].includes(body.scope)) throw new HttpError(400, 'Некорректная область доступа.');
  return { ...body, text: body.text.trim(), shortcut: body.shortcut.toLowerCase() };
}
function visible(uid) { return { $or: [{ owner: uid, scope: 'personal' }, { scope: 'shared' }] }; }
function writable(uid, admin) { return { $or: [{ owner: uid, scope: 'personal' }, ...(admin ? [{ scope: 'shared' }] : [])] }; }
function canWriteScope(scope, admin) { if (scope === 'shared' && !admin) throw new HttpError(403, 'Общие шаблоны изменяет администратор.'); }
module.exports = { validate, visible, writable, canWriteScope };
