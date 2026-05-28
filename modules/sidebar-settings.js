(function () {
    'use strict';

    const BTN_ID = 'vkteams-native-sidebar-btn';
    const PANEL_ID = 'vkteams-inline-settings-panel';
    const BACKDROP_ID = 'vkteams-inline-settings-backdrop';
    const MARKER = 'data-vkteams-reactions-settings';
    const LINK_MARKER = 'data-vkteams-sidebar-link';
    const DELEGATE_MARK = 'data-vkteams-click-delegate';
    const LINK_BTN_PREFIX = 'vkteams-sidebar-link-';

    let cachedSidebarLinks = [];

    function getExtensionIconUrl() {
        try {
            if (chrome.runtime && chrome.runtime.getURL) {
                return chrome.runtime.getURL('icon48.png');
            }
        } catch (e) {
            /* ignore */
        }
        return '';
    }

    function clearMaskAndBackground(el) {
        if (!el || el.nodeType !== 1) {
            return;
        }
        try {
            el.style.setProperty('mask', 'none', 'important');
            el.style.setProperty('-webkit-mask', 'none', 'important');
            el.style.setProperty('background-image', 'none', 'important');
            el.style.setProperty('background', 'transparent', 'important');
        } catch (e) {
            /* ignore */
        }
    }
    function applySidebarIcon(item, doc) {
        const iconUrl = getExtensionIconUrl();
        if (!iconUrl) {
            return;
        }

        clearMaskAndBackground(item);
        item.innerHTML = '';
        clearMaskAndBackground(item);

        const img = doc.createElement('img');
        img.src = iconUrl;
        img.alt = '';
        img.draggable = false;
        img.setAttribute('data-vkteams-reactions-icon', '1');
        img.width = 24;
        img.height = 24;
        img.style.cssText = [
            'width:24px',
            'height:24px',
            'display:block',
            'object-fit:contain',
            'border-radius:6px',
            'pointer-events:none'
        ].join(';');
        item.appendChild(img);
    }

    function hasOurSidebarIcon(item) {
        const img = item && item.querySelector('img[data-vkteams-reactions-icon]');
        if (!img) {
            return false;
        }
        const url = getExtensionIconUrl();
        return !url || img.src === url || img.src.endsWith('/icon48.png');
    }

    function findIconSlot(item) {
        if (!item) {
            return null;
        }
        return (
            item.querySelector('[class*="icon" i]') ||
            item.querySelector(':scope > span') ||
            item.querySelector(':scope > div') ||
            item
        );
    }

    function applyEmojiIcon(item, doc, emoji) {
        const slot = findIconSlot(item);
        if (!slot) {
            return;
        }
        clearMaskAndBackground(item);
        slot.querySelectorAll('svg, img, picture, canvas').forEach((el) => el.remove());
        clearMaskAndBackground(slot);

        let span = slot.querySelector('[data-vkteams-link-emoji]');
        if (!span) {
            span = doc.createElement('span');
            span.setAttribute('data-vkteams-link-emoji', '1');
            span.style.cssText = 'font-size:20px;line-height:1;display:block;pointer-events:none';
            slot.appendChild(span);
        }
        span.textContent = emoji || '🔗';
    }

    function hasLinkEmoji(item, emoji) {
        const span = item && item.querySelector('[data-vkteams-link-emoji]');
        return span && span.textContent === (emoji || '🔗');
    }

    function readSidebarLinksFromStorage(callback) {
        if (window.VKTeamsSidebarLinksStorage) {
            window.VKTeamsSidebarLinksStorage.read()
                .then((links) => callback(links))
                .catch(() => callback([]));
            return;
        }
        chrome.storage.local.get(['customSidebarLinks'], (result) => {
            const links = Array.isArray(result.customSidebarLinks) ? result.customSidebarLinks : [];
            callback(links);
        });
    }

    function openSidebarLink(url, openInNewTab) {
        if (!url) {
            return;
        }
        try {
            if (openInNewTab) {
                window.open(url, '_blank', 'noopener,noreferrer');
            } else {
                (window.top || window).location.href = url;
            }
        } catch (e) {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }

    function getLinkButtonId(linkId) {
        return LINK_BTN_PREFIX + linkId;
    }

    function listNativeSidebarItems(rail) {
        return Array.from(rail.querySelectorAll('button, a, [role="button"]')).filter(
            (el) => !isOurSidebarControl(el)
        );
    }
    function findVkNativeSettingsButton(rail) {
        const items = listNativeSidebarItems(rail);
        const labeled = items.find(isSettingsLike);
        if (labeled) {
            return labeled;
        }
        return items.length ? items[items.length - 1] : null;
    }

    function insertBeforeSibling(container, node, before) {
        if (!container || !node) {
            return false;
        }
        if (before && before.parentElement === container) {
            container.insertBefore(node, before);
            return true;
        }
        container.appendChild(node);
        return true;
    }
    function findSidebarFooterMount(doc, rail) {
        const vkSettings = findVkNativeSettingsButton(rail);
        const extensionBtn = doc.getElementById(BTN_ID);
        const ref = extensionBtn || vkSettings;
        if (!ref || !ref.parentElement) {
            if (vkSettings && vkSettings.parentElement) {
                return {
                    container: vkSettings.parentElement,
                    vkSettings: vkSettings,
                    extensionBtn: extensionBtn
                };
            }
            return null;
        }
        return {
            container: ref.parentElement,
            vkSettings: vkSettings,
            extensionBtn: extensionBtn
        };
    }

    function styleSidebarControl(item) {
        item.style.pointerEvents = 'auto';
        item.style.cursor = 'pointer';
    }

    function updateLinkButton(btn, link, doc) {
        btn.setAttribute(LINK_MARKER, '1');
        btn.setAttribute('data-link-id', link.id);
        btn.setAttribute('data-url', link.url);
        btn.setAttribute('data-open-tab', link.openInNewTab === false ? '0' : '1');
        applyLinkLabels(btn, link, doc);
        if (!hasLinkEmoji(btn, link.emoji)) {
            applyEmojiIcon(btn, doc, link.emoji);
        }
        applyLinkLabels(btn, link, doc);
        styleSidebarControl(btn);
    }

    function createLinkButton(link, template, doc) {
        const item = template.cloneNode(true);
        item.id = getLinkButtonId(link.id);
        item.removeAttribute('href');
        item.classList.add('vkteams-sidebar-link-item');
        stripActiveStyles(item);
        updateLinkButton(item, link, doc);
        return item;
    }

    function removeOrphanLinkButtons(doc, links) {
        const validIds = new Set(links.map((l) => getLinkButtonId(l.id)));
        doc.querySelectorAll('[' + LINK_MARKER + ']').forEach((el) => {
            if (!validIds.has(el.id)) {
                el.remove();
            }
        });
    }

    function injectCustomLinkButtons(doc, rail, linkTemplate, links) {
        if (!rail || !linkTemplate || !links.length) {
            doc.querySelectorAll('[' + LINK_MARKER + ']').forEach((el) => el.remove());
            return;
        }

        const mount = findSidebarFooterMount(doc, rail);
        const vkSettings = findVkNativeSettingsButton(rail);
        const anchor = (mount && (mount.extensionBtn || mount.vkSettings)) || vkSettings;

        if (!anchor || !anchor.parentElement) {
            return;
        }

        const container = anchor.parentElement;
        removeOrphanLinkButtons(doc, links);

        for (let i = links.length - 1; i >= 0; i--) {
            const link = links[i];
            if (!link || !link.id || !link.url) {
                continue;
            }
            const btnId = getLinkButtonId(link.id);
            let btn = doc.getElementById(btnId);
            if (!btn) {
                btn = createLinkButton(link, linkTemplate, doc);
                insertBeforeSibling(container, btn, anchor);
            } else {
                updateLinkButton(btn, link, doc);
                if (btn.parentElement !== container || btn.nextElementSibling !== anchor) {
                    insertBeforeSibling(container, btn, anchor);
                }
            }
        }
    }

    function isMessengerHost() {
        try {
            const h = location.hostname.toLowerCase();
            return (
                h.endsWith('.mail.ru') ||
                h.includes('workspace.vk.ru') ||
                h.endsWith('.bizml.ru') ||
                h.includes('teams.')
            );
        } catch (e) {
            return false;
        }
    }

    function getAccessibleDocuments() {
        const docs = [document];
        try {
            if (window.top && window.top.document && window.top.document !== document) {
                docs.push(window.top.document);
            }
        } catch (e) {
            
        }
        try {
            if (window.parent && window.parent.document && window.parent.document !== document) {
                docs.push(window.parent.document);
            }
        } catch (e) {
            /* ignore */
        }
        return docs;
    }

    function forEachRoot(callback) {
        const seen = new Set();
        const walk = (root) => {
            if (!root || seen.has(root)) {
                return;
            }
            seen.add(root);
            callback(root);
            try {
                root.querySelectorAll('*').forEach((el) => {
                    if (el.shadowRoot) {
                        walk(el.shadowRoot);
                    }
                });
            } catch (e) {
                /* ignore */
            }
        };
        getAccessibleDocuments().forEach((doc) => walk(doc));
    }

    function cleanupLegacy(doc) {
        ['vkteams-settings-backdrop', 'vkteams-sidebar-settings-btn', 'vkteams-settings-float'].forEach((id) => {
            const el = doc.getElementById(id);
            if (el) {
                el.remove();
            }
        });
    }

    function closePanel(doc) {
        doc.getElementById(PANEL_ID)?.remove();
        doc.getElementById(BACKDROP_ID)?.remove();
    }

    function openSettingsWindowFallback() {
        const url = chrome.runtime.getURL('popup.html');
        try {
            const w = window.open(url, 'vkteams_settings', 'width=420,height=720,menubar=no,toolbar=no');
            if (w) {
                return;
            }
        } catch (e) {
            /* ignore */
        }
        chrome.runtime.sendMessage({ action: 'openSettingsWindow' });
    }
    function openInlinePanel(targetDoc) {
        const doc = targetDoc || document;

        if (doc.getElementById(PANEL_ID)) {
            closePanel(doc);
            return;
        }

        getAccessibleDocuments().forEach((d) => closePanel(d));

        if (!chrome.runtime || !chrome.runtime.getURL) {
            openSettingsWindowFallback();
            return;
        }

        const backdrop = doc.createElement('div');
        backdrop.id = BACKDROP_ID;
        backdrop.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483646',
            'background:rgba(0,0,0,0.2)',
            'pointer-events:auto'
        ].join(';');
        backdrop.addEventListener('click', () => closePanel(doc));

        const panel = doc.createElement('div');
        panel.id = PANEL_ID;
        panel.setAttribute('data-vkteams-ui', '1');
        panel.style.cssText = [
            'position:fixed',
            'left:56px',
            'top:0',
            'bottom:0',
            'width:400px',
            'max-width:calc(100vw - 64px)',
            'z-index:2147483647',
            'background:#232324',
            'box-shadow:4px 0 32px rgba(0,0,0,0.35)',
            'display:flex',
            'flex-direction:column',
            'overflow:hidden',
            'pointer-events:auto'
        ].join(';');

        const closeBar = doc.createElement('div');
        closeBar.style.cssText = [
            'display:flex',
            'justify-content:flex-end',
            'padding:6px 8px 0',
            'background:#232324',
            'flex-shrink:0'
        ].join(';');
        const closeBtn = doc.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.title = 'Закрыть';
        closeBtn.style.cssText = 'border:none;background:transparent;color:#a1a1a6;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px';
        closeBtn.addEventListener('click', () => closePanel(doc));
        closeBar.appendChild(closeBtn);

        const iframe = doc.createElement('iframe');
        iframe.title = 'VK Teams Extension Settings';
        iframe.style.cssText = 'flex:1;width:100%;border:none;background:#232324;min-height:0';
        iframe.src = chrome.runtime.getURL('popup.html?embed=1');

        let loaded = false;
        iframe.addEventListener('load', () => {
            loaded = true;
        });

        setTimeout(() => {
            if (!loaded && doc.getElementById(PANEL_ID)) {
                closePanel(doc);
                openSettingsWindowFallback();
            }
        }, 2500);

        panel.appendChild(closeBar);
        panel.appendChild(iframe);

        const mount = doc.body || doc.documentElement;
        mount.appendChild(backdrop);
        mount.appendChild(panel);

        doc.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape') {
                closePanel(doc);
                doc.removeEventListener('keydown', onEsc);
            }
        });

    }

    function handleSettingsActivate(e, doc) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openInlinePanel(doc);
        return false;
    }

    function installClickDelegation(doc) {
        const root = doc.documentElement;
        if (!root || root.getAttribute(DELEGATE_MARK)) {
            return;
        }
        root.setAttribute(DELEGATE_MARK, '1');

        const onActivate = (e) => {
            const linkHit = e.target && e.target.closest && e.target.closest('[' + LINK_MARKER + ']');
            if (linkHit) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                const url = linkHit.getAttribute('data-url');
                const openTab = linkHit.getAttribute('data-open-tab') !== '0';
                openSidebarLink(url, openTab);
                return;
            }
            const settingsHit = e.target && e.target.closest && e.target.closest('[' + MARKER + ']');
            if (settingsHit) {
                handleSettingsActivate(e, doc);
            }
        };

        doc.addEventListener('click', onActivate, true);
        doc.addEventListener('pointerdown', (e) => {
            const hit =
                (e.target && e.target.closest && e.target.closest('[' + LINK_MARKER + ']')) ||
                (e.target && e.target.closest && e.target.closest('[' + MARKER + ']'));
            if (hit) {
                e.stopPropagation();
            }
        }, true);
    }

    function isSettingsLike(el) {
        const t = (el.getAttribute('title') || el.getAttribute('aria-label') || '').toLowerCase();
        return t.includes('настрой') || t.includes('setting');
    }

    function isOurSidebarControl(el) {
        if (!el) {
            return false;
        }
        if (el.id === BTN_ID || (el.id && el.id.startsWith(LINK_BTN_PREFIX))) {
            return true;
        }
        return el.hasAttribute(MARKER) || el.hasAttribute(LINK_MARKER);
    }

    function findLinkButtonTemplate(rail, doc) {
        const native = findVkNativeSettingsButton(rail);
        if (native) {
            return native;
        }
        const extensionBtn = doc.getElementById(BTN_ID);
        if (extensionBtn) {
            return extensionBtn;
        }
        return findSettingsTemplate(rail);
    }

    const TOOLTIP_LAYER_ID = 'vkteams-sidebar-tooltip-layer';

    function hideLinkTooltip(doc) {
        const layer = doc.getElementById(TOOLTIP_LAYER_ID);
        if (layer) {
            layer.style.display = 'none';
        }
    }

    function showLinkTooltip(btn, title, doc) {
        const text = (title || '').trim();
        if (!text) {
            return;
        }
        let layer = doc.getElementById(TOOLTIP_LAYER_ID);
        if (!layer) {
            layer = doc.createElement('div');
            layer.id = TOOLTIP_LAYER_ID;
            layer.setAttribute('data-vkteams-ui', '1');
            layer.style.cssText = [
                'position:fixed',
                'z-index:2147483647',
                'display:none',
                'max-width:240px',
                'padding:6px 10px',
                'border-radius:8px',
                'background:#2c2c2e',
                'color:#ececed',
                'font:600 13px/1.3 system-ui,sans-serif',
                'box-shadow:0 4px 16px rgba(0,0,0,.35)',
                'pointer-events:none',
                'white-space:nowrap'
            ].join(';');
            (doc.body || doc.documentElement).appendChild(layer);
        }
        layer.textContent = text;
        const rect = btn.getBoundingClientRect();
        layer.style.display = 'block';
        layer.style.visibility = 'hidden';
        const tipRect = layer.getBoundingClientRect();
        layer.style.visibility = 'visible';
        const left = rect.right + 10;
        const top = rect.top + rect.height / 2 - tipRect.height / 2;
        layer.style.left = Math.max(8, left) + 'px';
        layer.style.top = Math.max(8, top) + 'px';
    }

    function stripVkTooltipMetadata(root, customTitle) {
        const labelAttrs = [
            'title',
            'aria-label',
            'aria-labelledby',
            'data-tooltip',
            'data-tip',
            'data-hint',
            'data-title',
            'data-content',
            'data-original-title'
        ];
        root.querySelectorAll('*').forEach((node) => {
            labelAttrs.forEach((attr) => node.removeAttribute(attr));
        });
        labelAttrs.forEach((attr) => {
            if (attr === 'aria-labelledby') {
                root.removeAttribute(attr);
            }
        });
        root.querySelectorAll('[role="tooltip"],[class*="tooltip" i],[class*="hint" i]').forEach((el) => {
            el.remove();
        });
        root.setAttribute('aria-label', customTitle);
        root.removeAttribute('title');
    }

    function bindLinkTooltip(btn, title, doc) {
        if (btn.getAttribute('data-vkteams-tip-bound') === title) {
            return;
        }
        btn.setAttribute('data-vkteams-tip-bound', title);

        const onEnter = (e) => {
            e.stopPropagation();
            showLinkTooltip(btn, title, doc);
        };
        const onLeave = (e) => {
            e.stopPropagation();
            hideLinkTooltip(doc);
        };

        btn.addEventListener('mouseenter', onEnter, true);
        btn.addEventListener('mouseleave', onLeave, true);
        btn.addEventListener('focus', onEnter, true);
        btn.addEventListener('blur', onLeave, true);
    }

    function applyLinkLabels(btn, link, doc) {
        const title = (link.title || '').trim() || link.url;
        stripVkTooltipMetadata(btn, title);
        bindLinkTooltip(btn, title, doc);
    }

    function findLeftRail(root) {
        let best = null;
        let bestScore = 0;
        const nodes = root.querySelectorAll('aside, nav, div');
        nodes.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width < 40 || rect.width > 100 || rect.height < 200 || rect.left > 30) {
                return;
            }
            const items = el.querySelectorAll('button, a, [role="button"]');
            if (items.length < 4) {
                return;
            }
            const score = items.length * 100 + rect.height - rect.left;
            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        });
        return best;
    }

    function findSettingsTemplate(rail) {
        const native = findVkNativeSettingsButton(rail);
        if (native) {
            return native;
        }
        const items = listNativeSidebarItems(rail);
        return items[0] || null;
    }

    function stripActiveStyles(el) {
        el.classList.forEach((cls) => {
            if (/active|selected|current|highlight|pressed/i.test(cls)) {
                el.classList.remove(cls);
            }
        });
    }

    function injectSettingsButton(doc, rail, template) {
        const existing = doc.getElementById(BTN_ID);
        if (existing) {
            if (!hasOurSidebarIcon(existing)) {
                applySidebarIcon(existing, doc);
            }
            return true;
        }

        if (!rail || !template) {
            return false;
        }

        const item = template.cloneNode(true);
        item.id = BTN_ID;
        item.setAttribute(MARKER, '1');
        item.removeAttribute('href');
        item.title = 'Кастомные реакции';
        item.setAttribute('aria-label', 'Кастомные реакции');
        item.classList.add('vkteams-reactions-sidebar-item');
        stripActiveStyles(item);
        applySidebarIcon(item, doc);
        styleSidebarControl(item);

        const vkSettings = findVkNativeSettingsButton(rail);
        const mount = findSidebarFooterMount(doc, rail);

        if (mount && mount.container) {
            insertBeforeSibling(mount.container, item, mount.vkSettings || mount.extensionBtn);
            return true;
        }

        if (vkSettings && vkSettings.parentElement) {
            vkSettings.parentElement.insertBefore(item, vkSettings);
            return true;
        }

        const items = listNativeSidebarItems(rail);
        const last = items[items.length - 1];
        if (last && last.parentElement) {
            last.parentElement.insertBefore(item, last);
            return true;
        }

        if (rail) {
            rail.appendChild(item);
            return true;
        }

        return false;
    }

    function injectSidebar(doc, links) {
        let rail = null;
        let settingsTemplate = null;
        forEachRoot((root) => {
            if (rail) {
                return;
            }
            const r = findLeftRail(root);
            if (r) {
                rail = r;
                settingsTemplate = findSettingsTemplate(r);
            }
        });

        if (!rail || !settingsTemplate) {
            return false;
        }

        injectSettingsButton(doc, rail, settingsTemplate);
        const linkTemplate = findLinkButtonTemplate(rail, doc) || settingsTemplate;
        injectCustomLinkButtons(doc, rail, linkTemplate, links || cachedSidebarLinks);
        return true;
    }

    function refreshSidebar(doc) {
        readSidebarLinksFromStorage((links) => {
            cachedSidebarLinks = links;
            injectSidebar(doc, links);
        });
    }

    function scheduleSidebarRetries(doc, attempt) {
        if (doc.getElementById(BTN_ID)) {
            return;
        }
        if (attempt >= 30) {
            return;
        }
        refreshSidebar(doc);
        setTimeout(() => scheduleSidebarRetries(doc, attempt + 1), 500);
    }

    function bootDocument(doc) {
        cleanupLegacy(doc);
        installClickDelegation(doc);
        refreshSidebar(doc);
        scheduleSidebarRetries(doc, 0);

        let reinjectTimer = null;
        const observer = new MutationObserver(() => {
            if (reinjectTimer) {
                return;
            }
            reinjectTimer = setTimeout(() => {
                reinjectTimer = null;
                const settingsBtn = doc.getElementById(BTN_ID);
                const needSettings = !settingsBtn || !hasOurSidebarIcon(settingsBtn);
                const needLinks = cachedSidebarLinks.some((link) => !doc.getElementById(getLinkButtonId(link.id)));
                if (needSettings || needLinks) {
                    refreshSidebar(doc);
                }
            }, 300);
        });
        if (doc.body) {
            observer.observe(doc.body, { childList: true, subtree: true });
        }
    }

    function start() {
        if (!isMessengerHost()) {
            return;
        }

        getAccessibleDocuments().forEach((doc) => bootDocument(doc));

        if (window.VKTeamsSidebarLinksStorage) {
            window.VKTeamsSidebarLinksStorage.onChanged((links) => {
                cachedSidebarLinks = links;
                getAccessibleDocuments().forEach((doc) => injectSidebar(doc, links));
            });
        } else {
            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName !== 'local' || !changes.customSidebarLinks) {
                    return;
                }
                const links = Array.isArray(changes.customSidebarLinks.newValue)
                    ? changes.customSidebarLinks.newValue
                    : [];
                cachedSidebarLinks = links;
                getAccessibleDocuments().forEach((doc) => injectSidebar(doc, links));
            });
        }

        if (!document.documentElement.getAttribute('data-vkteams-hotkey')) {
            document.documentElement.setAttribute('data-vkteams-hotkey', '1');
            document.addEventListener('keydown', (e) => {
                if (e.altKey && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
                    e.preventDefault();
                    openInlinePanel(document);
                }
            }, true);
        }

    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
