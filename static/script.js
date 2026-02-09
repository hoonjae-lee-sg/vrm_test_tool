document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const startForm = document.getElementById('start-form');
    const stopForm = document.getElementById('stop-form');
    const statusForm = document.getElementById('status-form');
    const startEventForm = document.getElementById('start-event-form');
    const stopEventForm = document.getElementById('stop-event-form');
    const clipForm = document.getElementById('clip-form');
    const snapshotForm = document.getElementById('snapshot-form');
    const healthForm = document.getElementById('health-form');

    const startButton = document.getElementById('start-button');
    const stopButton = document.getElementById('stop-button');
    const statusButton = document.getElementById('status-button');
    const startEventButton = document.getElementById('start-event-button');
    const stopEventButton = document.getElementById('stop-event-button');
    const clipButton = document.getElementById('clip-button');
    const snapshotButton = document.getElementById('snapshot-button');
    const healthButton = document.getElementById('health-button');

    const hqUrlInput = document.getElementById('hq-url');
    const sqUrlInput = document.getElementById('sq-url');
    const recordingIdInput = document.getElementById('recording-id');

    const logOutput = document.getElementById('log-output');
    const clearLogButton = document.getElementById('clear-log');

    const navLinks = document.querySelectorAll('.nav-item');
    const panels = document.querySelectorAll('.panel');

    // Recording List Elements
    const recordingsTbody = document.getElementById('recordings-tbody');
    const refreshRecordingsButton = document.getElementById('refresh-recordings');

    // --- Helper Functions ---
    const syntaxHighlight = (json) => {
        if (typeof json !== 'string') {
            json = JSON.stringify(json, undefined, 2);
        }
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            let cls = 'number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'key';
                } else {
                    cls = 'string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'boolean';
            } else if (/null/.test(match)) {
                cls = 'null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        });
    };

    const log = (title, data) => {
        const timestamp = new Date().toLocaleTimeString();
        let formattedData = '';
        if (data) {
            formattedData = syntaxHighlight(data);
        }

        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `
            <div class="log-header">
                <span class="log-time">[${timestamp}]</span>
                <span class="log-title">${title}</span>
            </div>
            ${formattedData ? `<pre class="log-data">${formattedData}</pre>` : ''}
        `;

        // Remove placeholder if it exists
        const placeholder = logOutput.querySelector('.log-placeholder');
        if (placeholder) {
            logOutput.innerHTML = '';
        }

        logOutput.appendChild(entry);
        logOutput.scrollTop = logOutput.scrollHeight;
    };

    // --- Recording List Functions ---
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

            row.innerHTML = `
                <td><span class="mono" title="${rec.recording_id}">${rec.recording_id.substring(0, 12)}...</span></td>
                <td><span class="badge ${badgeClass}">${rec.state}</span></td>
                <td>
                    <button class="btn-sm btn-secondary use-id-btn" data-id="${rec.recording_id}">Use</button>
                </td>
            `;
            recordingsTbody.appendChild(row);
        });

        // Add event listeners to new buttons
        document.querySelectorAll('.use-id-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                fillRecordingId(id);
                log('Selected Recording ID', { recording_id: id });
                // Optional: Flash the floating panel to indicate action?
            });
        });
    };

    // Floating Panel Logic
    const floatingPanel = document.getElementById('floating-recording-list');
    const floatingHeader = document.getElementById('floating-header');
    const toggleFloatingBtn = document.getElementById('toggle-floating');

    if (floatingHeader) {
        floatingHeader.addEventListener('click', (e) => {
            // Don't toggle if clicking buttons
            if (e.target.tagName === 'BUTTON') return;
            floatingPanel.classList.toggle('minimized');
            toggleFloatingBtn.textContent = floatingPanel.classList.contains('minimized') ? '□' : '_';
        });
    }

    if (toggleFloatingBtn) {
        toggleFloatingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            floatingPanel.classList.toggle('minimized');
            toggleFloatingBtn.textContent = floatingPanel.classList.contains('minimized') ? '□' : '_';
        });
    }

    const fillRecordingId = (id) => {
        const inputs = [
            'recording-id',
            'status-recording-id',
            'event-start-recording-id',
            'event-stop-recording-id',
            'clip-recording-id',
            'snapshot-recording-id',
            'health-recording-id',
            'playlist-recording-id'
        ];

        inputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) input.value = id;
        });
    };

    // --- Event Listeners ---

    // Clear Log
    if (clearLogButton) {
        clearLogButton.addEventListener('click', () => {
            logOutput.innerHTML = '<span class="log-placeholder">Waiting for commands...</span>';
        });
    }

    // Refresh Recordings
    if (refreshRecordingsButton) {
        refreshRecordingsButton.addEventListener('click', fetchRecordings);
    }

    // Start Recording
    if (startForm) {
        startForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const hqStorageInput = document.getElementById('hq-storage');
            const sqStorageInput = document.getElementById('sq-storage');
            const retentionDaysInput = document.getElementById('retention-days');
            const recordingModeInput = document.getElementById('recording-mode');
            const encodingCodecInput = document.getElementById('encoding-codec');
            const authTokenInput = document.getElementById('auth-token');
            const notesInput = document.getElementById('notes');

            const body = {
                hq_url: hqUrlInput.value,
                sq_url: sqUrlInput.value,
                hq_storage_limit_mbs: hqStorageInput.value ? parseInt(hqStorageInput.value, 10) : null,
                sq_storage_limit_mbs: sqStorageInput.value ? parseInt(sqStorageInput.value, 10) : null,
                retention_days: retentionDaysInput.value ? parseInt(retentionDaysInput.value, 10) : null,
                recording_mode: recordingModeInput.value,
                encoding_codec: encodingCodecInput.value,
                auth_token: authTokenInput.value || null,
                notes: notesInput.value || null,
            };

            log('Starting recording...', body);
            startButton.setAttribute('aria-busy', 'true');
            startButton.textContent = 'Starting...';

            try {
                const response = await fetch('/api/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const result = await response.json();
                log('Start Response:', result);

                if (result.created && result.created.status) {
                    const newId = result.created.status.recording_id;
                    fillRecordingId(newId);
                    startButton.textContent = 'Started!';
                    fetchRecordings(); // Refresh list
                    setTimeout(() => startButton.textContent = 'Start Recording', 2000);
                } else {
                    startButton.textContent = 'Failed';
                    setTimeout(() => startButton.textContent = 'Start Recording', 2000);
                }

            } catch (error) {
                log('Error:', error);
                startButton.textContent = 'Error';
                setTimeout(() => startButton.textContent = 'Start Recording', 2000);
            } finally {
                startButton.removeAttribute('aria-busy');
            }
        });
    }

    // Stop Recording
    if (stopForm) {
        stopForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordingId = document.getElementById('recording-id').value;
            const authToken = document.getElementById('stop-auth-token').value;

            log('Stopping recording...', { recording_id: recordingId });
            stopButton.setAttribute('aria-busy', 'true');
            stopButton.textContent = 'Stopping...';

            try {
                const response = await fetch('/api/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recording_id: recordingId,
                        auth_token: authToken || null
                    }),
                });
                const result = await response.json();
                log('Stop Response:', result);

                if (response.ok) {
                    stopButton.textContent = 'Stopped!';
                } else if (result.error && result.error.code === 'FAILED_PRECONDITION') {
                    // If already stopped or in error state, treat as success
                    stopButton.textContent = 'Already Stopped';
                } else {
                    stopButton.textContent = 'Failed';
                }

                fetchRecordings(); // Refresh list
                setTimeout(() => stopButton.textContent = 'Stop Recording', 2000);

            } catch (error) {
                log('Error:', error);
                stopButton.textContent = 'Error';
                setTimeout(() => stopButton.textContent = 'Stop Recording', 2000);
            } finally {
                stopButton.removeAttribute('aria-busy');
            }
        });
    }

    // Check Status
    if (statusForm) {
        statusForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordingId = document.getElementById('status-recording-id').value;
            const authToken = document.getElementById('status-auth-token').value;

            log('Checking status...', { recording_id: recordingId });
            statusButton.setAttribute('aria-busy', 'true');
            statusButton.textContent = 'Checking...';

            try {
                const params = new URLSearchParams({ recording_id: recordingId });
                if (authToken) params.append('auth_token', authToken);

                const response = await fetch(`/api/status?${params.toString()}`, {
                    method: 'GET',
                });
                const result = await response.json();
                log('Status Response:', result);
                statusButton.textContent = 'Checked!';
                setTimeout(() => statusButton.textContent = 'Check Status', 2000);

            } catch (error) {
                log('Error:', error);
                statusButton.textContent = 'Error';
                setTimeout(() => statusButton.textContent = 'Check Status', 2000);
            } finally {
                statusButton.removeAttribute('aria-busy');
            }
        });
    }

    // Start Event Clip
    if (startEventForm) {
        startEventForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordingId = document.getElementById('event-start-recording-id').value;
            const authToken = document.getElementById('event-start-auth-token').value;

            log('Starting event clip...', { recording_id: recordingId });
            startEventButton.setAttribute('aria-busy', 'true');
            startEventButton.textContent = 'Starting...';

            try {
                const response = await fetch('/api/event/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recording_id: recordingId,
                        auth_token: authToken || null
                    }),
                });
                const result = await response.json();
                log('Start Event Response:', result);
                startEventButton.textContent = 'Started!';
                setTimeout(() => startEventButton.textContent = 'Start Event', 2000);

            } catch (error) {
                log('Error:', error);
                startEventButton.textContent = 'Error';
                setTimeout(() => startEventButton.textContent = 'Start Event', 2000);
            } finally {
                startEventButton.removeAttribute('aria-busy');
            }
        });
    }

    // Stop Event Clip
    if (stopEventForm) {
        stopEventForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordingId = document.getElementById('event-stop-recording-id').value;
            const authToken = document.getElementById('event-stop-auth-token').value;

            log('Stopping event clip...', { recording_id: recordingId });
            stopEventButton.setAttribute('aria-busy', 'true');
            stopEventButton.textContent = 'Stopping...';

            try {
                const response = await fetch('/api/event/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recording_id: recordingId,
                        auth_token: authToken || null
                    }),
                });
                const result = await response.json();
                log('Stop Event Response:', result);
                stopEventButton.textContent = 'Stopped!';
                setTimeout(() => stopEventButton.textContent = 'Stop Event', 2000);

            } catch (error) {
                log('Error:', error);
                stopEventButton.textContent = 'Error';
                setTimeout(() => stopEventButton.textContent = 'Stop Event', 2000);
            } finally {
                stopEventButton.removeAttribute('aria-busy');
            }
        });
    }

    // Create Clip
    if (clipForm) {
        clipForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordingId = document.getElementById('clip-recording-id').value;
            const seconds = document.getElementById('clip-seconds').value;
            const nanos = document.getElementById('clip-nanos').value;

            log('Creating clip...', { recording_id: recordingId, seconds, nanos });
            clipButton.setAttribute('aria-busy', 'true');
            clipButton.textContent = 'Creating...';

            try {
                const response = await fetch('/api/clip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recording_id: recordingId,
                        seconds: parseInt(seconds, 10),
                        nanos: parseInt(nanos, 10)
                    }),
                });
                const result = await response.json();
                log('Clip Response:', result);
                clipButton.textContent = 'Created!';
                setTimeout(() => clipButton.textContent = 'Create Clip', 2000);

            } catch (error) {
                log('Error:', error);
                clipButton.textContent = 'Error';
                setTimeout(() => clipButton.textContent = 'Create Clip', 2000);
            } finally {
                clipButton.removeAttribute('aria-busy');
            }
        });
    }

    // Take Snapshot
    if (snapshotForm) {
        const snapshotResultsContainer = document.getElementById('snapshot-results-container');
        const snapshotOutput = document.getElementById('snapshot-output');

        snapshotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordingId = document.getElementById('snapshot-recording-id').value;
            const seconds = document.getElementById('snapshot-seconds').value;
            const nanos = document.getElementById('snapshot-nanos').value;

            log('Taking snapshot...', { recording_id: recordingId, seconds, nanos });
            snapshotButton.setAttribute('aria-busy', 'true');
            snapshotButton.textContent = 'Taking...';

            try {
                const response = await fetch('/api/snapshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recording_id: recordingId,
                        seconds: seconds ? parseInt(seconds, 10) : null,
                        nanos: nanos ? parseInt(nanos, 10) : 0
                    }),
                });
                const result = await response.json();
                log('Snapshot Response:', result);
                console.log("Full snapshot API response:", result); // DEBUG LOG

                snapshotButton.textContent = 'Taken!';

                const imagePath = result.file ? result.file.path : null;

                if (imagePath) {
                    console.log("Image path found:", imagePath); // DEBUG LOG
                    snapshotResultsContainer.style.display = 'block';

                    const snapshotItem = document.createElement('div');
                    snapshotItem.className = 'snapshot-item';

                    // Build absolute URL to OATPP server (port 18071)
                    const oatppPort = 18071;
                    // Path from API is './data/...', remove leading '.' for clean join
                    const cleanPath = imagePath.startsWith('./') ? imagePath.substring(1) : imagePath;
                    const imageUrl = `http://127.0.0.1:${oatppPort}${cleanPath}`;

                    const img = document.createElement('img');
                    img.src = imageUrl;
                    console.log("Setting image src to:", img.src); // DEBUG LOG
                    img.alt = `Snapshot for ${recordingId} at ${seconds}s`;

                    const info = document.createElement('div');
                    info.className = 'snapshot-item-info';
                    const timestamp = new Date(parseInt(seconds, 10) * 1000);
                    info.textContent = timestamp.toLocaleTimeString('en-GB');

                    snapshotItem.appendChild(img);
                    snapshotItem.appendChild(info);
                    snapshotOutput.prepend(snapshotItem);
                } else {
                    console.log("Could not find 'path' in 'response.file'.", result.file); // DEBUG LOG
                }

                setTimeout(() => snapshotButton.textContent = 'Take Snapshot', 2000);

            } catch (error) {
                log('Error:', error);
                snapshotButton.textContent = 'Error';
                setTimeout(() => snapshotButton.textContent = 'Take Snapshot', 2000);
            } finally {
                snapshotButton.removeAttribute('aria-busy');
            }
        });
    }

    // Check Health
    if (healthForm) {
        healthForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const recordingId = document.getElementById('health-recording-id').value;
            const authToken = document.getElementById('health-auth-token').value;

            log('Checking health...', { recording_id: recordingId });
            healthButton.setAttribute('aria-busy', 'true');
            healthButton.textContent = 'Checking...';

            try {
                const params = new URLSearchParams({ recording_id: recordingId });
                if (authToken) params.append('auth_token', authToken);

                const response = await fetch(`/api/health?${params.toString()}`, {
                    method: 'GET',
                });
                const result = await response.json();
                log('Health Response:', result);
                healthButton.textContent = 'Checked!';
                setTimeout(() => healthButton.textContent = 'Check Health', 2000);

            } catch (error) {
                log('Error:', error);
                healthButton.textContent = 'Error';
                setTimeout(() => healthButton.textContent = 'Check Health', 2000);
            } finally {
                healthButton.removeAttribute('aria-busy');
            }
        });
    }

    // --- Navigation Logic ---
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            // Update active state
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Show target panel
            const targetId = link.getAttribute('href').substring(1); // remove #
            panels.forEach(panel => {
                if (panel.id === targetId) {
                    panel.classList.add('active');
                    panel.classList.remove('hidden');
                } else {
                    panel.classList.remove('active');
                    panel.classList.add('hidden');
                }
            });
        });
    });

    // Snapshot Timeline Logic
    const snapshotLookupBtn = document.getElementById('snapshot-lookup-btn');
    const snapshotTimelineContainer = document.getElementById('snapshot-timeline-container');
    const snapshotTimelineCanvas = document.getElementById('snapshot-timeline');
    const timelineInfo = document.getElementById('timeline-info');
    const timelineZoomInput = document.getElementById('timeline-zoom');
    const zoomLevelDisplay = document.getElementById('zoom-level');
    const timelineScrollArea = document.getElementById('timeline-scroll-area');

    let currentSegments = [];
    let currentZoom = 1; // 현재 줌 레벨 (휠 이벤트에서 접근 가능하도록 외부 스코프에 선언)



    if (timelineZoomInput) {
        timelineZoomInput.addEventListener('input', (e) => {
            currentZoom = parseFloat(e.target.value);
            zoomLevelDisplay.textContent = `${currentZoom}x`;
            renderTimeline(currentSegments);
        });
    }

    function renderTimeline(segments) {
        if (!segments || segments.length === 0) {
            timelineInfo.textContent = "No segments found.";
            return;
        }

        // 외부 스코프의 currentZoom 사용 (휠 이벤트와 공유)
        const zoom = currentZoom;
        const ctx = snapshotTimelineCanvas.getContext('2d');

        // Calculate range from segments
        const firstSeg = segments[0];
        const lastSeg = segments[segments.length - 1];

        const startTime = firstSeg.start;
        const endTime = lastSeg.start + lastSeg.duration;
        const totalDuration = endTime - startTime;

        // Base pixels per second (at 1x zoom)
        // Let's say 1x means the whole timeline fits in 800px (or container width)
        const containerWidth = timelineScrollArea.clientWidth || 800;
        const basePixelsPerSecond = containerWidth / totalDuration;

        // Calculate new width based on zoom
        // If zoom is 1, we fit to container. If zoom > 1, we expand.
        // Actually, let's make 1x be "fit to screen"
        const canvasWidth = Math.max(containerWidth * zoom, containerWidth);

        snapshotTimelineCanvas.width = canvasWidth;
        snapshotTimelineCanvas.height = 100; // Fixed height
        snapshotTimelineCanvas.style.display = 'block'; // 캔버스를 블록 요소로 설정하여 스크롤 가능하게 함

        const width = snapshotTimelineCanvas.width;
        const height = snapshotTimelineCanvas.height;

        // 디버그: 캔버스 및 스크롤 영역 크기 확인
        console.log('Canvas width:', canvasWidth, 'Container width:', containerWidth, 'Zoom:', zoom);
        console.log('Scroll area - scrollWidth:', timelineScrollArea.scrollWidth, 'clientWidth:', timelineScrollArea.clientWidth);

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        // Draw segments
        ctx.fillStyle = '#4CAF50'; // Green for available segments

        // We map [startTime, endTime] to [0, width]
        // t -> x: (t - startTime) / totalDuration * width

        segments.forEach(seg => {
            const x = ((seg.start - startTime) / totalDuration) * width;
            const w = (seg.duration / totalDuration) * width;

            // Draw segment with a 1px gap to distinguish them visually
            let drawW = w;
            if (w > 2) {
                drawW = w - 1;
            }
            // Ensure it's visible
            if (drawW < 1) drawW = 1;

            ctx.fillRect(x, 10, drawW, height - 20);
        });

        // Update info
        const startDate = new Date(startTime * 1000).toLocaleString();
        const endDate = new Date(endTime * 1000).toLocaleString();
        timelineInfo.textContent = `Range: ${startDate} - ${endDate} (${segments.length} segments)`;
    }
    // 마우스 인터랙션 상태 변수 (renderTimeline 외부에 선언하여 한 번만 초기화)
    let isDragging = false;
    let timelineInitialized = false;
    let scrollInterval = null; // 엣지 스크롤용 인터벌
    let lastCanvasX = null; // 마지막 캔버스 X 좌표 저장

    // 타임스탬프 업데이트 헬퍼 함수
    const updateTimestampFromX = (canvasX, segments) => {
        if (!segments || segments.length === 0) return;

        const firstSeg = segments[0];
        const lastSeg = segments[segments.length - 1];
        const startTime = firstSeg.start;
        const endTime = lastSeg.start + lastSeg.duration;
        const totalDuration = endTime - startTime;
        const width = snapshotTimelineCanvas.width;

        console.log('updateTimestampFromX:', {
            canvasX: canvasX,
            canvasWidth: width,
            inRange: canvasX >= 0 && canvasX <= width
        });

        const clickTime = startTime + (canvasX / width) * totalDuration;
        const timestamp = Math.floor(clickTime);

        // Fill inputs
        document.getElementById('snapshot-seconds').value = timestamp;
        document.getElementById('snapshot-nanos').value = 0;

        // 항상 타임라인을 다시 그려서 이전 빨간 선 제거
        renderTimeline(segments);

        // 빨간 선 그리기
        const ctx = snapshotTimelineCanvas.getContext('2d');
        const height = snapshotTimelineCanvas.height;
        ctx.beginPath();
        ctx.moveTo(canvasX, 0);
        ctx.lineTo(canvasX, height);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        ctx.stroke();

        console.log('Red line drawn at canvasX:', canvasX, 'height:', height);

        timelineInfo.textContent = `Selected Time: ${new Date(timestamp * 1000).toLocaleString()}`;

        // 마지막 위치 저장
        lastCanvasX = canvasX;
    };

    // 엣지 스크롤 중지 함수
    const stopEdgeScroll = () => {
        if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
        }
    };

    // 이벤트 핸들러 초기화 (한 번만 실행)
    const initializeTimelineEvents = () => {
        console.log('initializeTimelineEvents called, timelineInitialized:', timelineInitialized);
        if (timelineInitialized) return;
        timelineInitialized = true;
        console.log('Initializing timeline events...');

        const timelinePreviewPopup = document.getElementById('timeline-preview-popup');
        if (!timelinePreviewPopup) console.error("Timeline preview popup element not found!");

        const updatePreview = (e) => {
            if (!timelinePreviewPopup) return;
            const canvasX = e.offsetX;
            if (!currentSegments || currentSegments.length === 0) return;

            const firstSeg = currentSegments[0];
            const lastSeg = currentSegments[currentSegments.length - 1];
            const startTime = firstSeg.start;
            const endTime = lastSeg.start + lastSeg.duration;
            const totalDuration = endTime - startTime;
            const width = snapshotTimelineCanvas.width;
            const hoverTime = startTime + (canvasX / width) * totalDuration;

            const date = new Date(hoverTime * 1000);
            const timeCaption = document.getElementById('preview-time-caption');
            if (timeCaption) {
                timeCaption.textContent = date.toLocaleTimeString('en-GB', { hour12: false }) + `.${date.getMilliseconds().toString().padStart(3, '0')}`;
            }

            // --- New Positioning Logic ---
            const canvasRect = snapshotTimelineCanvas.getBoundingClientRect();
            const popupX = e.clientX; // Use mouse's viewport X coordinate
            const popupY = canvasRect.top;  // Align with the top of the visible canvas area

            timelinePreviewPopup.style.position = 'fixed'; // Position relative to viewport
            timelinePreviewPopup.style.left = `${popupX}px`;
            timelinePreviewPopup.style.top = `${popupY}px`;
            timelinePreviewPopup.style.display = 'block';
        };

        const handleInteraction = (e) => {
            const canvasX = e.offsetX;
            updateTimestampFromX(canvasX, currentSegments);
            updatePreview(e);
        };

        // 마우스 다운: 드래그 시작
        snapshotTimelineCanvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            handleInteraction(e);
        });

        // 마우스 무브: 드래그 중이거나 마우스 호버 시
        snapshotTimelineCanvas.addEventListener('mousemove', (e) => {
            if (isDragging) {
                handleInteraction(e); // 드래그 중: 빨간 선 및 미리보기 업데이트
            } else {
                updatePreview(e); // 호버 중: 미리보기만 업데이트
            }
        });

        // 마우스 업: 드래그 종료
        snapshotTimelineCanvas.addEventListener('mouseup', (e) => {
            if (isDragging) {
                handleInteraction(e);
            }
            isDragging = false;
            stopEdgeScroll();
        });

        // 마우스 리브: 캔버스 밖으로 나가면 드래그 및 미리보기 종료
        snapshotTimelineCanvas.addEventListener('mouseleave', () => {
            console.log("Mouse left canvas, hiding preview."); // DEBUG LOG
            isDragging = false;
            stopEdgeScroll();
            if (timelinePreviewPopup) {
                timelinePreviewPopup.style.display = 'none';
            }
        });

        // 마우스 휠: 줌 인/아웃
        snapshotTimelineCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            const zoomDelta = e.deltaY > 0 ? -0.5 : 0.5; // 휠 다운: 줌 아웃, 휠 업: 줌 인
            let newZoom = currentZoom + zoomDelta;

            // 줌 레벨 제한 (1x ~ 50x)
            newZoom = Math.max(1, Math.min(50, newZoom));

            if (newZoom !== currentZoom) {
                const oldWidth = snapshotTimelineCanvas.width;
                let timeFraction = null;
                if (lastCanvasX !== null) {
                    timeFraction = lastCanvasX / oldWidth;
                }

                currentZoom = newZoom;
                timelineZoomInput.value = currentZoom;
                zoomLevelDisplay.textContent = `${currentZoom}x`;
                renderTimeline(currentSegments);

                if (timeFraction !== null) {
                    const newWidth = snapshotTimelineCanvas.width;
                    const newCanvasX = timeFraction * newWidth;

                    const ctx = snapshotTimelineCanvas.getContext('2d');
                    const height = snapshotTimelineCanvas.height;
                    ctx.beginPath();
                    ctx.moveTo(newCanvasX, 0);
                    ctx.lineTo(newCanvasX, height);
                    ctx.strokeStyle = 'red';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    lastCanvasX = newCanvasX;
                }
            }
        });
    };

    // Lookup 버튼 클릭 시 이벤트 핸들러 초기화
    if (snapshotLookupBtn) {
        snapshotLookupBtn.addEventListener('click', async () => {
            const recordingId = document.getElementById('snapshot-recording-id').value;
            console.log('Lookup clicked for:', recordingId); // Debug log
            if (!recordingId) {
                alert('Please enter a Recording ID first.');
                return;
            }

            try {
                const response = await fetch(`/api/recordings/${recordingId}/segments`);
                const data = await response.json();

                if (response.ok) {
                    currentSegments = data.segments;
                    initializeTimelineEvents(); // 이벤트 핸들러 초기화 (한 번만)
                    renderTimeline(currentSegments);
                    snapshotTimelineContainer.style.display = 'block';
                } else {
                    alert('Error fetching segments: ' + (data.error || 'Unknown error'));
                    snapshotTimelineContainer.style.display = 'none';
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to fetch segments.');
            }
        });
    }

    // Initial fetch
    fetchRecordings();

    // Auto-refresh every 5 seconds
    setInterval(fetchRecordings, 5000);
});