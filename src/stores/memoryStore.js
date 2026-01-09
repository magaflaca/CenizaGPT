class MemoryStore {
  constructor({ historyLimit = 12 } = {}) {
    this.historyLimit = Math.max(4, Number(historyLimit) || 12);
    this.channelHistory = new Map(); // key -> [{ role, content }]
    this.userState = new Map(); // key -> { activeItem, ... }
  }

  _channelKey(guildId, channelId) {
    return `${guildId}:${channelId}`;
  }

  _userKey(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  addChatMessage({ guildId, channelId, role, content }) {
    const key = this._channelKey(guildId, channelId);
    const arr = this.channelHistory.get(key) || [];
    arr.push({ role, content, ts: Date.now() });
    // recortar
    const maxLen = this.historyLimit;
    while (arr.length > maxLen) arr.shift();
    this.channelHistory.set(key, arr);
  }

  getChatHistory({ guildId, channelId }) {
    const key = this._channelKey(guildId, channelId);
    return this.channelHistory.get(key) || [];
  }

  resetChannel({ guildId, channelId }) {
    const key = this._channelKey(guildId, channelId);
    this.channelHistory.delete(key);
  }

  resetUser({ guildId, userId }) {
    const key = this._userKey(guildId, userId);
    this.userState.delete(key);
  }

  getUserState({ guildId, userId }) {
    const key = this._userKey(guildId, userId);
    return this.userState.get(key) || {};
  }

  setUserState({ guildId, userId, patch }) {
    const key = this._userKey(guildId, userId);
    const prev = this.userState.get(key) || {};
    this.userState.set(key, { ...prev, ...patch });
  }
}

module.exports = { MemoryStore };
