(function (global) {
    'use strict';

    const ACCENT_TO_THEME = {
        blue: 'blue',
        turquoise: 'turquoise',
        lilac: 'violet',
        orange: 'orange',
        pink: 'pink',
        red: 'blue'
    };

    const ACCENT_PRESETS = {
        blue: { label: 'Синяя', main: '#3f8ae0', custom: false },
        turquoise: { label: 'Бирюзовая', main: '#2bb6d6', custom: false },
        lilac: { label: 'Сиреневая', main: '#ac7eed', custom: false },
        orange: { label: 'Оранжевая', main: '#ff9e00', custom: false },
        pink: { label: 'Розовая', main: '#e03dac', custom: false },
        red: {
            label: 'Красная',
            main: '#e64646',
            custom: true,
            rgb: { r: 230, g: 70, b: 70 },
            hover: { r: 212, g: 58, b: 58 },
            active: { r: 198, g: 48, b: 48 },
            light: { r: 242, g: 120, b: 120 },
            bright: { r: 180, g: 55, b: 55 },
            gradient: { r: 235, g: 90, b: 90 },
            chat: { r: 89, g: 55, b: 55 }
        }
    };

    function rgbStr(c) {
        return c.r + ', ' + c.g + ', ' + c.b;
    }

    function themeIdForSettings(settings) {
        const base = ACCENT_TO_THEME[settings.appearanceAccent] || ACCENT_TO_THEME.lilac;
        const mode = settings.appearanceTheme;
        let dark = mode === 'dark';
        if (mode === 'system') {
            try {
                dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            } catch (e) {
                dark = true;
            }
        }
        return dark ? 'dark_' + base : base;
    }

    function usesCustomAccent(accentId) {
        const preset = ACCENT_PRESETS[accentId];
        return !!(preset && preset.custom);
    }

    function buildCustomAccentCss(settings) {
        const preset = ACCENT_PRESETS[settings.appearanceAccent];
        if (!preset || !preset.custom || !preset.rgb) {
            return '';
        }

        const p = preset.rgb;
        const h = preset.hover || p;
        const a = preset.active || h;
        const l = preset.light || p;
        const b = preset.bright || h;
        const g = preset.gradient || p;
        const ch = preset.chat || b;

        const vars = [
            ['--theme-color-primary', p],
            ['--theme-color-primary_hover', h],
            ['--theme-color-primary_active', a],
            ['--theme-color-primary_light', l],
            ['--theme-color-primary_bright', b],
            ['--theme-color-primary_bright_hover', h],
            ['--theme-color-primary_bright_active', a],
            ['--theme-color-primary_pastel', b],
            ['--theme-color-primary_pastel_hover', h],
            ['--theme-color-primary_pastel_active', a],
            ['--theme-color-primary_hex', preset.main],
            ['--theme-color-text_primary', p],
            ['--theme-color-text_primary_hover', p],
            ['--theme-color-text_primary_active', p],
            ['--theme-color-gradient_primary', g],
            ['--theme-color-gradient_secondary', g],
            ['--theme-color-gradient_primary_hover', h],
            ['--theme-color-gradient_secondary_hover', h],
            ['--theme-color-gradient_primary_active', a],
            ['--theme-color-gradient_secondary_active', a],
            ['--theme-color-chat_secondary', ch],
            ['--theme-color-chat_secondary_hover', ch],
            ['--theme-color-chat_secondary_active', ch]
        ];

        const lines = vars
            .map(([name, c]) => name + ': ' + rgbStr(c) + ' !important;')
            .join('\n');

        return `
            html[${'data-vkteams-appearance'}] body,
            html[${'data-vkteams-appearance'}] {
                ${lines}
            }
        `;
    }

    global.VKTeamsAppearancePresets = {
        ACCENT_TO_THEME,
        ACCENT_PRESETS,
        themeIdForSettings,
        usesCustomAccent,
        buildCustomAccentCss
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
