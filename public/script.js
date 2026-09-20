(function() {
    // ===== DOM Elements =====
    const video = document.getElementById('videoPlayer');
    const urlInput = document.getElementById('videoUrl');
    const loadBtn = document.getElementById('loadBtn');
    const backBtn = document.getElementById('backBtn');
    const playBtn = document.getElementById('playBtn');
    const skipBackBtn = document.getElementById('skipBackBtn');
    const skipForwardBtn = document.getElementById('skipForwardBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const pipBtn = document.getElementById('pipBtn');
    const theaterBtn = document.getElementById('theaterBtn');
    const muteBtn = document.getElementById('muteBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    const speedSelect = document.getElementById('speedSelect');
    const progressContainer = document.getElementById('progressContainer');
    const progressPlayed = document.getElementById('progressPlayed');
    const currentTimeEl = document.getElementById('currentTime');
    const durationEl = document.getElementById('duration');
    const useProxyCheckbox = document.getElementById('useProxy');
    const urlSection = document.getElementById('urlSection');
    const playerSection = document.getElementById('playerSection');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const toast = document.getElementById('toast');
    const videoOverlay = document.getElementById('videoOverlay');
    const historySection = document.getElementById('historySection');
    const historyList = document.getElementById('historyList');

    // ===== State =====
    let isDragging = false;
    let isMuted = localStorage.getItem('sf_muted') === 'true';
    let lastVolume = parseFloat(localStorage.getItem('sf_volume'));
    if (isNaN(lastVolume)) lastVolume = 1;
    let toastTimeout;
    let rafId = null;
    let currentVideoUrl = null;
    let autoRetryCount = 0;
    const MAX_RETRIES = 3;
    let hlsInstance = null;

    // Load saved speed
    const savedSpeed = localStorage.getItem('sf_speed');
    if (savedSpeed) speedSelect.value = savedSpeed;

    // ===== Load Video =====
    function loadVideo(retryUrl = null, resumeTime = 0) {
        let url = retryUrl || urlInput.value.trim();
        if (!url) {
            showToast('Please enter a video URL', true);
            return;
        }

        const useProxy = useProxyCheckbox.checked;
        if (!retryUrl && useProxy) {
            // For HLS, proxying the master playlist often breaks relative TS segments unless the proxy rewrites them.
            // But we'll leave it as requested for now.
            url = '/proxy?url=' + encodeURIComponent(url);
        }

        currentVideoUrl = url;
        
        // Clean up previous HLS instance if it exists
        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }

        // HLS Support
        if ((urlInput.value.trim().toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.m3u8')) && window.Hls && Hls.isSupported()) {
            hlsInstance = new Hls({
                maxBufferLength: 30,
            });
            hlsInstance.loadSource(url);
            hlsInstance.attachMedia(video);
            
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, function() {
                if (resumeTime > 0) video.currentTime = resumeTime;
                video.play().catch(() => {});
                durationEl.textContent = 'Live / ' + formatTime(video.duration);
            });
            
            hlsInstance.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    switch(data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            hlsInstance.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hlsInstance.recoverMediaError();
                            break;
                        default:
                            hlsInstance.destroy();
                            break;
                    }
                }
            });
        } else {
            // Native fallback
            video.src = url;
            if (resumeTime > 0) {
                video.currentTime = resumeTime;
            }
            video.load();
            video.play().catch(() => {});
        }
        
        // UI Transitions
        urlSection.style.display = 'none';
        playerSection.classList.add('active');
        updatePlayIcon(false);
        showLoader(true);

        video.playbackRate = parseFloat(speedSelect.value);
    }

    // ===== History Management =====
    function loadHistory() {
        try {
            const history = JSON.parse(localStorage.getItem('sf_history') || '[]');
            if (history.length > 0) {
                historySection.style.display = 'block';
                historyList.innerHTML = history.map((item, index) => `
                    <div class="history-item" data-index="${index}">
                        <span class="history-url" title="${item.originalUrl}">${item.originalUrl}</span>
                        <span class="history-time">${formatTime(item.time)}</span>
                    </div>
                `).join('');
                
                // Add click listeners
                document.querySelectorAll('.history-item').forEach(el => {
                    el.addEventListener('click', () => {
                        const idx = el.getAttribute('data-index');
                        const item = history[idx];
                        urlInput.value = item.originalUrl;
                        useProxyCheckbox.checked = item.usedProxy;
                        loadVideo(null, item.time);
                    });
                });
            } else {
                historySection.style.display = 'none';
            }
        } catch (e) {}
    }

    function saveToHistory() {
        if (!currentVideoUrl || video.currentTime < 5) return;
        try {
            let history = JSON.parse(localStorage.getItem('sf_history') || '[]');
            const originalUrl = urlInput.value.trim();
            
            // Remove existing entry for same URL
            history = history.filter(h => h.originalUrl !== originalUrl);
            
            // Add to top
            history.unshift({
                originalUrl: originalUrl,
                usedProxy: useProxyCheckbox.checked,
                time: video.currentTime,
                timestamp: Date.now()
            });
            
            // Keep only last 10
            history = history.slice(0, 10);
            localStorage.setItem('sf_history', JSON.stringify(history));
            loadHistory(); // refresh UI
        } catch (e) {}
    }

    // Periodically save history if watching for a long time
    setInterval(() => {
        if (!video.paused && currentVideoUrl) saveToHistory();
    }, 30000);

    // ===== UI Updates =====
    function showToast(msg, isError = false) {
        toast.textContent = msg;
        if (isError) toast.classList.add('error');
        else toast.classList.remove('error');
        
        toast.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    function showLoader(show) {
        if (show) videoOverlay.classList.add('show');
        else videoOverlay.classList.remove('show');
    }

    function updatePlayIcon(playing) {
        if (playing) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = '';
        } else {
            playIcon.style.display = '';
            pauseIcon.style.display = 'none';
        }
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '00:00';
        seconds = Math.floor(seconds);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    // Debounced progress update using requestAnimationFrame
    function updateProgress() {
        if (!video.duration || isDragging) return;
        if (rafId) cancelAnimationFrame(rafId);
        
        rafId = requestAnimationFrame(() => {
            const percent = (video.currentTime / video.duration) * 100;
            progressPlayed.style.width = percent + '%';
            currentTimeEl.textContent = formatTime(video.currentTime);
        });
    }

    // ===== Seek =====
    function seekToTime(time) {
        if (!video.duration) return;
        const clamped = Math.max(0, Math.min(time, video.duration));
        video.currentTime = clamped;
    }

    let dragRaf = null;
    function seek(e) {
        if (dragRaf) return; 
        
        dragRaf = requestAnimationFrame(() => {
            const rect = progressContainer.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            const clampedPos = Math.max(0, Math.min(1, pos));
            seekToTime(clampedPos * video.duration);
            const percent = clampedPos * 100;
            progressPlayed.style.width = percent + '%';
            dragRaf = null;
        });
    }

    function skip(seconds) {
        seekToTime(video.currentTime + seconds);
        showToast(seconds > 0 ? `+${seconds}s` : `${seconds}s`);
    }

    // ===== Event Listeners =====
    loadBtn.addEventListener('click', () => { autoRetryCount = 0; loadVideo(); });
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { autoRetryCount = 0; loadVideo(); }
    });

    backBtn.addEventListener('click', () => {
        saveToHistory();
        video.pause();
        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }
        video.removeAttribute('src'); 
        video.load();
        currentVideoUrl = null;
        updatePlayIcon(false);
        playerSection.classList.remove('active');
        document.body.classList.remove('theater-mode');
        
        // Exit PiP if active
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(()=>{});
        }

        setTimeout(() => {
            urlSection.style.display = 'block';
            progressPlayed.style.width = '0%';
            currentTimeEl.textContent = '00:00';
            durationEl.textContent = '00:00';
        }, 300);
    });

    // Play/Pause
    playBtn.addEventListener('click', () => {
        if (video.paused) video.play();
        else video.pause();
    });
    
    video.addEventListener('click', () => {
        if (video.paused) video.play();
        else video.pause();
    });

    // Video events
    video.addEventListener('play', () => {
        updatePlayIcon(true);
        showLoader(false);
        autoRetryCount = 0; 
    });

    video.addEventListener('pause', () => {
        updatePlayIcon(false);
        saveToHistory();
    });

    video.addEventListener('ended', () => {
        updatePlayIcon(false);
    });

    video.addEventListener('timeupdate', updateProgress);

    video.addEventListener('loadedmetadata', () => {
        durationEl.textContent = formatTime(video.duration);
        showLoader(false);
    });

    video.addEventListener('waiting', () => {
        showLoader(true);
    });

    video.addEventListener('canplay', () => {
        showLoader(false);
    });

    video.addEventListener('error', () => {
        showLoader(false);
        const error = video.error;
        
        // Auto-recovery
        if (error && error.code === 2 && currentVideoUrl && video.currentTime > 0) {
            if (autoRetryCount < MAX_RETRIES) {
                autoRetryCount++;
                showToast(`Connection lost. Reconnecting... (${autoRetryCount}/${MAX_RETRIES})`, true);
                const resumeTime = video.currentTime;
                setTimeout(() => loadVideo(currentVideoUrl, resumeTime), 2000);
                return;
            }
        }
        
        let msg = 'Unable to load video';
        if (error) {
            switch(error.code) {
                case 2: msg = 'Network error - check URL or connection'; break;
                case 3: msg = 'Video decoding error'; break;
                case 4: msg = 'Video not found or unsupported format'; break;
            }
        }
        showToast(msg, true);
    });

    // Skip
    skipBackBtn.addEventListener('click', () => skip(-10));
    skipForwardBtn.addEventListener('click', () => skip(10));

    // Progress bar
    progressContainer.addEventListener('click', seek);

    progressContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        seek(e);
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        seek(e);
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        if (dragRaf) {
            cancelAnimationFrame(dragRaf);
            dragRaf = null;
        }
    });

    // Volume
    volumeSlider.addEventListener('input', () => {
        video.volume = volumeSlider.value;
        video.muted = video.volume === 0;
        updateMuteUI();
    });

    muteBtn.addEventListener('click', () => {
        if (video.muted) {
            video.muted = false;
            video.volume = lastVolume;
        } else {
            lastVolume = video.volume || 1;
            video.muted = true;
        }
        updateMuteUI();
    });

    function updateMuteUI() {
        isMuted = video.muted;
        
        localStorage.setItem('sf_muted', isMuted);
        localStorage.setItem('sf_volume', video.volume);

        if (isMuted) {
            muteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
            volumeSlider.value = 0;
        } else {
            muteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
            volumeSlider.value = video.volume;
        }
    }

    // Speed
    speedSelect.addEventListener('change', () => {
        video.playbackRate = parseFloat(speedSelect.value);
        localStorage.setItem('sf_speed', speedSelect.value);
        showToast(`${speedSelect.value}x Speed`);
    });

    // PiP
    pipBtn.addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled) {
                await video.requestPictureInPicture();
            } else {
                showToast('PiP is not supported by your browser', true);
            }
        } catch (err) {
            showToast('Failed to enter PiP mode', true);
        }
    });

    // Theater Mode
    theaterBtn.addEventListener('click', () => {
        document.body.classList.toggle('theater-mode');
        showToast(document.body.classList.contains('theater-mode') ? 'Theater Mode ON' : 'Theater Mode OFF');
    });

    // Fullscreen
    fullscreenBtn.addEventListener('click', () => {
        const container = document.querySelector('.video-container');
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    });

    // ===== Keyboard Shortcuts =====
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (!playerSection.classList.contains('active')) return;

        switch(e.key) {
            case ' ':
            case 'Space':
                e.preventDefault();
                playBtn.click();
                break;
            case 'f':
            case 'F':
                fullscreenBtn.click();
                break;
            case 't':
            case 'T':
                theaterBtn.click();
                break;
            case 'p':
            case 'P':
                pipBtn.click();
                break;
            case 'm':
            case 'M':
                muteBtn.click();
                break;
            case 'ArrowRight':
                e.preventDefault();
                skip(10);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                skip(-10);
                break;
            case 'ArrowUp':
                e.preventDefault();
                video.volume = Math.min(1, video.volume + 0.1);
                updateMuteUI();
                break;
            case 'ArrowDown':
                e.preventDefault();
                video.volume = Math.max(0, video.volume - 0.1);
                updateMuteUI();
                break;
        }
    });

    // ===== Auto-load from URL param =====
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    if (urlParam) {
        urlInput.value = decodeURIComponent(urlParam);
        loadVideo();
    }

    // ===== Init =====
    video.muted = isMuted;
    video.volume = isMuted ? 0 : lastVolume;
    updateMuteUI();
    loadHistory();
})();
