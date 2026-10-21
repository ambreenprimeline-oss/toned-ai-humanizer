/**
 * localStorage-backed job store.
 * Replaces base44.entities.RewriteJob and base44.entities.UserSetting.
 */

function readAll(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

function writeAll(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

// ─── RewriteJob ───────────────────────────────────────────────────────────────

const JOB_KEY = 'humanizer_jobs';

const RewriteJob = {
  create(data) {
    const jobs = readAll(JOB_KEY);
    const record = { ...data, id: makeId(), created_date: now() };
    jobs.unshift(record);
    writeAll(JOB_KEY, jobs);
    return Promise.resolve(record);
  },

  get(id) {
    const jobs = readAll(JOB_KEY);
    const found = jobs.find((j) => j.id === id);
    if (!found) return Promise.reject(new Error('Job not found'));
    return Promise.resolve(found);
  },

  update(id, patch) {
    const jobs = readAll(JOB_KEY);
    const index = jobs.findIndex((j) => j.id === id);
    if (index === -1) return Promise.reject(new Error('Job not found'));
    jobs[index] = { ...jobs[index], ...patch };
    writeAll(JOB_KEY, jobs);
    return Promise.resolve(jobs[index]);
  },

  delete(id) {
    const jobs = readAll(JOB_KEY).filter((j) => j.id !== id);
    writeAll(JOB_KEY, jobs);
    return Promise.resolve();
  },

  deleteMany(filter) {
    let jobs = readAll(JOB_KEY);
    if (filter?.expires_at?.$lt) {
      const cutoff = filter.expires_at.$lt;
      jobs = jobs.filter((j) => !j.expires_at || j.expires_at >= cutoff);
    } else if (filter?.created_by_id !== undefined) {
      // Wipe all (single-user app, created_by_id is ignored)
      jobs = [];
    }
    writeAll(JOB_KEY, jobs);
    return Promise.resolve();
  },

  /** list(sortField, limit) — sortField prefixed with '-' means descending */
  list(sortField = '-created_date', limit = 100) {
    let jobs = readAll(JOB_KEY);
    const desc = String(sortField).startsWith('-');
    const field = desc ? sortField.slice(1) : sortField;
    jobs.sort((a, b) => {
      const av = a[field] || '';
      const bv = b[field] || '';
      return desc ? (bv > av ? 1 : -1) : av > bv ? 1 : -1;
    });
    return Promise.resolve(jobs.slice(0, limit));
  },
};

// ─── UserSetting ──────────────────────────────────────────────────────────────

const SETTING_KEY = 'humanizer_settings';

const UserSetting = {
  list(_sort, _limit) {
    const settings = readAll(SETTING_KEY);
    return Promise.resolve(settings.slice(0, 1));
  },

  create(data) {
    const record = { ...data, id: makeId(), created_date: now() };
    writeAll(SETTING_KEY, [record]);
    return Promise.resolve(record);
  },

  update(id, patch) {
    const settings = readAll(SETTING_KEY);
    const index = settings.findIndex((s) => s.id === id);
    if (index === -1) return Promise.reject(new Error('Setting not found'));
    settings[index] = { ...settings[index], ...patch };
    writeAll(SETTING_KEY, settings);
    return Promise.resolve(settings[index]);
  },
};

export const jobStore = { RewriteJob, UserSetting };
