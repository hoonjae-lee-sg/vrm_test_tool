document.addEventListener('DOMContentLoaded', () => {
    const cameraGrid = document.getElementById('camera-grid');
    const totalCount = document.getElementById('total-count');
    const runningCount = document.getElementById('running-count');
    const errorCount = document.getElementById('error-count');

    const fetchStatus = async () => {
        try {
            const response = await fetch('/api/recordings');
            const data = await response.json();
            renderDashboard(data);
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        }
    };

    const players = {}; // Map<recording_id, mpegts.Player>

    const renderDashboard = (recordings) => {
        if (recordings.length === 0) {
            cameraGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1; padding: 60px;">
                    <div class="empty-state-icon">📹</div>
                    <div>No cameras registered.</div>
                    <div style="font-size: 12px; margin-top: 8px; color: var(--text-muted);">Start a recording in the Tester tab.</div>
                </div>`;
            totalCount.textContent = '0';
            runningCount.textContent = '0';
            errorCount.textContent = '0';
            
            // Cleanup all players
            Object.keys(players).forEach(id => {
                if (players[id]) {
                    players[id].destroy();
                    delete players[id];
                }
            });
            return;
        }

        // 1. Mark existing cards
        const existingIds = new Set();
        recordings.forEach(rec => existingIds.add(rec.recording_id));

        // 2. Remove obsolete cards & players
        Array.from(cameraGrid.children).forEach(card => {
            if (card.dataset.id && !existingIds.has(card.dataset.id)) {
                if (players[card.dataset.id]) {
                    players[card.dataset.id].destroy();
                    delete players[card.dataset.id];
                }
                card.remove();
            }
        });

        let running = 0;
        let errors = 0;

        recordings.forEach(rec => {
            const state = rec.state || 'UNKNOWN';
            if (state === 'RUNNING') running++;
            if (state === 'ERROR') errors++;

            let card = document.getElementById(`card-${rec.recording_id}`);
            const isNew = !card;

            if (isNew) {
                card = document.createElement('div');
                card.className = 'camera-card';
                card.id = `card-${rec.recording_id}`;
                card.dataset.id = rec.recording_id;
                
                // Static structure created only once
                card.innerHTML = `
                    <div class="camera-preview">
                        <video id="video-${rec.recording_id}" muted playsinline></video>
                    </div>
                    <div class="camera-content">
                        <div class="camera-header">
                            <div class="camera-id" title="${rec.recording_id}">${rec.recording_id}</div>
                            <div id="status-badge-${rec.recording_id}" class="status-badge"></div>
                        </div>
                        <div class="camera-info">
                            <div class="info-row">
                                <span class="info-label">Created</span>
                                <span id="info-created-${rec.recording_id}" class="info-value"></span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Mode</span>
                                <span id="info-mode-${rec.recording_id}" class="info-value"></span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Storage</span>
                                <span id="info-storage-${rec.recording_id}" class="info-value"></span>
                            </div>
                        </div>
                        <div class="camera-actions">
                            <a href="/live?id=${rec.recording_id}" class="btn-card btn-primary-card">Live View (HQ)</a>
                            <a href="/tester" class="btn-card" onclick="sessionStorage.setItem('target_id', '${rec.recording_id}')">Control</a>
                        </div>
                    </div>
                `;
                cameraGrid.appendChild(card);
            }

            // Update only changing parts
            let statusClass = 'stopped';
            if (state === 'RUNNING') statusClass = 'running';
            else if (state === 'ERROR') statusClass = 'error';
            else if (state === 'PENDING') statusClass = 'pending';

            const badge = document.getElementById(`status-badge-${rec.recording_id}`);
            badge.className = `status-badge bg-${statusClass}`;
            badge.innerHTML = `<span class="status-dot dot-${statusClass}"></span>${state}`;

            const createdAt = new Date(rec.created_at).toLocaleString('ko-KR', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            document.getElementById(`info-created-${rec.recording_id}`).textContent = createdAt;
            document.getElementById(`info-mode-${rec.recording_id}`).textContent = rec.recording_mode || 'N/A';
            document.getElementById(`info-storage-${rec.recording_id}`).textContent = `${rec.storage_used_mbs || 0} MB`;

            // Player Management
            const videoEl = document.getElementById(`video-${rec.recording_id}`);
            if (state === 'RUNNING') {
                if (!players[rec.recording_id]) {
                    if (mpegts.getFeatureList().mseLivePlayback) {
                        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                        const wsUrl = `${wsProtocol}//${window.location.hostname}:18071/recording/${rec.recording_id}/sq`;
                        
                        const player = mpegts.createPlayer({
                            type: 'mpegts',
                            isLive: true,
                            hasAudio: false, // 백엔드에서 오디오 제거됨
                            url: wsUrl
                        }, {
                            enableStashBuffer: false,
                            liveBufferLatencyChasing: true,
                            liveBufferLatencyMaxLatency: 1.5,
                            liveBufferLatencyMinRemain: 0.3,
                            lazyLoad: false
                        });
                        
                        player.attachMediaElement(videoEl);
                        player.load();
                        player.play().catch(e => console.log("Autoplay blocked:", e));
                        
                        players[rec.recording_id] = player;
                    }
                }
            } else {
                if (players[rec.recording_id]) {
                    players[rec.recording_id].destroy();
                    delete players[rec.recording_id];
                }
            }
        });

        totalCount.textContent = recordings.length;
        runningCount.textContent = running;
        errorCount.textContent = errors;
    };

    // --- Modal Logic ---
    const addModal = document.getElementById('add-camera-modal');
    const openModalBtn = document.getElementById('open-add-modal-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const startBtn = document.getElementById('start-recording-btn');

    const modalSerial = document.getElementById('modal-serial');
    const modalHqUrl = document.getElementById('modal-hq-url');
    const modalSqUrl = document.getElementById('modal-sq-url');
    const modalMode = document.getElementById('modal-mode');
    const modalRetention = document.getElementById('modal-retention');

    openModalBtn.addEventListener('click', () => {
        addModal.style.display = 'flex';
        modalSerial.value = `SN-${Date.now()}`;
    });

    closeModalBtn.addEventListener('click', () => {
        addModal.style.display = 'none';
    });

    const showToast = (message) => {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(100px)';
        }, 3000);
    };

    startBtn.addEventListener('click', async () => {
        const body = {
            serial_number: modalSerial.value.trim(),
            hq_url: modalHqUrl.value.trim(),
            sq_url: modalSqUrl.value.trim(),
            recording_mode: modalMode.value,
            retention_days: parseInt(modalRetention.value) || 7
        };

        if (!body.hq_url || !body.sq_url) {
            alert('URLs are required.');
            return;
        }

        // 성공 여부와 상관없이 즉시 팝업 닫기
        addModal.style.display = 'none';
        
        // 백그라운드에서 실행될 수 있도록 버튼 상태 제어는 생략하거나 최소화
        try {
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (response.ok) {
                showToast('Recording Started Successfully');
                setTimeout(fetchStatus, 1000); // 서버 상태 반영을 위해 1초 후 갱신
            } else {
                const err = await response.json();
                showToast('Error: ' + (err.error?.details || err.error));
            }
        } catch (error) {
            console.error('Failed to start recording:', error);
            showToast('Request failed. Check network.');
        }
    });

    // Initial fetch
    fetchStatus();
    // Refresh every 3 seconds
    setInterval(fetchStatus, 3000);
});