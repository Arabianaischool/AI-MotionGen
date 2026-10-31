/**
 * Long-form film renderer
 *
 * Renders a "film" project (narration + one TSX component per scene) either as
 * a single scene, a still frame, or the whole film with the narration attached.
 *
 * Usage:
 *   node render-film.js --project=<filmDir> --mode=scene --scene=s01
 *   node render-film.js --project=<filmDir> --mode=still --scene=s01 --time=3
 *   node render-film.js --project=<filmDir> --mode=film
 *   node render-film.js --project=<filmDir> --mode=film --allow-missing
 *
 * Options:
 *   --output=<file>       explicit output path (mp4 / png)
 *   --concurrency=<n>     render concurrency (default: Remotion's default)
 *   --frame=<n>           still frame (overrides --time), scene-local frame
 *   --time=<seconds>      still time inside the scene (default 1)
 *   --muted               no audio track
 *   --verbose             full stack traces
 *
 * Machine-readable progress (ASCII only):
 *   @@PROGRESS:42:rendering
 *   @@DONE:<output path>
 *   @@ERROR:<message>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { bundle } = require('@remotion/bundler');
const { renderMedia, renderStill, selectComposition, ensureBrowser } = require('@remotion/renderer');

// ---------------------------------------------------------------------------
// args & logging
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        args[arg.slice(2, eq)] = arg.slice(eq + 1).replace(/^["']|["']$/g, '');
      } else {
        args[arg.slice(2)] = true;
      }
    }
  });
  return args;
}

function progress(percent, message) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  // avoid flooding the UI with identical lines
  if (lastProgress.value === value && lastProgress.message === message) return;
  lastProgress.value = value;
  lastProgress.message = message;
  process.stdout.write(`@@PROGRESS:${value}:${message}\n`);
}

const lastProgress = { value: -1, message: '' };

function fail(message) {
  process.stdout.write(`@@ERROR:${String(message).replace(/\s+/g, ' ')}\n`);
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

function log(message) {
  console.log(`  ${message}`);
}

// ---------------------------------------------------------------------------
// film data
// ---------------------------------------------------------------------------

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function probeDuration(filePath) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
      { encoding: 'utf-8' }
    );
    const value = parseFloat(String(out).trim());
    return Number.isFinite(value) ? value : 0;
  } catch (err) {
    return 0;
  }
}

function loadFilmData(projectDir) {
  const filmPath = path.join(projectDir, 'film.json');
  if (!fs.existsSync(filmPath)) {
    fail(`film.json غير موجود داخل: ${projectDir}`);
  }
  const film = readJson(filmPath);
  film.fps = Number(film.fps) || 30;
  film.width = Number(film.width) || 1080;
  film.height = Number(film.height) || 1920;
  film.scenes = Array.isArray(film.scenes) ? film.scenes : [];

  if (!film.scenes.length) {
    fail('لا توجد مشاهد. حلّل الصوت أولًا من واجهة الأداة.');
  }

  const audioPath = path.join(projectDir, 'public', film.audio || 'voiceover.wav');
  if (!fs.existsSync(audioPath)) {
    fail(`ملف الصوت غير موجود: ${audioPath}`);
  }
  if (!film.audioDuration) {
    film.audioDuration = probeDuration(audioPath);
  }

  // normalise timing fields (older / hand-edited film.json files)
  film.scenes.forEach((scene) => {
    scene.start = Number(scene.start) || 0;
    scene.end = Number(scene.end) || scene.start;
    scene.startFrame = Number.isFinite(Number(scene.startFrame))
      ? Number(scene.startFrame)
      : Math.round(scene.start * film.fps);
    scene.endFrame = Number.isFinite(Number(scene.endFrame))
      ? Number(scene.endFrame)
      : Math.round(scene.end * film.fps);
    scene.durationInFrames = scene.endFrame - scene.startFrame;
  });

  film.durationInFrames = film.scenes.reduce(
    (max, scene) => Math.max(max, scene.endFrame),
    0
  );

  return { film, audioPath };
}

function sceneFile(projectDir, sceneId) {
  return path.join(projectDir, 'scenes', `${sceneId}.tsx`);
}

const STUB_MARKER = '// @stub-scene';

function hasCode(projectDir, sceneId) {
  const file = sceneFile(projectDir, sceneId);
  if (!fs.existsSync(file)) return false;
  const code = fs.readFileSync(file, 'utf-8');
  if (code.trimStart().startsWith(STUB_MARKER)) return false;
  return /export\s+default/.test(code) && code.trim().length > 40;
}

// ---------------------------------------------------------------------------
// temp remotion project
// ---------------------------------------------------------------------------

function copyDirIfExists(from, to, filter) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDirIfExists(source, target, filter);
    } else if (!filter || filter(source)) {
      fs.copyFileSync(source, target);
    }
  }
}

const SOURCE_EXT = new Set(['.tsx', '.ts', '.jsx', '.js', '.json', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp']);

function createFilmTempProject(projectDir, film, scenesToImport) {
  const tempDir = path.join(os.tmpdir(), `remotion-film-${Date.now()}`);
  const srcDir = path.join(tempDir, 'src');
  const scenesDir = path.join(srcDir, 'scenes');
  fs.mkdirSync(scenesDir, { recursive: true });

  // 1. copy the project's scene sources (keeps relative imports working)
  copyDirIfExists(
    path.join(projectDir, 'scenes'),
    scenesDir,
    (file) => SOURCE_EXT.has(path.extname(file).toLowerCase())
  );
  // 2. shared helpers, if the user created them
  copyDirIfExists(path.join(projectDir, 'shared'), path.join(srcDir, 'shared'));
  // 3. public assets (audio, images, fonts, ...)
  copyDirIfExists(path.join(projectDir, 'public'), path.join(tempDir, 'public'));

  // film data as a TS module (no JSON import quirks)
  const filmData = {
    id: film.id,
    name: film.name,
    audio: film.audio || 'voiceover.wav',
    audioDuration: film.audioDuration || 0,
    fps: film.fps,
    width: film.width,
    height: film.height,
  };
  fs.writeFileSync(
    path.join(srcDir, 'film-data.ts'),
    `export const FILM = ${JSON.stringify(filmData, null, 2)} as const;\n`,
    'utf-8'
  );

  const imports = scenesToImport
    .map((scene, i) => `import Scene${i} from './scenes/${scene.id}';`)
    .join('\n');

  const sequences = scenesToImport
    .map(
      (scene, i) =>
        `      <Sequence from={${scene.startFrame}} durationInFrames={${scene.durationInFrames}} name="${scene.id}">\n` +
        `        <Scene${i} />\n` +
        `      </Sequence>`
    )
    .join('\n');

  const single = scenesToImport.length === 1 ? scenesToImport[0] : null;

  const compositions = [];
  if (scenesToImport.length > 1) {
    compositions.push(`    <Composition
      id="Film"
      component={Film}
      durationInFrames={${film.durationInFrames}}
      fps={${film.fps}}
      width={${film.width}}
      height={${film.height}}
    />`);
  }
  scenesToImport.forEach((scene, i) => {
    compositions.push(`    <Composition
      id="Scene-${scene.id}"
      component={SceneComp${i}}
      durationInFrames={${scene.durationInFrames}}
      fps={${film.fps}}
      width={${film.width}}
      height={${film.height}}
    />`);
  });

  const sceneComps = scenesToImport
    .map(
      (scene, i) => `const SceneComp${i}: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#000000' }}>
    <Audio src={staticFile(FILM.audio)} startFrom={${scene.startFrame}} />
    <Scene${i} />
  </AbsoluteFill>
);`
    )
    .join('\n\n');

  const rootTsx = `import React from 'react';
import { AbsoluteFill, Audio, Composition, Sequence, staticFile } from 'remotion';
import { FILM } from './film-data';
${imports}

${
  scenesToImport.length > 1
    ? `const Film: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#000000' }}>
    <Audio src={staticFile(FILM.audio)} />
${sequences}
  </AbsoluteFill>
);`
    : '// single-scene render: no Film composition'
}

${sceneComps}

export const Root: React.FC = () => {
  return (
    <>
${compositions.join('\n')}
    </>
  );
};
`;

  fs.writeFileSync(path.join(srcDir, 'Root.tsx'), rootTsx, 'utf-8');
  fs.writeFileSync(
    path.join(srcDir, 'index.ts'),
    `import { registerRoot } from 'remotion';\nimport { Root } from './Root';\n\nregisterRoot(Root);\n`,
    'utf-8'
  );

  fs.writeFileSync(
    path.join(tempDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          lib: ['ES2020', 'DOM'],
          jsx: 'react-jsx',
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          moduleResolution: 'node',
        },
        include: ['src/**/*'],
      },
      null,
      2
    ),
    'utf-8'
  );

  return { tempDir, entryPoint: path.join(srcDir, 'index.ts'), publicDir: path.join(tempDir, 'public') };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const projectDir = args.project ? path.resolve(args.project) : null;
  if (!projectDir) fail('مرّر --project=<مجلد الفيلم>');

  const mode = args.mode || 'film';
  const { film } = loadFilmData(projectDir);

  log(`Film: ${film.name}`);
  log(`Scenes: ${film.scenes.length} · ${film.fps}fps · ${film.width}x${film.height}`);

  // ---- which scenes do we need? ------------------------------------------
  let scenesToImport;
  if (mode === 'scene' || mode === 'still') {
    const sceneId = args.scene || (film.scenes[0] && film.scenes[0].id);
    const scene = film.scenes.find((item) => item.id === sceneId);
    if (!scene) fail(`مشهد غير موجود: ${sceneId}`);
    if (!hasCode(projectDir, scene.id)) {
      fail(`المشهد ${scene.id} لا يحتوي على كود بعد (scenes/${scene.id}.tsx)`);
    }
    scenesToImport = [scene];
  } else {
    const missing = film.scenes.filter((scene) => !hasCode(projectDir, scene.id));
    if (missing.length && !args['allow-missing']) {
      fail(
        `مشاهد بدون كود: ${missing.map((s) => s.id).join(', ')} — أضف الكود أو استخدم --allow-missing`
      );
    }
    scenesToImport = film.scenes.filter((scene) => hasCode(projectDir, scene.id));
    if (!scenesToImport.length) fail('لا يوجد أي مشهد جاهز للرندر');
  }

  log(`Mode: ${mode} · loading ${scenesToImport.map((s) => s.id).join(', ')}`);

  // ---- browser ------------------------------------------------------------
  progress(1, 'التحقق من المتصفح');
  await ensureBrowser({
    logLevel: 'error',
    onBrowserDownload: () => ({
      version: null,
      onProgress: ({ percent }) => progress(2 + percent * 4, 'تحميل المتصفح'),
    }),
  });

  // ---- temp project -------------------------------------------------------
  const { tempDir, entryPoint, publicDir } = createFilmTempProject(projectDir, film, scenesToImport);
  const rendererNodeModules = path.resolve(__dirname, 'node_modules');

  const cleanup = () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      /* Windows file locks: ignore */
    }
  };

  try {
    progress(5, 'تجهيز الكود');
    const serveUrl = await bundle({
      entryPoint,
      publicDir,
      webpackOverride: (webpackConfig) => {
        webpackConfig.resolve = webpackConfig.resolve || {};
        webpackConfig.resolve.modules = [
          rendererNodeModules,
          ...(webpackConfig.resolve.modules || ['node_modules']),
        ];
        webpackConfig.resolveLoader = webpackConfig.resolveLoader || {};
        webpackConfig.resolveLoader.modules = [
          rendererNodeModules,
          ...(webpackConfig.resolveLoader.modules || ['node_modules']),
        ];
        return webpackConfig;
      },
      onProgress: (percent) => {
        const p = percent <= 1 ? percent * 100 : percent; // bundler reports 0-100
        progress(5 + p * 0.25, 'تجهيز الكود');
      },
    });

    const compositionId =
      mode === 'film' && scenesToImport.length > 1
        ? 'Film'
        : `Scene-${scenesToImport[0].id}`;

    progress(32, 'اختيار التركيب');
    const composition = await selectComposition({ serveUrl, id: compositionId });
    log(`Composition: ${composition.id}`);

    const outputPath = args.output
      ? path.resolve(args.output)
      : defaultOutputPath(projectDir, film, mode, scenesToImport[0]);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    if (mode === 'still') {
      const scene = scenesToImport[0];
      const frameFromTime = Math.round((Number(args.time) || 1) * film.fps);
      const frame = Math.min(
        Math.max(0, args.frame !== undefined ? Number(args.frame) : frameFromTime),
        Math.max(0, scene.durationInFrames - 1)
      );

      progress(40, 'توليد الصورة');
      await renderStill({
        composition: {
          ...composition,
          durationInFrames: scene.durationInFrames,
          fps: film.fps,
          width: film.width,
          height: film.height,
        },
        serveUrl,
        output: outputPath,
        frame,
        imageFormat: 'png',
      });
      progress(100, 'تم');
      process.stdout.write(`@@DONE:${outputPath}\n`);
      log(`Still: ${outputPath}`);
      return;
    }

    const total = mode === 'film' ? film.durationInFrames : scenesToImport[0].durationInFrames;

    progress(38, `بدء الرندر: ${total} إطار`);
    const started = Date.now();

    await renderMedia({
      composition: {
        ...composition,
        durationInFrames: total,
        fps: film.fps,
        width: film.width,
        height: film.height,
      },
      serveUrl,
      codec: 'h264',
      audioCodec: 'aac',
      muted: Boolean(args.muted),
      outputLocation: outputPath,
      ...(args.concurrency ? { concurrency: Number(args.concurrency) } : {}),
      onProgress: ({ progress: p, renderedFrames, encodedFrames }) => {
        const pct = 38 + p * 60;
        const elapsed = (Date.now() - started) / 1000;
        const done = renderedFrames || encodedFrames || 0;
        const eta = done > 0 ? (elapsed / done) * (total - done) : 0;
        progress(
          pct,
          `رندر ${Math.min(total, done)}/${total} إطار` +
            (eta > 0 ? ` · متبقي ~${Math.round(eta)}s` : '')
        );
      },
    });

    progress(100, 'تم');
    process.stdout.write(`@@DONE:${outputPath}\n`);
    log(`Rendered: ${outputPath}`);
  } finally {
    cleanup();
  }
}

function defaultOutputPath(projectDir, film, mode, scene) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rendersDir = path.join(projectDir, 'renders');
  if (mode === 'still') {
    return path.join(rendersDir, `still_${scene ? scene.id : 'film'}_${stamp}.png`);
  }
  if (mode === 'scene' && scene) {
    return path.join(rendersDir, `${scene.id}_${stamp}.mp4`);
  }
  return path.join(rendersDir, `film_${stamp}.mp4`);
}

// ---------------------------------------------------------------------------
// exports (for reuse by preview.js)
// ---------------------------------------------------------------------------
module.exports = { createFilmTempProject, loadFilmData };

// Run main only when executed directly
if (require.main === module) {
  main().catch((err) => {
    const verbose = process.argv.includes('--verbose');
    if (verbose) console.error(err.stack);
    fail(err && err.message ? err.message : String(err));
  });
}
