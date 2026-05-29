(function() {
    'use strict';

    const DEFAULT_RAPI_URL = 'https://u.myteam.vmailru.net';
    const DEFAULT_RAPI_API_VERSION = '145';
    let RAPI_URL = DEFAULT_RAPI_URL;
    let RAPI_API_VERSION = DEFAULT_RAPI_API_VERSION;

    function readConnectionFromStorage() {
        return new Promise((resolve) => {
            if (window.VKTeamsConnectionStorage) {
                window.VKTeamsConnectionStorage.read().then(resolve).catch(() => resolve({}));
                return;
            }
            chrome.storage.local.get(['customAimsid', 'rapiBaseUrl', 'rapiApiVersion'], (local) => {
                const hasLocal =
                    (local.customAimsid && String(local.customAimsid).trim()) ||
                    (local.rapiBaseUrl && String(local.rapiBaseUrl).trim());
                if (hasLocal) {
                    resolve(local);
                    return;
                }
                chrome.storage.sync.get(['customAimsid', 'rapiBaseUrl', 'rapiApiVersion'], resolve);
            });
        });
    }

    function loadRapiConfig() {
        return readConnectionFromStorage().then((r) => {
            RAPI_URL = DEFAULT_RAPI_URL;
            RAPI_API_VERSION = DEFAULT_RAPI_API_VERSION;
            if (r.rapiBaseUrl && typeof r.rapiBaseUrl === 'string' && r.rapiBaseUrl.trim()) {
                RAPI_URL = r.rapiBaseUrl.trim().replace(/\/$/, '');
            }
            if (r.rapiApiVersion != null && String(r.rapiApiVersion).trim() !== '') {
                RAPI_API_VERSION = String(r.rapiApiVersion).trim();
            }
        });
    }

    function loadAimsidConfig() {
        return readConnectionFromStorage().then((r) => {
            const stored = (r.customAimsid && typeof r.customAimsid === 'string') ? r.customAimsid.trim() : '';
            aimsid = stored || getAIMSID();
        });
    }

    function mirrorConnectionToPageStorage() {
        try {
            localStorage.setItem('vkteams_rapi_url', RAPI_URL);
            localStorage.setItem('vkteams_rapi_ver', RAPI_API_VERSION);
            if (aimsid) {
                localStorage.setItem('vkteams_custom_aimsid', aimsid);
            }
        } catch (e) {
            /* ignore */
        }
    }

    function loadConnectionConfig() {
        return loadRapiConfig().then(() => loadAimsidConfig()).then(() => {
            mirrorConnectionToPageStorage();
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'vkteams-inject') {
            return;
        }
        if (event.data.type === 'setReaction') {
            ackInjectReactionHandled();
            loadConnectionConfig().then(() => {
                setReaction(event.data.messageId, event.data.chatId, event.data.reaction);
            });
        }
    });

    function ackInjectReactionHandled() {
        try {
            window.postMessage({
                source: 'vkteams-reactions-extension',
                type: 'setReactionAck'
            }, '*');
        } catch (e) {
            /* ignore */
        }
    }

    const DEFAULT_REACTIONS = ['🤨', '🙄', '🥱', '😭', '🥶', '🤮', '🥺', '💀', '🦧', '🔇'];
    const MAX_REACTIONS = 30;

    let aimsid = null;
    let activePopup = null;
    let CUSTOM_REACTIONS = [...DEFAULT_REACTIONS];
    let aiManager = null;
    function closeActiveReactionPopup() {
        if (!activePopup) {
            return;
        }
        try {
            activePopup.remove();
        } catch (e) {
            console.error('[VK Teams Custom Reactions] Error removing popup:', e);
        }
        activePopup = null;
    }
    function parseReactionsInput(input) {
        if (input == null) {
            return null;
        }
        if (Array.isArray(input)) {
            const list = input
                .map((item) => (typeof item === 'string' ? item.trim() : ''))
                .filter(Boolean);
            return list.length ? list : null;
        }
        if (typeof input !== 'string') {
            return null;
        }
        const trimmed = input.trim();
        if (!trimmed) {
            return null;
        }
        if (/[\s,;|]/.test(trimmed)) {
            const list = trimmed.split(/[\s,;|]+/).map((s) => s.trim()).filter(Boolean);
            return list.length ? list : null;
        }
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const seg = new Intl.Segmenter('ru', { granularity: 'grapheme' });
            const list = [...seg.segment(trimmed)].map((s) => s.segment).filter(Boolean);
            return list.length ? list : null;
        }
        return [...trimmed];
    }
    function applyReactions(reactions, options = {}) {
        const { persist = false, source = 'unknown' } = options;
        const parsed = parseReactionsInput(reactions);
        if (!parsed || !parsed.length) {
            console.warn('[VK Teams Custom Reactions] Invalid reactions:', reactions);
            return false;
        }
        CUSTOM_REACTIONS = parsed.slice(0, MAX_REACTIONS);
        closeActiveReactionPopup();
        syncReactionsPageAttribute();
        if (persist && chrome.storage) {
            persistReactionsToStorage();
        }
        return true;
    }

    function resolveReactionsFromStorage(result) {
        if (Array.isArray(result.reactionSets) && result.reactionSets.length) {
            const activeId = result.activeReactionSetId || result.reactionSets[0].id;
            const activeSet = result.reactionSets.find((s) => s && s.id === activeId);
            if (activeSet && Array.isArray(activeSet.reactions) && activeSet.reactions.length) {
                return activeSet.reactions;
            }
        }
        if (result.customReactions && Array.isArray(result.customReactions) && result.customReactions.length) {
            return result.customReactions;
        }
        return null;
    }

    function persistReactionsToStorage() {
        const apply = (result) => {
            const sets = Array.isArray(result.reactionSets) ? result.reactionSets : [];
            const activeId = result.activeReactionSetId;
            const payload = { customReactions: CUSTOM_REACTIONS };
            if (sets.length && activeId) {
                payload.reactionSets = sets.map((set) => (
                    set.id === activeId
                        ? Object.assign({}, set, { reactions: CUSTOM_REACTIONS.slice() })
                        : set
                ));
                payload.activeReactionSetId = activeId;
            }
            if (window.VKTeamsReactionStorage) {
                window.VKTeamsReactionStorage.write(payload);
                return;
            }
            chrome.storage.local.set(payload, () => {
                if (chrome.runtime.lastError) {
                    console.error('[VK Teams Custom Reactions] save failed:', chrome.runtime.lastError.message);
                }
            });
        };

        if (window.VKTeamsReactionStorage) {
            window.VKTeamsReactionStorage.read().then(apply);
            return;
        }
        chrome.storage.local.get(['reactionSets', 'activeReactionSetId'], (local) => {
            if (Array.isArray(local.reactionSets) && local.reactionSets.length) {
                apply(local);
                return;
            }
            chrome.storage.sync.get(['reactionSets', 'activeReactionSetId'], apply);
        });
    }
    function loadCustomReactions() {
        return new Promise((resolve) => {
            const finish = (result) => {
                const reactions = resolveReactionsFromStorage(result);
                if (reactions) {
                    applyReactions(reactions, { persist: false, source: 'storage' });
                } else {
                    applyReactions(DEFAULT_REACTIONS, { persist: false, source: 'defaults' });
                }
                resolve();
            };

            if (window.VKTeamsReactionStorage) {
                window.VKTeamsReactionStorage.read().then(finish).catch(() => finish({}));
                return;
            }
            chrome.storage.local.get(['reactionSets', 'activeReactionSetId', 'customReactions'], (local) => {
                if (Array.isArray(local.reactionSets) && local.reactionSets.length) {
                    finish(local);
                    return;
                }
                chrome.storage.sync.get(['reactionSets', 'activeReactionSetId', 'customReactions'], finish);
            });
        });
    }

    function onReactionStorageChanged() {
        const reload = (result) => {
            const reactions = resolveReactionsFromStorage(result);
            if (reactions) {
                applyReactions(reactions, { persist: false, source: 'storage-change' });
            }
        };
        if (window.VKTeamsReactionStorage) {
            window.VKTeamsReactionStorage.read().then(reload);
            return;
        }
        chrome.storage.local.get(['reactionSets', 'activeReactionSetId', 'customReactions'], reload);
    }

    if (window.VKTeamsReactionStorage) {
        window.VKTeamsReactionStorage.onChanged(onReactionStorageChanged);
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' && areaName !== 'sync') {
            return;
        }
        if (changes.customReactions || changes.reactionSets || changes.activeReactionSetId) {
            onReactionStorageChanged();
        }
        if (changes.customAimsid || changes.rapiBaseUrl || changes.rapiApiVersion) {
            loadConnectionConfig();
        }
        if (changes.extensionActivated) {
            init();
        }
    });

    function syncReactionsPageAttribute() {
        try {
            document.documentElement.setAttribute(
                'data-vk-teams-reactions',
                JSON.stringify(CUSTOM_REACTIONS)
            );
        } catch (e) {
            /* ignore */
        }
    }
    window.__vkTeamsReactions = {
        get: () => [...CUSTOM_REACTIONS],
        defaults: () => [...DEFAULT_REACTIONS],
        set: (reactions, persist = true) => applyReactions(reactions, { persist, source: 'console' }),
        reset: () => applyReactions(DEFAULT_REACTIONS, { persist: true, source: 'console-reset' })
    };
    function installPageConsoleBridge() {
        if (document.documentElement.getAttribute('data-vk-teams-reactions-bridge')) {
            syncReactionsPageAttribute();
            return;
        }
        document.documentElement.setAttribute('data-vk-teams-reactions-bridge', '1');
        syncReactionsPageAttribute();

        const script = document.createElement('script');
        script.textContent = `(() => {
            if (window.__vkTeamsReactions && window.__vkTeamsReactions.__pageBridge) return;
            const DEFAULTS = ${JSON.stringify(DEFAULT_REACTIONS)};
            const read = () => {
                try {
                    const raw = document.documentElement.getAttribute('data-vk-teams-reactions');
                    return raw ? JSON.parse(raw) : [];
                } catch (e) { return []; }
            };
            const post = (type, extra) => window.postMessage(Object.assign({
                source: 'vkteams-reactions-extension',
                type: type
            }, extra || {}), '*');
            window.__vkTeamsReactions = {
                __pageBridge: true,
                get: () => read(),
                defaults: () => DEFAULTS.slice(),
                set: (reactions, persist) => post('set', { reactions: reactions, persist: persist !== false }),
                reset: () => post('reset')
            };
        })();`;
        (document.documentElement || document.head).appendChild(script);
        script.remove();

        window.addEventListener('message', (event) => {
            if (event.source !== window || !event.data || event.data.source !== 'vkteams-reactions-extension') {
                return;
            }
            if (event.data.type === 'set') {
                applyReactions(event.data.reactions, {
                    persist: event.data.persist !== false,
                    source: 'page-console'
                });
            } else if (event.data.type === 'reset') {
                applyReactions(DEFAULT_REACTIONS, { persist: true, source: 'page-console-reset' });
            }
        });
    }

    installPageConsoleBridge();
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'reloadReactions') {
            if (message.reactions) {
                applyReactions(message.reactions, { persist: false, source: 'popup' });
                sendResponse({ success: true, reactions: CUSTOM_REACTIONS });
            } else {
                loadCustomReactions().then(() => {
                    sendResponse({ success: true, reactions: CUSTOM_REACTIONS });
                });
                return true;
            }
            return false;
        }

        if (message.action === 'getReactions') {
            sendResponse({ success: true, reactions: CUSTOM_REACTIONS, defaults: DEFAULT_REACTIONS });
            return false;
        }

        if (message.action === 'reloadAi') {
            console.log('[VK Teams AI] Reloading AI config...');
            if (aiManager) {
                aiManager.init().then(() => {
                    console.log('[VK Teams AI] AI config reloaded');
                    processMessages();
                    sendResponse({ success: true });
                }).catch((err) => {
                    console.error('[VK Teams AI] Reload failed:', err);
                    sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
                });
                return true;
            }
            sendResponse({ success: false, error: 'AI Manager not initialized' });
            return false;
        }

        if (message.action === 'reloadRapiConfig' || message.action === 'reloadConnection') {
            loadConnectionConfig().then(() => {
                sendResponse({ success: true, aimsid: aimsid ? true : false });
            });
            return true;
        }

        if (message.action === 'getDetectedAimsid') {
            const detected = getAIMSID();
            sendResponse({ success: !!detected, aimsid: detected || null });
            return false;
        }

        if (message.action === 'extensionActivated') {
            init();
            sendResponse({ success: true });
            return false;
        }

        if (message.action === 'reloadAppearance') {
            if (window.VKTeamsAppearanceApplier) {
                const run = message.settings
                    ? Promise.resolve().then(() => {
                        const s = window.VKTeamsAppearanceStorage
                            ? window.VKTeamsAppearanceStorage.sanitize(message.settings)
                            : message.settings;
                        window.VKTeamsAppearanceApplier.applySettings(s);
                    })
                    : window.VKTeamsAppearanceApplier.loadAndApply();
                Promise.resolve(run).then(() => {
                    sendResponse({ success: true });
                }).catch((err) => {
                    sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
                });
                return true;
            }
            sendResponse({ success: false, error: 'Appearance applier not loaded' });
            return false;
        }
    });
    const AIMSID_PATTERN = /\d{3}\.\d+\.\d+:[a-zA-Z0-9.@_-]+/;

    function scanStorageForAimsid(storage) {
        try {
            for (const key of Object.keys(storage)) {
                const value = storage.getItem(key);
                if (!value || typeof value !== 'string') {
                    continue;
                }
                const match = value.match(AIMSID_PATTERN);
                if (match) {
                    return match[0];
                }
            }
        } catch (e) {
            /* ignore */
        }
        return null;
    }

    function getAIMSID() {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'aimsid' && value) {
                return value;
            }
        }
        return scanStorageForAimsid(localStorage) || scanStorageForAimsid(sessionStorage);
    }
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    function showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'success' ? '#4CAF50' : '#f44336'};
            color: white;
            border-radius: 4px;
            z-index: 10001;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            animation: slideIn 0.3s ease-out;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    function normalizeRapiMsgId(messageId) {
        const raw = String(messageId).trim();
        if (!/^\d+$/.test(raw)) {
            return messageId;
        }
        const asNumber = Number(raw);
        return Number.isSafeInteger(asNumber) ? asNumber : raw;
    }

    function buildReactionAddBody(reqId, messageId, chatId, reactions, reaction) {
        const msgId = normalizeRapiMsgId(messageId);
        const params = {
            chatId: chatId,
            reactions: reactions,
            customReactions: CUSTOM_REACTIONS,
            reaction: reaction
        };
        if (typeof msgId === 'number') {
            return JSON.stringify({
                reqId: reqId,
                aimsid: aimsid,
                params: Object.assign({ msgId: msgId }, params)
            });
        }
        const msgIdLiteral = /^\d+$/.test(String(msgId).trim()) ? String(msgId).trim() : JSON.stringify(msgId);
        return '{"reqId":' + JSON.stringify(reqId)
            + ',"aimsid":' + JSON.stringify(aimsid)
            + ',"params":{"msgId":' + msgIdLiteral
            + ',"chatId":' + JSON.stringify(chatId)
            + ',"reactions":' + JSON.stringify(reactions)
            + ',"customReactions":' + JSON.stringify(CUSTOM_REACTIONS)
            + ',"reaction":' + JSON.stringify(reaction)
            + '}}';
    }

    function setReaction(messageId, chatId, reaction) {
        if (!aimsid) {
            aimsid = getAIMSID();
        }
        if (!aimsid) {
            showNotification('❌ AIMSID not found', 'error');
            return;
        }

        const reqId = generateUUID();
        const allEmojis = (window.VKTeamsAllEmojis && window.VKTeamsAllEmojis.list) || [];
        const jsonBody = buildReactionAddBody(reqId, messageId, chatId, allEmojis, reaction);

        fetch(`${RAPI_URL}/api/v${RAPI_API_VERSION}/rapi/reaction/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/plain',
                'X-Teams-Aimsid': aimsid
            },
            body: jsonBody
        })
            .then((response) => response.text())
            .then((text) => {
                const data = JSON.parse(text);
                const statusCode = data.status?.code;
                const statusDetail = data.status?.reason || data.status?.message || '';

                if (statusCode === 50000 || statusCode === 20000) {
                    showNotification(`✅ Reaction ${reaction} set!`);
                } else if (statusCode === 40000) {
                    showNotification(`❌ Error 40000: ${statusDetail || 'Invalid request'}`, 'error');
                } else if (statusCode === 40200) {
                    showNotification(`❌ Сессия (aimsid): ${statusDetail || 'Invalid token'}`, 'error');
                } else {
                    showNotification(`⚠️ ${statusCode}${statusDetail ? ': ' + statusDetail : ''}`, 'error');
                }
            })
            .catch(() => {
                showNotification('❌ Network error', 'error');
            });
    }

    function createEmojiPopup(messageElement, messageId, chatId, buttonElement) {
        closeActiveReactionPopup();

        const popup = document.createElement('div');
        popup.className = 'vkteams-custom-reactions-popup';

        CUSTOM_REACTIONS.forEach(emoji => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = emoji;

            button.addEventListener('click', (e) => {
                e.stopPropagation();
                setReaction(messageId, chatId, emoji);
                try {
                    popup.remove();
                } catch (err) {
                    console.error('[VK Teams Custom Reactions] Error removing popup:', err);
                }
                activePopup = null;
            });

            popup.appendChild(button);
        });

        const buttonRect = buttonElement.getBoundingClientRect();

        let left = buttonRect.right + 10;
        let top = buttonRect.top;

        const popupWidth = Math.min(520, CUSTOM_REACTIONS.length * 34 + 16);
        if (left + popupWidth > window.innerWidth) {
            left = buttonRect.left - popupWidth - 10;
        }

        if (left < 10) {
            left = 10;
        }

        const popupHeight = 40;
        if (top + popupHeight > window.innerHeight) {
            top = window.innerHeight - popupHeight - 10;
        }
        if (top < 10) {
            top = 10;
        }

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;

        document.body.appendChild(popup);
        activePopup = popup;

        setTimeout(() => {
            document.addEventListener('click', function closePopup(e) {
                if (!popup.contains(e.target)) {
                    popup.remove();
                    activePopup = null;
                    document.removeEventListener('click', closePopup);
                }
            });
        }, 100);
    }
    function createAiPopup(action, result, messageElement, chatId) {
        if (activePopup) {
            try {
                activePopup.remove();
            } catch (e) {
                console.error('[VK Teams AI] Error removing popup:', e);
            }
            activePopup = null;
        }

        const popup = document.createElement('div');
        popup.className = 'vkteams-ai-popup';
        popup.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.2);
            padding: 20px;
            z-index: 10000;
            min-width: 400px;
            max-width: 600px;
            max-height: 70vh;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid #e0e0e0;
        `;

        const actionIconsSvg = {
            'smart-reply': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><path fill="currentColor" d="M10 2.5a7.5 7.5 0 0 0-6.928 10.438l-.904 2.714a.417.417 0 0 0 .514.514l2.713-.905A7.5 7.5 0 1 0 10 2.5zm-3.333 7.917a.833.833 0 1 1-1.667 0 .833.833 0 0 1 1.667 0zm3.333 0a.833.833 0 1 1-1.667 0 .833.833 0 0 1 1.667 0zm3.333 0a.833.833 0 1 1-1.666 0 .833.833 0 0 1 1.666 0z"/></svg>',
            'summarize': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><path fill="currentColor" fill-rule="evenodd" d="M4.375 5.833c0-.345.28-.625.625-.625h10a.625.625 0 1 1 0 1.25H5a.625.625 0 0 1-.625-.625zm0 4.167c0-.345.28-.625.625-.625h10a.625.625 0 1 1 0 1.25H5A.625.625 0 0 1 4.375 10zm0 4.167c0-.345.28-.625.625-.625h6a.625.625 0 1 1 0 1.25H5a.625.625 0 0 1-.625-.625z" clip-rule="evenodd"/></svg>',
            'translate': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><path fill="currentColor" fill-rule="evenodd" d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM10.625 3.789a6.25 6.25 0 0 1 5.586 5.586h-2.878c-.175-1.788-.683-3.342-1.404-4.45a11.51 11.51 0 0 1-1.304-1.136zm-1.25 0v5.586H6.667c.175-1.788.683-3.342 1.404-4.45a11.51 11.51 0 0 0 1.304-1.136zm0 6.836v5.586a11.51 11.51 0 0 1-1.304-1.136c-.721-1.108-1.229-2.662-1.404-4.50h2.708zm1.25 0h2.708c-.175 1.788-.683 3.342-1.404 4.45a11.51 11.51 0 0 1-1.304 1.136v-5.586zm2.708-1.25h-2.708V3.789c.489.327.923.715 1.304 1.136.721 1.108 1.229 2.662 1.404 4.45zm-6.666 0h2.708V3.789a11.51 11.51 0 0 0-1.304 1.136c-.721 1.108-1.229 2.662-1.404 4.45zm0 1.25H3.789a6.25 6.25 0 0 0 5.586 5.586v-5.586H6.667zm6.666 0v5.586a6.25 6.25 0 0 0 5.586-5.586h-5.586z" clip-rule="evenodd"/></svg>',
            'change-tone': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><path fill="currentColor" d="M9.167 2.5a.625.625 0 0 1 .625.625v13.75a.625.625 0 1 1-1.25 0V3.125A.625.625 0 0 1 9.167 2.5zm-4.167 4.167a.625.625 0 0 1 .625.625v6.666a.625.625 0 1 1-1.25 0V7.292a.625.625 0 0 1 .625-.625zm8.333-1.667a.625.625 0 0 1 .625.625v9.167a.625.625 0 1 1-1.25 0V5.625a.625.625 0 0 1 .625-.625zM2.5 8.333a.625.625 0 0 1 .625.625v1.667a.625.625 0 1 1-1.25 0V8.958a.625.625 0 0 1 .625-.625zm15 -1.666a.625.625 0 0 1 .625.625v5a.625.625 0 1 1-1.25 0v-5a.625.625 0 0 1 .625-.625z"/></svg>',
            'explain-manager': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><path fill="currentColor" fill-rule="evenodd" d="M10 4.792a2.708 2.708 0 1 0 0 5.416 2.708 2.708 0 0 0 0-5.416zM8.542 7.5a1.458 1.458 0 1 1 2.916 0 1.458 1.458 0 0 1-2.916 0z" clip-rule="evenodd"/><path fill="currentColor" d="M3.125 17.5a6.875 6.875 0 0 1 13.75 0 .625.625 0 1 1-1.25 0 5.625 5.625 0 0 0-11.25 0 .625.625 0 1 1-1.25 0z"/></svg>',
            'custom-prompt': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><path fill="currentColor" d="M4.167 5.625a.625.625 0 0 1 .625-.625h10.416a.625.625 0 1 1 0 1.25H4.792a.625.625 0 0 1-.625-.625zm0 4.167a.625.625 0 0 1 .625-.625h10.416a.625.625 0 1 1 0 1.25H4.792a.625.625 0 0 1-.625-.625zm.625 3.541a.625.625 0 1 0 0 1.25h6.25a.625.625 0 1 0 0-1.25h-6.25z"/></svg>'
        };

        const actionTitles = {
            'smart-reply': 'Умный ответ',
            'summarize': 'Краткое изложение',
            'translate': 'Перевод',
            'change-tone': 'Изменить тон',
            'explain-manager': 'Для менеджера',
            'custom-prompt': 'Свой промпт'
        };

        const title = document.createElement('div');
        title.style.cssText = 'font-size: 18px; font-weight: 600; color: #333; display: flex; align-items: center;';
        title.innerHTML = `${actionIconsSvg[action]}<span>${actionTitles[action]}</span>`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            border: none;
            background: transparent;
            font-size: 20px;
            cursor: pointer;
            color: #999;
            padding: 4px 8px;
            border-radius: 4px;
        `;
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = '#f0f0f0';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'transparent';
        });
        closeBtn.addEventListener('click', () => {
            popup.remove();
            activePopup = null;
        });

        header.appendChild(title);
        header.appendChild(closeBtn);

        const content = document.createElement('div');
        content.style.cssText = `
            margin-bottom: 16px;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 8px;
            font-size: 14px;
            line-height: 1.6;
            color: #333;
            white-space: pre-wrap;
            word-wrap: break-word;
        `;
        content.textContent = result.text;

        const usageDiv = document.createElement('div');
        if (result.usage && result.usage.total_tokens > 0) {
            usageDiv.style.cssText = `
                font-size: 11px;
                color: #999;
                margin-top: 8px;
                text-align: right;
            `;
            usageDiv.textContent = `Tokens: ${result.usage.total_tokens}`;
            content.appendChild(usageDiv);
        }

        const buttons = document.createElement('div');
        buttons.style.cssText = `
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        `;

        const buttonStyle = `
            padding: 10px 20px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        `;

        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Копировать';
        copyBtn.style.cssText = buttonStyle + `
            background: #e0e0e0;
            color: #333;
        `;
        copyBtn.addEventListener('mouseenter', () => {
            copyBtn.style.background = '#d0d0d0';
        });
        copyBtn.addEventListener('mouseleave', () => {
            copyBtn.style.background = '#e0e0e0';
        });
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(result.text);
            copyBtn.textContent = 'Скопировано!';
            setTimeout(() => {
                copyBtn.textContent = 'Копировать';
            }, 2000);
        });

        const sendBtn = document.createElement('button');
        sendBtn.textContent = 'Отправить';
        sendBtn.style.cssText = buttonStyle + `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        `;
        sendBtn.addEventListener('mouseenter', () => {
            sendBtn.style.opacity = '0.9';
        });
        sendBtn.addEventListener('mouseleave', () => {
            sendBtn.style.opacity = '1';
        });
        sendBtn.addEventListener('click', () => {
            let inputField = document.querySelector('.ProseMirror[contenteditable="true"]');

            if (!inputField) {
                inputField = document.querySelector('[role="textbox"][contenteditable="true"]');
            }

            if (!inputField) {
                inputField = document.querySelector('.InputPanelContentEditable__field-BooXx');
            }

            if (!inputField) {
                inputField = document.querySelector('[data-testid="inputPanel__field"]');
            }

            if (!inputField) {
                inputField = document.querySelector('.im-textfield_rich[contenteditable="true"]');
            }

            if (!inputField) {
                console.log('[VK Teams AI] Looking for input field...');
                const allEditables = document.querySelectorAll('[contenteditable="true"]');
                console.log('[VK Teams AI] Found contenteditable elements:', allEditables.length);
                allEditables.forEach((el, i) => {
                    console.log(`[VK Teams AI] Element ${i}:`, el.className, el);
                });
            }

            if (inputField) {
                let targetElement = inputField.querySelector('p');
                if (!targetElement) {
                    targetElement = inputField;
                }

                targetElement.innerHTML = '';

                const textNode = document.createTextNode(result.text);
                targetElement.appendChild(textNode);

                inputField.focus();

                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(targetElement);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);

                const inputEvent = new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: result.text
                });
                inputField.dispatchEvent(inputEvent);

                showNotification('✅ Текст вставлен в поле ввода');
                console.log('[VK Teams AI] Text inserted successfully into ProseMirror');

                chrome.storage.sync.get(['aiConfig'], (result) => {
                    if (result.aiConfig && result.aiConfig.autoSend) {
                        console.log('[VK Teams AI] Auto-send enabled, clicking send button');

                        setTimeout(() => {
                            const sendButton = document.querySelector('[data-testid="sendButton"]') ||
                                              document.querySelector('.common__send-uRrhw') ||
                                              document.querySelector('button[data-title-type="scheduleMessage"]');

                            if (sendButton) {
                                sendButton.click();
                                console.log('[VK Teams AI] Send button clicked');
                            } else {
                                console.error('[VK Teams AI] Send button not found');
                            }
                        }, 100); // Small delay to ensure text is fully inserted
                    }
                });
            } else {
                console.error('[VK Teams AI] Could not find input field');
                showNotification('❌ Не удалось найти поле ввода', 'error');
            }
            popup.remove();
            activePopup = null;
        });

        buttons.appendChild(copyBtn);
        buttons.appendChild(sendBtn);

        popup.appendChild(header);
        popup.appendChild(content);
        popup.appendChild(buttons);

        document.body.appendChild(popup);
        activePopup = popup;

        setTimeout(() => {
            document.addEventListener('click', function closeAiPopup(e) {
                if (!popup.contains(e.target)) {
                    popup.remove();
                    activePopup = null;
                    document.removeEventListener('click', closeAiPopup);
                }
            });
        }, 100);
    }
    function showLoadingPopup(action) {
        if (activePopup) {
            try {
                activePopup.remove();
            } catch (e) {
                console.error('[VK Teams AI] Error removing popup:', e);
            }
        }

        const popup = document.createElement('div');
        popup.className = 'vkteams-ai-loading-popup';
        popup.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.2);
            padding: 40px;
            z-index: 10000;
            text-align: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        const spinner = document.createElement('div');
        spinner.style.cssText = `
            width: 40px;
            height: 40px;
            border: 4px solid #f0f0f0;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        `;

        const text = document.createElement('div');
        text.style.cssText = 'font-size: 14px; color: #666;';
        text.textContent = 'Генерация ответа...';

        popup.appendChild(spinner);
        popup.appendChild(text);

        document.body.appendChild(popup);
        activePopup = popup;

        return popup;
    }
    async function handleAiAction(action, messageElement, chatId) {
        console.log('[VK Teams AI] AI action:', action);

        if (!aiManager || !aiManager.isConfigured()) {
            showNotification('⚠️ AI не настроен. Откройте настройки расширения.', 'error');
            return;
        }

        let messageTextElement = messageElement.querySelector('.im-message__bubble-text');
        if (!messageTextElement) {
            messageTextElement = messageElement.querySelector('.im-message-text');
        }
        if (!messageTextElement) {
            messageTextElement = messageElement.querySelector('[class*="message"][class*="text"]');
        }
        if (!messageTextElement) {
            messageTextElement = messageElement.querySelector('[class*="bubble"]');
        }

        if (!messageTextElement) {
            console.error('[VK Teams AI] Could not find message text element. Message HTML:', messageElement.innerHTML);
            showNotification('❌ Не удалось получить текст сообщения', 'error');
            return;
        }

        const messageText = messageTextElement.textContent.trim();
        if (!messageText) {
            showNotification('❌ Сообщение пустое', 'error');
            return;
        }

        console.log('[VK Teams AI] Message text:', messageText.substring(0, 100));

        const loadingPopup = showLoadingPopup(action);

        try {
            let result;

            switch (action) {
                case 'smart-reply':
                    result = await aiManager.generateSmartReply(messageText);
                    break;
                case 'summarize':
                    result = await aiManager.summarizeMessage(messageText);
                    break;
                case 'translate':
                    result = await aiManager.translateMessage(messageText);
                    break;
                case 'change-tone':
                    const toneChoice = prompt(
                        'Выберите тональность для переписывания сообщения:\n\n' +
                        '1 - Формальный (официальный, вежливый)\n' +
                        '2 - Неформальный (расслабленный, простой)\n' +
                        '3 - Дружелюбный (тёплый, позитивный)\n\n' +
                        'Введите номер (1-3):'
                    );

                    if (!toneChoice) {
                        if (loadingPopup && loadingPopup.parentNode) {
                            loadingPopup.parentNode.removeChild(loadingPopup);
                        }
                        return;
                    }

                    const toneMap = {
                        '1': 'formal',
                        '2': 'casual',
                        '3': 'friendly'
                    };

                    const selectedTone = toneMap[toneChoice.trim()] || 'friendly';
                    result = await aiManager.changeTone(messageText, selectedTone);
                    break;
                case 'explain-manager':
                    result = await aiManager.explainForManager(messageText);
                    break;
                case 'custom-prompt':
                    const customPrompt = prompt('Введите ваш промпт для AI (текст сообщения будет добавлен автоматически):');
                    if (!customPrompt) {
                        if (loadingPopup && loadingPopup.parentNode) {
                            loadingPopup.parentNode.removeChild(loadingPopup);
                        }
                        return;
                    }
                    result = await aiManager.customPrompt(messageText, customPrompt);
                    break;
            }

            if (loadingPopup && loadingPopup.parentNode) {
                loadingPopup.remove();
            }

            createAiPopup(action, result, messageElement, chatId);

        } catch (error) {
            console.error('[VK Teams AI] Error:', error);

            if (loadingPopup && loadingPopup.parentNode) {
                loadingPopup.remove();
            }

            showNotification(`❌ Ошибка: ${error.message}`, 'error');
        }
    }

    const QUICK_MENU_SELECTORS = [
        '.im-quick-menu-block',
        '[class*="quick-menu-block"]',
        '[class*="QuickMenuBlock"]',
        '[class*="quickMenuBlock"]',
        '[class*="message-actions"]',
        '[class*="MessageActions"]',
        '[data-testid*="quick-menu"]',
        '[data-testid*="message-actions"]'
    ];

    const MESSAGE_ROOT_SELECTORS = '.imMessage, .im-message, [class*="imMessage"], [class*="ImMessage"]';

    function queryAllDeep(selector, root = document) {
        const results = [];
        const seen = new Set();

        const collect = (node) => {
            if (!node || !node.querySelectorAll) {
                return;
            }
            try {
                node.querySelectorAll(selector).forEach((el) => {
                    if (!seen.has(el)) {
                        seen.add(el);
                        results.push(el);
                    }
                });
            } catch (e) {}
            try {
                node.querySelectorAll('*').forEach((child) => {
                    if (child.shadowRoot) {
                        collect(child.shadowRoot);
                    }
                });
            } catch (e) {}
        };

        collect(root);
        return results;
    }

    function findQuickMenuBlock(messageElement) {
        for (const selector of QUICK_MENU_SELECTORS) {
            const block = messageElement.querySelector(selector);
            if (block) {
                return block;
            }
        }
        return null;
    }

    function resolveMessageElement(node) {
        if (!node || node.nodeType !== 1) {
            return null;
        }
        if (node.matches && node.matches(MESSAGE_ROOT_SELECTORS)) {
            return node;
        }
        if (node.closest) {
            const root = node.closest(MESSAGE_ROOT_SELECTORS);
            if (root) {
                return root;
            }
        }
        if (node.hasAttribute('data-arch-id') && node.hasAttribute('data-parent-chat-sn')) {
            return node;
        }
        return null;
    }

    function findMessageElements() {
        const seen = new Set();
        const messages = [];

        const add = (el) => {
            const messageElement = resolveMessageElement(el);
            if (!messageElement || seen.has(messageElement)) {
                return;
            }
            seen.add(messageElement);
            messages.push(messageElement);
        };

        document.querySelectorAll('.imMessage, .im-message').forEach(add);
        queryAllDeep('[data-arch-id][data-parent-chat-sn]').forEach(add);

        return messages;
    }
    function addReactionButton(messageElement) {
        if (messageElement.querySelector('.vkteams-custom-reaction-btn')) {
            return;
        }

        const messageId = messageElement.getAttribute('data-arch-id');
        const chatId = messageElement.getAttribute('data-parent-chat-sn');

        if (!messageId || !chatId) {
            return;
        }

        let quickMenuBlock = findQuickMenuBlock(messageElement);
        if (!quickMenuBlock) {
            quickMenuBlock = document.createElement('div');
            quickMenuBlock.className = 'vkteams-custom-quick-menu-fallback';
            quickMenuBlock.style.cssText = 'display:inline-flex;align-items:center;gap:2px;margin-left:4px;';
            const anchor = messageElement.querySelector('[class*="bubble"]') || messageElement;
            anchor.appendChild(quickMenuBlock);
        }

        const button = document.createElement('div');
        button.className = 'vkteams-custom-reaction-btn';
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm-1.25 3.125a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0zm7.5 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0zM5.625 10a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm8.75 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM10 13.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/></svg>';
        button.title = 'Add custom reaction';
        button.style.cssText = `
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border-radius: 6px;
            transition: color 0.2s ease;
            width: 24px;
            height: 24px;
            color: #818c99;
        `;

        const svg = button.querySelector('svg');
        if (svg) {
            svg.style.cssText = `
                display: block;
                width: 20px;
                height: 20px;
            `;
        }

        button.addEventListener('mouseenter', () => {
            button.style.color = '#3f8ae0';
        });

        button.addEventListener('mouseleave', () => {
            button.style.color = '#818c99';
        });

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            createEmojiPopup(messageElement, messageId, chatId, button);
        }, true);

        quickMenuBlock.appendChild(button);

        if (aiManager && aiManager.isConfigured()) {
            addAiButtons(messageElement, messageId, chatId, quickMenuBlock);
        }
    }
    function addAiButtons(messageElement, messageId, chatId, quickMenuBlock) {
        if (messageElement.querySelector('.vkteams-ai-btn')) {
            return;
        }

        const aiActionsSvg = {
            'smart-reply': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M10 2.5a7.5 7.5 0 0 0-6.928 10.438l-.904 2.714a.417.417 0 0 0 .514.514l2.713-.905A7.5 7.5 0 1 0 10 2.5zm-3.333 7.917a.833.833 0 1 1-1.667 0 .833.833 0 0 1 1.667 0zm3.333 0a.833.833 0 1 1-1.667 0 .833.833 0 0 1 1.667 0zm3.333 0a.833.833 0 1 1-1.666 0 .833.833 0 0 1 1.666 0z"/></svg>',
            'summarize': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" fill-rule="evenodd" d="M4.375 5.833c0-.345.28-.625.625-.625h10a.625.625 0 1 1 0 1.25H5a.625.625 0 0 1-.625-.625zm0 4.167c0-.345.28-.625.625-.625h10a.625.625 0 1 1 0 1.25H5A.625.625 0 0 1 4.375 10zm0 4.167c0-.345.28-.625.625-.625h6a.625.625 0 1 1 0 1.25H5a.625.625 0 0 1-.625-.625z" clip-rule="evenodd"/></svg>',
            'translate': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" fill-rule="evenodd" d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM10.625 3.789a6.25 6.25 0 0 1 5.586 5.586h-2.878c-.175-1.788-.683-3.342-1.404-4.45a11.51 11.51 0 0 1-1.304-1.136zm-1.25 0v5.586H6.667c.175-1.788.683-3.342 1.404-4.45a11.51 11.51 0 0 0 1.304-1.136zm0 6.836v5.586a11.51 11.51 0 0 1-1.304-1.136c-.721-1.108-1.229-2.662-1.404-4.45h2.708zm1.25 0h2.708c-.175 1.788-.683 3.342-1.404 4.45a11.51 11.51 0 0 1-1.304 1.136v-5.586zm2.708-1.25h-2.708V3.789c.489.327.923.715 1.304 1.136.721 1.108 1.229 2.662 1.404 4.45zm-6.666 0h2.708V3.789a11.51 11.51 0 0 0-1.304 1.136c-.721 1.108-1.229 2.662-1.404 4.45zm0 1.25H3.789a6.25 6.25 0 0 0 5.586 5.586v-5.586H6.667zm6.666 0v5.586a6.25 6.25 0 0 0 5.586-5.586h-5.586z" clip-rule="evenodd"/></svg>',
            'change-tone': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M9.167 2.5a.625.625 0 0 1 .625.625v13.75a.625.625 0 1 1-1.25 0V3.125A.625.625 0 0 1 9.167 2.5zm-4.167 4.167a.625.625 0 0 1 .625.625v6.666a.625.625 0 1 1-1.25 0V7.292a.625.625 0 0 1 .625-.625zm8.333-1.667a.625.625 0 0 1 .625.625v9.167a.625.625 0 1 1-1.25 0V5.625a.625.625 0 0 1 .625-.625zM2.5 8.333a.625.625 0 0 1 .625.625v1.667a.625.625 0 1 1-1.25 0V8.958a.625.625 0 0 1 .625-.625zm15 -1.666a.625.625 0 0 1 .625.625v5a.625.625 0 1 1-1.25 0v-5a.625.625 0 0 1 .625-.625z"/></svg>',
            'explain-manager': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" fill-rule="evenodd" d="M10 4.792a2.708 2.708 0 1 0 0 5.416 2.708 2.708 0 0 0 0-5.416zM8.542 7.5a1.458 1.458 0 1 1 2.916 0 1.458 1.458 0 0 1-2.916 0z" clip-rule="evenodd"/><path fill="currentColor" d="M3.125 17.5a6.875 6.875 0 0 1 13.75 0 .625.625 0 1 1-1.25 0 5.625 5.625 0 0 0-11.25 0 .625.625 0 1 1-1.25 0z"/></svg>',
            'custom-prompt': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M4.167 5.625a.625.625 0 0 1 .625-.625h10.416a.625.625 0 1 1 0 1.25H4.792a.625.625 0 0 1-.625-.625zm0 4.167a.625.625 0 0 1 .625-.625h10.416a.625.625 0 1 1 0 1.25H4.792a.625.625 0 0 1-.625-.625zm.625 3.541a.625.625 0 1 0 0 1.25h6.25a.625.625 0 1 0 0-1.25h-6.25z"/></svg>'
        };

        const aiActions = [
            { action: 'smart-reply', title: 'Умный ответ' },
            { action: 'summarize', title: 'Кратко' },
            { action: 'translate', title: 'Перевести' },
            { action: 'change-tone', title: 'Изменить тон' },
            { action: 'explain-manager', title: 'Для менеджера' },
            { action: 'custom-prompt', title: 'Свой промпт' }
        ];

        aiActions.forEach(({ action, title }) => {
            const aiButton = document.createElement('div');
            aiButton.className = 'vkteams-ai-btn';
            aiButton.setAttribute('data-ai-action', action);
            aiButton.innerHTML = aiActionsSvg[action];
            aiButton.title = title;
            aiButton.style.cssText = `
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                border-radius: 6px;
                transition: color 0.2s ease;
                width: 24px;
                height: 24px;
                color: #818c99;
            `;

            const svg = aiButton.querySelector('svg');
            if (svg) {
                svg.style.cssText = `
                    display: block;
                    width: 20px;
                    height: 20px;
                `;
            }

            aiButton.addEventListener('mouseenter', () => {
                aiButton.style.color = '#3f8ae0';
            });

            aiButton.addEventListener('mouseleave', () => {
                aiButton.style.color = '#818c99';
            });

            aiButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                console.log('[VK Teams AI] AI button clicked:', action);
                handleAiAction(action, messageElement, chatId);
            }, true);

            quickMenuBlock.appendChild(aiButton);
        });
    }
    let loggedMessageCountFrame = false;

    function processMessages() {
        const messages = findMessageElements();
        if (messages.length) {
            loggedMessageCountFrame = true;
        }

        messages.forEach((messageElement) => {
            addReactionButton(messageElement);
        });
    }
    function runsInCustomShell() {
        try {
            return /VKTeamsCustomShell/i.test(navigator.userAgent);
        } catch (e) {
            return false;
        }
    }

    async function isExtensionEnabled() {
        if (runsInCustomShell()) {
            return true;
        }
        return new Promise((resolve) => {
            chrome.storage.sync.get(['extensionActivated'], (result) => {
                resolve(!!result.extensionActivated);
            });
        });
    }
    async function init() {
        if (!(await isExtensionEnabled())) {
            return;
        }

        await loadConnectionConfig();
        await loadCustomReactions();
        if (window.VKTeamsAppearanceApplier) {
            window.VKTeamsAppearanceApplier.init();
        }
        installPageConsoleBridge();

        if (window.VKTeamsAI && window.VKTeamsAI.AIManager) {
            aiManager = new window.VKTeamsAI.AIManager();
            await aiManager.init();
        }

        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }

            @keyframes spin {
                0% {
                    transform: rotate(0deg);
                }
                100% {
                    transform: rotate(360deg);
                }
            }

            .vkteams-custom-reactions-popup {
                position: fixed;
                background: #232324;
                border-radius: 6px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
                padding: 4px 6px;
                z-index: 10000;
                display: flex;
                flex-wrap: nowrap;
                align-items: center;
                gap: 2px;
            }

            .vkteams-custom-reactions-popup button {
                font-size: 22px;
                line-height: 1;
                border: none;
                background: transparent;
                cursor: pointer;
                padding: 4px 5px;
                margin: 0;
                border-radius: 4px;
                transition: background 0.15s ease;
            }

            .vkteams-custom-reactions-popup button:hover {
                background: rgba(255, 255, 255, 0.12);
            }

            .vkteams-custom-reactions-popup button:active {
                background: rgba(255, 255, 255, 0.18);
            }
        `;
        document.head.appendChild(style);

        processMessages();
        [1500, 4000, 8000].forEach((delay) => {
            setTimeout(processMessages, delay);
        });

        const observer = new MutationObserver(() => {
            processMessages();
        });

        const observeTarget = document.body || document.documentElement;
        if (observeTarget) {
            observer.observe(observeTarget, {
                childList: true,
                subtree: true
            });
        }


        setInterval(processMessages, 2500);

        initCallRecording();
    }

    async function initCallRecording() {
        try {
            if (!window.VKTeamsCallRecording || !window.VKTeamsCallRecording.CallRecordingManager) {
                return;
            }

            const { CallRecordingManager } = window.VKTeamsCallRecording;
            const manager = new CallRecordingManager();
            await manager.init();

            window.VKTeamsCallRecordingManagerInstance = manager;

            console.log('[VK Teams CallRecording] Initialized successfully');
        } catch (error) {
            console.error('[VK Teams CallRecording] Initialization failed:', error);
        }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'reloadRecordingSettings') {
            console.log('[VK Teams CallRecording] Reloading settings...');

            if (window.VKTeamsCallRecordingManagerInstance) {
                window.VKTeamsCallRecordingManagerInstance.loadSettings().then(settings => {
                    window.VKTeamsCallRecordingManagerInstance.isEnabled = settings.callRecordingEnabled;
                    window.VKTeamsCallRecordingManagerInstance.autoAnswer = settings.autoAnswerCalls;

                    if (settings.callRecordingEnabled) {
                        window.VKTeamsCallRecordingManagerInstance.start();
                    } else {
                        window.VKTeamsCallRecordingManagerInstance.stop();
                    }
                });
            }
        }

        if (message.action === 'getRecordings') {
            console.log('[VK Teams CallRecording] Getting recordings...');

            if (window.VKTeamsCallRecordingManagerInstance) {
                const storageManager = window.VKTeamsCallRecordingManagerInstance.getStorageManager();

                if (storageManager) {
                    storageManager.getRecordings()
                        .then(recordings => {
                            console.log('[VK Teams CallRecording] Retrieved recordings:', recordings.length);

                            const recordingsWithData = recordings.map(rec => ({
                                ...rec,
                                blobData: null
                            }));

                            sendResponse({ success: true, recordings: recordingsWithData });
                        })
                        .catch(error => {
                            console.error('[VK Teams CallRecording] Error getting recordings:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                    return true;
                }
                sendResponse({ success: false, error: 'Storage manager not initialized' });
                return false;
            }
            sendResponse({ success: false, error: 'Recording manager not initialized' });
            return false;
        }

        if (message.action === 'getRecordingBlob' && message.recordingId) {
            console.log('[VK Teams CallRecording] Getting recording blob:', message.recordingId);

            if (window.VKTeamsCallRecordingManagerInstance) {
                const storageManager = window.VKTeamsCallRecordingManagerInstance.getStorageManager();

                if (storageManager) {
                    storageManager.getRecording(message.recordingId)
                        .then(recording => {
                            if (recording && recording.blob) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    sendResponse({
                                        success: true,
                                        blobData: reader.result,
                                        mimeType: recording.mimeType
                                    });
                                };
                                reader.onerror = () => {
                                    sendResponse({ success: false, error: 'Failed to read blob' });
                                };
                                reader.readAsDataURL(recording.blob);
                            } else {
                                sendResponse({ success: false, error: 'Recording not found' });
                            }
                        })
                        .catch(error => {
                            console.error('[VK Teams CallRecording] Error getting recording blob:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                    return true;
                }
                sendResponse({ success: false, error: 'Storage manager not initialized' });
                return false;
            }
            sendResponse({ success: false, error: 'Recording manager not initialized' });
            return false;
        }

        if (message.action === 'getRecordingStats') {
            console.log('[VK Teams CallRecording] Getting recording stats...');

            if (window.VKTeamsCallRecordingManagerInstance) {
                const storageManager = window.VKTeamsCallRecordingManagerInstance.getStorageManager();

                if (storageManager) {
                    storageManager.getStats()
                        .then(stats => {
                            console.log('[VK Teams CallRecording] Retrieved stats:', stats);
                            sendResponse({ success: true, stats: stats });
                        })
                        .catch(error => {
                            console.error('[VK Teams CallRecording] Error getting stats:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                    return true;
                }
                sendResponse({ success: false, error: 'Storage manager not initialized' });
                return false;
            }
            sendResponse({ success: false, error: 'Recording manager not initialized' });
            return false;
        }

        if (message.action === 'deleteRecording' && message.recordingId) {
            console.log('[VK Teams CallRecording] Deleting recording:', message.recordingId);

            if (window.VKTeamsCallRecordingManagerInstance) {
                const storageManager = window.VKTeamsCallRecordingManagerInstance.getStorageManager();

                if (storageManager) {
                    storageManager.deleteRecording(message.recordingId)
                        .then(() => {
                            console.log('[VK Teams CallRecording] Recording deleted');
                            sendResponse({ success: true });
                        })
                        .catch(error => {
                            console.error('[VK Teams CallRecording] Error deleting recording:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                    return true;
                }
                sendResponse({ success: false, error: 'Storage manager not initialized' });
                return false;
            }
            sendResponse({ success: false, error: 'Recording manager not initialized' });
            return false;
        }

        if (message.action === 'transcribeRecording' && message.recordingId) {
            console.log('[VK Teams CallRecording] Transcribing recording:', message.recordingId);

            if (window.VKTeamsCallRecordingManagerInstance) {
                const storageManager = window.VKTeamsCallRecordingManagerInstance.getStorageManager();

                if (storageManager) {
                    storageManager.getRecording(message.recordingId)
                        .then(async (recording) => {
                            if (!recording || !recording.blob) {
                                throw new Error('Recording not found or has no audio data');
                            }

                            await window.VKTeamsCallRecordingManagerInstance.transcribeRecording(
                                message.recordingId,
                                recording.blob
                            );

                            console.log('[VK Teams CallRecording] Transcription completed for:', message.recordingId);
                            sendResponse({ success: true });
                        })
                        .catch(error => {
                            console.error('[VK Teams CallRecording] Error transcribing recording:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                    return true;
                }
                sendResponse({ success: false, error: 'Storage manager not initialized' });
                return false;
            }
            sendResponse({ success: false, error: 'Recording manager not initialized' });
            return false;
        }

        if (message.action === 'deleteAllRecordings') {
            console.log('[VK Teams CallRecording] Deleting all recordings...');

            if (window.VKTeamsCallRecordingManagerInstance) {
                const storageManager = window.VKTeamsCallRecordingManagerInstance.getStorageManager();

                if (storageManager) {
                    storageManager.deleteAllRecordings()
                        .then(() => {
                            console.log('[VK Teams CallRecording] All recordings deleted');
                            sendResponse({ success: true });
                        })
                        .catch(error => {
                            console.error('[VK Teams CallRecording] Error deleting all recordings:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                    return true;
                }
                sendResponse({ success: false, error: 'Storage manager not initialized' });
                return false;
            }
            sendResponse({ success: false, error: 'Recording manager not initialized' });
            return false;
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 2000);
    }
})();
