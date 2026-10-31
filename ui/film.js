/**
 * Long-form mode (narration -> scenes -> per-scene code -> render)
 *
 * Kept in a separate file so the original single-composition flow in app.js
 * stays untouched. Progress UI helpers (updateProgress, addLog, showError, ...)
 * come from app.js.
 */

(function () {
    const BASE = 'http://127.0.0.1:3847';

    const el = {
        tabs: document.querySelectorAll('.mode-tab'),
        singleMode: document.getElementById('singleMode'),
        filmMode: document.getElementById('filmMode'),

        drop: document.getElementById('audioDrop'),
        dropText: document.getElementById('audioDropText'),
        audioInput: document.getElementById('audioInput'),
        audioMeta: document.getElementById('audioMeta'),

        name: document.getElementById('filmName'),
        size: document.getElementById('filmSize'),
        fps: document.getElementById('filmFps'),
        sceneLength: document.getElementById('filmSceneLength'),
        model: document.getElementById('filmModel'),
        analyzeBtn: document.getElementById('analyzeBtn'),

        badge: document.getElementById('filmBadge'),
        summary: document.getElementById('filmSummary'),
        sceneList: document.getElementById('sceneList'),
        refreshBtn: document.getElementById('refreshFilmsBtn'),
        openFolderBtn: document.getElementById('openFilmFolderBtn'),
        renderFilmBtn: document.getElementById('renderFilmBtn'),

        projects: document.getElementById('filmProjects'),
        projectsList: document.getElementById('filmProjectsList'),

        sceneModal: document.getElementById('sceneModal'),
        sceneModalOverlay: document.getElementById('sceneModalOverlay'),
        sceneModalTitle: document.getElementById('sceneModalTitle'),
        sceneModalMeta: document.getElementById('sceneModalMeta'),
        closeSceneModal: document.getElementById('closeSceneModal'),
        sceneCode: document.getElementById('sceneCode'),
        sceneJson: document.getElementById('sceneJson'),
        copyPromptBtn: document.getElementById('copyPromptBtn'),
        saveSceneBtn: document.getElementById('saveSceneBtn'),
        renderSceneBtn: document.getElementById('renderSceneBtn'),
        stillSceneBtn: document.getElementById('stillSceneBtn'),
    };

    const state = {
        audio: null, // { path, name, size, duration }
        filmId: null,
        dir: null,
        film: null,
        scenes: [],
        activeScene: null,
        activePrompt: '',
        activeJson: null,
        busy: false,
        uploading: false,
    };

    // ---------------------------------------------------------------- utils
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function toast(message) {
        let node = document.querySelector('.toast');
        if (!node) {
            node = document.createElement('div');
            node.className = 'toast';
            document.body.appendChild(node);
        }
        node.textContent = message;
        node.classList.add('visible');
        clearTimeout(node._timer);
        node._timer = setTimeout(() => node.classList.remove('visible'), 2600);
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function timecode(seconds) {
        const total = Math.max(0, Number(seconds) || 0);
        const minutes = Math.floor(total / 60);
        const rest = total - minutes * 60;
        return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
    }

    function humanSize(bytes) {
        if (!bytes) return '';
        const mb = bytes / (1024 * 1024);
        return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
    }

    async function api(path, options) {
        const response = await fetch(`${BASE}${path}`, options);
        let data = null;
        try {
            data = await response.json();
        } catch (err) {
            data = null;
        }
        if (!response.ok) {
            throw new Error((data && data.error) || `فشل الطلب (${response.status})`);
        }
        return data || {};
    }

    function postJson(path, body) {
        return api(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            toast('تم النسخ ✓');
            return true;
        } catch (err) {
            try {
                const area = document.createElement('textarea');
                area.value = text;
                area.style.position = 'fixed';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.select();
                document.execCommand('copy');
                document.body.removeChild(area);
                toast('تم النسخ ✓');
                return true;
            } catch (err2) {
                toast('تعذّر النسخ — افتح ملف البرومت من مجلد المشروع');
                return false;
            }
        }
    }

    // --------------------------------------------------------------- tabs
    el.tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            el.tabs.forEach((item) => item.classList.toggle('active', item === tab));
            const mode = tab.dataset.mode;
            el.singleMode.style.display = mode === 'single' ? 'block' : 'none';
            el.filmMode.style.display = mode === 'film' ? 'block' : 'none';
            if (mode === 'film') refreshFilmList();
        });
    });

    // ------------------------------------------------------------- upload
    el.drop.addEventListener('click', () => el.audioInput.click());

    el.drop.addEventListener('dragover', (event) => {
        event.preventDefault();
        el.drop.classList.add('dragover');
    });
    el.drop.addEventListener('dragleave', () => el.drop.classList.remove('dragover'));
    el.drop.addEventListener('drop', (event) => {
        event.preventDefault();
        el.drop.classList.remove('dragover');
        const file = event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) uploadAudio(file);
    });

    el.audioInput.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) uploadAudio(file);
    });

    async function uploadAudio(file) {
        if (state.uploading) return;
        state.uploading = true;
        el.dropText.textContent = `جاري رفع ${file.name} (${humanSize(file.size)})...`;
        try {
            const response = await fetch(
                `${BASE}/upload?name=${encodeURIComponent(file.name)}`,
                { method: 'POST', body: file }
            );
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'فشل الرفع');
            state.audio = data;
            el.dropText.textContent = `✓ ${data.name}`;
            el.audioMeta.style.display = 'block';
            el.audioMeta.innerHTML =
                `<strong>تم رفع التعليق الصوتي</strong><br>` +
                `المدة: ${data.duration ? `${data.duration.toFixed(1)} ثانية` : 'غير معروفة (سيتم حسابها أثناء التحليل)'}` +
                ` · الحجم: ${humanSize(data.size)}<br>` +
                `<span style="color:var(--text-muted)">${escapeHtml(data.path)}</span>`;
        } catch (err) {
            el.dropText.textContent = 'اسحب ملف الصوت هنا أو اضغط للاختيار';
            toast(err.message);
        } finally {
            state.uploading = false;
            el.audioInput.value = '';
        }
    }

    // ---------------------------------------------------------- task runner
    async function trackTask(taskId, title) {
        progressSection.style.display = 'block';
        resultSection.style.display = 'none';
        successCard.style.display = 'none';
        errorCard.style.display = 'none';
        progressLog.innerHTML = '';
        updateProgress(1, title);

        let seen = 0;
        let lastLine = '';

        for (let i = 0; i < 100000; i += 1) {
            const status = await api(`/status/${taskId}`);

            if (Array.isArray(status.logs)) {
                const fresh = status.logs.slice(seen);
                seen = status.logs.length;
                fresh.forEach((line) => {
                    if (line !== lastLine) {
                        addLog(line);
                        lastLine = line;
                    }
                });
            }

            updateProgress(status.progress || 0, status.message || title);

            if (status.status === 'completed') {
                progressSection.style.display = 'none';
                return status;
            }
            if (status.status === 'error') {
                showError(status.error || 'فشلت العملية', status.logs || []);
                throw new Error(status.error || 'فشلت العملية');
            }
            await sleep(900);
        }
        throw new Error('انتهت مدة الانتظار');
    }

    // ------------------------------------------------------------- analyze
    el.analyzeBtn.addEventListener('click', async () => {
        if (state.busy) return;
        if (!state.audio) {
            toast('ارفع ملف الصوت أولًا');
            return;
        }

        const [width, height] = el.size.value.split('x').map(Number);
        const fps = Number(el.fps.value) || 30;
        const target = Number(el.sceneLength.value) || 14;
        const model = el.model.value || 'small';

        state.busy = true;
        el.analyzeBtn.disabled = true;

        try {
            let filmId = null;
            const sameAudio =
                state.film &&
                state.film.sourceAudio &&
                state.audio.path &&
                state.film.sourceAudio === state.audio.path;

            if (sameAudio) {
                filmId = state.film.id;
            } else {
                const created = await postJson('/film/create', {
                    name: el.name.value.trim() || 'فيلمي',
                    audioPath: state.audio.path,
                    audioDuration: state.audio.duration,
                    fps,
                    width,
                    height,
                    language: 'ar',
                    model,
                    settings: {
                        minSceneSeconds: Math.max(4, Math.round(target * 0.45)),
                        targetSceneSeconds: target,
                        maxSceneSeconds: Math.round(target * 1.6),
                    },
                });
                filmId = created.filmId;
                state.dir = created.dir;
            }

            const analysis = await postJson('/film/analyze', {
                filmId,
                model,
                language: 'ar',
                settings: {
                    minSceneSeconds: Math.max(4, Math.round(target * 0.45)),
                    targetSceneSeconds: target,
                    maxSceneSeconds: Math.round(target * 1.6),
                },
            });

            if (!analysis.taskId) throw new Error(analysis.error || 'تعذّر بدء التحليل');

            await trackTask(analysis.taskId, 'جاري تحليل الصوت...');
            await loadFilm(filmId);
            toast('تم تقسيم المشاهد ✓');
        } catch (err) {
            if (!String(err.message).includes('فشلت العملية')) toast(err.message);
        } finally {
            state.busy = false;
            el.analyzeBtn.disabled = false;
        }
    });

    // ---------------------------------------------------------- load film
    async function loadFilm(filmId) {
        const data = await api(`/film/get?filmId=${encodeURIComponent(filmId)}`);
        state.filmId = filmId;
        state.film = data.film;
        state.dir = data.dir;
        state.scenes = data.scenes || [];

        el.badge.textContent = `${state.film.name} · ${state.scenes.length} مشهد`;
        el.badge.classList.add('ready');

        const ready = state.scenes.filter((scene) => scene.hasCode).length;
        el.summary.innerHTML =
            `المشروع: <strong>${escapeHtml(state.film.name)}</strong><br>` +
            `المدة: <strong>${timecode(state.film.audioDuration)}</strong> · ` +
            `${state.film.width}×${state.film.height} · ${state.film.fps}fps<br>` +
            `المشاهد: <strong>${state.scenes.length}</strong> · فيها كود: <strong>${ready}</strong><br>` +
            `<span style="color:var(--text-muted)">${escapeHtml(data.dir)}</span>`;

        el.openFolderBtn.disabled = false;
        el.renderFilmBtn.disabled = state.scenes.length === 0;
        el.name.value = state.film.name || el.name.value;

        renderScenes();
    }

    function renderScenes() {
        if (!state.scenes.length) {
            el.sceneList.innerHTML =
                '<div class="film-summary">لا توجد مشاهد بعد.</div>';
            return;
        }

        el.sceneList.innerHTML = state.scenes
            .map(
                (scene) => `
            <div class="scene-item" data-scene="${scene.id}">
                <div class="scene-main">
                    <span class="scene-index">${String(scene.index).padStart(2, '0')}</span>
                    <div class="scene-info">
                        <div class="scene-title">${escapeHtml(scene.title || scene.id)}</div>
                        <div class="scene-meta">${timecode(scene.start)} → ${timecode(scene.end)} · ${scene.duration}s · ${scene.durationInFrames} إطار</div>
                        <div class="scene-text">${escapeHtml(scene.text || '')}</div>
                    </div>
                    <span class="scene-status ${scene.hasCode ? 'ready' : 'empty'}">${scene.hasCode ? 'جاهز' : 'بدون كود'}</span>
                </div>
                <div class="scene-actions">
                    <button data-act="edit">تحرير الكود</button>
                    <button data-act="prompt">نسخ البرومت</button>
                    <button data-act="preview">معاينة (بدون رندر)</button>
                    <button data-act="still">صورة معاينة</button>
                    <button data-act="render">رندر المشهد</button>
                </div>
            </div>`
            )
            .join('');
    }

    el.sceneList.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-act]');
        if (!button) return;
        const card = event.target.closest('.scene-item');
        if (!card) return;
        const sceneId = card.dataset.scene;
        const action = button.dataset.act;

        if (state.busy) {
            toast('انتظر انتهاء العملية الحالية');
            return;
        }

        if (action === 'edit') await openSceneEditor(sceneId);
        if (action === 'preview') await previewScene(sceneId);
        if (action === 'prompt') {
            try {
                const data = await api(
                    `/film/scene?filmId=${encodeURIComponent(state.filmId)}&sceneId=${sceneId}`
                );
                await copyText(data.prompt || '');
            } catch (err) {
                toast(err.message);
            }
        }
        if (action === 'still') await renderStill(sceneId);
        if (action === 'render') await renderScene(sceneId);
    });

    // --------------------------------------------------------- scene modal
    async function openSceneEditor(sceneId) {
        try {
            const data = await api(
                `/film/scene?filmId=${encodeURIComponent(state.filmId)}&sceneId=${sceneId}`
            );
            state.activeScene = sceneId;
            state.activePrompt = data.prompt || '';
            state.activeJson = data.scene || null;

            const scene = data.scene || {};
            el.sceneModalTitle.textContent = `${sceneId} · ${scene.title || ''}`;
            el.sceneModalMeta.textContent = `${timecode(scene.start)} → ${timecode(
                scene.end
            )} · ${scene.duration}s · ${scene.durationInFrames} إطار`;
            el.sceneCode.value = data.code || '';
            el.sceneJson.textContent = JSON.stringify(data.scene || {}, null, 2);
            el.sceneModal.classList.add('active');
        } catch (err) {
            toast(err.message);
        }
    }

    function closeSceneEditor() {
        el.sceneModal.classList.remove('active');
        state.activeScene = null;
    }

    el.closeSceneModal.addEventListener('click', closeSceneEditor);
    el.sceneModalOverlay.addEventListener('click', closeSceneEditor);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeSceneEditor();
    });

    el.copyPromptBtn.addEventListener('click', async () => {
        if (!state.activeScene) return;
        if (!state.activePrompt) {
            try {
                const data = await api(
                    `/film/scene?filmId=${encodeURIComponent(state.filmId)}&sceneId=${state.activeScene}`
                );
                state.activePrompt = data.prompt || '';
            } catch (err) {
                toast(err.message);
                return;
            }
        }
        await copyText(state.activePrompt);
    });

    el.saveSceneBtn.addEventListener('click', async () => {
        if (!state.activeScene) return;
        const code = el.sceneCode.value;
        try {
            await postJson('/film/scene-save', {
                filmId: state.filmId,
                sceneId: state.activeScene,
                code,
            });
            toast('تم حفظ الكود ✓');
            if (state.film) await loadFilm(state.filmId);
        } catch (err) {
            toast(err.message);
        }
    });

    el.renderSceneBtn.addEventListener('click', async () => {
        if (!state.activeScene) return;
        await renderScene(state.activeScene);
    });

    el.stillSceneBtn.addEventListener('click', async () => {
        if (!state.activeScene) return;
        await renderStill(state.activeScene);
    });

    // ----------------------------------------------------------- preview
    let activePreviewId = null;

    async function previewScene(sceneId) {
        if (state.busy) return;
        state.busy = true;
        try {
            const { previewId, url } = await postJson('/preview/start', {
                mode: 'single',
                filmId: state.filmId,
                sceneId,
            });
            activePreviewId = previewId;
            window.open(url, '_blank');
            toast('تم فتح المعاينة (Remotion Studio) ✓');
        } catch (err) {
            toast(err.message);
        } finally {
            state.busy = false;
        }
    }

    async function previewFilm() {
        if (state.busy || !state.filmId) return;
        state.busy = true;
        try {
            const { previewId, url } = await postJson('/preview/start', {
                mode: 'film',
                filmId: state.filmId,
            });
            activePreviewId = previewId;
            window.open(url, '_blank');
            toast('تم فتح معاينة الفيلم ✓');
        } catch (err) {
            toast(err.message);
        } finally {
            state.busy = false;
        }
    }

    async function stopPreview() {
        if (!activePreviewId) return;
        try {
            await postJson('/preview/stop', { previewId: activePreviewId });
        } catch (err) { /* ignore */ }
        activePreviewId = null;
        toast('تم إيقاف المعاينة');
    }

    // ------------------------------------------------------------ renders
    async function renderScene(sceneId) {
        if (state.busy) return;
        state.busy = true;
        try {
            const { taskId } = await postJson('/film/render-scene', {
                filmId: state.filmId,
                sceneId,
            });
            const status = await trackTask(taskId, `جاري توليد المشهد ${sceneId}...`);
            showSuccess(status.outputPath);
            openVideoModal(`${BASE}/file?path=${encodeURIComponent(status.outputPath)}`);
        } catch (err) {
            /* error already surfaced by trackTask */
        } finally {
            state.busy = false;
        }
    }

    async function renderStill(sceneId) {
        if (state.busy) return;
        state.busy = true;
        try {
            const { taskId } = await postJson('/film/still', {
                filmId: state.filmId,
                sceneId,
                time: 1,
            });
            const status = await trackTask(taskId, `جاري توليد صورة من ${sceneId}...`);
            window.open(`${BASE}/file?path=${encodeURIComponent(status.outputPath)}`, '_blank');
            toast('تم توليد الصورة ✓');
        } catch (err) {
            /* ignore */
        } finally {
            state.busy = false;
        }
    }

    // add preview button next to renderFilmBtn (created once)
    (function addPreviewButton() {
        const btn = document.createElement('button');
        btn.className = 'btn-small';
        btn.textContent = 'معاينة الفيلم (بدون رندر)';
        btn.style.marginBottom = '8px';
        btn.addEventListener('click', previewFilm);
        const parent = el.renderFilmBtn.parentNode;
        if (parent) parent.insertBefore(btn, el.renderFilmBtn);
    })();

    el.renderFilmBtn.addEventListener('click', async () => {
        if (state.busy || !state.filmId) return;
        const missing = state.scenes.filter((scene) => !scene.hasCode);
        if (missing.length) {
            const proceed = window.confirm(
                `هناك ${missing.length} مشهد بدون كود (${missing.map((s) => s.id).join(', ')}).\n` +
                    'هل تريد رندر الفيلم مع تخطي المشاهد الفارغة؟'
            );
            if (!proceed) return;
        }

        state.busy = true;
        el.renderFilmBtn.disabled = true;
        try {
            const { taskId } = await postJson('/film/render-film', {
                filmId: state.filmId,
                allowMissing: missing.length > 0,
            });
            const status = await trackTask(taskId, 'جاري توليد الفيلم الكامل...');
            showSuccess(status.outputPath);
            openVideoModal(`${BASE}/file?path=${encodeURIComponent(status.outputPath)}`);
        } catch (err) {
            /* ignore */
        } finally {
            state.busy = false;
            el.renderFilmBtn.disabled = false;
        }
    });

    // -------------------------------------------------------------- folders
    el.openFolderBtn.addEventListener('click', async () => {
        if (!state.dir) return;
        try {
            await postJson('/open-folder', { path: state.dir });
        } catch (err) {
            toast(err.message);
        }
    });

    // -------------------------------------------------------- film listing
    async function refreshFilmList() {
        try {
            const data = await api('/film/list');
            const films = data.films || [];
            if (!films.length) {
                el.projects.style.display = 'none';
                return;
            }
            el.projects.style.display = 'block';
            el.projectsList.innerHTML = films
                .map(
                    (film) => `
                <button class="film-project-chip" data-film="${film.id}">
                    ${escapeHtml(film.name)}
                    <small>${film.sceneCount} مشهد · ${film.readyScenes} جاهز · ${timecode(
                        film.audioDuration
                    )}</small>
                </button>`
                )
                .join('');
        } catch (err) {
            /* server might not be ready yet */
        }
    }

    el.projectsList.addEventListener('click', async (event) => {
        const chip = event.target.closest('[data-film]');
        if (!chip) return;
        try {
            await loadFilm(chip.dataset.film);
            toast('تم تحميل المشروع');
        } catch (err) {
            toast(err.message);
        }
    });

    el.refreshBtn.addEventListener('click', async () => {
        await refreshFilmList();
        if (state.filmId) {
            try {
                await loadFilm(state.filmId);
            } catch (err) {
                /* ignore */
            }
        }
    });

    // ------------------------------------------------------------- startup
    document.addEventListener('DOMContentLoaded', async () => {
        await refreshFilmList();
    });
})();
