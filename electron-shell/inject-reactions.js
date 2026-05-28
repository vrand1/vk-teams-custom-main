(function () {
    if (window.__vkTeamsElectronInject) {
        return;
    }
    window.__vkTeamsElectronInject = true;

    const DEFAULT_REACTIONS = ['🤨', '🙄', '🥱', '😭', '🥶', '🤮', '🥺', '💀', '🦧', '🔇'];
    const QUICK_MENU_SELECTORS = [
        '.im-quick-menu-block',
        '[class*="quick-menu-block"]',
        '[class*="QuickMenuBlock"]',
        '[class*="quickMenuBlock"]',
        '[class*="message-actions"]',
        '[data-testid*="quick-menu"]'
    ];
    const MESSAGE_ROOT = '.imMessage, .im-message, [class*="imMessage"], [class*="ImMessage"]';

    let CUSTOM_REACTIONS = DEFAULT_REACTIONS.slice();
    let activePopup = null;
    let RAPI_URL = guessRapiUrl();
    const RAPI_API_VERSION = localStorage.getItem('vkteams_rapi_ver') || '125';

    function guessRapiUrl() {
        const stored = localStorage.getItem('vkteams_rapi_url');
        if (stored) {
            return stored.replace(/\/$/, '');
        }
        const h = location.hostname.toLowerCase();
        if (h.includes('myteam.mail.ru') || h.endsWith('.mail.ru')) {
            return 'https://u.myteam.mail.ru';
        }
        if (h.includes('workspace.vk.ru')) {
            return 'https://u.workspace.vk.ru';
        }
        if (h.includes('bizml.ru')) {
            return `https://u.${h.split('.').slice(-3).join('.')}`;
        }
        return 'https://u.myteam.mail.ru';
    }

    function getAIMSID() {
        const fromSettings = localStorage.getItem('vkteams_custom_aimsid');
        if (fromSettings && fromSettings.trim()) {
            return fromSettings.trim();
        }
        const cookies = document.cookie.split(';');
        for (const c of cookies) {
            const [name, value] = c.trim().split('=');
            if (name === 'aimsid' && value) {
                return value;
            }
        }
        try {
            for (const key of Object.keys(localStorage)) {
                const value = localStorage.getItem(key);
                if (!value) {
                    continue;
                }
                const m = value.match(/\d{3}\.\d+\.\d+:[a-zA-Z0-9.@_-]+/);
                if (m) {
                    return m[0];
                }
            }
        } catch (e) {
            /* ignore */
        }
        return null;
    }

    function showNotification(message, type) {
        const n = document.createElement('div');
        n.textContent = message;
        n.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 16px;z-index:2147483647;color:#fff;border-radius:8px;font:14px sans-serif;background:' +
            (type === 'error' ? '#f44336' : '#4CAF50');
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 3000);
    }

    function findQuickMenu(el) {
        for (const sel of QUICK_MENU_SELECTORS) {
            const b = el.querySelector(sel);
            if (b) {
                return b;
            }
        }
        return null;
    }

    function findMessages() {
        const seen = new Set();
        const out = [];
        const add = (el) => {
            if (!el || seen.has(el)) {
                return;
            }
            seen.add(el);
            out.push(el);
        };
        document.querySelectorAll(MESSAGE_ROOT).forEach(add);
        document.querySelectorAll('[data-arch-id][data-parent-chat-sn]').forEach((node) => {
            const root = node.closest ? node.closest(MESSAGE_ROOT) : null;
            add(root || node);
        });
        return out;
    }

    let injectReactionAckTimer = null;

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'vkteams-reactions-extension') {
            return;
        }
        if (event.data.type === 'setReactionAck') {
            window.__vkTeamsInjectAck = true;
            if (injectReactionAckTimer) {
                clearTimeout(injectReactionAckTimer);
                injectReactionAckTimer = null;
            }
        }
    });

    function setReaction(messageId, chatId, reaction) {
        window.__vkTeamsInjectAck = false;
        window.postMessage({
            source: 'vkteams-inject',
            type: 'setReaction',
            messageId: messageId,
            chatId: chatId,
            reaction: reaction
        }, '*');

        if (injectReactionAckTimer) {
            clearTimeout(injectReactionAckTimer);
        }
        injectReactionAckTimer = setTimeout(() => {
            injectReactionAckTimer = null;
            if (!window.__vkTeamsInjectAck) {
                showNotification(
                    '❌ Расширение не ответило. Перезагрузите страницу или проверьте подключение в настройках.',
                    'error'
                );
            }
        }, 4000);
    }

    function createPopup(msgEl, messageId, chatId, anchor) {
        if (activePopup) {
            activePopup.remove();
        }
        const popup = document.createElement('div');
        popup.className = 'vkteams-custom-reactions-popup';
        popup.style.cssText = 'position:fixed;background:#232324;border-radius:6px;padding:4px 6px;z-index:2147483647;display:flex;gap:2px;box-shadow:0 4px 16px rgba(0,0,0,.45)';
        const rect = anchor.getBoundingClientRect();
        popup.style.top = Math.max(8, rect.top - 48) + 'px';
        popup.style.left = Math.min(window.innerWidth - 280, rect.left) + 'px';
        CUSTOM_REACTIONS.forEach((emoji) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = emoji;
            btn.style.cssText = 'font-size:22px;border:none;background:transparent;cursor:pointer;padding:4px';
            btn.onclick = (e) => {
                e.stopPropagation();
                setReaction(messageId, chatId, emoji);
                popup.remove();
                activePopup = null;
            };
            popup.appendChild(btn);
        });
        document.body.appendChild(popup);
        activePopup = popup;
        setTimeout(() => {
            document.addEventListener('click', function close() {
                if (activePopup) {
                    activePopup.remove();
                    activePopup = null;
                }
                document.removeEventListener('click', close);
            }, { once: true });
        }, 0);
    }

    function addButton(msgEl) {
        if (msgEl.querySelector('.vkteams-custom-reaction-btn')) {
            return;
        }
        const messageId = msgEl.getAttribute('data-arch-id');
        const chatId = msgEl.getAttribute('data-parent-chat-sn');
        if (!messageId || !chatId) {
            return;
        }
        let menu = findQuickMenu(msgEl);
        if (!menu) {
            menu = document.createElement('div');
            menu.className = 'vkteams-custom-quick-menu-fallback';
            menu.style.cssText = 'display:inline-flex;align-items:center;margin-left:4px;';
            (msgEl.querySelector('[class*="bubble"]') || msgEl).appendChild(menu);
        }
        const btn = document.createElement('div');
        btn.className = 'vkteams-custom-reaction-btn';
        btn.title = 'Custom reaction';
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm-1.25 3.125a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0zm7.5 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0zM5.625 10a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm8.75 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM10 13.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/></svg>';
        btn.style.cssText = 'cursor:pointer;display:flex;width:24px;height:24px;color:#818c99;align-items:center;justify-content:center';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            createPopup(msgEl, messageId, chatId, btn);
        }, true);
        menu.appendChild(btn);
    }

    function tick() {
        const messages = findMessages();
        if (messages.length) {
            messages.forEach(addButton);
        }
    }

    tick();
    setInterval(tick, 2000);
})();
