(function (global) {
    'use strict';

    const STYLE_ID = 'vkteams-appearance-scale';
    const ACCENT_STYLE_ID = 'vkteams-appearance-accent';
    const ROOT_ATTR = 'data-vkteams-appearance';
    const RE_THEME_CLASS = /^im-theme(-|$)/;
    const RE_VKUI_SCHEME = /^vkui--paradigmBase--(light|dark)$/;

    let systemMq = null;
    let systemListener = null;
    let currentSettings = null;
    let booted = false;
    let retryTimer = null;

    function themeIdForSettings(settings) {
        if (global.VKTeamsAppearancePresets && global.VKTeamsAppearancePresets.themeIdForSettings) {
            return global.VKTeamsAppearancePresets.themeIdForSettings(settings);
        }
        return 'lilac';
    }

    function resolveThemeMode(settings) {
        if (settings.appearanceTheme === 'light') {
            return 'light';
        }
        if (settings.appearanceTheme === 'dark') {
            return 'dark';
        }
        try {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        } catch (e) {
            return 'dark';
        }
    }

    function findThemeHost(doc) {
        if (!doc || !doc.body) {
            return doc ? doc.documentElement : null;
        }
        const body = doc.body;
        if ([...body.classList].some((c) => RE_THEME_CLASS.test(c))) {
            return body;
        }
        const root = body.querySelector('[class*="im-root"]');
        return root || body;
    }

    function stripImThemeClasses(el) {
        if (!el || !el.classList) {
            return;
        }
        [...el.classList].forEach((cls) => {
            if (RE_THEME_CLASS.test(cls)) {
                el.classList.remove(cls);
            }
        });
    }

    function stripVkuiSchemeClasses(el) {
        if (!el || !el.classList) {
            return;
        }
        [...el.classList].forEach((cls) => {
            if (RE_VKUI_SCHEME.test(cls)) {
                el.classList.remove(cls);
            }
        });
    }

    function applyCustomAccent(doc, settings) {
        const head = doc.head || doc.documentElement;
        if (!head) {
            return;
        }
        let el = doc.getElementById(ACCENT_STYLE_ID);
        const presets = global.VKTeamsAppearancePresets;
        const css =
            presets && presets.buildCustomAccentCss ? presets.buildCustomAccentCss(settings) : '';

        if (!css) {
            if (el) {
                el.remove();
            }
            return;
        }

        if (!el) {
            el = doc.createElement('style');
            el.id = ACCENT_STYLE_ID;
            el.setAttribute('data-vkteams-ui', 'appearance-accent');
            head.appendChild(el);
        }
        el.textContent = css;
    }

    function applyScale(doc, settings) {
        const head = doc.head || doc.documentElement;
        if (!head) {
            return;
        }
        const scale = settings.appearanceUiScale / 100;
        let el = doc.getElementById(STYLE_ID);
        if (!el) {
            el = doc.createElement('style');
            el.id = STYLE_ID;
            el.setAttribute('data-vkteams-ui', 'appearance-scale');
            head.appendChild(el);
        }
        el.textContent = `
            html[${ROOT_ATTR}] {
                zoom: ${scale};
            }
        `;
    }

    function applyNativeTheme(doc, settings) {
        const host = findThemeHost(doc);
        if (!host) {
            return false;
        }

        const themeId = themeIdForSettings(settings);
        const themeClass = 'im-theme-' + themeId;
        const mode = resolveThemeMode(settings);
        const vkuiClass = 'vkui--paradigmBase--' + mode;

        stripImThemeClasses(host);
        stripVkuiSchemeClasses(host);
        stripVkuiSchemeClasses(doc.documentElement);

        host.classList.add(themeClass);
        host.classList.add(vkuiClass);
        doc.documentElement.classList.add(vkuiClass);

        host.setAttribute(ROOT_ATTR, themeId);
        doc.documentElement.setAttribute(ROOT_ATTR, '1');
        doc.documentElement.setAttribute('data-vkteams-theme', mode);
        doc.documentElement.setAttribute('data-vkteams-accent', settings.appearanceAccent);

        applyCustomAccent(doc, settings);
        applyScale(doc, settings);
        return host.classList.contains(themeClass);
    }

    function clearAppearance(doc) {
        if (!doc) {
            return;
        }
        const host = findThemeHost(doc);
        if (host) {
            stripImThemeClasses(host);
            host.removeAttribute(ROOT_ATTR);
        }
        stripVkuiSchemeClasses(doc.documentElement);
        if (doc.body) {
            stripVkuiSchemeClasses(doc.body);
        }
        doc.documentElement.removeAttribute(ROOT_ATTR);
        doc.documentElement.removeAttribute('data-vkteams-theme');
        doc.documentElement.removeAttribute('data-vkteams-accent');
        const scaleEl = doc.getElementById(STYLE_ID);
        if (scaleEl) {
            scaleEl.remove();
        }
        const accentEl = doc.getElementById(ACCENT_STYLE_ID);
        if (accentEl) {
            accentEl.remove();
        }
    }

    function applyToDocument(doc, settings) {
        if (!doc) {
            return;
        }
        if (!settings || !settings.appearanceEnabled) {
            clearAppearance(doc);
            return;
        }
        applyNativeTheme(doc, settings);
    }

    function applyToAllDocuments(settings) {
        currentSettings = settings;
        try {
            applyToDocument(document, settings);
        } catch (e) {
            /* ignore */
        }
        try {
            for (let i = 0; i < window.frames.length; i++) {
                try {
                    const frameDoc = window.frames[i].document;
                    if (frameDoc && frameDoc !== document) {
                        applyToDocument(frameDoc, settings);
                    }
                } catch (e) {
                    /* cross-origin */
                }
            }
        } catch (e) {
            /* ignore */
        }
    }

    function scheduleRetries() {
        if (retryTimer) {
            clearInterval(retryTimer);
            retryTimer = null;
        }
        if (!currentSettings || !currentSettings.appearanceEnabled) {
            return;
        }
        let attempts = 0;
        retryTimer = setInterval(() => {
            if (!currentSettings || !currentSettings.appearanceEnabled) {
                clearInterval(retryTimer);
                retryTimer = null;
                return;
            }
            applyToAllDocuments(currentSettings);
            attempts += 1;
            if (attempts >= 8) {
                clearInterval(retryTimer);
                retryTimer = null;
            }
        }, 2000);
    }

    function bindSystemThemeListener(settings) {
        unbindSystemThemeListener();
        if (!settings || settings.appearanceTheme !== 'system') {
            return;
        }
        try {
            systemMq = window.matchMedia('(prefers-color-scheme: dark)');
            systemListener = () => {
                if (currentSettings) {
                    applyToAllDocuments(currentSettings);
                }
            };
            if (systemMq.addEventListener) {
                systemMq.addEventListener('change', systemListener);
            } else if (systemMq.addListener) {
                systemMq.addListener(systemListener);
            }
        } catch (e) {
            /* ignore */
        }
    }

    function unbindSystemThemeListener() {
        if (!systemMq || !systemListener) {
            systemMq = null;
            systemListener = null;
            return;
        }
        try {
            if (systemMq.removeEventListener) {
                systemMq.removeEventListener('change', systemListener);
            } else if (systemMq.removeListener) {
                systemMq.removeListener(systemListener);
            }
        } catch (e) {
            /* ignore */
        }
        systemMq = null;
        systemListener = null;
    }

    function applySettings(settings) {
        currentSettings = settings;
        if (!settings || !settings.appearanceEnabled) {
            unbindSystemThemeListener();
            if (retryTimer) {
                clearInterval(retryTimer);
                retryTimer = null;
            }
            applyToAllDocuments({ appearanceEnabled: false });
            return settings;
        }
        applyToAllDocuments(settings);
        bindSystemThemeListener(settings);
        scheduleRetries();
        return settings;
    }

    async function loadAndApply() {
        let settings;
        if (global.VKTeamsAppearanceStorage) {
            settings = await global.VKTeamsAppearanceStorage.read();
        } else {
            settings = { appearanceEnabled: false };
        }
        return applySettings(settings);
    }

    function init() {
        if (booted) {
            loadAndApply();
            return;
        }
        booted = true;

        loadAndApply();

        if (global.VKTeamsAppearanceStorage) {
            global.VKTeamsAppearanceStorage.onChanged(() => {
                loadAndApply();
            });
        }

        const observer = new MutationObserver(() => {
            if (!currentSettings || !currentSettings.appearanceEnabled) {
                return;
            }
            const expected = 'im-theme-' + themeIdForSettings(currentSettings);
            const host = findThemeHost(document);
            if (host && ![...host.classList].includes(expected)) {
                applyToAllDocuments(currentSettings);
            }
        });

        const target = document.body;
        if (target) {
            observer.observe(target, {
                attributes: true,
                attributeFilter: ['class'],
                subtree: false
            });
        }
    }

    function isMessengerContext() {
        try {
            const host = location.hostname.toLowerCase();
            return /myteam\.mail\.ru|workspace\.vk\.ru|bizml\.ru|teams\./.test(host);
        } catch (e) {
            return false;
        }
    }

    if (isMessengerContext()) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => init(), { once: true });
        } else {
            init();
        }
    }

    global.VKTeamsAppearanceApplier = {
        init,
        loadAndApply,
        applySettings,
        applyToAllDocuments,
        themeIdForSettings
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
