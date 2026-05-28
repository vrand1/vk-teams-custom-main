(function (global) {
    'use strict';

    const STORAGE_KEY = 'customSidebarLinks';
    const MAX_LINKS = 15;

    const DEFAULT_SIDEBAR_LINKS = [
        {
            id: 'vkteams-default-erp',
            title: 'ERP',
            url: 'http://192.168.1.42/main',
            emoji: '🔶',
            openInNewTab: true
        }
    ];

    function storageGet() {
        return new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEY], (result) => {
                if (chrome.runtime.lastError) {
                    console.warn('[VK Teams Sidebar Links]', chrome.runtime.lastError.message);
                }
                resolve(result || {});
            });
        });
    }

    function storageSet(links) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [STORAGE_KEY]: links }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    function sanitizeLinks(raw) {
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw
            .filter((item) => item && item.id && item.url && item.title)
            .slice(0, MAX_LINKS)
            .map((item) => ({
                id: String(item.id),
                title: String(item.title).trim().slice(0, 80),
                url: String(item.url).trim(),
                emoji: String(item.emoji || '🔗').trim().slice(0, 8) || '🔗',
                openInNewTab: item.openInNewTab !== false
            }));
    }

    async function ensureDefaultSidebarLinks() {
        const seeded = sanitizeLinks(DEFAULT_SIDEBAR_LINKS);
        await storageSet(seeded);
        return seeded;
    }

    async function readSidebarLinks() {
        const result = await storageGet();
        if (!(STORAGE_KEY in result)) {
            return ensureDefaultSidebarLinks();
        }
        return sanitizeLinks(result[STORAGE_KEY]);
    }

    async function writeSidebarLinks(links) {
        const sanitized = sanitizeLinks(links);
        await storageSet(sanitized);
        return sanitized;
    }

    function onSidebarLinksChanged(listener) {
        if (!chrome.storage || !chrome.storage.onChanged) {
            return;
        }
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes[STORAGE_KEY]) {
                listener(sanitizeLinks(changes[STORAGE_KEY].newValue));
            }
        });
    }

    global.VKTeamsSidebarLinksStorage = {
        KEY: STORAGE_KEY,
        MAX_LINKS: MAX_LINKS,
        DEFAULTS: DEFAULT_SIDEBAR_LINKS,
        read: readSidebarLinks,
        write: writeSidebarLinks,
        onChanged: onSidebarLinksChanged,
        sanitize: sanitizeLinks,
        ensureDefaults: ensureDefaultSidebarLinks
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
