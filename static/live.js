document.addEventListener('DOMContentLoaded', () => {
    // --- Global DOM Elements ---
    const liveGrid = document.getElementById('live-grid');
    const viewLiveBtn = document.getElementById('view-live-btn');
    const viewLiveModal = document.getElementById('view-live-modal');
    const viewModalCancelBtn = document.getElementById('view-modal-cancel-btn');
    const viewModalConfirmBtn = document.getElementById('view-modal-confirm-btn');
    const viewModalRecId = document.getElementById('view-modal-rec-id');
    const viewModalQuality = document.getElementById('view-modal-quality');
    const addLiveBtn = document.getElementById('add-live-btn');
    const addLiveModal = document.getElementById('add-live-modal');
    const modalRecId = document.getElementById('modal-rec-id');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalStartBtn = document.getElementById('modal-start-btn');
    const modalHqUrl = document.getElementById('modal-hq-url');
    const modalSqUrl = document.getElementById('modal-sq-url');
    const modalMode = document.getElementById('modal-mode');
    const modalCodec = document.getElementById('modal-codec');
    const modalRetention = document.getElementById('modal-retention');
    const modalHqStorage = document.getElementById('modal-hq-storage');
    const modalSqStorage = document.getElementById('modal-sq-storage');
    const modalAuth = document.getElementById('modal-auth');
    const modalNotes = document.getElementById('modal-notes');
    const recordingsTbody = document.getElementById('recordings-tbody');
    const refreshRecordingsButton = document.getElementById('refresh-recordings');
    const floatingPanel = document.getElementById('floating-recording-list');
    const floatingHeader = document.getElementById('floating-header');
    const toggleFloatingBtn = document.getElementById('toggle-floating');

    // --- Global State ---
    let activeStreams = []; // This will hold LiveStream instances

    // --- LiveStream Class Definition ---
    class LiveStream {
        constructor(recId, quality) {
            this.recId = recId;
            this.quality = quality;
            this.uniqueId = `${recId}-${quality}-${Date.now()}`;
            this.targetId = `${recId}-${quality}`;

            // Sync and state variables
            this.ptsOffset = null;
            this.metadataQueue = [];
            this.lastDrawnData = null;
            this.lastDrawnTime = 0;
            this.animationFrameId = null;
            this.player = null;
            this.element = null;

            this._setupDOM();
            this._setupPlayer();
            this.renderLoop();
        }

        _setupDOM() {
            const cell = document.createElement('div');
            cell.className = 'live-cell';
            cell.style.position = 'relative';
            cell.id = `cell-${this.uniqueId}`;
            this.element = cell;

            const video = document.createElement('video');
            video.controls = true;
            video.autoplay = true;
            video.muted = true;
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'contain';
            video.addEventListener('play', () => this._jumpToLiveEdge());
            this.video = video;
            cell.appendChild(video);

            const canvas = document.createElement('canvas');
            canvas.className = 'live-cell-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '10';
            this.canvas = canvas;
            cell.appendChild(canvas);

            const overlay = document.createElement('div');
            overlay.className = 'live-cell-overlay';
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn-danger btn-sm';
            removeBtn.textContent = 'Close View';
            removeBtn.onclick = () => removeStream(this.uniqueId);
            overlay.appendChild(removeBtn);
            cell.appendChild(overlay);

            const info = document.createElement('div');
            info.className = 'live-info';
            info.textContent = `${this.recId} [${this.quality.toUpperCase()}]`;
            cell.appendChild(info);

            liveGrid.appendChild(cell);
        }

        _setupPlayer() {
            if (!mpegts.getFeatureList().mseLivePlayback) {
                alert('Your browser does not support MSE Live Playback (mpegts.js).');
                return;
            }

            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            // Change format from /recording/{id}-{quality}/live to /recording/{id}/{quality}
            const wsUrl = `${wsProtocol}//${window.location.hostname}:18071/recording/${this.recId}/${this.quality}`;
            console.log(`Connecting to MPEG-TS Stream: ${wsUrl}`);

            this.player = mpegts.createPlayer({
                type: 'mpegts',
                isLive: true,
                url: wsUrl
            }, {
                enableStashBuffer: false,
                liveBufferLatencyChasing: true,
                liveBufferLatencyMaxLatency: 1.5,
                liveBufferLatencyMinRemain: 0.3
            });

            this.player.attachMediaElement(this.video);
            this.player.load();
            this.player.play();

            this.player.on(mpegts.Events.ERROR, this._handlePlayerError.bind(this));
            this.player.on(mpegts.Events.TIMED_ID3_METADATA_ARRIVED, this._handleMetadata.bind(this));
        }

        _handlePlayerError(type, details, data) {
            console.error(`MPEG-TS Error (${this.targetId}):`, type, details, data);
            if (type === mpegts.ErrorTypes.MEDIA_ERROR || type === mpegts.ErrorTypes.NETWORK_ERROR) {
                console.log(`[Auto-Recover] Reloading stream ${this.targetId}...`);
                try {
                    this.player.unload();
                    this.player.detachMediaElement();
                    this.player.attachMediaElement(this.video);
                    this.player.load();
                    this.player.play();
                } catch (e) {
                    console.error("Recovery failed:", e);
                }
            }
        }

        _handleMetadata(data) {
            if (this.video.paused || this.video.ended) return;
            try {
                const textDecoder = new TextDecoder('utf-8');
                const jsonStr = textDecoder.decode(data.data).trim();
                if (!jsonStr.startsWith('{') && !jsonStr.startsWith('[')) return;
                
                const metadata = JSON.parse(jsonStr);
                if (metadata.pts !== undefined) {
                    this.metadataQueue.push({ pts: metadata.pts, data: metadata });
                    if (this.metadataQueue.length > 200) this.metadataQueue.shift();
                }
            } catch (e) {
                console.warn('Failed to parse ID3 metadata:', e);
            }
        }

        _jumpToLiveEdge() {
            if (this.video.buffered.length > 0) {
                const end = this.video.buffered.end(this.video.buffered.length - 1);
                const latency = end - this.video.currentTime;
                if (latency > 0.5) {
                    console.log(`Jumping to live edge. Latency: ${latency.toFixed(2)}s`);
                    this.video.currentTime = end - 0.1;
                }
            }
        }
        
        renderLoop() {
            if (!this.video || this.video.paused || this.video.ended) {
                this.animationFrameId = requestAnimationFrame(() => this.renderLoop());
                return;
            }

            const currentTime = this.video.currentTime;

            if (this.metadataQueue.length > 0 && currentTime > 0) {
                const latestMeta = this.metadataQueue[this.metadataQueue.length - 1];
                const newOffset = latestMeta.pts - currentTime;
                if (this.ptsOffset === null) {
                    this.ptsOffset = newOffset;
                    console.log(`[Sync] Initialized PTS Offset for ${this.recId}: ${this.ptsOffset.toFixed(3)}`);
                } else {
                    const smoothingFactor = 0.99;
                    this.ptsOffset = (this.ptsOffset * smoothingFactor) + (newOffset * (1 - smoothingFactor));
                }
            }
            
            if (this.ptsOffset !== null) {
                const targetPts = currentTime + this.ptsOffset;
                let dataToDraw = null;

                for (let i = this.metadataQueue.length - 1; i >= 0; i--) {
                    if (this.metadataQueue[i].pts <= targetPts) {
                        dataToDraw = this.metadataQueue[i].data;
                        break;
                    }
                }

                const HOLD_DURATION = 0.5;
                if (dataToDraw) {
                    const hasObjects = (dataToDraw.objects && dataToDraw.objects.length > 0);
                    if (hasObjects) {
                        this.lastDrawnData = dataToDraw;
                        this.lastDrawnTime = currentTime;
                    } else if (this.lastDrawnData && (currentTime - this.lastDrawnTime > HOLD_DURATION)) {
                        this.lastDrawnData = null;
                    }
                } else if (this.lastDrawnData && (currentTime - this.lastDrawnTime > HOLD_DURATION)) {
                    this.lastDrawnData = null;
                }

                const ctx = this.canvas.getContext('2d');
                const vWidth = this.video.videoWidth;
                const vHeight = this.video.videoHeight;
                
                if (vWidth > 0 && vHeight > 0) {
                    if (this.canvas.width !== vWidth || this.canvas.height !== vHeight) {
                        this.canvas.width = vWidth;
                        this.canvas.height = vHeight;
                    }
                    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

                    if (this.lastDrawnData) {
                        const hasObjects = this.lastDrawnData.objects && Array.isArray(this.lastDrawnData.objects) && this.lastDrawnData.objects.length > 0;
                        if (hasObjects) {
                            ctx.strokeStyle = 'red';
                            ctx.lineWidth = 2;
                            const sourceWidth = 3840;
                            const sourceHeight = 2160;
                            const scaleX = vWidth / sourceWidth;
                            const scaleY = vHeight / sourceHeight;
                            this.lastDrawnData.objects.forEach(obj => {
                                if (obj.bbox && Array.isArray(obj.bbox)) {
                                    const [left, top, right, bottom] = obj.bbox;
                                    ctx.strokeRect(left * scaleX, top * scaleY, (right - left) * scaleX, (bottom - top) * scaleY);
                                }
                            });
                        }
                    }
                }
                
                const bufferToKeep = 10;
                while (this.metadataQueue.length > 0 && this.metadataQueue[0].pts < targetPts - bufferToKeep) {
                    this.metadataQueue.shift();
                }
            }

            this.animationFrameId = requestAnimationFrame(() => this.renderLoop());
        }

        resetSync() {
            console.log(`[Sync] Resetting sync state for ${this.recId}`);
            this.ptsOffset = null;
            this.metadataQueue.length = 0;
            if (this.player) {
                this._jumpToLiveEdge();
                this.player.play();
            }
        }

        destroy() {
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
            }
            if (this.player) {
                this.player.destroy();
            }
            if (this.element) {
                this.element.remove();
            }
        }
    }

    // --- Main Functions ---
    const addStreamToGrid = (recId, quality = 'hq') => {
        if (activeStreams.some(s => s.recId === recId && s.quality === quality)) {
            alert(`Already viewing ${recId} (${quality.toUpperCase()})`);
            return;
        }
        if (activeStreams.length >= 9) {
            alert("Maximum 9 live streams allowed.");
            return;
        }
        const emptyState = liveGrid.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const stream = new LiveStream(recId, quality);
        activeStreams.push(stream);
        updateGridLayout();
    };

    const removeStream = (uniqueId) => {
        const streamIndex = activeStreams.findIndex(s => s.uniqueId === uniqueId);
        if (streamIndex === -1) return;

        activeStreams[streamIndex].destroy();
        activeStreams.splice(streamIndex, 1);
        
        updateGridLayout();

        if (activeStreams.length === 0) {
            liveGrid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1; grid-row: 1/-1; display: flex; align-items: center; justify-content: center; color: #555;">No active live streams. Click "+ View Live Stream" to watch.</div>`;
        }
    };
    
    // --- Layout and UI Logic (mostly unchanged) ---
    const updateGridLayout = () => {
        const count = activeStreams.length;
        if (count === 0) {
            liveGrid.style.display = 'flex';
            liveGrid.style.gridTemplateColumns = 'none';
            liveGrid.style.gridTemplateRows = 'none';
            const emptyState = liveGrid.querySelector('.empty-state');
            if (emptyState) emptyState.style.display = 'flex';
            return;
        }

        const emptyState = liveGrid.querySelector('.empty-state');
        if (emptyState) emptyState.style.display = 'none';

        liveGrid.style.display = 'grid';
        const aspectRatio = 16 / 9;
        let bestLayout = { cols: 1, rows: 1, area: 0 };
        for (let cols = 1; cols <= count; cols++) {
            const rows = Math.ceil(count / cols);
            const cellWidth = liveGrid.clientWidth / cols;
            const cellHeight = liveGrid.clientHeight / rows;
            const area = (cellWidth / aspectRatio > cellHeight) ? (cellHeight * aspectRatio * cellHeight) : (cellWidth * (cellWidth/aspectRatio));
            if (area > bestLayout.area) bestLayout = { cols, rows, area };
        }
        liveGrid.style.gridTemplateColumns = `repeat(${bestLayout.cols}, 1fr)`;
        liveGrid.style.gridTemplateRows = `repeat(${bestLayout.rows}, 1fr)`;
    };
    
    const fetchRecordings = async () => {
        try {
            const response = await fetch('/api/recordings');
            const recordings = await response.json();
            renderRecordingsTable(recordings);
        } catch (error) {
            console.error('Error fetching recordings:', error);
        }
    };

    const renderRecordingsTable = (recordings) => {
        if (!recordingsTbody) return;
        recordingsTbody.innerHTML = '';
        if (recordings.length === 0) {
            recordingsTbody.innerHTML = '<tr><td colspan="3" class="empty-state">No recordings found.</td></tr>';
            return;
        }
        recordings.forEach(rec => {
            const row = document.createElement('tr');
            let badgeClass = 'badge-stopped';
            if (rec.state === 'RUNNING') badgeClass = 'badge-running';
            else if (rec.state === 'ERROR') badgeClass = 'badge-error';
            row.innerHTML = `<td><span class="mono" title="${rec.recording_id}">${rec.recording_id}</span></td><td><span class="badge ${badgeClass}">${rec.state}</span></td><td><button class="btn-sm btn-secondary use-id-btn" data-id="${rec.recording_id}">Use</button></td>`;
            recordingsTbody.appendChild(row);
        });
        document.querySelectorAll('.use-id-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                viewModalRecId.value = e.target.dataset.id;
                if (viewLiveModal.style.display !== 'flex') {
                    viewLiveModal.style.display = 'flex';
                }
            });
        });
    };

    // --- Event Listeners ---
    addLiveBtn.addEventListener('click', () => {
        addLiveModal.style.display = 'flex';
        modalRecId.value = `SN-${Date.now()}`;
    });
    modalCancelBtn.addEventListener('click', () => addLiveModal.style.display = 'none');
    modalStartBtn.addEventListener('click', async () => {
        const serialNumber = modalRecId.value.trim() || `SN-${Date.now()}`;
        if (!modalHqUrl.value.trim() || !modalSqUrl.value.trim()) {
            return alert("HQ and SQ URLs are required.");
        }
        modalStartBtn.disabled = true;
        modalStartBtn.innerHTML = 'Starting...';
        try {
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serial_number: serialNumber,
                    hq_url: modalHqUrl.value.trim(),
                    sq_url: modalSqUrl.value.trim(),
                    recording_mode: modalMode.value,
                    encoding_codec: modalCodec.value,
                    retention_days: parseInt(modalRetention.value) || 7,
                    hq_storage_limit: parseInt(modalHqStorage.value) || 0,
                    sq_storage_limit: parseInt(modalSqStorage.value) || 0,
                    auth_token: modalAuth.value.trim() || null,
                    notes: modalNotes.value.trim() || null
                })
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.details || err.error || `HTTP ${response.status}`);
            }
            addLiveModal.style.display = 'none';
            fetchRecordings();
            alert(`Recording started successfully!\nID: ${(await response.json()).recording_id || serialNumber}`);
        } catch (error) {
            console.error('Error starting recording:', error);
            alert('Failed to start recording:\n' + error.message);
        } finally {
            modalStartBtn.disabled = false;
            modalStartBtn.innerHTML = 'Start Recording';
        }
    });

    viewLiveBtn.addEventListener('click', () => {
        if (activeStreams.length >= 9) return alert("Maximum 9 live streams allowed.");
        viewLiveModal.style.display = 'flex';
        viewModalRecId.value = '';
    });
    viewModalCancelBtn.addEventListener('click', () => viewLiveModal.style.display = 'none');
    viewModalConfirmBtn.addEventListener('click', () => {
        const recId = viewModalRecId.value.trim();
        if (!recId) return alert("Recording ID is required.");
        addStreamToGrid(recId, viewModalQuality.value);
        viewLiveModal.style.display = 'none';
    });
    
    new ResizeObserver(updateGridLayout).observe(liveGrid);
    if (floatingHeader) floatingHeader.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        floatingPanel.classList.toggle('minimized');
        toggleFloatingBtn.textContent = floatingPanel.classList.contains('minimized') ? '□' : '_';
    });
    if (toggleFloatingBtn) toggleFloatingBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        floatingPanel.classList.toggle('minimized');
        toggleFloatingBtn.textContent = floatingPanel.classList.contains('minimized') ? '□' : '_';
    });
    if (refreshRecordingsButton) refreshRecordingsButton.addEventListener('click', fetchRecordings);

    // Visibility handler for robust sync
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log("Tab is visible, resetting sync state for all streams.");
            activeStreams.forEach(stream => stream.resetSync());
        }
    });

    // Initial Fetch
    fetchRecordings();
    updateGridLayout();
});