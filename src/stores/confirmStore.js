const crypto = require('crypto');

class ConfirmStore {
  constructor({ ttlMs = 2 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.pending = new Map(); // id -> { createdAt, requesterId, action }
  }

  create({ requesterId, action, context }) {
    const id = crypto.randomUUID();
    this.pending.set(id, {
      createdAt: Date.now(),
      requesterId,
      action,
      context,
    });
    return id;
  }

  get(id) {
    const data = this.pending.get(id);
    if (!data) return null;
    if (Date.now() - data.createdAt > this.ttlMs) {
      this.pending.delete(id);
      return null;
    }
    return data;
  }

  consume(id) {
    const data = this.get(id);
    if (!data) return null;
    this.pending.delete(id);
    return data;
  }
}

module.exports = { ConfirmStore };
