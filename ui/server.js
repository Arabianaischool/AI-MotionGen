/**
 * Remotion UI Server
 * Backend server for the Arabic UI
 *
 * Two modes:
 *   - short form: paste one TSX composition -> /render
 *   - long form : upload narration -> /film/* (analyze, scene code, render)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, exec, execFileSync } = require('child_process');
const url = require('url');

const { splitScenes } = require('./lib/scene-split');
const filmLib = require('./lib/film-project');

const PORT = 3847;
const HOST = '127.0.0.1';
const SCRIPT_DIR = path.dirname(__dirname);
const TSX_DIR = path.join(SCRIPT_DIR, 'projects');
const RENDERS_DIR = path.join(SCRIPT_DIR, 'renders');
const FILMS_DIR = path.join(SCRIPT_DIR, 'films');
const UPLOADS_DIR = path.join(SCRIPT_DIR, 'uploads');
const MODELS_DIR = path.join(SCRIPT_DIR, 'tools', 'models');
const NODE_EXE = path.join(SCRIPT_DIR, 'node', 'node.exe');
const RENDER_FILM = path.join(SCRIPT_DIR, 'renderer', 'render-film.js');
const TRANSCRIBE_PY = path.join(SCRIPT_DIR, 'tools', 'transcribe.py');

// Track render / analysis tasks
const tasks = new Map();

[TSX_DIR, RENDERS_DIR, FILMS_DIR, UPLOADS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// MIME types
const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// ---------------------------------------------------------------------------
// generic helpers
// ---------------------------------------------------------------------------

async function parseBody(req, limitBytes = 5 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limitBytes) {
                reject(new Error('الطلب أكبر من الحد المسموح'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new Error('JSON غير صالح في الطلب'));
            }
        });
        req.on('error', reject);
    });
}

async function readRawBody(req, limitBytes = 512 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limitBytes) {
                reject(new Error('حجم الملف أكبر من 512 ميجابايت'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function sendJson(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function safeFileName(name, fallback = 'file') {
    const cleaned = String(name || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .slice(-80);
    return cleaned || fallback;
}

function ffprobeDuration(filePath) {
    try {
        const out = execFileSync(
            'ffprobe',
            ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
            { encoding: 'utf-8', timeout: 15000 }
        );
        const value = parseFloat(String(out).trim());
        return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
    } catch (err) {
        return 0;
    }
}

let pythonCache = null;
function detectPython() {
    if (pythonCache) return pythonCache;
    const candidates = [
        { cmd: 'python', pre: [] },
        { cmd: 'py', pre: ['-3'] },
        { cmd: 'python3', pre: [] },
    ];
    let usable = null;
    for (const candidate of candidates) {
        try {
            execFileSync(candidate.cmd, [...candidate.pre, '-c', 'import sys'], {
                stdio: 'ignore',
                timeout: 15000,
            });
            usable = candidate;
            break;
        } catch (err) {
            /* try the next one */
        }
    }
    if (!usable) {
        pythonCache = { ok: false, reason: 'لم يتم العثور على Python على هذا الجهاز' };
        return pythonCache;
    }
    let hasWhisper = false;
    try {
        execFileSync(usable.cmd, [...usable.pre, '-c', 'import faster_whisper'], {
            stdio: 'ignore',
            timeout: 60000,
        });
        hasWhisper = true;
    } catch (err) {
        hasWhisper = false;
    }
    pythonCache = { ok: true, hasWhisper, ...usable };
    return pythonCache;
}

// ---------------------------------------------------------------------------
// task runner
// ---------------------------------------------------------------------------

function createTask(taskId, message) {
    const task = {
        id: taskId,
        status: 'running',
        progress: 0,
        message: message || 'جاري التجهيز...',
        logs: [],
        outputPath: null,
        error: null,
        meta: {},
        startedAt: Date.now(),
        child: null,
    };
    tasks.set(taskId, task);
    return task;
}

function pushLog(task, line) {
    const text = String(line).replace(/\s+$/, '');
    if (!text.trim()) return;
    task.logs.push(text);
    if (task.logs.length > 4000) task.logs.splice(0, task.logs.length - 4000);
}

/**
 * Parse one line of child output. Understands the @@ protocol plus the legacy
 * render-cli.js progress lines.
 */
function handleTaskLine(task, line) {
    const text = String(line);

    let match = text.match(/^@@PROGRESS:(\d+(?:\.\d+)?):?(.*)$/);
    if (match) {
        task.progress = parseFloat(match[1]);
        if (match[2]) task.message = match[2];
        return;
    }
    if (text.startsWith('@@DONE:')) {
        task.outputPath = text.slice('@@DONE:'.length).trim();
        task.progress = Math.max(task.progress, 99);
        return;
    }
    if (text.startsWith('@@ERROR:')) {
        task.error = text.slice('@@ERROR:'.length).trim();
        pushLog(task, text.slice('@@ERROR:'.length));
        return;
    }

    // legacy single-composition renderer output
    match = text.match(/Bundling:\s*(\d+)%/);
    if (match) {
        task.progress = 5 + parseInt(match[1], 10) * 0.3;
        task.message = 'جاري تجهيز الكود...';
    } else if (text.match(/Rendering:\s*(\d+)%/)) {
        const p = parseInt(text.match(/Rendering:\s*(\d+)%/)[1], 10);
        task.progress = 40 + p * 0.55;
        task.message = 'جاري توليد الفيديو...';
    } else if (text.includes('Downloading browser')) {
        const p = text.match(/(\d+)%/);
        if (p) {
            task.progress = 2 + parseInt(p[1], 10) * 0.03;
            task.message = 'جاري تحميل المتصفح...';
        }
    } else if (text.includes('Browser ready')) {
        task.progress = 6;
        task.message = 'المتصفح جاهز';
    } else if (text.includes('Bundle complete')) {
        task.progress = 36;
        task.message = 'تم تجهيز الكود';
    } else if (text.includes('Render complete')) {
        task.progress = 95;
        task.message = 'جاري الحفظ...';
    }

    pushLog(task, text);
}

function runTask(taskId, options) {
    const task = createTask(taskId, options.message);
    task.meta = options.meta || {};

    const child = spawn(options.command, options.args || [], {
        cwd: options.cwd || SCRIPT_DIR,
        env: { ...process.env, ...(options.env || {}) },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    task.child = child;

    const stdout = readline.createInterface({ input: child.stdout });
    const stderr = readline.createInterface({ input: child.stderr });
    stdout.on('line', (line) => {
        handleTaskLine(task, line);
        console.log('[task]', line);
    });
    stderr.on('line', (line) => {
        handleTaskLine(task, `[stderr] ${line}`);
        console.log('[task:err]', line);
    });

    child.on('error', (err) => {
        task.status = 'error';
        task.error = err.message;
    });

    child.on('close', (code) => {
        task.duration = Math.round((Date.now() - task.startedAt) / 1000);
        if (task.status === 'error') return;
        if (task.error) {
            task.status = 'error';
            return;
        }
        const expected = options.expectFile || task.outputPath;
        if (expected && fs.existsSync(expected)) {
            task.status = 'completed';
            task.progress = 100;
            task.message = 'تم بنجاح';
            task.outputPath = expected;
            return;
        }
        if (code === 0) {
            task.status = 'completed';
            task.progress = 100;
            task.message = task.message || 'تم بنجاح';
            if (typeof options.onSuccess === 'function') {
                try {
                    options.onSuccess(task);
                } catch (err) {
                    task.status = 'error';
                    task.error = err.message;
                }
            }
            return;
        }
        task.status = 'error';
        task.error = task.error || `فشل الأمر (رمز الخروج ${code})`;
    });

    return task;
}

// ---------------------------------------------------------------------------
// short form (existing flow)
// ---------------------------------------------------------------------------

function saveTsxFile(code, filename) {
    const safeName = String(filename || 'MyVideo').replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fullFilename = `${safeName}_${timestamp}.tsx`;
    const filepath = path.join(TSX_DIR, fullFilename);

    fs.writeFileSync(filepath, code, 'utf-8');
    return filepath;
}

function startRender(taskId, tsxFilePath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputName = path.basename(tsxFilePath, '.tsx') + '_' + timestamp + '.mp4';
    const outputPath = path.join(RENDERS_DIR, outputName);

    runTask(taskId, {
        command: 'cmd.exe',
        args: ['/c', 'render.bat', tsxFilePath, outputPath],
        message: 'جاري التجهيز...',
        expectFile: outputPath,
        meta: { mode: 'single', tsx: tsxFilePath },
    });

    return taskId;
}

// ---------------------------------------------------------------------------
// long form: analysis
// ---------------------------------------------------------------------------

function analyzeFilmIntoTask(taskId, filmId, options = {}) {
    const { dir, film } = filmLib.loadFilm(FILMS_DIR, filmId);
    const transcriptPath = path.join(dir, 'transcript.json');
    const force = Boolean(options.force);

    const finishAnalysis = () => {
        const transcript = filmLib.readJson(transcriptPath);
        const { scenes, totals, settings } = splitScenes(transcript, {
            fps: film.fps,
            audioDuration: film.audioDuration || transcript.duration,
            ...(options.settings || film.settings || {}),
        });

        if (!scenes.length) {
            throw new Error('لم يتم استخراج أي مشاهد من الصوت. جرّب موديلًا أكبر أو ارفع نصًا يدويًا.');
        }

        film.status = 'analyzed';
        film.language = transcript.language || film.language || 'ar';
        film.audioDuration = transcript.duration || film.audioDuration;
        film.settings = {
            minSceneSeconds: settings.minSceneSeconds,
            targetSceneSeconds: settings.targetSceneSeconds,
            maxSceneSeconds: settings.maxSceneSeconds,
            padSeconds: settings.padSeconds,
        };
        film.scenes = scenes;
        film.totals = totals;
        film.analyzedAt = new Date().toISOString();

        filmLib.writeSceneArtifacts(dir, film);
        filmLib.writeFilmFile(dir, film);
        return { sceneCount: scenes.length, totals };
    };

    const task = createTask(taskId, 'جاري تحليل التعليق الصوتي...');
    task.meta = { mode: 'analyze', filmId };

    const alreadyTranscribed = fs.existsSync(transcriptPath) && !force;

    if (alreadyTranscribed) {
        try {
            task.progress = 60;
            task.message = 'تم العثور على نص سابق — جاري تقسيم المشاهد...';
            const result = finishAnalysis();
            task.status = 'completed';
            task.progress = 100;
            task.message = `تم إنشاء ${result.sceneCount} مشهد`;
            task.meta.result = result;
        } catch (err) {
            task.status = 'error';
            task.error = err.message;
        }
        return task;
    }

    const python = detectPython();
    if (!python.ok) {
        task.status = 'error';
        task.error = `${python.reason}. ثبّت Python أو ارفع ملف نص (transcript.json) يدويًا.`;
        return task;
    }
    if (!python.hasWhisper) {
        task.status = 'error';
        task.error =
            'حزمة faster-whisper غير مثبتة. شغّل: python -m pip install faster-whisper';
        return task;
    }

    const audioFile = path.join(dir, 'public', film.audio || 'voiceover.wav');
    if (!fs.existsSync(audioFile)) {
        task.status = 'error';
        task.error = `ملف الصوت غير موجود: ${audioFile}`;
        return task;
    }

    // if only a bad/partial transcript exists, start clean
    if (fs.existsSync(transcriptPath)) {
        try { fs.unlinkSync(transcriptPath); } catch (err) { /* ignore */ }
    }

    const child = spawn(
        python.cmd,
        [
            ...python.pre,
            '-u',
            TRANSCRIBE_PY,
            '--input', audioFile,
            '--output', transcriptPath,
            '--language', options.language || film.language || 'ar',
            '--model', options.model || film.model || 'small',
            '--duration', String(film.audioDuration || 0),
            '--download-root', MODELS_DIR,
        ],
        {
            cwd: SCRIPT_DIR,
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                PYTHONUTF8: '1',
                PYTHONUNBUFFERED: '1',
            },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    task.child = child;

    const stdout = readline.createInterface({ input: child.stdout });
    const stderr = readline.createInterface({ input: child.stderr });
    stdout.on('line', (line) => {
        handleTaskLine(task, line);
        if (!line.startsWith('@@')) console.log('[py]', line);
    });
    stderr.on('line', (line) => {
        const trimmed = String(line).trim();
        if (!trimmed) return;
        // faster-whisper download bars are noisy; keep the tail only
        pushLog(task, trimmed.slice(0, 300));
        console.log('[py:err]', trimmed);
    });

    child.on('error', (err) => {
        task.status = 'error';
        task.error = err.message;
    });

    child.on('close', (code) => {
        if (task.status === 'error') return;
        task.duration = Math.round((Date.now() - task.startedAt) / 1000);
        if (code !== 0 || task.error || !fs.existsSync(transcriptPath)) {
            task.status = 'error';
            task.error =
                task.error ||
                (code !== 0
                    ? `فشل التحليل (رمز الخروج ${code}) — راجع السجل`
                    : 'لم يتم إنشاء ملف النص');
            return;
        }
        try {
            task.progress = 88;
            task.message = 'جاري تقسيم المشاهد...';
            const result = finishAnalysis();
            task.status = 'completed';
            task.progress = 100;
            task.message = `تم إنشاء ${result.sceneCount} مشهد`;
            task.meta.result = result;
        } catch (err) {
            task.status = 'error';
            task.error = err.message;
        }
    });

    return task;
}

// ---------------------------------------------------------------------------
// long form: rendering
// ---------------------------------------------------------------------------

function filmRenderTask(taskId, filmId, mode, options = {}) {
    const { dir, film } = filmLib.loadFilm(FILMS_DIR, filmId);
    const args = [RENDER_FILM, `--project=${dir}`, `--mode=${mode}`];

    if (options.sceneId) args.push(`--scene=${options.sceneId}`);
    if (options.time !== undefined && options.time !== null) args.push(`--time=${options.time}`);
    if (options.frame !== undefined && options.frame !== null) args.push(`--frame=${options.frame}`);
    if (options.allowMissing) args.push('--allow-missing');
    if (options.output) args.push(`--output=${options.output}`);

    const outputPath =
        options.output ||
        path.join(
            dir,
            'renders',
            `${
                mode === 'film' ? 'film' : `${options.sceneId || 'scene'}${
                    mode === 'still' ? '_still' : ''
                }`
            }_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${
                mode === 'still' ? 'png' : 'mp4'
            }`
        );

    if (!args.some((a) => a.startsWith('--output='))) {
        args.push(`--output=${outputPath}`);
    }

    const labels = {
        film: 'جاري توليد الفيلم الكامل...',
        scene: `جاري توليد المشهد ${options.sceneId || ''}...`,
        still: `جاري توليد صورة من المشهد ${options.sceneId || ''}...`,
    };

    runTask(taskId, {
        command: fs.existsSync(NODE_EXE) ? NODE_EXE : 'node',
        args,
        message: labels[mode] || 'جاري التوليد...',
        expectFile: outputPath,
        meta: { mode: `film-${mode}`, filmId, sceneId: options.sceneId || null, filmName: film.name },
    });

    return taskId;
}

// ---------------------------------------------------------------------------
// long form: preview (Remotion Studio, no render)
// ---------------------------------------------------------------------------

const previews = new Map();
let previewPortCounter = 3110;

async function startPreview(options) {
    const port = previewPortCounter++;
    const args = [path.join(SCRIPT_DIR, 'renderer', 'preview.js'), '--port=' + port];

    if (options.mode === 'film') {
        const { dir } = filmLib.loadFilm(FILMS_DIR, options.filmId);
        args.push('--project=' + dir);
    } else {
        let filepath = options.filepath;
        if (!filepath && options.filmId && options.sceneId) {
            const { dir } = filmLib.loadFilm(FILMS_DIR, options.filmId);
            filepath = path.join(dir, 'scenes', options.sceneId + '.tsx');
        }
        if (!filepath || !fs.existsSync(filepath)) {
            throw new Error('file TSX not found for preview');
        }
        args.push('--input=' + filepath);
    }

    const child = spawn(
        fs.existsSync(NODE_EXE) ? NODE_EXE : 'node',
        args,
        {
            cwd: SCRIPT_DIR,
            env: { ...process.env, FORCE_COLOR: '0' },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );

    const preview = { id: null, child, url: null, port, ready: false, error: null };
    const stdout = readline.createInterface({ input: child.stdout });
    const stderr = readline.createInterface({ input: child.stderr });
    stdout.on('line', (line) => {
        const match = line.match(/^@@PREVIEW_URL:(.+)$/);
        if (match) { preview.url = match[1].trim(); preview.ready = true; }
        const errMatch = line.match(/^@@ERROR:(.+)$/);
        if (errMatch) { preview.error = errMatch[1].trim(); }
    });
    stderr.on('line', (line) => {
        if (!preview.ready && /error/i.test(line)) {
            preview.error = (preview.error ? preview.error + ' | ' : '') + line.slice(0, 200);
        }
    });
    child.on('exit', (code) => {
        if (!preview.ready && !preview.error) {
            preview.error = 'exited (code ' + code + ')';
        }
    });

    const started = Date.now();
    while (!preview.ready && !preview.error && Date.now() - started < 90000) {
        await new Promise((r) => setTimeout(r, 500));
    }

    if (preview.error || !preview.url) {
        try { child.kill(); } catch (e) { /* ignore */ }
        throw new Error(preview.error || 'preview start failed');
    }

    const id = generateId();
    preview.id = id;
    previews.set(id, preview);
    return { id, url: preview.url, port };
}

function stopPreview(previewId) {
    const preview = previews.get(previewId);
    if (!preview) return false;
    try { preview.child.kill(); } catch (e) { /* ignore */ }
    previews.delete(previewId);
    return true;
}

// ---------------------------------------------------------------------------
// file preview (renders / stills)
// ---------------------------------------------------------------------------

const PREVIEW_ROOTS = [FILMS_DIR, RENDERS_DIR, UPLOADS_DIR];

function servePreviewFile(req, res, filePath) {
    const resolved = path.resolve(filePath);
    const allowed = PREVIEW_ROOTS.some((root) => resolved.startsWith(path.resolve(root)));
    if (!allowed) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    fs.readFile(resolved, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        const ext = path.extname(resolved).toLowerCase();
        res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(content);
    });
}

// ---------------------------------------------------------------------------
// static files
// ---------------------------------------------------------------------------

function serveStatic(req, res) {
    const uiDir = path.join(SCRIPT_DIR, 'ui');
    const requested = decodeURIComponent((req.url || '/').split('?')[0]);
    let filePath = path.join(uiDir, requested === '/' ? 'index.html' : requested);

    if (!path.resolve(filePath).startsWith(path.resolve(uiDir))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Internal Server Error');
            }
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

// Open folder in explorer
function openFolder(filePath) {
    const target = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
        ? filePath
        : path.dirname(filePath);
    if (process.platform === 'win32') {
        exec(`explorer "${target}"`);
    } else if (process.platform === 'darwin') {
        exec(`open "${target}"`);
    } else {
        exec(`xdg-open "${target}"`);
    }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    try {
        // ---------------- short form -------------------------------------
        if (pathname === '/save-tsx' && req.method === 'POST') {
            const { code, filename } = await parseBody(req);
            if (!code || !String(code).trim()) {
                sendJson(res, { error: 'الكود فارغ' }, 400);
                return;
            }
            const filepath = saveTsxFile(code, filename);
            sendJson(res, { success: true, filepath });
            return;
        }

        if (pathname === '/render' && req.method === 'POST') {
            const { filepath } = await parseBody(req);
            if (!filepath || !fs.existsSync(filepath)) {
                sendJson(res, { error: 'ملف TSX غير موجود' }, 400);
                return;
            }
            const taskId = generateId();
            startRender(taskId, filepath);
            sendJson(res, { success: true, taskId });
            return;
        }

        if (pathname.startsWith('/status/') && req.method === 'GET') {
            const taskId = pathname.split('/')[2];
            const task = tasks.get(taskId);
            if (!task) {
                sendJson(res, { error: 'Task not found' }, 404);
                return;
            }
            sendJson(res, {
                status: task.status,
                progress: task.progress,
                message: task.message,
                log: task.logs.length ? task.logs[task.logs.length - 1] : null,
                logs: task.logs,
                outputPath: task.outputPath,
                error: task.error,
                meta: task.meta,
                duration: task.duration || null,
            });
            return;
        }

        if (pathname === '/open-folder' && req.method === 'POST') {
            const { path: filePath } = await parseBody(req);
            if (filePath) openFolder(filePath);
            sendJson(res, { success: true });
            return;
        }

        // ---------------- uploads ----------------------------------------
        if (pathname === '/upload' && req.method === 'POST') {
            const originalName = safeFileName(parsedUrl.query.name || 'voiceover.wav');
            const buffer = await readRawBody(req);
            if (!buffer.length) {
                sendJson(res, { error: 'لم يتم استلام أي بيانات' }, 400);
                return;
            }
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const fileName = `${stamp}_${originalName}`;
            const target = path.join(UPLOADS_DIR, fileName);
            fs.writeFileSync(target, buffer);
            const duration = ffprobeDuration(target);
            sendJson(res, {
                success: true,
                path: target,
                name: originalName,
                size: buffer.length,
                duration,
                hasFfprobeDuration: duration > 0,
            });
            return;
        }

        // ---------------- film projects ----------------------------------
        if (pathname === '/film/list' && req.method === 'GET') {
            sendJson(res, { films: filmLib.listFilms(FILMS_DIR) });
            return;
        }

        if (pathname === '/film/create' && req.method === 'POST') {
            const body = await parseBody(req);
            const audioPath = body.audioPath ? path.resolve(SCRIPT_DIR, body.audioPath) : null;
            if (!audioPath || !fs.existsSync(audioPath)) {
                sendJson(res, { error: 'ملف الصوت غير موجود — ارفعه أولًا' }, 400);
                return;
            }
            const duration = Number(body.audioDuration) || ffprobeDuration(audioPath);
            const { dir, film } = filmLib.createFilm(FILMS_DIR, {
                name: body.name,
                audioPath,
                audioDuration: duration,
                fps: body.fps,
                width: body.width,
                height: body.height,
                language: body.language,
                model: body.model,
                settings: body.settings,
            });
            sendJson(res, {
                success: true,
                filmId: film.id,
                dir,
                film,
                audioDuration: duration,
            });
            return;
        }

        if (pathname === '/film/analyze' && req.method === 'POST') {
            const body = await parseBody(req);
            if (!body.filmId) {
                sendJson(res, { error: 'filmId مطلوب' }, 400);
                return;
            }
            const taskId = generateId();
            analyzeFilmIntoTask(taskId, body.filmId, {
                model: body.model,
                language: body.language,
                settings: body.settings,
                force: body.force,
            });
            sendJson(res, { success: true, taskId });
            return;
        }

        if (pathname === '/film/transcript' && req.method === 'POST') {
            // manual transcript upload (no whisper needed): raw JSON body
            const filmId = parsedUrl.query.filmId;
            if (!filmId) {
                sendJson(res, { error: 'filmId مطلوب' }, 400);
                return;
            }
            const { dir, film } = filmLib.loadFilm(FILMS_DIR, filmId);
            const buffer = await readRawBody(req, 32 * 1024 * 1024);
            let transcript;
            try {
                transcript = JSON.parse(buffer.toString('utf-8'));
            } catch (err) {
                sendJson(res, { error: 'ملف النص ليس JSON صالحًا' }, 400);
                return;
            }
            if (!Array.isArray(transcript.segments)) {
                sendJson(res, { error: 'الملف يجب أن يحتوي على segments' }, 400);
                return;
            }
            filmLib.writeJson(path.join(dir, 'transcript.json'), transcript);
            const taskId = generateId();
            analyzeFilmIntoTask(taskId, filmId, { settings: film.settings, force: false });
            // the transcript exists now, so the task splits immediately
            sendJson(res, { success: true, taskId });
            return;
        }

        if (pathname === '/film/get' && req.method === 'GET') {
            const filmId = parsedUrl.query.filmId;
            const { dir, film } = filmLib.loadFilm(FILMS_DIR, filmId);
            const scenes = (film.scenes || []).map((scene) => ({
                id: scene.id,
                index: scene.index,
                start: scene.start,
                end: scene.end,
                duration: scene.duration,
                startFrame: scene.startFrame,
                endFrame: scene.endFrame,
                durationInFrames: scene.durationInFrames,
                title: scene.title,
                text: scene.text,
                hasCode: filmLib.sceneHasCode(dir, scene.id),
            }));
            sendJson(res, {
                dir,
                filmId: film.id,
                film: {
                    ...film,
                    scenes: undefined,
                },
                scenes,
                hasTranscript: fs.existsSync(path.join(dir, 'transcript.json')),
            });
            return;
        }

        if (pathname === '/film/scene' && req.method === 'GET') {
            const filmId = parsedUrl.query.filmId;
            const sceneId = parsedUrl.query.sceneId;
            const { dir, film } = filmLib.loadFilm(FILMS_DIR, filmId);
            const scene = filmLib.getScene(dir, film, sceneId);
            const jsonPath = filmLib.sceneJsonPath(dir, sceneId);
            const promptPath = filmLib.scenePromptPath(dir, sceneId);
            sendJson(res, {
                scene: filmLib.readJson(jsonPath),
                code: filmLib.readSceneTsx(dir, sceneId),
                prompt: fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf-8') : filmLib.buildScenePrompt(filmLib.readJson(jsonPath)),
            });
            return;
        }

        if (pathname === '/film/scene-save' && req.method === 'POST') {
            const { filmId, sceneId, code } = await parseBody(req);
            const { dir, film } = filmLib.loadFilm(FILMS_DIR, filmId);
            filmLib.getScene(dir, film, sceneId);
            const file = filmLib.saveSceneTsx(dir, sceneId, code);
            const scene = film.scenes.find((item) => item.id === sceneId);
            if (scene) scene.hasCode = filmLib.isRealSceneCode(code);
            filmLib.writeFilmFile(dir, film);
            sendJson(res, { success: true, file });
            return;
        }

        if (pathname === '/film/render-scene' && req.method === 'POST') {
            const body = await parseBody(req);
            const taskId = generateId();
            filmRenderTask(taskId, body.filmId, 'scene', { sceneId: body.sceneId });
            sendJson(res, { success: true, taskId });
            return;
        }

        if (pathname === '/film/still' && req.method === 'POST') {
            const body = await parseBody(req);
            const taskId = generateId();
            filmRenderTask(taskId, body.filmId, 'still', {
                sceneId: body.sceneId,
                time: body.time === undefined ? 1 : body.time,
            });
            sendJson(res, { success: true, taskId });
            return;
        }

        if (pathname === '/film/render-film' && req.method === 'POST') {
            const body = await parseBody(req);
            const taskId = generateId();
            filmRenderTask(taskId, body.filmId, 'film', { allowMissing: body.allowMissing });
            sendJson(res, { success: true, taskId });
            return;
        }

        if (pathname === '/film/delete' && req.method === 'POST') {
            const { filmId } = await parseBody(req);
            const { dir } = filmLib.loadFilm(FILMS_DIR, filmId);
            fs.rmSync(dir, { recursive: true, force: true });
            sendJson(res, { success: true });
            return;
        }

        // ---------------- preview (no render) ------------------------------
        if (pathname === '/preview/start' && req.method === 'POST') {
            const body = await parseBody(req);
            const mode = body.mode === 'film' ? 'film' : 'single';
            try {
                const result = await startPreview({
                    mode,
                    filmId: body.filmId,
                    sceneId: body.sceneId,
                    filepath: body.filepath,
                });
                sendJson(res, { success: true, ...result });
            } catch (err) {
                sendJson(res, { error: err.message }, 400);
            }
            return;
        }

        if (pathname === '/preview/stop' && req.method === 'POST') {
            const body = await parseBody(req);
            const ok = stopPreview(body.previewId);
            sendJson(res, { success: ok });
            return;
        }

// ---------------- preview files ----------------------------------
        if (pathname === '/file' && req.method === 'GET') {
            const filePath = parsedUrl.query.path;
            if (!filePath) {
                sendJson(res, { error: 'path مطلوب' }, 400);
                return;
            }
            servePreviewFile(req, res, filePath);
            return;
        }

        if (pathname === '/system' && req.method === 'GET') {
            const python = detectPython();
            sendJson(res, {
                node: process.version,
                python: python.ok ? { found: true, hasWhisper: python.hasWhisper } : { found: false },
                filmsDir: FILMS_DIR,
                ffmpeg: ffprobeDuration ? true : false,
            });
            return;
        }

        serveStatic(req, res);
    } catch (error) {
        console.error('Server error:', error);
        sendJson(res, { error: error.message }, 500);
    }
});

server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  =====================================================');
    console.log('   AI Motion Graphics Tool');
    console.log('   Server: http://localhost:' + PORT);
    console.log('   Films : ' + FILMS_DIR);
    console.log('  =====================================================');
    console.log('');
    console.log('  Opening browser...');

    const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${openCmd} http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    for (const task of tasks.values()) {
        if (task.child) {
            try { task.child.kill(); } catch (err) { /* ignore */ }
        }
    }
    server.close();
    process.exit(0);
});
