const crypto = require('node:crypto');
const { HttpError } = require('./domain.cjs');

function createQueue() {
  const jobs = new Map(); const waiting = []; let working = false;
  async function drain() {
    if (working) return;
    working = true;
    try {
      while (waiting.length) {
        const entry = waiting.shift(); const { job } = entry;
        if (job.controller.signal.aborted) continue;
        job.status = 'running'; job.startedAt = new Date().toISOString();
        try {
          job.result = await entry.run(job, delta => Object.assign(job.progress, delta), job.controller.signal);
          job.controller.signal.throwIfAborted(); job.status = 'done';
        } catch (error) {
          job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
          job.error = job.status === 'cancelled' ? 'Задача отменена.' : error.status ? error.message : 'Не удалось завершить обработку. Повторите запрос.';
        }
        job.finishedAt = new Date().toISOString();
        job.resolve();
      }
    } finally { working = false; }
  }
  function submit(uid, operation, run) {
    for (const job of jobs.values()) {
      if (job.uid === uid && ['queued', 'running'].includes(job.status)) throw new HttpError(409, 'У вас уже выполняется задача. Дождитесь завершения или отмените её.');
      if (job.finishedAt && Date.now() - new Date(job.finishedAt) > 3600000) jobs.delete(job.id);
    }
    const job = { id: crypto.randomUUID(), uid, operation, status: 'queued', progress: {}, createdAt: new Date().toISOString(), controller: new AbortController() };
    job.finished = new Promise(resolve => { job.resolve = resolve; });
    jobs.set(job.id, job); waiting.push({ job, run });
    setImmediate(drain);
    return job;
  }
  function get(id, uid) {
    const job = jobs.get(id);
    if (!job || job.uid !== uid || job.finishedAt && Date.now() - new Date(job.finishedAt) > 3600000) throw new HttpError(404, 'Задача не найдена. После перезапуска сервера запустите запрос снова — индекс сохранён.');
    return job;
  }
  function cancel(id, uid) {
    const job = get(id, uid);
    if (['queued', 'running'].includes(job.status)) {
      job.controller.abort(); job.status = 'cancelled'; job.finishedAt = new Date().toISOString(); job.resolve();
      for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].job.id === id) waiting.splice(i, 1);
    }
    return job;
  }
  function status(job) {
    return { id: job.id, operation: job.operation, status: job.status, progress: job.progress, createdAt: job.createdAt,
      startedAt: job.startedAt, finishedAt: job.finishedAt, error: job.error,
      position: job.status === 'queued' ? waiting.findIndex(entry => entry.job.id === job.id) + 1 : 0 };
  }
  return { submit, get, cancel, status };
}

module.exports = { createQueue };
