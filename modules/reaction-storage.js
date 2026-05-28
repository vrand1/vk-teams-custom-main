(function (global) {
    'use strict';

    const REACTION_KEYS = ['reactionSets', 'activeReactionSetId', 'customReactions'];

    function storageGet(area, keys) {
        return new Promise((resolve) => {
            try {
                area.get(keys, (result) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[VK Teams Reactions Storage]', chrome.runtime.lastError.message);
                    }
                    resolve(result || {});
                });
            } catch (e) {
                resolve({});
            }
        });
    }

    function storageSet(area, payload) {
        return new Promise((resolve, reject) => {
            try {
                area.set(payload, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve();
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async function readReactionData() {
        const local = await storageGet(chrome.storage.local, REACTION_KEYS);
        if (Array.isArray(local.reactionSets) && local.reactionSets.length > 0) {
            return local;
        }

        const sync = await storageGet(chrome.storage.sync, REACTION_KEYS);
        if (Array.isArray(sync.reactionSets) && sync.reactionSets.length > 0) {
            try {
                await storageSet(chrome.storage.local, {
                    reactionSets: sync.reactionSets,
                    activeReactionSetId: sync.activeReactionSetId,
                    customReactions: sync.customReactions
                });
            } catch (e) {
                console.warn('[VK Teams Reactions Storage] sync→local migrate failed:', e.message);
            }
            return sync;
        }

        return Object.assign({}, local, sync);
    }

    function writeReactionData(payload, done) {
        const data = {};
        REACTION_KEYS.forEach((key) => {
            if (payload[key] !== undefined) {
                data[key] = payload[key];
            }
        });

        storageSet(chrome.storage.local, data)
            .then(() => {
                if (typeof done === 'function') {
                    done();
                }
            })
            .catch((err) => {
                console.error('[VK Teams Reactions Storage] save failed:', err.message);
                if (typeof done === 'function') {
                    done(err);
                }
            });
    }

    function onReactionDataChanged(listener) {
        if (!chrome.storage || !chrome.storage.onChanged) {
            return;
        }
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') {
                return;
            }
            if (REACTION_KEYS.some((k) => changes[k])) {
                listener(changes);
            }
        });
    }

    global.VKTeamsReactionStorage = {
        KEYS: REACTION_KEYS,
        read: readReactionData,
        write: writeReactionData,
        onChanged: onReactionDataChanged
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
