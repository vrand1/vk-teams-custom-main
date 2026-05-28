(function (global) {
    'use strict';

    const CONNECTION_KEYS = ['customAimsid', 'rapiBaseUrl', 'rapiApiVersion'];

    function storageGet(area, keys) {
        return new Promise((resolve) => {
            try {
                area.get(keys, (result) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[VK Teams Connection Storage]', chrome.runtime.lastError.message);
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

    function hasStoredConnection(data) {
        return CONNECTION_KEYS.some((key) => {
            const v = data[key];
            return v != null && String(v).trim() !== '';
        });
    }

    async function readConnectionSettings() {
        const local = await storageGet(chrome.storage.local, CONNECTION_KEYS);
        if (hasStoredConnection(local)) {
            return local;
        }

        const sync = await storageGet(chrome.storage.sync, CONNECTION_KEYS);
        if (hasStoredConnection(sync)) {
            try {
                await storageSet(chrome.storage.local, sync);
            } catch (e) {
                console.warn('[VK Teams Connection Storage] sync→local:', e.message);
            }
            return sync;
        }

        return local;
    }

    function writeConnectionSettings(payload) {
        const data = {};
        CONNECTION_KEYS.forEach((key) => {
            if (payload[key] !== undefined) {
                data[key] = payload[key];
            }
        });
        return storageSet(chrome.storage.local, data);
    }

    function onConnectionSettingsChanged(listener) {
        if (!chrome.storage || !chrome.storage.onChanged) {
            return;
        }
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') {
                return;
            }
            if (CONNECTION_KEYS.some((k) => changes[k])) {
                listener(changes);
            }
        });
    }

    global.VKTeamsConnectionStorage = {
        KEYS: CONNECTION_KEYS,
        read: readConnectionSettings,
        write: writeConnectionSettings,
        onChanged: onConnectionSettingsChanged
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
