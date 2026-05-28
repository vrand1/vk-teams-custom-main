
(function() {
    'use strict';
    class AIProvider {
        constructor(config) {
            this.config = config;
            this.apiKey = config.apiKey;
            this.model = config.model;
            this.temperature = config.temperature || 0.7;
            this.maxTokens = config.maxTokens || 500;
        }

        async generateResponse(prompt, context = '') {
            console.log('[VK Teams AI] Sending request to background script:', this.config.provider);
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'aiRequest',
                    provider: this.config.provider,
                    config: this.config,
                    prompt: prompt,
                    context: context
                }, (response) => {
                    console.log('[VK Teams AI] Response from background:', response);
                    if (chrome.runtime.lastError) {
                        console.error('[VK Teams AI] Runtime error:', chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (!response) {
                        console.error('[VK Teams AI] No response from background script');
                        reject(new Error('No response from background script'));
                    } else if (response.success) {
                        resolve(response.result);
                    } else {
                        reject(new Error(response.error));
                    }
                });
            });
        }
    }
    class OpenAIProvider extends AIProvider {}
    class ClaudeProvider extends AIProvider {}
    class GeminiProvider extends AIProvider {}
    class OllamaProvider extends AIProvider {}
    class CustomProvider extends AIProvider {}
    class AIManager {
        constructor() {
            this.provider = null;
            this.config = null;
        }

        async init() {
            return new Promise((resolve) => {
                chrome.storage.sync.get(['aiConfig'], (result) => {
                    if (result.aiConfig) {
                        this.config = result.aiConfig;
                        this.provider = this.createProvider(this.config);
                        console.log('[VK Teams AI] AI Provider initialized:', this.config.provider);
                    } else {
                        console.log('[VK Teams AI] No AI config found');
                    }
                    resolve();
                });
            });
        }

        createProvider(config) {
            switch (config.provider) {
                case 'openai':
                    return new OpenAIProvider(config);
                case 'claude':
                    return new ClaudeProvider(config);
                case 'gemini':
                    return new GeminiProvider(config);
                case 'ollama':
                    return new OllamaProvider(config);
                case 'custom':
                    return new CustomProvider(config);
                default:
                    throw new Error(`Unknown provider: ${config.provider}`);
            }
        }

        isConfigured() {
            return this.provider !== null && this.config !== null;
        }

        async generateSmartReply(messageText) {
            if (!this.isConfigured()) {
                throw new Error('AI not configured');
            }

            const prompt = `Ты помощник для корпоративного мессенджера. Твоя задача - сгенерировать уместный ответ на сообщение коллеги.

КОНТЕКСТ:
- Это рабочая переписка в VK Teams
- Нужен краткий, естественный ответ
- Тон должен соответствовать исходному сообщению (формальный/неформальный)

ПРАВИЛА:
1. Если это вопрос - дай конкретный ответ
2. Если это просьба/задача - подтверди понимание или предложи помощь
3. Если это информация - поблагодари или прокомментируй уместно
4. Если это обсуждение - выскажи мнение или согласие
5. Длина ответа: 1-3 предложения (не более 2 строк)
6. Используй профессиональный, но дружелюбный тон
7. Избегай шаблонных фраз типа "Спасибо за вопрос"

ФОРМАТ ОТВЕТА:
Пиши ТОЛЬКО текст ответа. Никаких пояснений, меток, комментариев.

СООБЩЕНИЕ ОТ КОЛЛЕГИ:
"${messageText}"

ТВОЙ ОТВЕТ:`;
            return await this.provider.generateResponse(prompt);
        }

        async summarizeMessage(messageText) {
            if (!this.isConfigured()) {
                throw new Error('AI not configured');
            }

            const prompt = `Ты помощник для корпоративного мессенджера. Твоя задача - создать краткое изложение сообщения.

КОНТЕКСТ:
- Это рабочая переписка в VK Teams
- Сообщение может содержать: задачи, обсуждения, информацию, вопросы
- Изложение нужно для быстрого понимания сути без чтения всего текста

ПРАВИЛА СОЗДАНИЯ ИЗЛОЖЕНИЯ:
1. Выдели ГЛАВНУЮ мысль (что хочет сказать автор)
2. Перечисли КЛЮЧЕВЫЕ пункты (задачи, вопросы, решения)
3. Сохрани ВАЖНЫЕ детали (сроки, имена, цифры)
4. Убери воду, приветствия, вводные фразы
5. Длина: 2-4 предложения максимум
6. Используй структурированный текст (если пунктов много - используй маркеры)
7. Сохрани тон оригинала (срочность, важность)

ТИПЫ СООБЩЕНИЙ:
- Задача: Кто, что, когда, зачем
- Вопрос: Суть вопроса + контекст
- Информация: Главный факт + последствия
- Обсуждение: Тема + ключевые мнения

ФОРМАТ ОТВЕТА:
Пиши ТОЛЬКО краткое изложение. Без преамбул типа "В этом сообщении..." или "Автор говорит...".

ИСХОДНОЕ СООБЩЕНИЕ:
"${messageText}"

КРАТКОЕ ИЗЛОЖЕНИЕ:`;
            return await this.provider.generateResponse(prompt);
        }

        async translateMessage(messageText) {
            if (!this.isConfigured()) {
                throw new Error('AI not configured');
            }

            const cyrillicCount = (messageText.match(/[а-яА-ЯёЁ]/g) || []).length;
            const latinCount = (messageText.match(/[a-zA-Z]/g) || []).length;

            const isRussian = cyrillicCount > latinCount;

            let prompt;
            if (isRussian) {
                prompt = `You are a professional translator for corporate communications. Translate Russian business text to English.

CONTEXT:
- This is from a VK Teams corporate messenger
- May contain: technical terms, tasks, questions, discussions
- Translation should sound natural in English

TRANSLATION RULES:
1. Preserve the MEANING and TONE (formal/informal, urgent/casual)
2. Keep technical terms in original if commonly used (API, backend, deploy, etc.)
3. Adapt idioms and expressions to English equivalents
4. Maintain formatting (line breaks, lists, emphasis)
5. Keep names, dates, numbers unchanged
6. Professional but natural style

EXAMPLES OF GOOD TRANSLATIONS:
- "Нужно срочно пофиксить" → "Need to fix this urgently"
- "Давай созвонимся" → "Let's hop on a call"
- "Отправил PR на ревью" → "Sent the PR for review"

OUTPUT FORMAT:
Write ONLY the translated text. No labels like "Translation:", no explanations.

RUSSIAN TEXT:
"${messageText}"

ENGLISH TRANSLATION:`;
            } else {
                prompt = `Ты профессиональный переводчик корпоративных коммуникаций. Твоя задача - перевести АНГЛИЙСКИЙ текст на РУССКИЙ язык.

ВАЖНО: Текст ниже написан на АНГЛИЙСКОМ языке. Ты ОБЯЗАТЕЛЬНО должен перевести его на РУССКИЙ. НЕ оставляй текст на английском!

КОНТЕКСТ:
- Это из корпоративного мессенджера VK Teams
- Может содержать: технические термины, задачи, вопросы, обсуждения
- Перевод должен звучать естественно на русском языке

ПРАВИЛА ПЕРЕВОДА:
1. Переведи ВЕСЬ текст на РУССКИЙ язык
2. Сохрани СМЫСЛ и ТОН (формальный/неформальный, срочный/обычный)
3. Технические термины можешь оставлять на английском если они общеупотребительные (API, бэкенд, деплой, коммит, и т.д.)
4. Адаптируй идиомы и выражения к русским эквивалентам
5. Сохрани форматирование (переносы строк, списки, выделения)
6. Имена, даты, цифры не изменяй
7. Профессиональный но естественный стиль

ПРИМЕРЫ ХОРОШИХ ПЕРЕВОДОВ (English → Русский):
- "Need to fix this urgently" → "Нужно срочно пофиксить"
- "Let's hop on a call" → "Давай созвонимся"
- "Sent the PR for review" → "Отправил PR на ревью"
- "The build is failing" → "Сборка падает"
- "Can you review my code?" → "Можешь посмотреть мой код?"

ФОРМАТ ОТВЕТА:
Пиши ТОЛЬКО переведенный текст НА РУССКОМ ЯЗЫКЕ. Без меток типа "Перевод:", без пояснений, без английского текста.

АНГЛИЙСКИЙ ТЕКСТ ДЛЯ ПЕРЕВОДА НА РУССКИЙ:
"${messageText}"

РУССКИЙ ПЕРЕВОД:`;
            }

            return await this.provider.generateResponse(prompt);
        }

        async changeTone(messageText, tone) {
            if (!this.isConfigured()) {
                throw new Error('AI not configured');
            }

            const toneGuides = {
                formal: {
                    desc: 'официальный и формальный',
                    rules: `- Используй вежливые обращения ("Уважаемые коллеги", "Прошу рассмотреть")
- Избегай сокращений и жаргона
- Используй полные предложения и развернутые конструкции
- Формальная лексика ("осуществить", "предоставить", "рассмотреть")`,
                    example: '"Нужно пофиксить баг" → "Прошу рассмотреть возможность устранения обнаруженной ошибки"'
                },
                casual: {
                    desc: 'неформальный и расслабленный',
                    rules: `- Используй простые разговорные выражения
- Можно использовать сокращения (ок, лан, норм)
- Короткие предложения
- Неформальная лексика, но без грубости`,
                    example: '"Необходимо провести встречу" → "Давай созвонимся"'
                },
                friendly: {
                    desc: 'дружелюбный и тёплый',
                    rules: `- Используй приветливые выражения ("рад помочь", "с удовольствием")
- Эмодзи уместны (но без перебора - макс 1-2)
- Позитивные формулировки
- Проявляй заинтересованность`,
                    example: '"Нужна помощь с задачей" → "С радостью помогу с задачей! 😊"'
                }
            };

            const guide = toneGuides[tone];
            const prompt = `Ты редактор корпоративных сообщений. Твоя задача - переписать сообщение, изменив его тон, но сохранив смысл.

ЦЕЛЕВОЙ ТОН: ${guide.desc}

ПРАВИЛА ДЛЯ ЭТОГО ТОНА:
${guide.rules}

ПРИМЕР ТРАНСФОРМАЦИИ:
${guide.example}

ВАЖНО:
- Сохрани ВСЮ ключевую информацию (даты, имена, задачи, вопросы)
- Измени ТОЛЬКО стиль подачи
- Длина может измениться, но не сильно (±30%)
- Сохрани структуру если есть списки/пункты

ФОРМАТ ОТВЕТА:
Пиши ТОЛЬКО переписанное сообщение. Без пояснений, без меток "Переписано:" и т.п.

ИСХОДНОЕ СООБЩЕНИЕ:
"${messageText}"

СООБЩЕНИЕ В НОВОМ ТОНЕ:`;
            return await this.provider.generateResponse(prompt);
        }

        async explainForManager(messageText) {
            if (!this.isConfigured()) {
                throw new Error('AI not configured');
            }

            const prompt = `Ты переводчик технической информации для менеджмента. Твоя задача - перевести техническое сообщение на простой деловой язык.

АУДИТОРИЯ:
- Менеджеры без технического бэкграунда
- Понимают бизнес-цели, но не технические детали
- Им важно: ЧТО происходит, ЗАЧЕМ, КОГДА, КАКИЕ РИСКИ

ПРАВИЛА ТРАНСФОРМАЦИИ:
1. УБЕРИ технический жаргон и замени на простые термины
2. СОХРАНИ бизнес-ценность, сроки, риски, приоритеты
3. ОБЪЯСНИ "зачем" и "какой эффект" вместо "как технически"
4. ИСПОЛЬЗУЙ аналогии из реальной жизни при необходимости
5. СТРУКТУРИРУЙ: сначала главное, потом детали
6. ДЛИНА: 2-4 предложения, без потери ключевой информации

ПРИМЕРЫ ТРАНСФОРМАЦИЙ:
Техническое → Простое:
- "Деплой упал из-за race condition в микросервисе"
  → "Обновление системы не прошло из-за конфликта данных. Исправляем, потребуется 2 часа"

- "Нужно рефакторить legacy код, технический долг критический"
  → "Старый код тормозит разработку новых функций. Нужна неделя на улучшение для ускорения будущих задач"

- "API rate limit на стороне провайдера"
  → "Внешний сервис ограничивает количество запросов. Это влияет на скорость работы для пользователей"

- "Настроил CI/CD pipeline с автотестами"
  → "Автоматизировал проверку и выпуск обновлений. Это сократит время релизов и снизит ошибки"

ЧТО СОХРАНИТЬ:
✓ Сроки и дедлайны
✓ Влияние на бизнес/пользователей
✓ Риски и проблемы
✓ Необходимые ресурсы
✓ Приоритет задачи

ЧТО УБРАТЬ:
✗ Названия технологий (если не критично)
✗ Технические детали реализации
✗ Архитектурные паттерны
✗ Специфичные термины (API, endpoint, deploy, и т.д.)

ФОРМАТ ОТВЕТА:
Пиши ТОЛЬКО упрощенное объяснение. Без преамбул типа "Это означает что..." или "Технически это значит...".
Сразу пиши результат трансформации.

ТЕХНИЧЕСКОЕ СООБЩЕНИЕ:
"${messageText}"

ОБЪЯСНЕНИЕ ДЛЯ МЕНЕДЖЕРА:`;
            return await this.provider.generateResponse(prompt);
        }

        async customPrompt(messageText, userPrompt) {
            if (!this.isConfigured()) {
                throw new Error('AI not configured');
            }

            const fullPrompt = `${userPrompt}\n\nСообщение: "${messageText}"`;
            return await this.provider.generateResponse(fullPrompt);
        }
    }

    window.VKTeamsAI = {
        AIManager: AIManager
    };

})();
