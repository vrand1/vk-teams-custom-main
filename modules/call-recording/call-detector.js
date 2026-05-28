
(function() {
    'use strict';

    class CallDetector {
        constructor(options = {}) {
            this.options = {
                autoAnswer: options.autoAnswer || false,
                checkInterval: options.checkInterval || 1000, // Check every 1 second
                ...options
            };

            this.currentCall = null;
            this.incomingCall = null;
            this.observer = null;
            this.checkIntervalId = null;
            this.localMicStream = null;
            this.eventHandlers = {
                'callStarted': [],
                'callEnded': [],
                'incomingCall': [],
                'callAnswered': [],
                'streamsUpdated': []
            };

            console.log('[VK Teams CallDetector] Initialized with options:', this.options);
        }

        start() {
            console.log('[VK Teams CallDetector] Starting call detection...');

            this.observer = new MutationObserver(() => {
                this.checkForIncomingCall();
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            this.checkIntervalId = setInterval(() => {
                this.checkForActiveCall();
            }, this.options.checkInterval);

            this.checkForIncomingCall();
            this.checkForActiveCall();

            console.log('[VK Teams CallDetector] Call detection started');
        }

        stop() {
            console.log('[VK Teams CallDetector] Stopping call detection...');

            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            if (this.checkIntervalId) {
                clearInterval(this.checkIntervalId);
                this.checkIntervalId = null;
            }

            this.releaseLocalMicrophone();

            console.log('[VK Teams CallDetector] Call detection stopped');
        }

        checkForIncomingCall() {
            const incomingDialog = document.querySelector('.im-box-incomingcall');

            if (incomingDialog && !this.incomingCall) {
                let callerName = null;
                const nameSelectors = [
                    '.im-box-incoming__title',
                    '.im-box-incoming__name',
                    '[class*="incoming"][class*="title"]',
                    '[class*="incoming"][class*="name"]'
                ];

                for (const selector of nameSelectors) {
                    const element = incomingDialog.querySelector(selector);
                    if (element && element.textContent) {
                        const validatedName = this.validateName(element.textContent);
                        if (validatedName) {
                            callerName = validatedName;
                            console.log(`[VK Teams CallDetector] Found caller name "${callerName}" using selector: ${selector}`);
                            break;
                        }
                    }
                }

                if (!callerName) {
                    const headings = incomingDialog.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="name"]');
                    for (const heading of headings) {
                        const validatedName = this.validateName(heading.textContent);
                        if (validatedName) {
                            callerName = validatedName;
                            console.log(`[VK Teams CallDetector] Found caller name "${callerName}" from heading/title element`);
                            break;
                        }
                    }
                }

                if (!callerName) {
                    callerName = 'Unknown';
                    console.log('[VK Teams CallDetector] Could not find valid caller name in incoming dialog, using "Unknown"');
                }

                this.incomingCall = {
                    callerName: callerName,
                    time: Date.now(),
                    dialog: incomingDialog,
                    answered: false
                };

                let audioButton = incomingDialog.querySelector('.im-voip-button_answer');
                let declineButton = incomingDialog.querySelector('.im-voip-button_hangup');

                if (!audioButton) {
                    audioButton = incomingDialog.querySelector('button[aria-label*="Ответить"]') ||
                                  incomingDialog.querySelector('button[aria-label*="Answer"]');

                    if (!audioButton) {
                        const buttons = incomingDialog.querySelectorAll('button');
                        for (const btn of buttons) {
                            const text = btn.textContent.toLowerCase();
                            if (text.includes('аудио') || text.includes('audio') || text.includes('ответить') || text.includes('answer')) {
                                audioButton = btn;
                                console.log('[VK Teams CallDetector] Audio button found by text content:', btn.textContent);
                                break;
                            }
                        }
                    }
                    if (audioButton) {
                        console.log('[VK Teams CallDetector] Audio button found with alternative selector:', audioButton.className, audioButton.textContent);
                    }
                }

                if (!declineButton) {
                    declineButton = incomingDialog.querySelector('button[aria-label*="Отклонить"]') ||
                                    incomingDialog.querySelector('button[aria-label*="Decline"]');

                    if (!declineButton) {
                        const buttons = incomingDialog.querySelectorAll('button');
                        for (const btn of buttons) {
                            const text = btn.textContent.toLowerCase();
                            if (text.includes('отклонить') || text.includes('decline') || text.includes('reject')) {
                                declineButton = btn;
                                console.log('[VK Teams CallDetector] Decline button found by text content:', btn.textContent);
                                break;
                            }
                        }
                    }
                    if (declineButton) {
                        console.log('[VK Teams CallDetector] Decline button found with alternative selector:', declineButton.className, declineButton.textContent);
                    }
                }

                this.incomingCall.buttons = {
                    answer: audioButton,
                    decline: declineButton
                };

                console.log('[VK Teams CallDetector] ★★★ Incoming call detected from:', callerName);
                console.log('[VK Teams CallDetector] Buttons found:', {
                    answer: !!audioButton,
                    decline: !!declineButton,
                    audioButtonClass: audioButton?.className,
                    declineButtonClass: declineButton?.className
                });
                console.log('[VK Teams CallDetector] Auto-answer enabled:', this.options.autoAnswer);

                this.emit('incomingCall', this.incomingCall);

                if (this.options.autoAnswer) {
                    console.log('[VK Teams CallDetector] Auto-answering call in 500ms...');
                    setTimeout(() => {
                        console.log('[VK Teams CallDetector] Attempting auto-answer now...');
                        const result = this.answerCall();
                        console.log('[VK Teams CallDetector] Auto-answer result:', result);
                    }, 500); // Small delay for UI stability
                } else {
                    console.log('[VK Teams CallDetector] Auto-answer is disabled');
                }
            } else if (!incomingDialog && this.incomingCall) {
                console.log('[VK Teams CallDetector] Incoming call dialog closed');
                this.incomingCall = null;
            }
        }

        async captureLocalMicrophone() {
            try {
                console.log('[VK Teams CallDetector] Requesting local microphone access...');
                this.localMicStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });

                const audioTracks = this.localMicStream.getAudioTracks();
                console.log('[VK Teams CallDetector] ✓ Local microphone captured:', {
                    id: this.localMicStream.id,
                    tracks: audioTracks.length,
                    trackDetails: audioTracks.map(t => ({
                        id: t.id,
                        label: t.label,
                        enabled: t.enabled,
                        readyState: t.readyState
                    }))
                });
                return true;
            } catch (error) {
                console.error('[VK Teams CallDetector] ✗ Failed to capture microphone:', error);
                console.error('[VK Teams CallDetector] Error details:', error.name, error.message);
                return false;
            }
        }

        releaseLocalMicrophone() {
            if (this.localMicStream) {
                console.log('[VK Teams CallDetector] Releasing local microphone...');
                this.localMicStream.getTracks().forEach(track => {
                    track.stop();
                    console.log('[VK Teams CallDetector] Stopped track:', track.label);
                });
                this.localMicStream = null;
                console.log('[VK Teams CallDetector] Local microphone released');
            }
        }

        isEmailAddress(text) {
            if (!text || typeof text !== 'string') return false;
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailPattern.test(text.trim());
        }

        validateName(name) {
            if (!name || typeof name !== 'string') return null;

            const trimmed = name.trim();

            if (this.isEmailAddress(trimmed)) {
                console.log('[VK Teams CallDetector] Rejected name (email):', trimmed);
                return null;
            }

            if (trimmed.length < 2) {
                console.log('[VK Teams CallDetector] Rejected name (too short):', trimmed);
                return null;
            }

            if (trimmed.length > 100) {
                console.log('[VK Teams CallDetector] Rejected name (too long):', trimmed.substring(0, 50) + '...');
                return null;
            }

            const excludedTexts = ['звонок', 'call', 'вызов', 'групповой', 'group', 'unknown', 'неизвестно'];
            if (excludedTexts.some(excluded => trimmed.toLowerCase().includes(excluded))) {
                console.log('[VK Teams CallDetector] Rejected name (UI label):', trimmed);
                return null;
            }

            console.log('[VK Teams CallDetector] Validated name:', trimmed);
            return trimmed;
        }

        extractCallerNameFromUI() {
            const selectors = [
                '.im-voip-call-header__title',
                '.im-voip-call-header__name',
                '.im-voip-call__title',
                '.im-voip-call__name',
                '[class*="voip"][class*="title"]',
                '[class*="voip"][class*="name"]',
                '[class*="call"][class*="header"]',
                '[class*="call"][class*="title"]'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent) {
                    const validatedName = this.validateName(element.textContent);
                    if (validatedName) {
                        console.log(`[VK Teams CallDetector] Found caller name "${validatedName}" using selector: ${selector}`);
                        return validatedName;
                    }
                }
            }

            const chatTitle = document.querySelector('.im-chat-header__title');
            if (chatTitle && chatTitle.textContent) {
                const validatedName = this.validateName(chatTitle.textContent);
                if (validatedName) {
                    console.log(`[VK Teams CallDetector] Found caller name from chat header: "${validatedName}"`);
                    return validatedName;
                }
            }

            console.log('[VK Teams CallDetector] Could not extract valid caller name from UI');
            return null;
        }

        async checkForActiveCall() {
            const audioElements = Array.from(document.querySelectorAll('audio, video'));
            const activeStreams = [];

            const shouldLog = audioElements.length > 0 || this.currentCall !== null;

            if (shouldLog) {
                console.log('[VK Teams CallDetector] ═══════════════════════════════════════════');
                console.log(`[VK Teams CallDetector] 🔍 CHECKING FOR ACTIVE CALL - Found ${audioElements.length} audio/video elements`);
                console.log('[VK Teams CallDetector] ═══════════════════════════════════════════');
            }

            if (shouldLog) {
                audioElements.forEach((element, index) => {
                    console.log(`[VK Teams CallDetector] 📺 Element #${index} (${element.tagName}):`, {
                        hasSrcObject: !!element.srcObject,
                        muted: element.muted,
                        volume: element.volume,
                        paused: element.paused,
                        id: element.id,
                        className: element.className,
                        src: element.src || 'none'
                    });
                });
            }

            audioElements.forEach((element, index) => {
                if (!element.srcObject) {
                    if (shouldLog) console.log(`[VK Teams CallDetector] ⊘ Element #${index}: No srcObject, skipping`);
                    return;
                }

                const stream = element.srcObject;
                const audioTracks = stream.getAudioTracks();
                const videoTracks = stream.getVideoTracks();

                if (shouldLog) {
                    console.log(`[VK Teams CallDetector] 🎵 Element #${index} - Stream details:`, {
                        streamId: stream.id,
                        streamActive: stream.active,
                        audioTracksCount: audioTracks.length,
                        videoTracksCount: videoTracks.length,
                        elementMuted: element.muted
                    });

                    if (audioTracks.length > 0) {
                        console.log(`[VK Teams CallDetector]   📋 Audio tracks for stream ${stream.id}:`);
                        audioTracks.forEach((track, trackIndex) => {
                            console.log(`[VK Teams CallDetector]     Track #${trackIndex}:`, {
                                id: track.id,
                                kind: track.kind,
                                label: track.label,
                                enabled: track.enabled,
                                muted: track.muted,
                                readyState: track.readyState,
                                settings: track.getSettings ? track.getSettings() : 'N/A'
                            });
                        });
                    } else {
                        console.log(`[VK Teams CallDetector]   ⚠️ Stream ${stream.id} has NO audio tracks!`);
                    }
                }

                const usableAudioTracks = audioTracks.filter(track => track.readyState === 'live');

                if (shouldLog) {
                    console.log(`[VK Teams CallDetector]   🔍 Filter result: ${usableAudioTracks.length} usable tracks (readyState=live)`);
                }

                const shouldInclude = stream.active || usableAudioTracks.length > 0;

                if (shouldInclude) {
                    const alreadyAdded = activeStreams.some(s => s.id === stream.id);
                    if (!alreadyAdded) {
                        activeStreams.push(stream);
                        if (shouldLog) {
                            console.log(`[VK Teams CallDetector]   ✅ Stream #${index} ADDED (ID: ${stream.id})`);
                            console.log(`[VK Teams CallDetector]      Reason: streamActive=${stream.active}, usableTrack=${usableAudioTracks.length}`);
                        }
                    } else {
                        if (shouldLog) console.log(`[VK Teams CallDetector]   ⚠️ Stream #${index} already in list, skipping duplicate`);
                    }
                } else {
                    if (shouldLog) {
                        console.log(`[VK Teams CallDetector]   ❌ Stream #${index} REJECTED (ID: ${stream.id})`);
                        console.log(`[VK Teams CallDetector]      Reason: streamActive=${stream.active}, usableTrack=${usableAudioTracks.length}`);
                    }
                }
            });

            if (shouldLog) {
                console.log('[VK Teams CallDetector] ───────────────────────────────────────────');
                console.log(`[VK Teams CallDetector] 📊 SUMMARY: Found ${activeStreams.length} active streams from ${audioElements.length} elements`);
                activeStreams.forEach((stream, i) => {
                    console.log(`[VK Teams CallDetector]   Stream #${i}: ${stream.id} (tracks: ${stream.getAudioTracks().length})`);
                });
                console.log('[VK Teams CallDetector] ═══════════════════════════════════════════');
            }

            if (activeStreams.length > 0) {
                if (!this.currentCall) {
                    console.log('[VK Teams CallDetector] New call detected, capturing local microphone...');
                    const micCaptured = await this.captureLocalMicrophone();

                    if (micCaptured && this.localMicStream) {
                        activeStreams.push(this.localMicStream);
                        console.log('[VK Teams CallDetector] ✓ Added local microphone to streams');
                        console.log('[VK Teams CallDetector] Total streams (remote + local):', activeStreams.length);
                    } else {
                        console.warn('[VK Teams CallDetector] ⚠️ Could not capture local microphone, recording will only have remote audio');
                    }

                    this.currentCall = {
                        startTime: Date.now(),
                        streams: activeStreams,
                        audioElements: audioElements.filter(el => el.srcObject)
                    };

                    let callerName = null;

                    if (this.incomingCall && this.incomingCall.callerName && this.incomingCall.callerName !== 'Unknown') {
                        callerName = this.incomingCall.callerName;
                        console.log('[VK Teams CallDetector] Using caller name from incoming call:', callerName);
                    }

                    if (!callerName || callerName === 'Unknown') {
                        const extractedName = this.extractCallerNameFromUI();
                        if (extractedName) {
                            callerName = extractedName;
                            console.log('[VK Teams CallDetector] Using caller name from UI:', callerName);
                        }
                    }

                    if (!callerName) {
                        callerName = 'Unknown';
                        console.log('[VK Teams CallDetector] Could not determine caller name, using "Unknown"');
                    }

                    this.currentCall.callerName = callerName;

                    console.log('[VK Teams CallDetector] ★★★ Active call started with', activeStreams.length, 'audio streams');
                    this.emit('callStarted', this.currentCall);
                } else {
                    const updatedStreams = [...activeStreams];
                    if (this.localMicStream) {
                        updatedStreams.push(this.localMicStream);
                    }

                    const oldStreamIds = this.currentCall.streams.map(s => s.id).sort().join(',');
                    const newStreamIds = updatedStreams.map(s => s.id).sort().join(',');
                    const streamsChanged = oldStreamIds !== newStreamIds;

                    if (streamsChanged) {
                        console.log('[VK Teams CallDetector] 🎤 Including local mic stream in update:', this.localMicStream?.id);
                        console.log('[VK Teams CallDetector] 🔍 Checking for stream changes...');
                        console.log('[VK Teams CallDetector]   Old stream IDs:', oldStreamIds);
                        console.log('[VK Teams CallDetector]   New stream IDs:', newStreamIds);
                        console.log('[VK Teams CallDetector]   Streams changed:', streamsChanged);
                    }

                    if (streamsChanged) {
                        console.log('[VK Teams CallDetector] ⚠️⚠️⚠️ STREAMS CHANGED DURING CALL!');
                        console.log('[VK Teams CallDetector]   Old streams:', this.currentCall.streams.map(s => ({
                            id: s.id,
                            tracks: s.getAudioTracks().map(t => ({
                                id: t.id,
                                label: t.label,
                                enabled: t.enabled,
                                readyState: t.readyState
                            }))
                        })));
                        console.log('[VK Teams CallDetector]   New streams:', updatedStreams.map(s => ({
                            id: s.id,
                            tracks: s.getAudioTracks().map(t => ({
                                id: t.id,
                                label: t.label,
                                enabled: t.enabled,
                                readyState: t.readyState
                            }))
                        })));

                        this.currentCall.streams = updatedStreams;

                        console.log('[VK Teams CallDetector] 📢 Emitting streamsUpdated event with', updatedStreams.length, 'streams');
                        this.emit('streamsUpdated', {
                            ...this.currentCall,
                            streams: updatedStreams
                        });
                        console.log('[VK Teams CallDetector] ✓ streamsUpdated event emitted');
                    }
                }
            } else if (this.currentCall) {
                console.log('[VK Teams CallDetector] Call ended (no active audio streams)');
                this.handleCallEnd();
            }
        }

        handleCallEnd() {
            if (!this.currentCall) return;

            const callDuration = Date.now() - this.currentCall.startTime;
            const callInfo = {
                ...this.currentCall,
                endTime: Date.now(),
                duration: callDuration
            };

            console.log(`[VK Teams CallDetector] Call duration: ${Math.round(callDuration / 1000)}s`);
            this.emit('callEnded', callInfo);

            this.releaseLocalMicrophone();

            this.currentCall = null;
        }

        answerCall() {
            if (!this.incomingCall) {
                console.warn('[VK Teams CallDetector] No incoming call to answer');
                return false;
            }

            if (this.incomingCall.answered) {
                console.warn('[VK Teams CallDetector] Call already answered');
                return false;
            }

            const answerButton = this.incomingCall.buttons.answer;
            if (answerButton) {
                answerButton.click();
                this.incomingCall.answered = true;
                console.log('[VK Teams CallDetector] Call answered');
                this.emit('callAnswered', this.incomingCall);
                return true;
            }

            console.error('[VK Teams CallDetector] Answer button not found');
            return false;
        }

        declineCall() {
            if (!this.incomingCall) {
                console.warn('[VK Teams CallDetector] No incoming call to decline');
                return false;
            }

            const declineButton = this.incomingCall.buttons.decline;
            if (declineButton) {
                declineButton.click();
                console.log('[VK Teams CallDetector] Call declined');
                this.incomingCall = null;
                return true;
            }

            console.error('[VK Teams CallDetector] Decline button not found');
            return false;
        }

        on(eventName, handler) {
            if (this.eventHandlers[eventName]) {
                this.eventHandlers[eventName].push(handler);
                console.log(`[VK Teams CallDetector] Handler registered for '${eventName}' event (total: ${this.eventHandlers[eventName].length})`);
            } else {
                console.error(`[VK Teams CallDetector] Cannot register handler for '${eventName}' - event not in eventHandlers list!`);
            }
        }

        off(eventName, handler) {
            if (this.eventHandlers[eventName]) {
                const index = this.eventHandlers[eventName].indexOf(handler);
                if (index > -1) {
                    this.eventHandlers[eventName].splice(index, 1);
                }
            }
        }

        emit(eventName, data) {
            if (this.eventHandlers[eventName]) {
                const handlerCount = this.eventHandlers[eventName].length;
                if (handlerCount === 0) {
                    console.warn(`[VK Teams CallDetector] Event '${eventName}' emitted but no handlers registered`);
                }
                this.eventHandlers[eventName].forEach(handler => {
                    try {
                        handler(data);
                    } catch (error) {
                        console.error(`[VK Teams CallDetector] Error in ${eventName} handler:`, error);
                    }
                });
            } else {
                console.error(`[VK Teams CallDetector] Event '${eventName}' emitted but not in eventHandlers list!`);
            }
        }

        isCallActive() {
            return this.currentCall !== null;
        }

        hasIncomingCall() {
            return this.incomingCall !== null;
        }

        getCurrentCall() {
            return this.currentCall;
        }

        getIncomingCall() {
            return this.incomingCall;
        }
    }

    window.VKTeamsCallRecording = window.VKTeamsCallRecording || {};
    window.VKTeamsCallRecording.CallDetector = CallDetector;

    console.log('[VK Teams CallDetector] Module loaded');
})();
