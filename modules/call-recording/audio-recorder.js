
(function() {
    'use strict';

    class AudioRecorder {
        constructor(options = {}) {
            this.options = {
                mimeType: options.mimeType || 'audio/webm;codecs=opus',
                audioBitsPerSecond: options.audioBitsPerSecond || 128000,
                timeslice: options.timeslice || 1000, // Collect chunks every 1 second
                ...options
            };

            this.recorder = null;
            this.stream = null;
            this.chunks = [];
            this.isRecording = false;
            this.startTime = null;
            this.eventHandlers = {
                'recordingStarted': [],
                'recordingStopped': [],
                'dataAvailable': [],
                'error': []
            };

            console.log('[VK Teams AudioRecorder] Initialized with options:', this.options);
        }

        async startRecording(stream, keepExistingChunks = false) {
            if (this.isRecording) {
                console.warn('[VK Teams AudioRecorder] Already recording');
                return false;
            }

            if (!stream) {
                console.error('[VK Teams AudioRecorder] No stream provided');
                this.emit('error', new Error('No stream provided'));
                return false;
            }

            if (!window.MediaRecorder) {
                console.error('[VK Teams AudioRecorder] MediaRecorder API not supported');
                this.emit('error', new Error('MediaRecorder API not supported'));
                return false;
            }

            try {
                this.stream = stream;
                console.log('[VK Teams AudioRecorder] 🎬 Inside startRecording(), keepExistingChunks:', keepExistingChunks);

                if (!keepExistingChunks) {
                    console.log('[VK Teams AudioRecorder]   Starting fresh recording (clearing chunks)');
                    this.chunks = [];
                    this.startTime = Date.now();
                    console.log('[VK Teams AudioRecorder]   Chunks cleared, startTime set to:', this.startTime);
                } else {
                    console.log('[VK Teams AudioRecorder]   ✓ KEEPING EXISTING CHUNKS!');
                    console.log('[VK Teams AudioRecorder]   Current chunks count:', this.chunks.length);
                    console.log('[VK Teams AudioRecorder]   Current chunks size:', this.chunks.reduce((sum, c) => sum + c.size, 0), 'bytes');
                    console.log('[VK Teams AudioRecorder]   Current startTime:', this.startTime);
                }
                if (!this.startTime) {
                    console.log('[VK Teams AudioRecorder]   No startTime, setting to now');
                    this.startTime = Date.now();
                }

                const audioTracks = stream.getAudioTracks();
                console.log('[VK Teams AudioRecorder] Audio tracks:', audioTracks.length);

                if (audioTracks.length === 0) {
                    throw new Error('No audio tracks in stream');
                }

                let hasValidTrack = false;
                audioTracks.forEach((track, index) => {
                    console.log(`[VK Teams AudioRecorder] Track ${index}:`, {
                        id: track.id,
                        kind: track.kind,
                        label: track.label,
                        enabled: track.enabled,
                        muted: track.muted,
                        readyState: track.readyState
                    });

                    if (track.readyState === 'live' && track.enabled) {
                        hasValidTrack = true;
                    }
                });

                if (!hasValidTrack) {
                    console.warn('[VK Teams AudioRecorder] No valid tracks for recording (all tracks are either not live or disabled)');
                }

                const mimeTypes = [
                    'audio/webm;codecs=opus',
                    'audio/webm',
                    'audio/ogg;codecs=opus',
                    'audio/mp4'
                ];

                let selectedMimeType = null;
                for (const mimeType of mimeTypes) {
                    if (MediaRecorder.isTypeSupported(mimeType)) {
                        selectedMimeType = mimeType;
                        console.log('[VK Teams AudioRecorder] Selected mime type:', mimeType);
                        break;
                    }
                }

                if (!selectedMimeType) {
                    throw new Error('No supported mime type found');
                }

                this.options.mimeType = selectedMimeType;

                console.log('[VK Teams AudioRecorder] Creating MediaRecorder...');

                let recordingStream = stream;

                try {
                    const clonedTracks = audioTracks.map(track => track.clone());
                    recordingStream = new MediaStream(clonedTracks);
                    console.log('[VK Teams AudioRecorder] Created new MediaStream from cloned tracks');
                } catch (cloneError) {
                    console.warn('[VK Teams AudioRecorder] Failed to clone tracks, using original stream:', cloneError);
                    recordingStream = stream;
                }

                try {
                    this.recorder = new MediaRecorder(recordingStream, {
                        mimeType: selectedMimeType,
                        audioBitsPerSecond: this.options.audioBitsPerSecond
                    });
                    console.log('[VK Teams AudioRecorder] MediaRecorder created with audioBitsPerSecond');
                } catch (error) {
                    console.warn('[VK Teams AudioRecorder] Failed with audioBitsPerSecond, trying without:', error);
                    try {
                        this.recorder = new MediaRecorder(recordingStream, {
                            mimeType: selectedMimeType
                        });
                        console.log('[VK Teams AudioRecorder] MediaRecorder created without audioBitsPerSecond');
                    } catch (error2) {
                        console.warn('[VK Teams AudioRecorder] Failed with mimeType, trying with defaults:', error2);
                        this.recorder = new MediaRecorder(recordingStream);
                        console.log('[VK Teams AudioRecorder] MediaRecorder created with default options');
                    }
                }

                this.recorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        this.chunks.push(event.data);
                        const totalSize = this.chunks.reduce((sum, c) => sum + c.size, 0);
                        console.log(`[VK Teams AudioRecorder] 📦 Chunk #${this.chunks.length} received: ${event.data.size} bytes (total: ${totalSize} bytes)`);
                        this.emit('dataAvailable', {
                            chunk: event.data,
                            totalChunks: this.chunks.length,
                            timestamp: Date.now() - this.startTime
                        });
                    } else {
                        console.warn('[VK Teams AudioRecorder] ⚠️ Empty chunk received!', {
                            hasData: !!event.data,
                            size: event.data?.size || 0
                        });
                    }
                };

                this.recorder.onstop = () => {
                    console.log('[VK Teams AudioRecorder] Recording stopped');
                    this.isRecording = false;
                };

                this.recorder.onerror = (error) => {
                    console.error('[VK Teams AudioRecorder] Recorder error:', error);
                    this.isRecording = false;
                    this.emit('error', error);
                };

                console.log('[VK Teams AudioRecorder] 🎙️ Starting recorder.start() with timeslice:', this.options.timeslice);
                this.recorder.start(this.options.timeslice);
                this.isRecording = true;
                console.log('[VK Teams AudioRecorder] ✓ recorder.start() called, isRecording set to true');

                console.log('[VK Teams AudioRecorder] ═══════════════════════════════════════════');
                console.log('[VK Teams AudioRecorder] ✅ RECORDING STARTED SUCCESSFULLY');
                console.log('[VK Teams AudioRecorder] ═══════════════════════════════════════════');
                console.log('[VK Teams AudioRecorder] 📋 Final state:');
                console.log('[VK Teams AudioRecorder]   mimeType:', this.options.mimeType);
                console.log('[VK Teams AudioRecorder]   audioBitsPerSecond:', this.options.audioBitsPerSecond);
                console.log('[VK Teams AudioRecorder]   timeslice:', this.options.timeslice);
                console.log('[VK Teams AudioRecorder]   startTime:', this.startTime);
                console.log('[VK Teams AudioRecorder]   chunks count:', this.chunks.length);
                console.log('[VK Teams AudioRecorder]   isRecording:', this.isRecording);
                console.log('[VK Teams AudioRecorder]   recorder state:', this.recorder.state);

                this.emit('recordingStarted', {
                    mimeType: this.options.mimeType,
                    audioBitsPerSecond: this.options.audioBitsPerSecond,
                    startTime: this.startTime
                });

                return true;
            } catch (error) {
                console.error('[VK Teams AudioRecorder] Failed to start recording:', error);
                this.isRecording = false;
                this.emit('error', error);
                return false;
            }
        }

        stopRecording() {
            if (!this.isRecording) {
                console.warn('[VK Teams AudioRecorder] Not recording');
                return null;
            }

            if (!this.recorder) {
                console.error('[VK Teams AudioRecorder] No recorder instance');
                return null;
            }

            try {
                this.recorder.stop();

                const blob = new Blob(this.chunks, {
                    type: this.options.mimeType
                });

                const duration = Date.now() - this.startTime;

                console.log(`[VK Teams AudioRecorder] Recording stopped. Duration: ${Math.round(duration / 1000)}s, Size: ${blob.size} bytes`);

                const recordingData = {
                    blob: blob,
                    mimeType: this.options.mimeType,
                    size: blob.size,
                    duration: duration,
                    chunks: this.chunks.length,
                    startTime: this.startTime,
                    endTime: Date.now()
                };

                this.emit('recordingStopped', recordingData);

                this.recorder = null;
                this.stream = null;
                this.isRecording = false;

                return recordingData;
            } catch (error) {
                console.error('[VK Teams AudioRecorder] Failed to stop recording:', error);
                this.emit('error', error);
                return null;
            }
        }

        async restartRecording(newStream) {
            console.log('[VK Teams AudioRecorder] ═══════════════════════════════════════════');
            console.log('[VK Teams AudioRecorder] ⚠️⚠️⚠️ RESTART RECORDING CALLED');
            console.log('[VK Teams AudioRecorder] ═══════════════════════════════════════════');

            if (!this.isRecording) {
                console.error('[VK Teams AudioRecorder] ❌ Not currently recording, cannot restart!');
                console.log('[VK Teams AudioRecorder]   isRecording:', this.isRecording);
                console.log('[VK Teams AudioRecorder]   recorder:', this.recorder);
                return false;
            }

            console.log('[VK Teams AudioRecorder] 📋 Current state BEFORE restart:');
            console.log('[VK Teams AudioRecorder]   isRecording:', this.isRecording);
            console.log('[VK Teams AudioRecorder]   chunks count:', this.chunks.length);
            console.log('[VK Teams AudioRecorder]   chunks total size:', this.chunks.reduce((sum, c) => sum + c.size, 0), 'bytes');
            console.log('[VK Teams AudioRecorder]   recorder state:', this.recorder?.state);
            console.log('[VK Teams AudioRecorder]   current stream:', this.stream?.id);
            console.log('[VK Teams AudioRecorder]   start time:', this.startTime);

            console.log('[VK Teams AudioRecorder] 📥 New stream info:');
            console.log('[VK Teams AudioRecorder]   stream ID:', newStream?.id);
            console.log('[VK Teams AudioRecorder]   active:', newStream?.active);
            console.log('[VK Teams AudioRecorder]   audio tracks:', newStream?.getAudioTracks().map(t => ({
                id: t.id,
                label: t.label,
                enabled: t.enabled,
                readyState: t.readyState
            })));

            try {
                if (this.recorder && this.recorder.state !== 'inactive') {
                    console.log('[VK Teams AudioRecorder] 🛑 Stopping current recorder...');
                    console.log('[VK Teams AudioRecorder]   Current recorder state:', this.recorder.state);
                    this.recorder.stop();
                    console.log('[VK Teams AudioRecorder]   Recorder.stop() called');

                    console.log('[VK Teams AudioRecorder]   Waiting 100ms for recorder to stop...');
                    await new Promise(resolve => setTimeout(resolve, 100));
                    console.log('[VK Teams AudioRecorder]   ✓ Wait completed');
                } else {
                    console.log('[VK Teams AudioRecorder]   Recorder already inactive or null');
                }

                console.log('[VK Teams AudioRecorder] 💾 Saving chunks before reset...');
                const savedChunks = [...this.chunks];
                const savedStartTime = this.startTime;
                console.log('[VK Teams AudioRecorder]   Saved', savedChunks.length, 'chunks');

                console.log('[VK Teams AudioRecorder] 🔄 Resetting state...');
                this.recorder = null;
                this.stream = null;
                this.isRecording = false;
                console.log('[VK Teams AudioRecorder]   State reset complete');

                console.log('[VK Teams AudioRecorder] 🚀 Starting new recorder with existing chunks...');
                console.log('[VK Teams AudioRecorder]   Calling startRecording(newStream, keepExistingChunks=true)');

                const success = await this.startRecording(newStream, true);

                console.log('[VK Teams AudioRecorder] 📊 startRecording() returned:', success);

                if (success) {
                    console.log('[VK Teams AudioRecorder] ═══════════════════════════════════════════');
                    console.log('[VK Teams AudioRecorder] ✅✅✅ RECORDING RESTARTED SUCCESSFULLY!');
                    console.log('[VK Teams AudioRecorder] ═══════════════════════════════════════════');
                    console.log('[VK Teams AudioRecorder] 📋 State AFTER restart:');
                    console.log('[VK Teams AudioRecorder]   isRecording:', this.isRecording);
                    console.log('[VK Teams AudioRecorder]   chunks count:', this.chunks.length);
                    console.log('[VK Teams AudioRecorder]   chunks total size:', this.chunks.reduce((sum, c) => sum + c.size, 0), 'bytes');
                    console.log('[VK Teams AudioRecorder]   recorder state:', this.recorder?.state);
                    console.log('[VK Teams AudioRecorder]   new stream:', this.stream?.id);
                } else {
                    console.error('[VK Teams AudioRecorder] ═══════════════════════════════════════════');
                    console.error('[VK Teams AudioRecorder] ❌❌❌ FAILED TO RESTART!');
                    console.error('[VK Teams AudioRecorder] ═══════════════════════════════════════════');
                    console.log('[VK Teams AudioRecorder] 🔄 Restoring saved chunks...');
                    this.chunks = savedChunks;
                    this.startTime = savedStartTime;
                    console.log('[VK Teams AudioRecorder]   Restored', this.chunks.length, 'chunks');
                }

                return success;
            } catch (error) {
                console.error('[VK Teams AudioRecorder] ═══════════════════════════════════════════');
                console.error('[VK Teams AudioRecorder] ❌❌❌ EXCEPTION IN RESTART!');
                console.error('[VK Teams AudioRecorder] ═══════════════════════════════════════════');
                console.error('[VK Teams AudioRecorder] Error:', error);
                console.error('[VK Teams AudioRecorder] Error stack:', error.stack);
                this.emit('error', error);
                return false;
            }
        }

        pauseRecording() {
            if (!this.isRecording || !this.recorder) {
                console.warn('[VK Teams AudioRecorder] Cannot pause - not recording');
                return false;
            }

            if (this.recorder.state === 'recording') {
                this.recorder.pause();
                console.log('[VK Teams AudioRecorder] Recording paused');
                return true;
            }

            return false;
        }

        resumeRecording() {
            if (!this.isRecording || !this.recorder) {
                console.warn('[VK Teams AudioRecorder] Cannot resume - not recording');
                return false;
            }

            if (this.recorder.state === 'paused') {
                this.recorder.resume();
                console.log('[VK Teams AudioRecorder] Recording resumed');
                return true;
            }

            return false;
        }

        getState() {
            if (!this.recorder) {
                return 'inactive';
            }
            return this.recorder.state;
        }

        getDuration() {
            if (!this.startTime) {
                return 0;
            }
            return Date.now() - this.startTime;
        }

        getTotalSize() {
            return this.chunks.reduce((total, chunk) => total + chunk.size, 0);
        }

        on(eventName, handler) {
            if (this.eventHandlers[eventName]) {
                this.eventHandlers[eventName].push(handler);
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
                this.eventHandlers[eventName].forEach(handler => {
                    try {
                        handler(data);
                    } catch (error) {
                        console.error(`[VK Teams AudioRecorder] Error in ${eventName} handler:`, error);
                    }
                });
            }
        }

        static isSupported() {
            return typeof MediaRecorder !== 'undefined';
        }

        static getSupportedMimeTypes() {
            const types = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4'
            ];

            return types.filter(type => MediaRecorder.isTypeSupported(type));
        }
    }

    window.VKTeamsCallRecording = window.VKTeamsCallRecording || {};
    window.VKTeamsCallRecording.AudioRecorder = AudioRecorder;

    console.log('[VK Teams AudioRecorder] Module loaded');
})();
