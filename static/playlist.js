document.addEventListener('DOMContentLoaded', () => {
    const NUM_CHANNELS = 9;

    // DOM Elements
    const recSelects = [];
    const loadBtns = [];
    const changeBtns = [];
    const overlays = [];
    const videoElements = [];
    const hlsLogElements = [];
    for (let i = 0; i < NUM_CHANNELS; i++) {
        recSelects.push(document.getElementById(`rec-select-${i}`));
        loadBtns.push(document.getElementById(`load-btn-${i}`));
        changeBtns.push(document.getElementById(`change-btn-${i}`));
        overlays.push(document.getElementById(`overlay-${i}`));
        videoElements.push(document.getElementById(`hls-video-${i}`));
        hlsLogElements.push(document.getElementById(`hls-log-${i}`));
    }

    const placeholders = [];
    for (let i = 0; i < NUM_CHANNELS; i++) {
        placeholders.push(document.getElementById(`no-video-placeholder-${i}`));
    }

    const prevDayBtn = document.getElementById('prev-day');
    const nextDayBtn = document.getElementById('next-day');
    const datePicker = document.getElementById('date-picker');
    const currentDateText = document.getElementById('current-date-text');
    const timebarCanvas = document.getElementById('timebar-canvas');
    const ctx = timebarCanvas.getContext('2d');
    const globalStatus = document.getElementById('global-status-bar');

    // State
    let hlsInstances = Array(NUM_CHANNELS).fill(null);
    let channelRecordingIds = Array(NUM_CHANNELS).fill(null);
    let currentDate = new Date();
    let segmentData = {}; // Keyed by recordingId

    // Timebar Interactive State
    let zoomLevel = 1;
    let scrollOffset = 0;
    let isDragging = false;
    let dragStartY = 0;
    let dragStartOffset = 0;
    let hoverY = -1;

    // Constants
    let PIXELS_PER_MINUTE = 1;
    let TOTAL_HEIGHT = 1440;
    const CANVAS_WIDTH = 280;

    const log = (channelIndex, message) => {
        console.log(`[CH ${channelIndex + 1}]: ${message}`);
        if (hlsLogElements[channelIndex]) {
            hlsLogElements[channelIndex].textContent = message;
        }
    };

    const init = () => {
        updateDateDisplay();
        drawTimebar();

        // Per-channel load buttons
        for (let i = 0; i < NUM_CHANNELS; i++) {
            loadBtns[i].addEventListener('click', () => loadChannel(i));
            changeBtns[i].addEventListener('click', () => showOverlay(i));
        }

        // Global controls
        prevDayBtn.addEventListener('click', () => changeDate(-1));
        nextDayBtn.addEventListener('click', () => changeDate(1));
        datePicker.addEventListener('change', (e) => {
            if (e.target.value) {
                currentDate = new Date(e.target.value);
                updateDateDisplay();
                drawTimebar();
            }
        });
        currentDateText.addEventListener('click', () => datePicker.showPicker());

        // Timebar event listeners
        setupTimebarEvents();

        // Auto-load recordings
        loadInitialRecordings();
    };

    const setupTimebarEvents = () => {
        let ignoreClick = false;

        timebarCanvas.addEventListener('click', (e) => {
            if (ignoreClick) {
                ignoreClick = false;
                return;
            }
            if (isDragging) return;

            const rect = timebarCanvas.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const absoluteY = y + scrollOffset;
            const totalSeconds = (absoluteY / PIXELS_PER_MINUTE) * 60;
            const hour = Math.floor(totalSeconds / 3600);
            const minute = Math.floor((totalSeconds % 3600) / 60);
            const second = Math.floor(totalSeconds % 60);

            if (hour >= 0 && hour < 24) {
                playAt(hour, minute, second);
            }
        });

        timebarCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 2 : 0.5;
            let newZoomLevel = zoomLevel * zoomFactor;
            newZoomLevel = Math.max(1, Math.min(newZoomLevel, 8));

            if (newZoomLevel !== zoomLevel) {
                const rect = timebarCanvas.getBoundingClientRect();
                const mouseY = e.clientY - rect.top;
                const timeAtMouse = (scrollOffset + mouseY) / PIXELS_PER_MINUTE;

                zoomLevel = newZoomLevel;
                PIXELS_PER_MINUTE = zoomLevel;
                TOTAL_HEIGHT = 1440 * zoomLevel;
                timebarCanvas.height = TOTAL_HEIGHT;

                scrollOffset = (timeAtMouse * PIXELS_PER_MINUTE) - mouseY;
                scrollOffset = Math.max(0, Math.min(scrollOffset, TOTAL_HEIGHT - timebarCanvas.parentElement.clientHeight));

                drawTimebar();
            }
        });

        timebarCanvas.addEventListener('mousedown', (e) => {
            if (zoomLevel > 1) {
                isDragging = true;
                dragStartY = e.clientY;
                dragStartOffset = scrollOffset;
                timebarCanvas.style.cursor = 'grabbing';
                ignoreClick = false;
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const deltaY = e.clientY - dragStartY;
                if (Math.abs(deltaY) > 5) {
                    ignoreClick = true;
                }
                const newScrollOffset = dragStartOffset - deltaY;
                const visibleHeight = timebarCanvas.parentElement.clientHeight;
                scrollOffset = Math.max(0, Math.min(newScrollOffset, TOTAL_HEIGHT - visibleHeight));
                drawTimebar();
            }
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                timebarCanvas.style.cursor = 'pointer';
            }
        });

        timebarCanvas.addEventListener('mousemove', (e) => {
            const rect = timebarCanvas.getBoundingClientRect();
            hoverY = e.clientY - rect.top;
            drawTimebar();
        });

        timebarCanvas.addEventListener('mouseleave', () => {
            hoverY = -1;
            drawTimebar();
        });
    };

    const updateDateDisplay = () => {
        const yyyy = currentDate.getFullYear();
        const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
        const dd = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        currentDateText.textContent = dateStr;
        datePicker.value = dateStr;
    };

    const changeDate = (days) => {
        currentDate.setDate(currentDate.getDate() + days);
        updateDateDisplay();
        drawTimebar();
    };

    const loadInitialRecordings = async () => {
        try {
            globalStatus.textContent = "Fetching recordings list...";
            const response = await fetch('/api/recordings');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();

            // API returns an array of recording objects
            // We need to extract the recording_ids
            const initialRecIds = Array.isArray(data) ? data.map(r => r.recording_id) : [];

            if (initialRecIds.length === 0) {
                globalStatus.textContent = "No recordings found on server.";
                return;
            }

            globalStatus.textContent = `Found ${initialRecIds.length} recordings.`;

            // Populate all dropdowns
            initialRecIds.forEach(recId => {
                for (let i = 0; i < NUM_CHANNELS; i++) {
                    const option = document.createElement('option');
                    option.value = recId;
                    option.textContent = recId;
                    recSelects[i].appendChild(option);
                }
            });

        } catch (error) {
            console.error("Failed to load initial recordings:", error);
            globalStatus.textContent = "Error loading recording list. Is the backend running?";
        }
    };

    const showOverlay = (channelIndex) => {
        overlays[channelIndex].style.display = 'flex';
        changeBtns[channelIndex].style.display = 'none';
        // Optional: Stop playback when showing overlay?
        // if (hlsInstances[channelIndex]) hlsInstances[channelIndex].stopLoad();
    };

    const loadChannel = async (channelIndex) => {
        const recId = recSelects[channelIndex].value;
        if (!recId) {
            alert(`Please select a Recording ID for Channel ${channelIndex + 1}`);
            return;
        }

        // Hide overlay
        overlays[channelIndex].style.display = 'none';
        changeBtns[channelIndex].style.display = 'block';

        channelRecordingIds[channelIndex] = recId;

        // Visual feedback: dim the video container while loading
        const videoContainer = videoElements[channelIndex].parentElement;
        videoContainer.style.opacity = '0.5';

        await loadRecordingData(recId, channelIndex);

        videoContainer.style.opacity = '1.0';

        // Reset placeholder
        placeholders[channelIndex].style.display = 'none';
        videoElements[channelIndex].style.display = 'block';

        drawTimebar();
    };

    const loadRecordingData = async (recordingId, channelIndex) => {
        if (segmentData[recordingId]) {
            log(channelIndex, `Data for ${recordingId} already loaded.`);
            return;
        }
        log(channelIndex, `Loading data...`);
        try {
            const response = await fetch(`/api/recordings/${recordingId}/segments`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            segmentData[recordingId] = data.segments || [];
            log(channelIndex, `Loaded ${segmentData[recordingId].length} segments.`);
        } catch (error) {
            console.error(`Error loading data for ${recordingId}:`, error);
            log(channelIndex, `Error: ${error.message}`);
            channelRecordingIds[channelIndex] = null; // Unset on failure
        }
    };

    const drawTimebar = () => {
        const visibleHeight = timebarCanvas.parentElement.clientHeight;
        ctx.clearRect(0, 0, CANVAS_WIDTH, TOTAL_HEIGHT);
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, scrollOffset, CANVAS_WIDTH, visibleHeight);
        ctx.save();
        ctx.translate(0, -scrollOffset);

        // Grid and Labels
        ctx.strokeStyle = '#444';
        ctx.fillStyle = '#888';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const totalMinutes = 24 * 60;
        for (let minute = 0; minute < totalMinutes; minute++) {
            const y = minute * PIXELS_PER_MINUTE;
            if (minute % 60 === 0) {
                ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(CANVAS_WIDTH, y); ctx.strokeStyle = '#555'; ctx.stroke();
                ctx.fillText(`${String(minute / 60).padStart(2, '0')}:00`, 40, y);
            } else if (zoomLevel >= 8 && minute % 5 === 0) {
                ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(65, y); ctx.strokeStyle = '#333'; ctx.stroke();
                ctx.fillText(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, 40, y);
            } else if (zoomLevel >= 4 && minute % 10 === 0) {
                ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(60, y); ctx.strokeStyle = '#444'; ctx.stroke();
                ctx.fillText(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, 40, y);
            } else if (zoomLevel >= 2 && minute % 30 === 0) {
                ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(70, y); ctx.strokeStyle = '#444'; ctx.stroke();
                ctx.fillText(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, 40, y);
            }
        }

        // Segments
        const colors = ['#4caf50', '#2196f3', '#ffc107', '#e91e63', '#9c27b0', '#00bcd4', '#ff9800', '#795548', '#607d8b'];
        const startOfDay = new Date(currentDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(currentDate);
        endOfDay.setHours(23, 59, 59, 999);
        const startTs = Math.floor(startOfDay.getTime() / 1000);
        const endTs = Math.floor(endOfDay.getTime() / 1000);

        channelRecordingIds.forEach((recId, index) => {
            if (!recId || !segmentData[recId]) return;
            ctx.fillStyle = colors[index % colors.length];
            const daySegments = segmentData[recId].filter(s => (s.start + s.duration > startTs && s.start < endTs));
            daySegments.forEach(seg => {
                let segStart = Math.max(seg.start, startTs);
                let segEnd = Math.min(seg.start + seg.duration, endTs);
                const startPx = ((segStart - startTs) / 60) * PIXELS_PER_MINUTE;
                const heightPx = ((segEnd - segStart) / 60) * PIXELS_PER_MINUTE;
                const startY = Math.floor(startPx);
                const endY = Math.floor(startPx + heightPx);
                const channelWidth = (CANVAS_WIDTH - 80) / NUM_CHANNELS;
                const centerX = 80 + (channelWidth * index) + (channelWidth / 2);
                for (let y = startY; y < endY; y += 2) {
                    if (y >= scrollOffset - 1 && y < scrollOffset + visibleHeight + 1) {
                        const noise = Math.sin(y * 0.1) * Math.cos(y * 0.05);
                        const barWidth = (channelWidth * 0.4) + (Math.abs(noise) * channelWidth * 0.6);
                        ctx.fillRect(centerX - barWidth / 2, y, barWidth, 1);
                    }
                }
            });
        });

        // Hover Indicator
        if (hoverY >= 0) {
            const absoluteY = scrollOffset + hoverY;
            ctx.strokeStyle = 'rgba(255, 100, 100, 0.8)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, absoluteY); ctx.lineTo(CANVAS_WIDTH, absoluteY); ctx.stroke();
            const totalSeconds = (absoluteY / PIXELS_PER_MINUTE) * 60;
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = Math.floor(totalSeconds % 60);
            const timeString = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            ctx.fillStyle = 'rgba(255, 100, 100, 1)';
            ctx.font = 'bold 13px Inter, sans-serif';
            ctx.textAlign = 'left';
            let textY = absoluteY + 15;
            if (textY + 20 > scrollOffset + visibleHeight) { textY = absoluteY - 15; }
            ctx.fillText(timeString, 60, textY);
        }

        ctx.restore();
    };

    const playAt = (hour, minute, second) => {
        const startTimeInSeconds = (minute % 60) * 60 + second;
        const clickedTimestamp = new Date(currentDate);
        clickedTimestamp.setHours(hour, minute, second, 0);
        const clickedTime = Math.floor(clickedTimestamp.getTime() / 1000);

        channelRecordingIds.forEach((recId, index) => {
            if (!recId) return;

            // 1. Check if clicked time is within any valid segment
            const segments = segmentData[recId] || [];
            const validSegment = segments.find(s => clickedTime >= s.start && clickedTime < s.start + s.duration);

            if (!validSegment) {
                // Show placeholder
                placeholders[index].style.display = 'flex';
                videoElements[index].style.display = 'none';
                if (hlsInstances[index]) {
                    hlsInstances[index].stopLoad();
                }
                log(index, `No video data at ${hour}:${minute}:${second}`);
                return;
            }

            // Hide placeholder
            placeholders[index].style.display = 'none';
            videoElements[index].style.display = 'block';

            // 2. Calculate media time (seek position)
            // The HLS playlist for this hour will contain only valid segments.
            // We need to sum the duration of all valid segments in this hour *before* the current segment,
            // plus the offset within the current segment.

            const hourStart = new Date(currentDate);
            hourStart.setHours(hour, 0, 0, 0);
            const hourStartTs = Math.floor(hourStart.getTime() / 1000);
            const hourEndTs = hourStartTs + 3600;

            // Filter segments that overlap with this hour
            const hourSegments = segments.filter(s => s.start < hourEndTs && s.start + s.duration > hourStartTs);
            hourSegments.sort((a, b) => a.start - b.start);

            let mediaTime = 0;
            for (const seg of hourSegments) {
                // Intersection with current hour
                const segStartInHour = Math.max(seg.start, hourStartTs);
                const segEndInHour = Math.min(seg.start + seg.duration, hourEndTs);

                if (clickedTime >= segStartInHour && clickedTime < segEndInHour) {
                    mediaTime += (clickedTime - segStartInHour);
                    break;
                } else {
                    mediaTime += (segEndInHour - segStartInHour);
                }
            }

            const targetTime = new Date(currentDate);
            targetTime.setHours(hour, 0, 0, 0);
            const yyyy = targetTime.getUTCFullYear();
            const mm = String(targetTime.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(targetTime.getUTCDate()).padStart(2, '0');
            const hh = String(targetTime.getUTCHours()).padStart(2, '0');
            const timestamp = `${yyyy}${mm}${dd}${hh}0000`;

            const backendHost = window.location.hostname;
            const hlsUrl = `http://${backendHost}:18071/recording/${recId}/playback/master.m3u8`;

            loadHlsStream(index, hlsUrl, mediaTime);
        });
    };

    const loadHlsStream = (channelIndex, videoSrc, startTime = 0) => {
        const video = videoElements[channelIndex];
        if (!video) return;
        if (Hls.isSupported()) {
            if (hlsInstances[channelIndex]) {
                hlsInstances[channelIndex].destroy();
            }
            const hls = new Hls({ debug: false, enableWorker: true, lowLatencyMode: true });
            hlsInstances[channelIndex] = hls;
            hls.loadSource(videoSrc);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.currentTime = startTime > 0 ? startTime : (hls.startPosition > 0 ? hls.startPosition : 0);
                log(channelIndex, `Playing from ${video.currentTime.toFixed(0)}s`);
                video.play().catch(error => {
                    if (error.name !== 'AbortError') console.error(`CH ${channelIndex} Playback error:`, error);
                });
            });
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) log(channelIndex, `Fatal error: ${data.details}`);
            });
        }
    };

    init();
});
