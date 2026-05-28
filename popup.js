(function() {
    'use strict';

    const BUILTIN_REACTIONS = ['🤨', '🙄', '🥱', '😭', '🥶', '🤮', '🥺', '💀', '🦧', '🔇'];
    const MAX_REACTIONS_PER_SET = 30;
    const MAX_REACTION_SETS = 20;

    let reactionSetsCache = [];
    let activeReactionSetIdCache = null;
    let editingSetId = null;

    function tabEffectiveUrl(tab) {
        if (!tab) {
            return '';
        }
        const u = tab.url || tab.pendingUrl;
        return (typeof u === 'string' && u) ? u : '';
    }
    function isMessengerTabUrl(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }
        if (!/^https?:\/\//i.test(url)) {
            return false;
        }
        try {
            const h = new URL(url).hostname.toLowerCase();
            if (h === 'app.workspace.vk.ru' || h === 'workspace.vk.ru') {
                return true;
            }
            if (h.endsWith('.workspace.vk.ru')) {
                return true;
            }
            if (h === 'teams.your-organization.com' || h === 'webim.teams.your-organization.com') {
                return true;
            }
            if (h.endsWith('.teams.your-organization.com')) {
                return true;
            }
            if (h === 'myteam.mail.ru' || h.endsWith('.myteam.mail.ru')) {
                return true;
            }
            if (h.endsWith('.bizml.ru')) {
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    async function getAllTeamsTabs() {
        try {
            const byId = new Map();

            const ingest = (tabs) => {
                for (const tab of tabs) {
                    if (tab && tab.id != null && isMessengerTabUrl(tabEffectiveUrl(tab))) {
                        byId.set(tab.id, tab);
                    }
                }
            };

            try {
                const allTabs = await chrome.tabs.query({});
                ingest(allTabs);
            } catch (e) {
                console.warn('[VK Teams] tabs.query({}) failed:', e);
            }

            const patterns = [
                'https://teams.your-organization.com/*',
                'https://*.teams.your-organization.com/*',
                'https://webim.teams.your-organization.com/*',
                'https://app.workspace.vk.ru/*',
                'https://workspace.vk.ru/*',
                'https://*.workspace.vk.ru/*',
                'https://myteam.mail.ru/*',
                'https://*.myteam.mail.ru/*',
                'https://*.bizml.ru/*',
                '*://teams.your-organization.com/*',
                '*://*.teams.your-organization.com/*',
                '*://webim.teams.your-organization.com/*',
                '*://app.workspace.vk.ru/*',
                '*://workspace.vk.ru/*',
                '*://*.workspace.vk.ru/*',
                '*://myteam.mail.ru/*',
                '*://*.myteam.mail.ru/*',
                '*://*.bizml.ru/*'
            ];
            for (const pattern of patterns) {
                try {
                    const tabs = await chrome.tabs.query({ url: pattern });
                    ingest(tabs);
                } catch (e) {
                    /* ignore invalid pattern in exotic browsers */
                }
            }

            return Array.from(byId.values());
        } catch (error) {
            console.error('[VK Teams] Error getting tabs:', error);
            return [];
        }
    }

    async function getActiveTeamsTab() {
        try {
            const tabs = await getAllTeamsTabs();
            if (tabs.length === 0) {
                return null;
            }

            const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            const focusedUrl = tabEffectiveUrl(focused[0]);
            if (focused[0] && isMessengerTabUrl(focusedUrl)) {
                const match = tabs.find((t) => t.id === focused[0].id);
                if (match) {
                    return match;
                }
            }

            const activeMessenger = tabs.find((t) => t.active === true);
            if (activeMessenger) {
                return activeMessenger;
            }

            const withLast = tabs.filter((t) => typeof t.lastAccessed === 'number');
            if (withLast.length > 0) {
                withLast.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
                return withLast[0];
            }

            return tabs[0];
        } catch (error) {
            console.error('[VK Teams] Error getting active tab:', error);
            return null;
        }
    }
    const BUILTIN_DEFAULT_CONNECTION = {
        customAimsid: '',
        rapiBaseUrl: 'https://u.myteam.vmailru.net',
        rapiApiVersion: '145'
    };

    let cachedFileDefaults = null;

    async function loadDefaultsFromFile() {
        if (cachedFileDefaults) {
            return cachedFileDefaults;
        }
        try {
            const url = chrome.runtime.getURL('connection.defaults.json');
            const res = await fetch(url);
            if (res.ok) {
                cachedFileDefaults = await res.json();
                return cachedFileDefaults;
            }
        } catch (e) {
            console.warn('[VK Teams] connection.defaults.json:', e);
        }
        return null;
    }

    async function resolveConnectionDefaults() {
        const fromFile = await loadDefaultsFromFile();
        return Object.assign({}, BUILTIN_DEFAULT_CONNECTION, fromFile || {});
    }

    function reactionsToInputString(reactions) {
        if (!Array.isArray(reactions) || !reactions.length) {
            return '';
        }
        return reactions.join(', ');
    }

    function parseReactionsFromInput(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            return null;
        }
        const list = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
        return list.length ? list : null;
    }

    function showReactionsStatus(message, type) {
        const statusDiv = document.getElementById('reactionsStatusMessage');
        if (!statusDiv) {
            return;
        }
        statusDiv.textContent = message;
        statusDiv.className = 'status-message ' + type;
        if (type === 'success') {
            setTimeout(() => {
                statusDiv.className = 'status-message';
            }, 3000);
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function createReactionSetId() {
        return 'set_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function getActiveReactionSet() {
        if (!reactionSetsCache.length) {
            return null;
        }
        return reactionSetsCache.find((s) => s.id === activeReactionSetIdCache) || reactionSetsCache[0];
    }

    function updatePreviewFromReactions(reactions, setName) {
        const previewElement = document.getElementById('currentPreview');
        if (previewElement && Array.isArray(reactions)) {
            previewElement.innerHTML = reactions.map((emoji) => `<span>${emoji}</span>`).join('');
        }
        const nameEl = document.getElementById('activeSetName');
        if (nameEl) {
            nameEl.textContent = setName || '—';
        }
    }

    function persistReactionSets(sets, activeId, activeReactions, done) {
        const payload = {
            reactionSets: sets,
            activeReactionSetId: activeId,
            customReactions: activeReactions
        };
        if (window.VKTeamsReactionStorage) {
            window.VKTeamsReactionStorage.write(payload, done);
            return;
        }
        chrome.storage.local.set(payload, () => {
            if (chrome.runtime.lastError) {
                console.error('[VK Teams Reactions Settings] save failed:', chrome.runtime.lastError.message);
            }
            if (typeof done === 'function') {
                done();
            }
        });
    }

    function migrateReactionStorage(result) {
        if (Array.isArray(result.reactionSets) && result.reactionSets.length > 0) {
            return {
                sets: result.reactionSets.filter((s) => s && s.id && Array.isArray(s.reactions)),
                activeId: result.activeReactionSetId || result.reactionSets[0].id
            };
        }
        let reactions = BUILTIN_REACTIONS.slice();
        if (result.customReactions && Array.isArray(result.customReactions) && result.customReactions.length) {
            reactions = result.customReactions;
        }
        const id = 'set_default';
        return {
            sets: [{ id: id, name: 'Основной', reactions: reactions }],
            activeId: id,
            migrated: true
        };
    }

    function renderReactionSetsList() {
        const list = document.getElementById('reactionSetsList');
        if (!list) {
            return;
        }
        list.innerHTML = '';

        reactionSetsCache.forEach((set) => {
            const card = document.createElement('div');
            const isActive = set.id === activeReactionSetIdCache;
            card.className = 'preset-card reaction-set-card' + (isActive ? ' active' : '');
            card.dataset.setId = set.id;

            const emojisHtml = (set.reactions || [])
                .map((emoji) => `<span>${escapeHtml(emoji)}</span>`)
                .join('');

            card.innerHTML = `
                <div class="preset-name">
                    <span>${escapeHtml(set.name || 'Без названия')}</span>
                    <span class="check-icon" style="${isActive ? '' : 'display: none;'}">✓</span>
                </div>
                <div class="preset-emojis">${emojisHtml}</div>
                <div class="reaction-set-actions">
                    <button type="button" class="set-action-btn" data-action="edit" data-id="${escapeHtml(set.id)}">Изменить</button>
                    <button type="button" class="set-action-btn set-action-delete" data-action="delete" data-id="${escapeHtml(set.id)}">Удалить</button>
                </div>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('.reaction-set-actions')) {
                    return;
                }
                activateReactionSet(set.id);
            });

            card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
                e.stopPropagation();
                openReactionSetEditor(set.id);
            });

            card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteReactionSet(set.id);
            });

            list.appendChild(card);
        });
    }

    function applyLoadedReactionSets(result) {
        const migrated = migrateReactionStorage(result);
        reactionSetsCache = migrated.sets;
        activeReactionSetIdCache = migrated.activeId;

        if (!reactionSetsCache.some((s) => s.id === activeReactionSetIdCache)) {
            activeReactionSetIdCache = reactionSetsCache[0].id;
        }

        const finishUi = () => {
            const active = getActiveReactionSet();
            if (active) {
                updatePreviewFromReactions(active.reactions, active.name);
            }
            renderReactionSetsList();
        };

        if (migrated.migrated) {
            const active = getActiveReactionSet();
            persistReactionSets(reactionSetsCache, activeReactionSetIdCache, active.reactions, finishUi);
        } else {
            finishUi();
        }
    }

    function loadReactionSets() {
        if (window.VKTeamsReactionStorage) {
            window.VKTeamsReactionStorage.read().then(applyLoadedReactionSets).catch(() => {
                applyLoadedReactionSets({});
            });
            return;
        }
        chrome.storage.local.get(['reactionSets', 'activeReactionSetId', 'customReactions'], (local) => {
            if (Array.isArray(local.reactionSets) && local.reactionSets.length) {
                applyLoadedReactionSets(local);
                return;
            }
            chrome.storage.sync.get(['reactionSets', 'activeReactionSetId', 'customReactions'], applyLoadedReactionSets);
        });
    }

    function openReactionSetEditor(setId) {
        editingSetId = setId;
        const editor = document.getElementById('reactionSetEditor');
        const nameInput = document.getElementById('reactionSetNameInput');
        const reactionsInput = document.getElementById('reactionSetReactionsInput');
        const deleteBtn = document.getElementById('deleteReactionSetButton');

        if (!editor || !nameInput || !reactionsInput) {
            return;
        }

        if (setId === 'new') {
            nameInput.value = '';
            reactionsInput.value = reactionsToInputString(BUILTIN_REACTIONS);
            if (deleteBtn) {
                deleteBtn.style.display = 'none';
            }
        } else {
            const set = reactionSetsCache.find((s) => s.id === setId);
            if (!set) {
                return;
            }
            nameInput.value = set.name || '';
            reactionsInput.value = reactionsToInputString(set.reactions);
            if (deleteBtn) {
                deleteBtn.style.display = reactionSetsCache.length > 1 ? 'inline-block' : 'none';
            }
        }

        editor.style.display = 'block';
        nameInput.focus();
    }

    function closeReactionSetEditor() {
        editingSetId = null;
        const editor = document.getElementById('reactionSetEditor');
        if (editor) {
            editor.style.display = 'none';
        }
    }

    function activateReactionSet(setId) {
        const set = reactionSetsCache.find((s) => s.id === setId);
        if (!set) {
            return;
        }
        activeReactionSetIdCache = setId;
        persistReactionSets(reactionSetsCache, setId, set.reactions, () => {
            updatePreviewFromReactions(set.reactions, set.name);
            renderReactionSetsList();
            showReactionsStatus('✅ Набор «' + set.name + '» активен', 'success');
            notifyTabsReactions(set.reactions);
        });
    }

    function saveReactionSetFromEditor() {
        const nameInput = document.getElementById('reactionSetNameInput');
        const reactionsInput = document.getElementById('reactionSetReactionsInput');
        const name = (nameInput ? nameInput.value : '').trim() || 'Без названия';
        const reactions = parseReactionsFromInput(reactionsInput ? reactionsInput.value : '');

        if (!reactions || !reactions.length) {
            showReactionsStatus('Добавьте хотя бы один эмодзи', 'error');
            return;
        }
        const limited = reactions.slice(0, MAX_REACTIONS_PER_SET);

        if (editingSetId === 'new') {
            if (reactionSetsCache.length >= MAX_REACTION_SETS) {
                showReactionsStatus('Максимум ' + MAX_REACTION_SETS + ' наборов', 'error');
                return;
            }
            const newSet = { id: createReactionSetId(), name: name, reactions: limited };
            reactionSetsCache.push(newSet);
            activeReactionSetIdCache = newSet.id;
        } else {
            const idx = reactionSetsCache.findIndex((s) => s.id === editingSetId);
            if (idx === -1) {
                return;
            }
            reactionSetsCache[idx] = {
                ...reactionSetsCache[idx],
                name: name,
                reactions: limited
            };
        }

        const active = getActiveReactionSet();
        persistReactionSets(reactionSetsCache, activeReactionSetIdCache, active.reactions, () => {
            closeReactionSetEditor();
            updatePreviewFromReactions(active.reactions, active.name);
            renderReactionSetsList();
            showReactionsStatus('✅ Набор сохранён', 'success');
            notifyTabsReactions(active.reactions);
        });
    }

    function deleteReactionSet(setId) {
        if (reactionSetsCache.length <= 1) {
            showReactionsStatus('Нельзя удалить единственный набор', 'error');
            return;
        }
        const set = reactionSetsCache.find((s) => s.id === setId);
        if (!set) {
            return;
        }
        if (!confirm('Удалить набор «' + set.name + '»?')) {
            return;
        }

        reactionSetsCache = reactionSetsCache.filter((s) => s.id !== setId);
        if (activeReactionSetIdCache === setId) {
            activeReactionSetIdCache = reactionSetsCache[0].id;
        }
        if (editingSetId === setId) {
            closeReactionSetEditor();
        }

        const active = getActiveReactionSet();
        persistReactionSets(reactionSetsCache, activeReactionSetIdCache, active.reactions, () => {
            updatePreviewFromReactions(active.reactions, active.name);
            renderReactionSetsList();
            showReactionsStatus('Набор удалён', 'success');
            notifyTabsReactions(active.reactions);
        });
    }

    function notifyTabsReactions(reactions) {
        getAllTeamsTabs().then((tabs) => {
            tabs.forEach((tab) => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'reloadReactions',
                    reactions: reactions
                }).catch(() => {
                    console.log('[VK Teams Reactions Settings] Tab not ready:', tab.id);
                });
            });
        });
    }
    let appearanceSelectedAccent = 'lilac';

    function showAppearanceStatus(message, type) {
        const el = document.getElementById('appearanceStatusMessage');
        if (!el) {
            return;
        }
        el.textContent = message;
        el.className = 'status-message ' + (type || '');
        if (type === 'success') {
            setTimeout(() => {
                el.className = 'status-message';
                el.textContent = '';
            }, 3000);
        }
    }

    function updateAppearanceScaleLabel() {
        const slider = document.getElementById('appearanceUiScale');
        const label = document.getElementById('appearanceScaleLabel');
        if (slider && label) {
            label.textContent = slider.value + '%';
        }
    }

    function setAppearanceAccentUi(accent) {
        appearanceSelectedAccent = accent;
        document.querySelectorAll('.accent-swatch').forEach((btn) => {
            btn.classList.toggle('selected', btn.getAttribute('data-accent') === accent);
        });
    }

    function readAppearanceForm() {
        const themeInput = document.querySelector('input[name="appearanceTheme"]:checked');
        const scaleEl = document.getElementById('appearanceUiScale');
        const enabledEl = document.getElementById('appearanceEnabled');
        return {
            appearanceEnabled: enabledEl ? enabledEl.checked : true,
            appearanceTheme: themeInput ? themeInput.value : 'system',
            appearanceAccent: appearanceSelectedAccent,
            appearanceUiScale: scaleEl ? Number(scaleEl.value) : 100
        };
    }

    function fillAppearanceForm(settings) {
        const enabledEl = document.getElementById('appearanceEnabled');
        if (enabledEl) {
            enabledEl.checked = settings.appearanceEnabled !== false;
        }
        document.querySelectorAll('input[name="appearanceTheme"]').forEach((input) => {
            input.checked = input.value === settings.appearanceTheme;
        });
        setAppearanceAccentUi(settings.appearanceAccent || 'lilac');
        const scaleEl = document.getElementById('appearanceUiScale');
        if (scaleEl) {
            scaleEl.value = String(settings.appearanceUiScale || 100);
        }
        updateAppearanceScaleLabel();
    }

    async function loadAppearanceSettings() {
        try {
            let settings;
            if (window.VKTeamsAppearanceStorage) {
                settings = await window.VKTeamsAppearanceStorage.read();
            } else {
                const result = await new Promise((resolve) => {
                    chrome.storage.local.get(
                        ['appearanceEnabled', 'appearanceTheme', 'appearanceAccent', 'appearanceUiScale'],
                        resolve
                    );
                });
                settings = Object.assign(
                    {
                        appearanceEnabled: true,
                        appearanceTheme: 'system',
                        appearanceAccent: 'lilac',
                        appearanceUiScale: 100
                    },
                    result
                );
            }
            fillAppearanceForm(settings);
        } catch (err) {
            showAppearanceStatus('Не удалось загрузить оформление', 'error');
        }
    }

    function notifyTabsAppearance(settings) {
        getAllTeamsTabs().then((tabs) => {
            tabs.forEach((tab) => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'reloadAppearance',
                    settings: settings
                }).catch(() => {});
            });
        });
    }

    async function saveAppearanceSettings() {
        const settings = readAppearanceForm();
        try {
            let saved = settings;
            if (window.VKTeamsAppearanceStorage) {
                saved = await window.VKTeamsAppearanceStorage.write(settings);
            } else {
                await new Promise((resolve, reject) => {
                    chrome.storage.local.set(settings, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        resolve();
                    });
                });
            }
            notifyTabsAppearance(saved);
            showAppearanceStatus('Оформление сохранено', 'success');
        } catch (err) {
            showAppearanceStatus('Ошибка: ' + err.message, 'error');
        }
    }

    let sidebarLinksCache = [];
    let editingSidebarLinkId = null;

    function createSidebarLinkId() {
        return 'link_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function normalizeSidebarUrl(raw) {
        let value = (raw || '').trim();
        if (!value) {
            return null;
        }
        if (!/^https?:\/\//i.test(value)) {
            value = 'https://' + value;
        }
        try {
            const parsed = new URL(value);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return null;
            }
            return parsed.href;
        } catch (e) {
            return null;
        }
    }

    function firstEmojiChar(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            return '🔗';
        }
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const seg = new Intl.Segmenter('ru', { granularity: 'grapheme' });
            const first = [...seg.segment(trimmed)][0];
            return first ? first.segment : '🔗';
        }
        return trimmed.slice(0, 2) || '🔗';
    }

    function showSidebarLinksStatus(message, type) {
        const el = document.getElementById('sidebarLinksStatusMessage');
        if (!el) {
            return;
        }
        el.textContent = message;
        el.className = 'status-message ' + (type || '');
        if (type === 'success') {
            setTimeout(() => {
                el.className = 'status-message';
                el.textContent = '';
            }, 3000);
        }
    }

    async function persistSidebarLinks(links, done) {
        try {
            if (window.VKTeamsSidebarLinksStorage) {
                sidebarLinksCache = await window.VKTeamsSidebarLinksStorage.write(links);
            } else {
                sidebarLinksCache = links;
                await new Promise((resolve, reject) => {
                    chrome.storage.local.set({ customSidebarLinks: links }, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        resolve();
                    });
                });
            }
            if (typeof done === 'function') {
                done();
            }
        } catch (err) {
            showSidebarLinksStatus('Ошибка сохранения: ' + err.message, 'error');
        }
    }

    function renderSidebarLinksList() {
        const list = document.getElementById('sidebarLinksList');
        if (!list) {
            return;
        }
        list.innerHTML = '';

        if (!sidebarLinksCache.length) {
            list.innerHTML = '<div class="hint" style="text-align:center;padding:8px 0">Пока нет кнопок</div>';
            return;
        }

        sidebarLinksCache.forEach((link) => {
            const card = document.createElement('div');
            card.className = 'preset-card sidebar-link-card';
            card.innerHTML = `
                <div class="sidebar-link-head">
                    <span class="sidebar-link-emoji">${escapeHtml(link.emoji)}</span>
                    <span class="preset-name" style="margin:0">${escapeHtml(link.title)}</span>
                </div>
                <div class="sidebar-link-meta">${escapeHtml(link.url)}</div>
                <div class="reaction-set-actions">
                    <button type="button" class="set-action-btn" data-action="edit">Изменить</button>
                    <button type="button" class="set-action-btn set-action-delete" data-action="delete">Удалить</button>
                </div>
            `;
            card.querySelector('[data-action="edit"]').addEventListener('click', () => {
                openSidebarLinkEditor(link.id);
            });
            card.querySelector('[data-action="delete"]').addEventListener('click', () => {
                deleteSidebarLink(link.id);
            });
            list.appendChild(card);
        });
    }

    async function loadSidebarLinks() {
        try {
            if (window.VKTeamsSidebarLinksStorage) {
                sidebarLinksCache = await window.VKTeamsSidebarLinksStorage.read();
            } else {
                const result = await new Promise((resolve) => {
                    chrome.storage.local.get(['customSidebarLinks'], resolve);
                });
                sidebarLinksCache = Array.isArray(result.customSidebarLinks) ? result.customSidebarLinks : [];
            }
        } catch (e) {
            sidebarLinksCache = [];
        }
        renderSidebarLinksList();
    }

    function openSidebarLinkEditor(linkId) {
        editingSidebarLinkId = linkId;
        const editor = document.getElementById('sidebarLinkEditor');
        const titleInput = document.getElementById('sidebarLinkTitleInput');
        const urlInput = document.getElementById('sidebarLinkUrlInput');
        const emojiInput = document.getElementById('sidebarLinkEmojiInput');
        const newTabInput = document.getElementById('sidebarLinkNewTabInput');
        const deleteBtn = document.getElementById('deleteSidebarLinkButton');

        if (!editor || !titleInput || !urlInput) {
            return;
        }

        if (linkId === 'new') {
            titleInput.value = '';
            urlInput.value = '';
            if (emojiInput) {
                emojiInput.value = '🔗';
            }
            if (newTabInput) {
                newTabInput.checked = true;
            }
            if (deleteBtn) {
                deleteBtn.style.display = 'none';
            }
        } else {
            const link = sidebarLinksCache.find((l) => l.id === linkId);
            if (!link) {
                return;
            }
            titleInput.value = link.title;
            urlInput.value = link.url;
            if (emojiInput) {
                emojiInput.value = link.emoji;
            }
            if (newTabInput) {
                newTabInput.checked = link.openInNewTab !== false;
            }
            if (deleteBtn) {
                deleteBtn.style.display = 'inline-block';
            }
        }

        editor.style.display = 'block';
        titleInput.focus();
    }

    function closeSidebarLinkEditor() {
        editingSidebarLinkId = null;
        const editor = document.getElementById('sidebarLinkEditor');
        if (editor) {
            editor.style.display = 'none';
        }
    }

    function saveSidebarLinkFromEditor() {
        const titleInput = document.getElementById('sidebarLinkTitleInput');
        const urlInput = document.getElementById('sidebarLinkUrlInput');
        const emojiInput = document.getElementById('sidebarLinkEmojiInput');
        const newTabInput = document.getElementById('sidebarLinkNewTabInput');

        const title = (titleInput ? titleInput.value : '').trim();
        const url = normalizeSidebarUrl(urlInput ? urlInput.value : '');
        const emoji = firstEmojiChar(emojiInput ? emojiInput.value : '🔗');
        const openInNewTab = newTabInput ? newTabInput.checked : true;

        if (!title) {
            showSidebarLinksStatus('Укажите название', 'error');
            return;
        }
        if (!url) {
            showSidebarLinksStatus('Некорректный URL (нужен http или https)', 'error');
            return;
        }

        const maxLinks = (window.VKTeamsSidebarLinksStorage && window.VKTeamsSidebarLinksStorage.MAX_LINKS) || 15;

        if (editingSidebarLinkId === 'new') {
            if (sidebarLinksCache.length >= maxLinks) {
                showSidebarLinksStatus('Максимум ' + maxLinks + ' кнопок', 'error');
                return;
            }
            sidebarLinksCache.push({
                id: createSidebarLinkId(),
                title: title,
                url: url,
                emoji: emoji,
                openInNewTab: openInNewTab
            });
        } else {
            const idx = sidebarLinksCache.findIndex((l) => l.id === editingSidebarLinkId);
            if (idx === -1) {
                return;
            }
            sidebarLinksCache[idx] = Object.assign({}, sidebarLinksCache[idx], {
                title: title,
                url: url,
                emoji: emoji,
                openInNewTab: openInNewTab
            });
        }

        persistSidebarLinks(sidebarLinksCache, () => {
            closeSidebarLinkEditor();
            renderSidebarLinksList();
            showSidebarLinksStatus('✅ Кнопка сохранена', 'success');
        });
    }

    function deleteSidebarLink(linkId) {
        const link = sidebarLinksCache.find((l) => l.id === linkId);
        if (!link) {
            return;
        }
        if (!confirm('Удалить кнопку «' + link.title + '»?')) {
            return;
        }
        sidebarLinksCache = sidebarLinksCache.filter((l) => l.id !== linkId);
        if (editingSidebarLinkId === linkId) {
            closeSidebarLinkEditor();
        }
        persistSidebarLinks(sidebarLinksCache, () => {
            renderSidebarLinksList();
            showSidebarLinksStatus('Кнопка удалена', 'success');
        });
    }
    function loadAiConfig() {
        chrome.storage.sync.get(['aiConfig'], (result) => {
            if (result.aiConfig) {
                const config = result.aiConfig;
                document.getElementById('aiProvider').value = config.provider || '';
                document.getElementById('aiApiKey').value = config.apiKey || '';
                document.getElementById('aiModel').value = config.model || '';
                document.getElementById('aiTemperature').value = config.temperature || 0.7;
                document.getElementById('aiMaxTokens').value = config.maxTokens || 500;
                document.getElementById('aiAutoSend').checked = config.autoSend || false;

                if (config.provider === 'custom') {
                    if (config.endpoint) {
                        document.getElementById('aiEndpoint').value = config.endpoint;
                    }
                    if (config.format) {
                        document.getElementById('aiFormat').value = config.format;
                    }
                    document.getElementById('customEndpointGroup').style.display = 'block';
                    document.getElementById('customFormatGroup').style.display = 'block';
                }

                updateTemperatureLabel();
                console.log('[VK Teams AI Settings] Config loaded');
            }
        });
    }

    function updateTemperatureLabel() {
        const temperature = document.getElementById('aiTemperature').value;
        const label = document.querySelector('label[for="aiTemperature"]');
        if (label) {
            label.textContent = `Temperature (${temperature})`;
        }
    }

    function saveAiConfig() {
        const provider = document.getElementById('aiProvider').value;
        const apiKey = document.getElementById('aiApiKey').value;
        const model = document.getElementById('aiModel').value;
        const temperature = parseFloat(document.getElementById('aiTemperature').value);
        const maxTokens = parseInt(document.getElementById('aiMaxTokens').value);
        const endpoint = document.getElementById('aiEndpoint').value;
        const format = document.getElementById('aiFormat').value;
        const autoSend = document.getElementById('aiAutoSend').checked;

        if (!provider) {
            showAiStatus('Выберите провайдер', 'error');
            return;
        }

        if (!apiKey && provider !== 'ollama') {
            showAiStatus('Введите API ключ', 'error');
            return;
        }

        if (!model) {
            showAiStatus('Введите название модели', 'error');
            return;
        }

        const config = {
            provider: provider,
            apiKey: apiKey,
            model: model,
            temperature: temperature,
            maxTokens: maxTokens,
            autoSend: autoSend
        };

        if (provider === 'custom') {
            if (endpoint) {
                config.endpoint = endpoint;
            }
            if (format) {
                config.format = format;
            }
        }

        chrome.storage.sync.set({ aiConfig: config }, () => {
            console.log('[VK Teams AI Settings] Config saved:', config);
            showAiStatus('✅ Настройки сохранены!', 'success');

            getAllTeamsTabs().then(tabs => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'reloadAi'
                    }).catch(err => {
                        console.log('[VK Teams AI Settings] Tab not ready:', tab.id);
                    });
                });
            });
        });
    }

    function showAiStatus(message, type) {
        const statusDiv = document.getElementById('aiStatusMessage');
        statusDiv.textContent = message;
        statusDiv.className = 'status-message ' + type;

        if (type === 'success') {
            setTimeout(() => {
                statusDiv.className = 'status-message';
            }, 3000);
        }
    }

    function showConnectionStatus(message, type) {
        const statusDiv = document.getElementById('connectionStatusMessage');
        if (!statusDiv) {
            return;
        }
        statusDiv.textContent = message;
        statusDiv.className = 'status-message ' + type;
        if (type === 'success') {
            setTimeout(() => {
                statusDiv.className = 'status-message';
            }, 4000);
        }
    }

    function autoDetectAimsidIfEmpty() {
        const aimsidEl = document.getElementById('customAimsid');
        if (!aimsidEl || aimsidEl.value.trim()) {
            return;
        }
        getAllTeamsTabs().then((tabs) => {
            if (!tabs.length) {
                return;
            }
            tabs.forEach((tab) => {
                chrome.tabs.sendMessage(tab.id, { action: 'getDetectedAimsid' }, (resp) => {
                    if (chrome.runtime.lastError || !resp || !resp.aimsid) {
                        return;
                    }
                    if (aimsidEl && !aimsidEl.value.trim()) {
                        aimsidEl.value = resp.aimsid;
                    }
                });
            });
        });
    }

    async function readStoredConnectionSettings() {
        if (window.VKTeamsConnectionStorage) {
            return window.VKTeamsConnectionStorage.read();
        }
        return new Promise((resolve) => {
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

    async function loadConnectionSettings() {
        const defaults = await resolveConnectionDefaults();
        const r = await readStoredConnectionSettings();
        const aimsidEl = document.getElementById('customAimsid');
        const urlEl = document.getElementById('rapiBaseUrl');
        const verEl = document.getElementById('rapiApiVersion');

        const storedAimsid = (r.customAimsid && r.customAimsid.trim()) ? r.customAimsid.trim() : '';
        const storedUrl = (r.rapiBaseUrl && r.rapiBaseUrl.trim()) ? r.rapiBaseUrl.trim() : '';
        const storedVer = (r.rapiApiVersion != null && String(r.rapiApiVersion).trim())
            ? String(r.rapiApiVersion).trim()
            : '';

        if (aimsidEl) {
            aimsidEl.value = storedAimsid || (defaults.customAimsid || '').trim();
        }
        if (urlEl) {
            urlEl.value = storedUrl || (defaults.rapiBaseUrl || '').trim();
        }
        if (verEl) {
            verEl.value = storedVer || String(defaults.rapiApiVersion || '').trim();
        }

        if (!storedAimsid) {
            autoDetectAimsidIfEmpty();
        }
    }

    function detectAimsidFromTab() {
        const aimsidEl = document.getElementById('customAimsid');
        getAllTeamsTabs().then((tabs) => {
            if (!tabs.length) {
                showConnectionStatus('Откройте VK WorkSpace / Teams в браузере', 'error');
                return;
            }
            let found = false;
            tabs.forEach((tab) => {
                chrome.tabs.sendMessage(tab.id, { action: 'getDetectedAimsid' }, (resp) => {
                    if (chrome.runtime.lastError) {
                        return;
                    }
                    if (resp && resp.aimsid) {
                        found = true;
                        if (aimsidEl) {
                            aimsidEl.value = resp.aimsid;
                        }
                        showConnectionStatus('✅ AIMSID взят со страницы — нажмите «Сохранить»', 'success');
                    }
                });
            });
            setTimeout(() => {
                if (!found && (!aimsidEl || !aimsidEl.value.trim())) {
                    showConnectionStatus('AIMSID на странице не найден. Войдите в мессенджер и повторите.', 'error');
                }
            }, 900);
        });
    }

    function saveConnectionSettings() {
        const rawAimsid = (document.getElementById('customAimsid').value || '').trim();
        const rawUrl = (document.getElementById('rapiBaseUrl').value || '').trim();
        const rawVer = (document.getElementById('rapiApiVersion').value || '').trim();

        if (!rawAimsid) {
            showConnectionStatus('Укажите AIMSID', 'error');
            return;
        }

        const aimsidPattern = /^\d{3}\.\d+\.\d+:.+$/;
        if (!aimsidPattern.test(rawAimsid)) {
            showConnectionStatus('Неверный формат AIMSID (ожидается 014.…:логин)', 'error');
            return;
        }

        let normalizedUrl = '';
        if (rawUrl) {
            const withProto = rawUrl.includes('://') ? rawUrl : 'https://' + rawUrl;
            try {
                const parsed = new URL(withProto);
                if (parsed.protocol !== 'https:') {
                    showConnectionStatus('Нужен URL с https://', 'error');
                    return;
                }
                normalizedUrl = `${parsed.protocol}//${parsed.host}`;
            } catch (e) {
                showConnectionStatus('Некорректный URL API', 'error');
                return;
            }
        }

        if (!normalizedUrl) {
            showConnectionStatus('Укажите базовый URL API', 'error');
            return;
        }

        if (!rawVer) {
            showConnectionStatus('Укажите версию API', 'error');
            return;
        }

        const payload = {
            customAimsid: rawAimsid,
            rapiBaseUrl: normalizedUrl,
            rapiApiVersion: rawVer
        };

        const afterSave = () => {
            showConnectionStatus('✅ Подключение сохранено', 'success');
            getAllTeamsTabs().then((tabs) => {
                tabs.forEach((tab) => {
                    chrome.tabs.sendMessage(tab.id, { action: 'reloadConnection' }).catch(() => {});
                    chrome.tabs.sendMessage(tab.id, { action: 'reloadRapiConfig' }).catch(() => {});
                });
            });
        };

        const onError = (err) => {
            showConnectionStatus('Ошибка сохранения: ' + (err && err.message ? err.message : String(err)), 'error');
        };

        if (window.VKTeamsConnectionStorage) {
            window.VKTeamsConnectionStorage.write(payload).then(afterSave).catch(onError);
            return;
        }

        chrome.storage.local.set(payload, () => {
            if (chrome.runtime.lastError) {
                onError(new Error(chrome.runtime.lastError.message));
                return;
            }
            afterSave();
        });
    }
    function switchTab(tabName) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }
    function toggleSection(sectionId) {
        const header = document.querySelector(`[data-section="${sectionId}"]`);
        const content = document.getElementById(sectionId);

        if (!header || !content) return;

        const isCollapsed = content.classList.contains('collapsed');

        if (isCollapsed) {
            content.classList.remove('collapsed');
            header.setAttribute('aria-expanded', 'true');
        } else {
            content.classList.add('collapsed');
            header.setAttribute('aria-expanded', 'false');
        }
    }

    function initializeAccordion() {
        document.querySelectorAll('.section-header').forEach(header => {
            const sectionId = header.getAttribute('data-section');
            const content = document.getElementById(sectionId);

            const isCollapsed = content && content.classList.contains('collapsed');
            header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');

            header.addEventListener('click', () => {
                toggleSection(sectionId);
            });
        });
    }
    function checkActivation() {
        chrome.storage.sync.get(['extensionActivated'], (result) => {
            const isActivated = result.extensionActivated || false;
            const donationOverlay = document.getElementById('donationOverlay');
            const mainTabs = document.getElementById('mainTabs');
            const connectionTab = document.getElementById('connection-tab');
            const recordingsTab = document.getElementById('recordings-tab');
            const settingsTab = document.getElementById('settings-tab');

            if (!isActivated) {
                if (donationOverlay) {
                    donationOverlay.style.display = 'block';
                }
                if (mainTabs) {
                    mainTabs.style.display = 'none';
                }
                [connectionTab, recordingsTab, settingsTab].forEach((el) => {
                    if (el) {
                        el.style.display = 'none';
                    }
                });
            } else {
                if (donationOverlay) {
                    donationOverlay.style.display = 'none';
                }
                if (mainTabs) {
                    mainTabs.style.display = 'flex';
                }
                [connectionTab, recordingsTab, settingsTab].forEach((el) => {
                    if (el) {
                        el.style.display = '';
                    }
                });
            }
        });
    }

    function activateExtension() {
        chrome.storage.sync.set({ extensionActivated: true }, () => {
            checkActivation();

            getAllTeamsTabs().then(tabs => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'extensionActivated'
                    }).catch(err => {
                        console.log('[VK Teams Extension] Tab not ready:', tab.id);
                    });
                });
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (/[?&]embed=1(?:&|$)/.test(location.search)) {
            document.body.classList.add('vkteams-embed-panel');
        }

        checkActivation();

        const activateButton = document.getElementById('activateButton');
        if (activateButton) {
            activateButton.addEventListener('click', activateExtension);
        }

        loadReactionSets();
        loadSidebarLinks();
        loadAppearanceSettings();

        const saveAppearanceBtn = document.getElementById('saveAppearanceButton');
        if (saveAppearanceBtn) {
            saveAppearanceBtn.addEventListener('click', saveAppearanceSettings);
        }
        const appearanceScale = document.getElementById('appearanceUiScale');
        if (appearanceScale) {
            appearanceScale.addEventListener('input', updateAppearanceScaleLabel);
        }
        document.querySelectorAll('.accent-swatch').forEach((btn) => {
            btn.addEventListener('click', () => {
                setAppearanceAccentUi(btn.getAttribute('data-accent'));
            });
        });

        const addSidebarLinkBtn = document.getElementById('addSidebarLinkButton');
        if (addSidebarLinkBtn) {
            addSidebarLinkBtn.addEventListener('click', () => openSidebarLinkEditor('new'));
        }
        const saveSidebarLinkBtn = document.getElementById('saveSidebarLinkButton');
        if (saveSidebarLinkBtn) {
            saveSidebarLinkBtn.addEventListener('click', saveSidebarLinkFromEditor);
        }
        const cancelSidebarLinkBtn = document.getElementById('cancelSidebarLinkButton');
        if (cancelSidebarLinkBtn) {
            cancelSidebarLinkBtn.addEventListener('click', closeSidebarLinkEditor);
        }
        const deleteSidebarLinkBtn = document.getElementById('deleteSidebarLinkButton');
        if (deleteSidebarLinkBtn) {
            deleteSidebarLinkBtn.addEventListener('click', () => {
                if (editingSidebarLinkId && editingSidebarLinkId !== 'new') {
                    deleteSidebarLink(editingSidebarLinkId);
                }
            });
        }

        const addSetBtn = document.getElementById('addReactionSetButton');
        if (addSetBtn) {
            addSetBtn.addEventListener('click', () => openReactionSetEditor('new'));
        }
        const saveSetBtn = document.getElementById('saveReactionSetButton');
        if (saveSetBtn) {
            saveSetBtn.addEventListener('click', saveReactionSetFromEditor);
        }
        const cancelSetBtn = document.getElementById('cancelReactionSetButton');
        if (cancelSetBtn) {
            cancelSetBtn.addEventListener('click', closeReactionSetEditor);
        }
        const deleteSetBtn = document.getElementById('deleteReactionSetButton');
        if (deleteSetBtn) {
            deleteSetBtn.addEventListener('click', () => {
                if (editingSetId && editingSetId !== 'new') {
                    deleteReactionSet(editingSetId);
                }
            });
        }

        initializeAccordion();

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.getAttribute('data-tab');
                switchTab(tabName);

                if (tabName === 'connection') {
                    loadConnectionSettings();
                } else if (tabName === 'recordings') {
                    loadRecordings();
                    loadRecordingSettings();
                    loadAiConfig();
                } else if (tabName === 'settings') {
                    loadReactionSets();
                }
            });
        });

        loadConnectionSettings();

        document.getElementById('aiProvider').addEventListener('change', (e) => {
            const customGroup = document.getElementById('customEndpointGroup');
            const formatGroup = document.getElementById('customFormatGroup');
            if (e.target.value === 'custom') {
                customGroup.style.display = 'block';
                formatGroup.style.display = 'block';
            } else {
                customGroup.style.display = 'none';
                formatGroup.style.display = 'none';
            }

            const modelInput = document.getElementById('aiModel');
            const endpointInput = document.getElementById('aiEndpoint');
            const formatInput = document.getElementById('aiFormat');
            const temperatureInput = document.getElementById('aiTemperature');
            const maxTokensInput = document.getElementById('aiMaxTokens');
            const apiKeyInput = document.getElementById('aiApiKey');

            const defaults = {
                'openai': {
                    model: 'gpt-4o-mini',
                    temperature: 0.7,
                    maxTokens: 500
                },
                'claude': {
                    model: 'claude-3-5-haiku-20241022',
                    temperature: 0.7,
                    maxTokens: 500
                },
                'gemini': {
                    model: 'gemini-pro',
                    temperature: 0.7,
                    maxTokens: 500
                },
                'ollama': {
                    model: 'llama2',
                    temperature: 0.7,
                    maxTokens: 500
                },
                'custom': {
                    model: '',
                    endpoint: '',
                    apiKey: '',
                    format: 'openai',
                    temperature: 0.5,
                    maxTokens: 4000
                }
            };

            const config = defaults[e.target.value];
            if (config) {
                modelInput.value = config.model;

                if (config.temperature !== undefined) {
                    temperatureInput.value = config.temperature;
                    updateTemperatureLabel();
                }

                if (config.maxTokens !== undefined) {
                    maxTokensInput.value = config.maxTokens;
                }

                if (e.target.value === 'custom') {
                    if (config.endpoint) {
                        endpointInput.value = config.endpoint;
                    }
                    if (config.format) {
                        formatInput.value = config.format;
                    }
                    if (config.apiKey) {
                        apiKeyInput.value = config.apiKey;
                    }
                }
            }
        });

        document.getElementById('aiTemperature').addEventListener('input', updateTemperatureLabel);

        document.getElementById('saveAiButton').addEventListener('click', saveAiConfig);

        const saveConnectionBtn = document.getElementById('saveConnectionButton');
        if (saveConnectionBtn) {
            saveConnectionBtn.addEventListener('click', saveConnectionSettings);
        }
        const detectAimsidBtn = document.getElementById('detectAimsidButton');
        if (detectAimsidBtn) {
            detectAimsidBtn.addEventListener('click', detectAimsidFromTab);
        }
        function loadRecordingSettings() {
            chrome.storage.sync.get(['callRecordingEnabled', 'autoAnswerCalls', 'autoTranscribe', 'useLLMForSpeakers'], (result) => {
                document.getElementById('enableCallRecording').checked = result.callRecordingEnabled || false;
                document.getElementById('autoAnswerCalls').checked = result.autoAnswerCalls || false;
                document.getElementById('autoTranscribe').checked = result.autoTranscribe !== false; // default true
                document.getElementById('useLLMForSpeakers').checked = result.useLLMForSpeakers !== false; // default true
            });
        }

        function saveRecordingSettings() {
            const enabled = document.getElementById('enableCallRecording').checked;
            const autoAnswer = document.getElementById('autoAnswerCalls').checked;
            const autoTranscribe = document.getElementById('autoTranscribe').checked;
            const useLLMForSpeakers = document.getElementById('useLLMForSpeakers').checked;

            chrome.storage.sync.set({
                callRecordingEnabled: enabled,
                autoAnswerCalls: autoAnswer,
                autoTranscribe: autoTranscribe,
                useLLMForSpeakers: useLLMForSpeakers
            }, () => {
                console.log('[VK Teams Recordings] Settings saved');

                getAllTeamsTabs().then(tabs => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'reloadRecordingSettings'
                        }).catch(err => {
                            console.log('[VK Teams Recordings] Tab not ready:', tab.id);
                        });
                    });
                });
            });
        }

        async function sendToContentScript(message) {
            const tab = await getActiveTeamsTab();
            if (!tab) {
                throw new Error('VK Teams tab not found. Please open VK Teams.');
            }

            return new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tab.id, message, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response && response.success) {
                        resolve(response);
                    } else {
                        reject(new Error(response?.error || 'Unknown error'));
                    }
                });
            });
        }

        function formatDuration(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }

        function formatSize(bytes) {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        }

        function formatDate(dateString) {
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays === 1) return 'Yesterday';
            if (diffDays < 7) return `${diffDays}d ago`;

            return date.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        function formatAbsoluteDateTime(dateString) {
            const date = new Date(dateString);
            return date.toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        }

        async function loadRecordingBlob(recordingId) {
            try {
                const response = await sendToContentScript({
                    action: 'getRecordingBlob',
                    recordingId: recordingId
                });

                if (response.success && response.blobData) {
                    return response.blobData; // This is base64 data URL
                }
            } catch (error) {
                console.error('[VK Teams Recordings] Failed to load blob:', error);
            }
            return null;
        }

        function createRecordingCard(recording) {
            const card = document.createElement('div');
            card.className = 'recording-card';
            card.dataset.recordingId = recording.id;

            let transcriptionHtml = '';
            if (recording.transcription) {
                const transcriptionContent = recording.transcriptionFormatted
                    ? formatDialogTranscription(recording.transcriptionFormatted)
                    : `<div class="transcription-text">${escapeHtml(recording.transcription)}</div>`;

                transcriptionHtml = `
                    <div class="recording-transcription transcription-collapsed">
                        <div class="transcription-header">
                            <span class="transcription-toggle"></span>
                            <span>📝 Расшифровка разговора</span>
                        </div>
                        ${transcriptionContent}
                        <div class="transcription-download" data-recording-id="${recording.id}">
                            📥 Скачать текст (.txt)
                        </div>
                    </div>
                `;
            } else if (recording.transcriptionError) {
                transcriptionHtml = `
                    <div class="recording-transcription">
                        <div class="transcription-header">
                            <span>⚠️ Ошибка расшифровки</span>
                        </div>
                        <div class="transcription-status">${escapeHtml(recording.transcriptionError)}</div>
                        <button class="transcription-trigger" data-recording-id="${recording.id}">
                            🔄 Повторить транскрипцию
                        </button>
                    </div>
                `;
            } else {
                transcriptionHtml = `
                    <button class="transcription-trigger" data-recording-id="${recording.id}">
                        🎤 Транскрибировать запись
                    </button>
                `;
            }

            const recordingDate = new Date(recording.date);
            const dateStr = recordingDate.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            const timeStr = recordingDate.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });
            const primaryTitle = `Звонок от ${dateStr} в ${timeStr}`;

            const isValidName = recording.callerName &&
                                recording.callerName !== 'Unknown' &&
                                recording.callerName !== 'Unknown Caller' &&
                                !recording.callerName.includes('@');
            const participantInfo = isValidName ? `<div class="recording-participant">👤 ${escapeHtml(recording.callerName)}</div>` : '';

            card.innerHTML = `
                <div class="recording-header">
                    <div class="recording-info">
                        <div class="recording-caller">${primaryTitle}</div>
                        ${participantInfo}
                        <div class="recording-meta">
                            <div class="recording-meta-item">
                                <span>⏱️</span>
                                <span>${formatDuration(recording.duration)}</span>
                            </div>
                            <div class="recording-meta-item">
                                <span>💾</span>
                                <span>${formatSize(recording.size)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="recording-actions">
                        <button class="icon-button download" title="Download" data-id="${recording.id}">⬇️</button>
                        <button class="icon-button delete" title="Delete" data-id="${recording.id}">🗑️</button>
                    </div>
                </div>
                <div class="recording-player">
                    <audio controls preload="metadata" src="">
                        Your browser does not support audio playback.
                    </audio>
                </div>
                ${transcriptionHtml}
            `;

            const downloadBtn = card.querySelector('.download');
            const deleteBtn = card.querySelector('.delete');
            const audioElement = card.querySelector('audio');

            (async () => {
                const blobUrl = await loadRecordingBlob(recording.id);
                if (blobUrl && audioElement) {
                    audioElement.src = blobUrl;
                }
            })();

            if (downloadBtn) {
                downloadBtn.addEventListener('click', () => downloadRecording(recording));
            }
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => deleteRecording(recording.id));
            }

            const transcriptionHeader = card.querySelector('.transcription-header');
            if (transcriptionHeader) {
                transcriptionHeader.addEventListener('click', () => {
                    const transcriptionDiv = card.querySelector('.recording-transcription');
                    if (transcriptionDiv) {
                        transcriptionDiv.classList.toggle('transcription-collapsed');
                    }
                });
            }

            const downloadTranscriptionBtn = card.querySelector('.transcription-download');
            if (downloadTranscriptionBtn) {
                downloadTranscriptionBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Don't toggle collapse
                    downloadTranscriptionAsText(recording);
                });
            }

            const transcriptionTrigger = card.querySelector('.transcription-trigger');
            if (transcriptionTrigger) {
                transcriptionTrigger.addEventListener('click', () => {
                    triggerManualTranscription(recording.id);
                });
            }

            return card;
        }

        function formatDialogTranscription(formattedText) {
            const lines = formattedText.split('\n').filter(line => line.trim());
            let dialogHtml = '<div class="transcription-dialog">';

            for (const line of lines) {
                const match = line.match(/^(Участник\s*\d+|Speaker\s*\d+|Звонящий|Собеседник|Клиент|Оператор):\s*(.+)$/i);

                if (match) {
                    const speaker = match[1].trim();
                    const text = match[2].trim();

                    let speakerNumber = 1;
                    const numberMatch = speaker.match(/\d+/);
                    if (numberMatch) {
                        speakerNumber = parseInt(numberMatch[0]);
                    } else if (speaker.includes('2') || speaker.includes('Собеседник') || speaker.includes('Оператор')) {
                        speakerNumber = 2;
                    }

                    const speakerClass = `speaker${Math.min(speakerNumber, 6)}`;

                    dialogHtml += `
                        <div class="dialog-message ${speakerClass}">
                            <div class="dialog-speaker">${escapeHtml(speaker)}</div>
                            <div class="dialog-text">${escapeHtml(text)}</div>
                        </div>
                    `;
                }
            }

            dialogHtml += '</div>';
            return dialogHtml;
        }

        function downloadTranscriptionAsText(recording) {
            const date = new Date(recording.date);
            const dateStr = date.toISOString().split('T')[0];
            const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
            const callerName = (recording.callerName || 'Unknown').replace(/[^a-zA-Z0-9а-яА-Я]/g, '_');
            const filename = `${callerName}_${dateStr}_${timeStr}_transcription.txt`;

            let textContent = `VK Teams - Расшифровка разговора\n`;
            textContent += `Дата: ${formatAbsoluteDateTime(recording.date)}\n`;
            textContent += `Длительность: ${formatDuration(recording.duration)}\n`;
            textContent += `Собеседник: ${recording.callerName || 'Unknown'}\n`;
            textContent += `${'='.repeat(50)}\n\n`;

            if (recording.transcriptionFormatted) {
                textContent += 'ДИАЛОГ:\n\n';
                textContent += recording.transcriptionFormatted.replace(/<[^>]*>/g, '');
                textContent += '\n\n';
                textContent += `${'='.repeat(50)}\n\n`;
            }

            textContent += 'СЫРАЯ ТРАНСКРИПЦИЯ:\n\n';
            textContent += recording.transcription;

            const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        async function triggerManualTranscription(recordingId) {
            try {
                console.log('[VK Teams Recordings] Triggering manual transcription for:', recordingId);

                const button = document.querySelector(`.transcription-trigger[data-recording-id="${recordingId}"]`);
                if (button) {
                    button.disabled = true;
                    button.textContent = '⏳ Транскрибируем...';
                }

                const tabs = await getAllTeamsTabs();
                if (tabs.length === 0) {
                    throw new Error('VK Teams tab not found');
                }

                const response = await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'transcribeRecording',
                        recordingId: recordingId
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else if (!response) {
                            reject(new Error('No response from content script'));
                        } else if (response.success) {
                            resolve(response);
                        } else {
                            reject(new Error(response.error));
                        }
                    });
                });

                console.log('[VK Teams Recordings] Transcription completed:', response);

                await loadRecordings();

            } catch (error) {
                console.error('[VK Teams Recordings] Manual transcription failed:', error);
                alert(`Ошибка транскрипции: ${error.message}`);

                const button = document.querySelector(`.transcription-trigger[data-recording-id="${recordingId}"]`);
                if (button) {
                    button.disabled = false;
                    button.textContent = '🔄 Повторить транскрипцию';
                }
            }
        }

        async function downloadRecording(recording) {
            try {
                const blobUrl = await loadRecordingBlob(recording.id);
                if (!blobUrl) {
                    alert('Failed to load recording');
                    return;
                }

                const a = document.createElement('a');
                a.href = blobUrl;

                const date = new Date(recording.date);
                const dateStr = date.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
                const callerName = (recording.callerName || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
                const extension = recording.mimeType.split(';')[0].split('/')[1] || 'webm';

                a.download = `${callerName}_${dateStr}.${extension}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                console.log('[VK Teams Recordings] Downloaded:', recording.id);
            } catch (error) {
                console.error('[VK Teams Recordings] Download failed:', error);
                alert('Failed to download recording');
            }
        }

        async function deleteRecording(id) {
            if (!confirm('Delete this recording? This cannot be undone.')) {
                return;
            }

            try {
                await sendToContentScript({
                    action: 'deleteRecording',
                    recordingId: id
                });

                console.log('[VK Teams Recordings] Deleted recording:', id);

                await loadRecordings();
            } catch (error) {
                console.error('[VK Teams Recordings] Failed to delete recording:', error);
                alert('Failed to delete recording: ' + error.message);
            }
        }

        async function deleteAllRecordings() {
            if (!confirm('Delete ALL recordings? This cannot be undone.')) {
                return;
            }

            try {
                await sendToContentScript({
                    action: 'deleteAllRecordings'
                });

                console.log('[VK Teams Recordings] Deleted all recordings');

                await loadRecordings();
            } catch (error) {
                console.error('[VK Teams Recordings] Failed to delete all recordings:', error);
                alert('Failed to delete all recordings: ' + error.message);
            }
        }

        async function loadRecordings() {
            console.log('[VK Teams Recordings] Loading recordings...');

            const recordingsList = document.getElementById('recordingsList');
            const recordingsEmpty = document.getElementById('recordingsEmpty');
            const recordingsStats = document.getElementById('recordingsStats');
            const deleteAllButton = document.getElementById('deleteAllButton');

            if (!recordingsList) {
                console.error('[VK Teams Recordings] recordingsList element not found in DOM');
                return;
            }

            try {
                const [recordingsResponse, statsResponse] = await Promise.all([
                    sendToContentScript({ action: 'getRecordings' }),
                    sendToContentScript({ action: 'getRecordingStats' })
                ]);

                const recordings = recordingsResponse.recordings || [];
                const stats = statsResponse.stats || { count: 0, totalSize: 0, totalDuration: 0 };

                console.log('[VK Teams Recordings] Loaded:', recordings.length, 'recordings');
                console.log('[VK Teams Recordings] Stats:', stats);

                recordingsList.innerHTML = '';

                if (recordings.length === 0) {
                    if (recordingsEmpty) recordingsList.appendChild(recordingsEmpty);
                    if (recordingsStats) recordingsStats.style.display = 'none';
                    if (deleteAllButton) deleteAllButton.style.display = 'none';
                } else {
                    if (recordingsEmpty) recordingsEmpty.style.display = 'none';
                    if (recordingsStats) recordingsStats.style.display = 'block';
                    if (deleteAllButton) deleteAllButton.style.display = 'block';

                    const statsCount = document.getElementById('statsCount');
                    const statsSize = document.getElementById('statsSize');
                    const statsDuration = document.getElementById('statsDuration');

                    if (statsCount) statsCount.textContent = stats.count;
                    if (statsSize) statsSize.textContent = formatSize(stats.totalSize);
                    if (statsDuration) statsDuration.textContent = formatDuration(stats.totalDuration);

                    recordings.forEach(recording => {
                        const card = createRecordingCard(recording);
                        recordingsList.appendChild(card);
                    });
                }
            } catch (error) {
                console.error('[VK Teams Recordings] Failed to load recordings:', error);

                if (!recordingsList) {
                    console.error('[VK Teams Recordings] recordingsList element not found');
                    return;
                }

                const msg = (error && error.message) ? String(error.message) : '';
                const isNoMessengerTab = /VK Teams tab not found|Please open VK Teams/i.test(msg);
                const isContentScriptMissing = /Could not establish connection|Receiving end does not exist|message port closed/i.test(msg);

                if (isNoMessengerTab) {
                    recordingsList.innerHTML = `
                        <div class="state-panel state-panel-error">
                            <div class="state-panel-icon">⚠</div>
                            <div class="state-panel-title">Вкладка мессенджера не найдена</div>
                            <div class="state-panel-desc">
                                Откройте VK WorkSpace или корп. Teams <strong>в обычной вкладке</strong> этого браузера (не отдельное PWA‑окно, если возможно).
                            </div>
                            <div class="state-panel-tips">
                                Откройте мессенджер в этой вкладке браузера и обновите страницу (F5).
                            </div>
                        </div>
                    `;
                } else if (isContentScriptMissing) {
                    recordingsList.innerHTML = `
                        <div class="state-panel state-panel-warning">
                            <div class="state-panel-icon">🔌</div>
                            <div class="state-panel-title">Вкладка есть, скрипт расширения не отвечает</div>
                            <div class="state-panel-desc">
                                Часто это не PWA, а то что контент‑скрипт не внедрён: страница открыта до установки расширения, не пройдена активация или нужен перезапуск вкладки.
                            </div>
                            <div class="state-panel-tips">
                                Обновите вкладку мессенджера (Ctrl+F5) и активируйте расширение в попапе.
                            </div>
                            <div class="state-panel-error-msg">${escapeHtml(msg)}</div>
                        </div>
                    `;
                } else {
                    recordingsList.innerHTML = `
                        <div class="state-panel state-panel-error">
                            <div class="state-panel-icon">⚠</div>
                            <div class="state-panel-title">Не удалось загрузить записи</div>
                            <div class="state-panel-error-msg">${escapeHtml(msg)}</div>
                        </div>
                    `;
                }
            }
        }

        document.getElementById('enableCallRecording').addEventListener('change', saveRecordingSettings);
        document.getElementById('autoAnswerCalls').addEventListener('change', saveRecordingSettings);
        document.getElementById('autoTranscribe').addEventListener('change', saveRecordingSettings);
        document.getElementById('useLLMForSpeakers').addEventListener('change', saveRecordingSettings);

        document.getElementById('deleteAllButton').addEventListener('click', deleteAllRecordings);

        loadRecordingSettings();
    });
})();
