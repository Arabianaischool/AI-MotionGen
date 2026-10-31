/**
 * Preview server (Remotion Studio) for a film or single TSX composition.
 *
 * Usage:
 *   node preview.js --project=<filmDir>
 *   node preview.js --input=<file.tsx>
 *
 * Options:
 *   --port=<n>   preferred port (default: 3099)
 *
 * Output (ASCII, one line):
 *   @@PREVIEW_URL:http://localhost:<port>
 *   @@ERROR:<message>
 *
 * The process stays alive serving Remotion Studio until killed (SIGINT/SIGTERM).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const args = {};
process.argv.slice(2).forEach((arg) => {
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    if (eq > 0) args[arg.slice(2, eq)] = arg.slice(eq + 1).replace(/^["']|["']$/g, '');
    else args[arg.slice(2)] = true;
  }
});

const SCRIPT_DIR = __dirname; // renderer/
const ROOT_DIR = path.dirname(SCRIPT_DIR); // project root
const NODE_EXE = fs.existsSync(path.join(ROOT_DIR, 'node', 'node.exe'))
  ? path.join(ROOT_DIR, 'node', 'node.exe')
  : 'node';
const CLI_JS = path.join(SCRIPT_DIR, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
const RENDERER_NM = path.join(SCRIPT_DIR, 'node_modules');

function fail(message) {
  process.stdout.write(`@@ERROR:${String(message).replace(/\s+/g, ' ')}\n`);
  process.exit(1);
}

let tempDir = null;
let studioProc = null;

function cleanup() {
  if (studioProc) {
    try { studioProc.kill(); } catch (e) { /* ignore */ }
    studioProc = null;
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    tempDir = null;
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

(async () => {
  const port = parseInt(args.port || '3099', 10);

  // Build temp project
  let projectDir;
  if (args.project) {
    projectDir = path.resolve(args.project);
    const filmPath = path.join(projectDir, 'film.json');
    if (!fs.existsSync(filmPath)) fail(`film.json غير موجود: ${projectDir}`);
    const film = JSON.parse(fs.readFileSync(filmPath, 'utf-8'));
    film.fps = Number(film.fps) || 30;
    film.width = Number(film.width) || 1080;
    film.height = Number(film.height) || 1920;
    film.scenes = Array.isArray(film.scenes) ? film.scenes : [];
    const hasCode = (sid) => {
      const f = path.join(projectDir, 'scenes', `${sid}.tsx`);
      if (!fs.existsSync(f)) return false;
      const c = fs.readFileSync(f, 'utf-8');
      if (c.trimStart().startsWith('// @stub-scene')) return false;
      return /export\s+default/.test(c) && c.trim().length > 40;
    };
    const scenesToImport = film.scenes.filter((sc) => hasCode(sc.id));
    if (!scenesToImport.length) fail('لا يوجد مشهد جاهز للمعاينة — أضف كودًا first');

    // normalize timing
    scenesToImport.forEach((sc) => {
      sc.startFrame = Number.isFinite(Number(sc.startFrame)) ? Number(sc.startFrame) : Math.round((Number(sc.start) || 0) * film.fps);
      sc.endFrame = Number.isFinite(Number(sc.endFrame)) ? Number(sc.endFrame) : Math.round((Number(sc.end) || 0) * film.fps);
      sc.durationInFrames = sc.endFrame - sc.startFrame;
    });
    film.durationInFrames = film.scenes.reduce((m, sc) => Math.max(m, Number(sc.endFrame) || 0), 0);

    // Reuse createFilmTempProject by eval-ing render-film.js? Instead, replicate minimal.
    // render-film exports nothing, so we duplicate the temp-project builder by requiring a shared module.
    // To avoid duplication, we add an export to render-film.js? Simpler: inline a minimal film temp project.
    const { createFilmTempProject } = require('./render-film');
    const built = createFilmTempProject(projectDir, film, scenesToImport);
    tempDir = built.tempDir;
  } else if (args.input) {
    const inputPath = path.resolve(args.input);
    if (!fs.existsSync(inputPath)) fail(`ملف TSX غير موجود: ${inputPath}`);
    const code = fs.readFileSync(inputPath, 'utf-8');
    let config = null;
    const sceneMatch = code.match(/export\s+const\s+sceneConfig\s*=\s*(\{[\s\S]*?\});/);
    if (sceneMatch && !/compositionConfig/.test(code)) {
      try {
        const { parseLiteral } = require('./lib/config-extractor');
        const sc = parseLiteral(sceneMatch[1].replace(/\/\/.*$/gm, ''));
        config = {
          id: sc.id || 'Scene',
          durationInSeconds: (sc.end - sc.start) || 5,
          fps: sc.fps || 30,
          width: sc.width || 1080,
          height: sc.height || 1920,
          defaultProps: {},
        };
      } catch (e) { config = null; }
    }
    if (!config) {
      const { extractCompositionConfig } = require('./lib/config-extractor');
      try { config = extractCompositionConfig(inputPath); }
      catch (e) { fail('لا يوجد compositionConfig أو sceneConfig في الملف'); }
    }
    const { createTempProject } = require('./lib/temp-project');
    tempDir = createTempProject(inputPath, config);
  } else {
    fail('مرّر --project=<مجلد> أو --input=<file.tsx>');
  }

  // package.json for studio
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'preview', version: '1.0.0', private: true }, null, 2));

  const entry = path.join(tempDir, 'src', 'index.ts');
  if (!fs.existsSync(entry)) fail(`entry not found: ${entry}`);

  studioProc = spawn(NODE_EXE, [CLI_JS, 'studio', entry, '--port', String(port)], {
    cwd: tempDir,
    env: { ...process.env, NODE_PATH: RENDERER_NM, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  let urlFound = false;
  let stderrBuf = '';
  const handle = (data) => {
    const text = data.toString();
    const m = text.match(/http:\/\/localhost:\d+/);
    if (m && !urlFound) {
      urlFound = true;
      process.stdout.write(`@@PREVIEW_URL:${m[0]}\n`);
    }
  };
  studioProc.stdout.on('data', handle);
  studioProc.stderr.on('data', (d) => { stderrBuf += d.toString(); handle(d); });

  studioProc.on('error', (err) => fail(`studio spawn failed: ${err.message}`));
  studioProc.on('exit', (code) => {
    if (!urlFound) fail(`studio exited (code ${code}) before ready. ${stderrBuf.slice(-400)}`);
    // studio exited unexpectedly after being ready — notify
    process.stdout.write(`@@ERROR:studio exited (code ${code})\n`);
    cleanup();
    process.exit(code || 1);
  });

  // keep alive
})().catch((err) => fail(err && err.message ? err.message : String(err)));
