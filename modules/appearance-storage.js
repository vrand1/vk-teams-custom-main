(function (global) {
    'use strict';

    const KEYS = ['appearanceEnabled', 'appearanceTheme', 'appearanceAccent', 'appearanceUiScale'];

    const DEFAULTS = {
        appearanceEnabled: true,
        appearanceTheme: 'system',
        appearanceAccent: 'lilac',
        appearanceUiScale: 100
    };

    function storageGet() {
        return new Promise((resolve) => {
            chrome.storage.local.get(KEYS, (result) => {
                if (chrome.runtime.lastError) {
                    console.warn('[VK Teams Appearance]', chrome.runtime.lastError.message);
                }
                resolve(result || {});
            });
        });
    }

    function storageSet(payload) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(payload, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    function sanitize(raw) {
        const theme = raw.appearanceTheme;
        const accent = raw.appearanceAccent;
        const scale = Number(raw.appearanceUiScale);

        return {
            appearanceEnabled: raw.appearanceEnabled !== false,
            appearanceTheme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : DEFAULTS.appearanceTheme,
            appearanceAccent: ['blue', 'turquoise', 'lilac', 'orange', 'pink', 'red'].includes(accent)
                ? accent
                : DEFAULTS.appearanceAccent,
            appearanceUiScale: Number.isFinite(scale) ? Math.min(140, Math.max(80, Math.round(scale))) : DEFAULTS.appearanceUiScale
        };
    }

    async function read() {
        const result = await storageGet();
        return sanitize(Object.assign({}, DEFAULTS, result));
    }

    async function write(settings) {
        const sanitized = sanitize(settings);
        await storageSet(sanitized);
        return sanitized;
    }

    function onChanged(listener) {
        if (!chrome.storage || !chrome.storage.onChanged) {
            return;
        }
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') {
                return;
            }
            if (!KEYS.some((k) => changes[k])) {
                return;
            }
            read().then(listener).catch(() => {});
        });
    }

    global.VKTeamsAppearanceStorage = {
        KEYS,
        DEFAULTS,
        read,
        write,
        sanitize,
        onChanged
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
