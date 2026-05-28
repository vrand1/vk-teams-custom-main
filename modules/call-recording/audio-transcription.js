
(function() {
    'use strict';

    class AudioTranscription {
        constructor() {
            this.apiEndpoint = null;
            this.apiKey = null;
            this.model = 'whisper-1'; // Default Whisper model (OpenAI compatible)
            console.log('[VK Teams AudioTranscription] Initialized');
        }

        async init() {
            if (!chrome.runtime?.id) {
                console.warn('[VK Teams AudioTranscription] Extension context invalidated during init - transcription unavailable');
                return;
            }

            return new Promise((resolve) => {
                chrome.storage.sync.get(['aiConfig'], (result) => {
                    if (result.aiConfig && result.aiConfig.provider === 'custom') {
                        this.apiKey = result.aiConfig.apiKey;

                        const baseUrl = result.aiConfig.endpoint;
                        if (baseUrl.includes('/chat/completions')) {
                            this.apiEndpoint = baseUrl.replace('/chat/completions', '/audio/transcriptions');
                        } else if (baseUrl.includes('/v1/')) {
                            this.apiEndpoint = baseUrl.replace(/\/v1\/[^/]*$/, '/v1/audio/transcriptions');
                        } else {
                            this.apiEndpoint = baseUrl.replace(/\/$/, '') + '/v1/audio/transcriptions';
                        }

                        console.log('[VK Teams AudioTranscription] Configured:', {
                            endpoint: this.apiEndpoint,
                            hasApiKey: !!this.apiKey
                        });
                    } else {
                        console.warn('[VK Teams AudioTranscription] No custom AI config found');
                    }
                    resolve();
                });
            });
        }

        isAvailable() {
            return !!(this.apiEndpoint && this.apiKey);
        }

        async transcribe(audioBlob, options = {}) {
            if (!this.isAvailable()) {
                throw new Error('Transcription service not configured. Please set up Custom API in extension settings.');
            }

            console.log('[VK Teams AudioTranscription] Starting transcription...', {
                blobSize: audioBlob.size,
                blobType: audioBlob.type
            });

            try {
                const result = await this.sendToBackgroundScript(audioBlob, options);

                console.log('[VK Teams AudioTranscription] Transcription completed:', {
                    textLength: result.text?.length || 0
                });

                return result;
            } catch (error) {
                console.error('[VK Teams AudioTranscription] Transcription failed:', error);
                throw error;
            }
        }

        async sendToBackgroundScript(audioBlob, options) {
            if (!chrome.runtime?.id) {
                const error = new Error('Расширение было перезагружено. Обновите страницу VK Teams (F5) чтобы продолжить работу с записями и расшифровками.');
                console.error('[VK Teams AudioTranscription] Extension context invalidated - page reload required');
                throw error;
            }

            console.log('[VK Teams AudioTranscription] ★★★ Converting blob to base64:', {
                blobSize: audioBlob.size,
                blobType: audioBlob.type,
                timestamp: new Date().toISOString()
            });

            const base64Audio = await this.blobToBase64(audioBlob);

            console.log('[VK Teams AudioTranscription] ★★★ Sending to background script:', {
                base64Length: base64Audio.length,
                blobSize: audioBlob.size,
                endpoint: this.apiEndpoint,
                model: options.model || this.model,
                timestamp: new Date().toISOString()
            });

            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'audioTranscription',
                    endpoint: this.apiEndpoint,
                    apiKey: this.apiKey,
                    model: options.model || this.model,
                    audioData: base64Audio,
                    audioType: audioBlob.type,
                    language: options.language || 'ru',
                    prompt: options.prompt || null,
                    responseFormat: options.responseFormat || 'json'
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (!response) {
                        reject(new Error('No response from background script'));
                    } else if (response.success) {
                        console.log('[VK Teams AudioTranscription] ★★★ Got transcription result:', {
                            textLength: response.result.text?.length || 0,
                            textPreview: response.result.text?.substring(0, 100) + '...',
                            timestamp: new Date().toISOString()
                        });
                        resolve(response.result);
                    } else {
                        reject(new Error(response.error));
                    }
                });
            });
        }

        async blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = reader.result.split(',')[1];
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        async transcribeAndSave(recordingId, audioBlob) {
            try {
                console.log('[VK Teams AudioTranscription] Transcribing recording:', recordingId);

                const transcription = await this.transcribe(audioBlob, {
                    language: 'ru',
                    responseFormat: 'json'
                });


                return transcription;
            } catch (error) {
                console.error('[VK Teams AudioTranscription] Failed to transcribe recording:', error);
                return null;
            }
        }
    }

    window.VKTeamsCallRecording = window.VKTeamsCallRecording || {};
    window.VKTeamsCallRecording.AudioTranscription = AudioTranscription;

    console.log('[VK Teams AudioTranscription] Module loaded');
})();
