// VK Teams Custom Reactions - Popup Settings
(function() {
    'use strict';

    const BUILTIN_REACTIONS = ['🤨', '🙄', '🥱', '😭', '🥶', '🤮', '🥺', '💀', '🦧', '🔇'];
    const MAX_REACTIONS_PER_SET = 30;
    const MAX_REACTION_SETS = 20;

    let reactionSetsCache = [];
    let activeReactionSetIdCache = null;
    /** @type {null|string} null — редактор скрыт; 'new' — создание; иначе id набора */
    let editingSetId = null;

    function tabEffectiveUrl(tab) {
        if (!tab) {
            return '';
        }
        const u = tab.url || tab.pendingUrl;
        return (typeof u === 'string' && u) ? u : '';
    }

    /** URLs where the content script is injected (keep in sync with manifest.json matches). */
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
            return false;
        } catch (e) {
            return false;
        }
    }

    // Get all VK Teams / VK WorkSpace messenger tabs (scan all windows; merge pattern + URL filter).
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
                '*://teams.your-organization.com/*',
                '*://*.teams.your-organization.com/*',
                '*://webim.teams.your-organization.com/*',
                '*://app.workspace.vk.ru/*',
                '*://workspace.vk.ru/*',
                '*://*.workspace.vk.ru/*',
                '*://myteam.mail.ru/*',
                '*://*.myteam.mail.ru/*'
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

    function reactionsToInputString(reactions) {
        if (!Array.isArray(reactions) || !reactions.length) {
            return '';
        }
        return reactions.join(' ');
    }

    function parseReactionsFromInput(text) {
        const trimmed = (text || '').trim();
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
        chrome.storage.sync.set({
            reactionSets: sets,
            activeReactionSetId: activeId,
            customReactions: activeReactions
        }, done);
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

    function loadReactionSets() {
        chrome.storage.sync.get(['reactionSets', 'activeReactionSetId', 'customReactions'], (result) => {
            const migrated = migrateReactionStorage(result);
            reactionSetsCache = migrated.sets;
            activeReactionSetIdCache = migrated.activeId;

            if (!reactionSetsCache.some((s) => s.id === activeReactionSetIdCache)) {
                activeReactionSetIdCache = reactionSetsCache[0].id;
            }

            const persistMigrated = () => {
                const active = getActiveReactionSet();
                updatePreviewFromReactions(active.reactions, active.name);
                renderReactionSetsList();
            };

            if (migrated.migrated) {
                const active = getActiveReactionSet();
                persistReactionSets(reactionSetsCache, activeReactionSetIdCache, active.reactions, persistMigrated);
            } else {
                persistMigrated();
            }
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

    // === AI Settings ===

    // Load AI config
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

    // Update temperature label
    function updateTemperatureLabel() {
        const temperature = document.getElementById('aiTemperature').value;
        const label = document.querySelector('label[for="aiTemperature"]');
        if (label) {
            label.textContent = `Temperature (${temperature})`;
        }
    }

    // Save AI config
    function saveAiConfig() {
        const provider = document.getElementById('aiProvider').value;
        const apiKey = document.getElementById('aiApiKey').value;
        const model = document.getElementById('aiModel').value;
        const temperature = parseFloat(document.getElementById('aiTemperature').value);
        const maxTokens = parseInt(document.getElementById('aiMaxTokens').value);
        const endpoint = document.getElementById('aiEndpoint').value;
        const format = document.getElementById('aiFormat').value;
        const autoSend = document.getElementById('aiAutoSend').checked;

        // Validation
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

            // Notify content script to reload AI
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

    // Show AI status message
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

    function loadConnectionSettings() {
        chrome.storage.sync.get(['customAimsid', 'rapiBaseUrl', 'rapiApiVersion'], (r) => {
            const aimsidEl = document.getElementById('customAimsid');
            const urlEl = document.getElementById('rapiBaseUrl');
            const verEl = document.getElementById('rapiApiVersion');
            if (aimsidEl) {
                aimsidEl.value = (r.customAimsid && r.customAimsid.trim()) ? r.customAimsid.trim() : '';
            }
            if (urlEl) {
                urlEl.value = (r.rapiBaseUrl && r.rapiBaseUrl.trim()) ? r.rapiBaseUrl.trim() : '';
            }
            if (verEl) {
                verEl.value = (r.rapiApiVersion != null && String(r.rapiApiVersion).trim()) ? String(r.rapiApiVersion).trim() : '';
            }
        });
    }

    async function detectAimsidFromTab() {
        const tab = await getActiveTeamsTab();
        if (!tab) {
            showConnectionStatus('Откройте вкладку VK Teams / WorkSpace', 'error');
            return;
        }
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tab.id, { action: 'getDetectedAimsid' }, (res) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(res);
                    }
                });
            });
            if (response && response.success && response.aimsid) {
                const aimsidEl = document.getElementById('customAimsid');
                if (aimsidEl) {
                    aimsidEl.value = response.aimsid;
                }
                showConnectionStatus('✅ AIMSID подставлен — нажмите «Сохранить подключение»', 'success');
            } else {
                showConnectionStatus('AIMSID не найден на странице. Вставьте вручную из cookies.', 'error');
            }
        } catch (e) {
            showConnectionStatus('Не удалось прочитать вкладку: ' + (e.message || e), 'error');
        }
    }

    function saveConnectionSettings() {
        const rawAimsid = (document.getElementById('customAimsid').value || '').trim();
        const rawUrl = (document.getElementById('rapiBaseUrl').value || '').trim();
        const rawVer = (document.getElementById('rapiApiVersion').value || '').trim();

        if (!rawAimsid) {
            showConnectionStatus('Укажите AIMSID', 'error');
            return;
        }

        const aimsidPattern = /^\d{3}\.\d+\.\d+:[^\s]+$/;
        if (!aimsidPattern.test(rawAimsid)) {
            showConnectionStatus('Неверный формат AIMSID (ожидается 014.…:email)', 'error');
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

        chrome.storage.sync.set(payload, () => {
            showConnectionStatus('✅ Подключение сохранено', 'success');
            getAllTeamsTabs().then((tabs) => {
                tabs.forEach((tab) => {
                    chrome.tabs.sendMessage(tab.id, { action: 'reloadConnection' }).catch(() => {});
                });
            });
        });
    }

    // === Tab switching ===
    function switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }

    // === Accordion functionality ===
    function toggleSection(sectionId) {
        const header = document.querySelector(`[data-section="${sectionId}"]`);
        const content = document.getElementById(sectionId);

        if (!header || !content) return;

        const isCollapsed = content.classList.contains('collapsed');

        if (isCollapsed) {
            // Expand
            content.classList.remove('collapsed');
            header.setAttribute('aria-expanded', 'true');
        } else {
            // Collapse
            content.classList.add('collapsed');
            header.setAttribute('aria-expanded', 'false');
        }
    }

    // Initialize accordion sections
    function initializeAccordion() {
        document.querySelectorAll('.section-header').forEach(header => {
            const sectionId = header.getAttribute('data-section');
            const content = document.getElementById(sectionId);

            // Set initial aria-expanded based on collapsed class
            const isCollapsed = content && content.classList.contains('collapsed');
            header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');

            // Add click handler
            header.addEventListener('click', () => {
                toggleSection(sectionId);
            });
        });
    }

    // === Activation System ===

    // Check if extension is activated
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

    // Activate extension
    function activateExtension() {
        chrome.storage.sync.set({ extensionActivated: true }, () => {
            console.log('[VK Teams Extension] Extension activated!');
            checkActivation();

            // Notify content script
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

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[VK Teams Reactions Settings] Popup loaded');

        // Check activation status first
        checkActivation();

        // Activation button handler
        const activateButton = document.getElementById('activateButton');
        if (activateButton) {
            activateButton.addEventListener('click', activateExtension);
        }

        loadReactionSets();

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

        // Initialize accordion functionality
        initializeAccordion();

        // Tab switching
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

        // AI provider change handler
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

            // Set default models and settings
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

                // Set custom provider specific settings
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

        // Temperature slider
        document.getElementById('aiTemperature').addEventListener('input', updateTemperatureLabel);

        // Save AI config button
        document.getElementById('saveAiButton').addEventListener('click', saveAiConfig);

        const saveConnectionBtn = document.getElementById('saveConnectionButton');
        if (saveConnectionBtn) {
            saveConnectionBtn.addEventListener('click', saveConnectionSettings);
        }
        const detectAimsidBtn = document.getElementById('detectAimsidButton');
        if (detectAimsidBtn) {
            detectAimsidBtn.addEventListener('click', detectAimsidFromTab);
        }

        // === Recordings Tab ===

        // Load recording settings
        function loadRecordingSettings() {
            chrome.storage.sync.get(['callRecordingEnabled', 'autoAnswerCalls', 'autoTranscribe', 'useLLMForSpeakers'], (result) => {
                document.getElementById('enableCallRecording').checked = result.callRecordingEnabled || false;
                document.getElementById('autoAnswerCalls').checked = result.autoAnswerCalls || false;
                document.getElementById('autoTranscribe').checked = result.autoTranscribe !== false; // default true
                document.getElementById('useLLMForSpeakers').checked = result.useLLMForSpeakers !== false; // default true
            });
        }

        // Save recording settings
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

                // Notify content script
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

        // Send message to content script
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

        // Format duration (ms to mm:ss)
        function formatDuration(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }

        // Format size (bytes to KB/MB)
        function formatSize(bytes) {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        }

        // Format date (relative for UI)
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

        // Format absolute date and time (for file export)
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

        // Load recording blob
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

        // Create recording card HTML
        function createRecordingCard(recording) {
            const card = document.createElement('div');
            card.className = 'recording-card';
            card.dataset.recordingId = recording.id;

            // Build transcription HTML
            let transcriptionHtml = '';
            if (recording.transcription) {
                // Use formatted transcription if available, otherwise raw
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
                // No transcription yet
                transcriptionHtml = `
                    <button class="transcription-trigger" data-recording-id="${recording.id}">
                        🎤 Транскрибировать запись
                    </button>
                `;
            }

            // Format recording title: use date/time as primary identifier
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

            // Show participant name as secondary info only if it's valid (not Unknown, not email)
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

            // Add event listeners for buttons
            const downloadBtn = card.querySelector('.download');
            const deleteBtn = card.querySelector('.delete');
            const audioElement = card.querySelector('audio');

            // Load blob immediately for playback
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

            // Add transcription toggle listener
            const transcriptionHeader = card.querySelector('.transcription-header');
            if (transcriptionHeader) {
                transcriptionHeader.addEventListener('click', () => {
                    const transcriptionDiv = card.querySelector('.recording-transcription');
                    if (transcriptionDiv) {
                        transcriptionDiv.classList.toggle('transcription-collapsed');
                    }
                });
            }

            // Add download transcription listener
            const downloadTranscriptionBtn = card.querySelector('.transcription-download');
            if (downloadTranscriptionBtn) {
                downloadTranscriptionBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Don't toggle collapse
                    downloadTranscriptionAsText(recording);
                });
            }

            // Add manual transcription trigger listener
            const transcriptionTrigger = card.querySelector('.transcription-trigger');
            if (transcriptionTrigger) {
                transcriptionTrigger.addEventListener('click', () => {
                    triggerManualTranscription(recording.id);
                });
            }

            return card;
        }

        // Format transcription as dialog
        function formatDialogTranscription(formattedText) {
            const lines = formattedText.split('\n').filter(line => line.trim());
            let dialogHtml = '<div class="transcription-dialog">';

            for (const line of lines) {
                // Match "Участник N:" or "Speaker N:" or similar patterns
                const match = line.match(/^(Участник\s*\d+|Speaker\s*\d+|Звонящий|Собеседник|Клиент|Оператор):\s*(.+)$/i);

                if (match) {
                    const speaker = match[1].trim();
                    const text = match[2].trim();

                    // Extract speaker number
                    let speakerNumber = 1;
                    const numberMatch = speaker.match(/\d+/);
                    if (numberMatch) {
                        speakerNumber = parseInt(numberMatch[0]);
                    } else if (speaker.includes('2') || speaker.includes('Собеседник') || speaker.includes('Оператор')) {
                        speakerNumber = 2;
                    }

                    // Limit to max 6 speaker classes (fallback to speaker6 for 7+)
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

        // Download transcription as text file
        function downloadTranscriptionAsText(recording) {
            const date = new Date(recording.date);
            const dateStr = date.toISOString().split('T')[0];
            const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
            const callerName = (recording.callerName || 'Unknown').replace(/[^a-zA-Z0-9а-яА-Я]/g, '_');
            const filename = `${callerName}_${dateStr}_${timeStr}_transcription.txt`;

            // Create text content with both versions
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

            // Create download
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

        // Escape HTML to prevent XSS
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Trigger manual transcription
        async function triggerManualTranscription(recordingId) {
            try {
                console.log('[VK Teams Recordings] Triggering manual transcription for:', recordingId);

                // Update button state
                const button = document.querySelector(`.transcription-trigger[data-recording-id="${recordingId}"]`);
                if (button) {
                    button.disabled = true;
                    button.textContent = '⏳ Транскрибируем...';
                }

                // Get tabs with content script
                const tabs = await getAllTeamsTabs();
                if (tabs.length === 0) {
                    throw new Error('VK Teams tab not found');
                }

                // Send transcription request
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

                // Reload recordings to show updated transcription
                await loadRecordings();

            } catch (error) {
                console.error('[VK Teams Recordings] Manual transcription failed:', error);
                alert(`Ошибка транскрипции: ${error.message}`);

                // Reset button state
                const button = document.querySelector(`.transcription-trigger[data-recording-id="${recordingId}"]`);
                if (button) {
                    button.disabled = false;
                    button.textContent = '🔄 Повторить транскрипцию';
                }
            }
        }

        // Download recording
        async function downloadRecording(recording) {
            try {
                // Load blob data
                const blobUrl = await loadRecordingBlob(recording.id);
                if (!blobUrl) {
                    alert('Failed to load recording');
                    return;
                }

                const a = document.createElement('a');
                a.href = blobUrl;

                // Create filename: CallerName_YYYY-MM-DD_HH-MM.webm
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

        // Delete recording
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

                // Reload recordings
                await loadRecordings();
            } catch (error) {
                console.error('[VK Teams Recordings] Failed to delete recording:', error);
                alert('Failed to delete recording: ' + error.message);
            }
        }

        // Delete all recordings
        async function deleteAllRecordings() {
            if (!confirm('Delete ALL recordings? This cannot be undone.')) {
                return;
            }

            try {
                await sendToContentScript({
                    action: 'deleteAllRecordings'
                });

                console.log('[VK Teams Recordings] Deleted all recordings');

                // Reload recordings
                await loadRecordings();
            } catch (error) {
                console.error('[VK Teams Recordings] Failed to delete all recordings:', error);
                alert('Failed to delete all recordings: ' + error.message);
            }
        }

        // Load and display recordings
        async function loadRecordings() {
            console.log('[VK Teams Recordings] Loading recordings...');

            const recordingsList = document.getElementById('recordingsList');
            const recordingsEmpty = document.getElementById('recordingsEmpty');
            const recordingsStats = document.getElementById('recordingsStats');
            const deleteAllButton = document.getElementById('deleteAllButton');

            // Ensure recordingsList exists
            if (!recordingsList) {
                console.error('[VK Teams Recordings] recordingsList element not found in DOM');
                return;
            }

            try {
                // Get recordings and stats from content script
                const [recordingsResponse, statsResponse] = await Promise.all([
                    sendToContentScript({ action: 'getRecordings' }),
                    sendToContentScript({ action: 'getRecordingStats' })
                ]);

                const recordings = recordingsResponse.recordings || [];
                const stats = statsResponse.stats || { count: 0, totalSize: 0, totalDuration: 0 };

                console.log('[VK Teams Recordings] Loaded:', recordings.length, 'recordings');
                console.log('[VK Teams Recordings] Stats:', stats);

                // Clear existing recordings
                recordingsList.innerHTML = '';

                if (recordings.length === 0) {
                    // Show empty state
                    if (recordingsEmpty) recordingsList.appendChild(recordingsEmpty);
                    if (recordingsStats) recordingsStats.style.display = 'none';
                    if (deleteAllButton) deleteAllButton.style.display = 'none';
                } else {
                    // Hide empty state
                    if (recordingsEmpty) recordingsEmpty.style.display = 'none';
                    if (recordingsStats) recordingsStats.style.display = 'block';
                    if (deleteAllButton) deleteAllButton.style.display = 'block';

                    // Update stats
                    const statsCount = document.getElementById('statsCount');
                    const statsSize = document.getElementById('statsSize');
                    const statsDuration = document.getElementById('statsDuration');

                    if (statsCount) statsCount.textContent = stats.count;
                    if (statsSize) statsSize.textContent = formatSize(stats.totalSize);
                    if (statsDuration) statsDuration.textContent = formatDuration(stats.totalDuration);

                    // Create and append recording cards
                    recordings.forEach(recording => {
                        const card = createRecordingCard(recording);
                        recordingsList.appendChild(card);
                    });
                }
            } catch (error) {
                console.error('[VK Teams Recordings] Failed to load recordings:', error);

                // Ensure recordingsList exists
                if (!recordingsList) {
                    console.error('[VK Teams Recordings] recordingsList element not found');
                    return;
                }

                // Previously this matched any message containing substring "tab" (e.g. "establish") or "not" — wrong UI.
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
                                <div style="font-weight: 600; margin-bottom: 6px;">Что сделать:</div>
                                <div>1. Вкладка с <strong>app.workspace.vk.ru</strong> (или webim.teams.…) в Chrome/Edge</div>
                                <div>2. Обновите страницу (F5), затем снова откройте этот попап</div>
                                <div>3. На <code>chrome://extensions</code> нажмите «Обновить» у расширения после правок в папке</div>
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
                                <div>• Обновите вкладку <strong>app.workspace.vk.ru</strong> (Ctrl+F5)</div>
                                <div>• В попапе расширения пройдите <strong>активацию</strong> (если показывается первый экран)</div>
                                <div>• В консоли страницы (F12) ищите лог: <code>[VK Teams Custom Reactions] Extension loaded!</code></div>
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

        // Recording settings change handlers
        document.getElementById('enableCallRecording').addEventListener('change', saveRecordingSettings);
        document.getElementById('autoAnswerCalls').addEventListener('change', saveRecordingSettings);
        document.getElementById('autoTranscribe').addEventListener('change', saveRecordingSettings);
        document.getElementById('useLLMForSpeakers').addEventListener('change', saveRecordingSettings);

        // Delete all button
        document.getElementById('deleteAllButton').addEventListener('click', deleteAllRecordings);

        // Load recording settings on startup
        loadRecordingSettings();
    });
})();
