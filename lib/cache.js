const store = new Map();

function get(key, ttlMs) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > ttlMs) {
        store.delete(key);
        return null;
    }
    return entry.value;
}

function set(key, value) {
    store.set(key, { at: Date.now(), value });
}

module.exports = { get, set };
