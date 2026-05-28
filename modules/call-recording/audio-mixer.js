
(function() {
    'use strict';

    class AudioMixer {
        constructor() {
            this.audioContext = null;
            this.destination = null;
            this.sources = [];
            console.log('[VK Teams AudioMixer] Initialized');
        }

        mixStreams(streams) {
            if (!streams || streams.length === 0) {
                console.error('[VK Teams AudioMixer] No streams provided');
                return null;
            }

            if (streams.length === 1) {
                console.log('[VK Teams AudioMixer] ⚠️ Only 1 stream provided, returning without mixing');
                return streams[0];
            }

            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                console.log('[VK Teams AudioMixer] AudioContext created:', {
                    sampleRate: this.audioContext.sampleRate,
                    state: this.audioContext.state,
                    baseLatency: this.audioContext.baseLatency,
                    outputLatency: this.audioContext.outputLatency
                });

                if (this.audioContext.state === 'suspended') {
                    console.log('[VK Teams AudioMixer] AudioContext is suspended, attempting to resume...');
                    this.audioContext.resume().then(() => {
                        console.log('[VK Teams AudioMixer] AudioContext resumed successfully, state:', this.audioContext.state);
                    }).catch(err => {
                        console.error('[VK Teams AudioMixer] Failed to resume AudioContext:', err);
                    });
                }

                this.destination = this.audioContext.createMediaStreamDestination();

                console.log('[VK Teams AudioMixer] ★★★ Starting to mix', streams.length, 'streams');

                let totalTracksConnected = 0;

                streams.forEach((stream, index) => {
                    if (!stream) {
                        console.warn(`[VK Teams AudioMixer] Stream ${index} is null or undefined`);
                        return;
                    }

                    const audioTracks = stream.getAudioTracks();
                    console.log(`[VK Teams AudioMixer] Stream ${index}:`, {
                        id: stream.id,
                        active: stream.active,
                        audioTracks: audioTracks.length,
                        videoTracks: stream.getVideoTracks().length
                    });

                    audioTracks.forEach((track, trackIndex) => {
                        try {
                            console.log(`[VK Teams AudioMixer]   Processing track ${trackIndex}:`, {
                                id: track.id,
                                kind: track.kind,
                                label: track.label,
                                enabled: track.enabled,
                                muted: track.muted,
                                readyState: track.readyState,
                                settings: track.getSettings ? track.getSettings() : 'N/A'
                            });

                            if (track.readyState !== 'live') {
                                console.warn(`[VK Teams AudioMixer]   ⚠️ Track ${trackIndex} is not live (state: ${track.readyState}), skipping`);
                                return;
                            }

                            if (!track.enabled) {
                                console.warn(`[VK Teams AudioMixer]   ⚠️ Track ${trackIndex} is disabled, skipping`);
                                return;
                            }

                            const tempStream = new MediaStream([track]);
                            console.log(`[VK Teams AudioMixer]   Created temp stream:`, tempStream.id);

                            const source = this.audioContext.createMediaStreamSource(tempStream);
                            console.log(`[VK Teams AudioMixer]   Created audio source from temp stream`);

                            source.connect(this.destination);
                            console.log(`[VK Teams AudioMixer]   ✓ Connected track ${trackIndex} from stream ${index} to destination`);

                            this.sources.push(source);
                            totalTracksConnected++;
                        } catch (error) {
                            console.error(`[VK Teams AudioMixer]   ✗ Failed to connect track ${trackIndex}:`, error);
                            console.error(`[VK Teams AudioMixer]   Error stack:`, error.stack);
                        }
                    });
                });

                const mixedStream = this.destination.stream;
                const mixedTracks = mixedStream.getAudioTracks();

                console.log('[VK Teams AudioMixer] ═══════════════════════════════════════════');
                console.log('[VK Teams AudioMixer] ★★★ MIXING COMPLETE');
                console.log('[VK Teams AudioMixer] ═══════════════════════════════════════════');
                console.log('[VK Teams AudioMixer] 📊 Summary:', {
                    inputStreams: streams.length,
                    tracksConnected: totalTracksConnected,
                    outputStreamId: mixedStream.id,
                    outputStreamActive: mixedStream.active,
                    outputTracksCount: mixedTracks.length
                });
                console.log('[VK Teams AudioMixer] 📋 Output track details:');
                mixedTracks.forEach((track, i) => {
                    console.log(`[VK Teams AudioMixer]   Track ${i}:`, {
                        id: track.id,
                        label: track.label,
                        enabled: track.enabled,
                        readyState: track.readyState,
                        muted: track.muted
                    });
                });

                if (mixedTracks.length === 0 || totalTracksConnected === 0) {
                    console.error('[VK Teams AudioMixer] ═══════════════════════════════════════════');
                    console.error('[VK Teams AudioMixer] ❌❌❌ MIXING FAILED!');
                    console.error('[VK Teams AudioMixer] ═══════════════════════════════════════════');
                    console.error('[VK Teams AudioMixer] Reason: Mixed stream has NO audio tracks or no tracks connected!');
                    console.error('[VK Teams AudioMixer]   mixedTracks.length:', mixedTracks.length);
                    console.error('[VK Teams AudioMixer]   totalTracksConnected:', totalTracksConnected);
                    console.error('[VK Teams AudioMixer] Cleaning up and returning null to trigger fallback');
                    this.cleanup();
                    return null;
                }

                console.log('[VK Teams AudioMixer] ✅ Returning mixed stream:', mixedStream.id);
                return mixedStream;
            } catch (error) {
                console.error('[VK Teams AudioMixer] ✗ Failed to mix streams:', error);
                console.error('[VK Teams AudioMixer] Error stack:', error.stack);
                return null;
            }
        }

        cleanup() {
            console.log('[VK Teams AudioMixer] Cleaning up');

            this.sources.forEach(source => {
                try {
                    source.disconnect();
                } catch (e) {
                }
            });
            this.sources = [];

            if (this.audioContext) {
                try {
                    this.audioContext.close();
                } catch (e) {
                }
                this.audioContext = null;
            }

            this.destination = null;
        }
    }

    window.VKTeamsCallRecording = window.VKTeamsCallRecording || {};
    window.VKTeamsCallRecording.AudioMixer = AudioMixer;

    console.log('[VK Teams AudioMixer] Module loaded');
})();
