/**
 * Film projects (long-form mode)
 *
 * A "film" is a folder that holds one narration track plus one folder per scene:
 *
 *   films/<name>_<timestamp>/
 *     film.json                 manifest (settings, audio, scene list)
 *     transcript.json           word-level transcript (whisper)
 *     public/voiceover.wav      assets exposed through Remotion's staticFile()
 *     scenes/s01.json           per-scene timing JSON (hand this to the chatbot)
 *     scenes/s01.tsx            per-scene component (the user pastes code here)
 *     prompts/s01.md            ready-to-paste prompt for the chatbot
 *     renders/                  rendered scenes / stills / final film
 *
 * Everything is plain UTF-8 JSON so a chatbot (or a human) can edit it.
 */

const fs = require('fs');
const path = require('path');

const FILM_VERSION = 1;

// First line of the auto-generated placeholder component. A scene that still
// starts with this marker has NOT been written by the user yet.
const STUB_MARKER = '// @stub-scene';

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function slugify(value, fallback = 'film') {
  const slug = String(value || '')
    .trim()
    .replace(/[\s/\\:*?"<>|]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    if (fallback !== null) return fallback;
    throw err;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function timecode(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// project creation
// ---------------------------------------------------------------------------

/**
 * @param {string} filmsDir            root folder that holds all films
 * @param {Object} input
 * @param {string} input.name          film name
 * @param {string} input.audioPath     absolute path of the uploaded audio
 * @param {number} [input.audioDuration]
 * @param {number} [input.fps]
 * @param {number} [input.width]
 * @param {number} [input.height]
 * @param {string} [input.language]
 * @param {string} [input.model]       whisper model
 * @param {Object} [input.settings]    scene split settings
 */
function createFilm(filmsDir, input) {
  const name = String(input.name || 'Film').trim() || 'Film';
  const id = `${slugify(name)}_${nowIso()}`;
  const dir = path.join(filmsDir, id);

  ensureDir(dir);
  ensureDir(path.join(dir, 'scenes'));
  ensureDir(path.join(dir, 'prompts'));
  ensureDir(path.join(dir, 'renders'));
  ensureDir(path.join(dir, 'public'));

  // copy the narration into public/ so staticFile('voiceover.wav') works
  const audioExt = path.extname(input.audioPath || '.wav').toLowerCase() || '.wav';
  const audioName = `voiceover${audioExt}`;
  if (input.audioPath && fs.existsSync(input.audioPath)) {
    fs.copyFileSync(input.audioPath, path.join(dir, 'public', audioName));
  }

  const film = {
    version: FILM_VERSION,
    id,
    name,
    createdAt: new Date().toISOString(),
    status: 'created',
    language: input.language || 'ar',
    model: input.model || 'small',
    audio: audioName,
    sourceAudio: input.audioPath || null,
    audioDuration: Number(input.audioDuration) || 0,
    fps: clamp(Number(input.fps) || 30, 1, 60),
    width: clamp(Number(input.width) || 1080, 16, 4096),
    height: clamp(Number(input.height) || 1920, 16, 4096),
    settings: {
      minSceneSeconds: Number(input.settings && input.settings.minSceneSeconds) || 6,
      targetSceneSeconds: Number(input.settings && input.settings.targetSceneSeconds) || 14,
      maxSceneSeconds: Number(input.settings && input.settings.maxSceneSeconds) || 24,
      padSeconds:
        input.settings && input.settings.padSeconds !== undefined
          ? Number(input.settings.padSeconds)
          : 0.18,
    },
    scenes: [],
    totals: {
      sceneCount: 0,
      filmDuration: 0,
      filmDurationInFrames: 0,
    },
  };

  writeFilmFile(dir, film);
  return { dir, film };
}

function filmFile(dir) {
  return path.join(dir, 'film.json');
}

function writeFilmFile(dir, film) {
  writeJson(filmFile(dir), film);
}

function loadFilm(filmsDir, filmId) {
  if (!filmId || /[\\/]/.test(filmId) || filmId.includes('..')) {
    throw new Error('معرّف فيلم غير صالح');
  }
  const dir = path.join(filmsDir, filmId);
  const file = filmFile(dir);
  if (!fs.existsSync(file)) {
    throw new Error(`لم يتم العثور على الفيلم: ${filmId}`);
  }
  return { dir, film: readJson(file) };
}

function listFilms(filmsDir) {
  if (!fs.existsSync(filmsDir)) return [];
  return fs
    .readdirSync(filmsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(filmsDir, entry.name);
      try {
        const film = readJson(filmFile(dir), null);
        if (!film) return null;
        const scenes = Array.isArray(film.scenes) ? film.scenes : [];
        return {
          id: film.id,
          name: film.name,
          status: film.status,
          createdAt: film.createdAt,
          audioDuration: film.audioDuration,
          fps: film.fps,
          width: film.width,
          height: film.height,
          sceneCount: scenes.length,
          readyScenes: scenes.filter((scene) => sceneHasCode(dir, scene.id)).length,
          dir,
        };
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// ---------------------------------------------------------------------------
// scene persistence
// ---------------------------------------------------------------------------

function sceneJsonPath(dir, sceneId) {
  return path.join(dir, 'scenes', `${sceneId}.json`);
}

function sceneTsxPath(dir, sceneId) {
  return path.join(dir, 'scenes', `${sceneId}.tsx`);
}

function scenePromptPath(dir, sceneId) {
  return path.join(dir, 'prompts', `${sceneId}.md`);
}

/**
 * Write scenes/sNN.json + prompts/sNN.md (+ a stub component when missing)
 * for every scene of the film.
 */
function writeSceneArtifacts(dir, film) {
  const scenes = Array.isArray(film.scenes) ? film.scenes : [];

  scenes.forEach((scene) => {
    const payload = {
      version: FILM_VERSION,
      filmId: film.id,
      filmName: film.name,
      sceneId: scene.id,
      sceneIndex: scene.index,
      fps: film.fps,
      width: film.width,
      height: film.height,
      audio: film.audio,
      audioDuration: film.audioDuration,
      // timing of the scene inside the whole film
      start: scene.start,
      end: scene.end,
      duration: scene.duration,
      startFrame: scene.startFrame,
      endFrame: scene.endFrame,
      durationInFrames: scene.durationInFrames,
      title: scene.title,
      text: scene.text,
      // per-line timings (both absolute and scene-local frames)
      lines: (scene.lines || []).map((line) => ({
        start: line.start,
        end: line.end,
        text: line.text,
        localStartFrame: Math.max(0, (line.startFrame || 0) - scene.startFrame),
        localEndFrame: Math.max(0, (line.endFrame || 0) - scene.startFrame),
      })),
      // per-word timings in scene-local frames: the best signal for chat-driven syncing
      words: (scene.words || []).map((word) => ({
        word: word.word,
        start: word.start,
        end: word.end,
        localStartFrame: Math.max(0, Math.round((word.start - scene.start) * film.fps)),
        localEndFrame: Math.max(0, Math.round((word.end - scene.start) * film.fps)),
      })),
      component: `scenes/${scene.id}.tsx`,
      configHint: {
        id: scene.id,
        start: scene.start,
        end: scene.end,
        fps: film.fps,
        width: film.width,
        height: film.height,
      },
    };

    writeJson(sceneJsonPath(dir, scene.id), payload);

    if (!fs.existsSync(sceneTsxPath(dir, scene.id))) {
      fs.writeFileSync(sceneTsxPath(dir, scene.id), buildSceneStub(scene, film), 'utf-8');
    }
    fs.writeFileSync(scenePromptPath(dir, scene.id), buildScenePrompt(payload), 'utf-8');
  });

  // refresh hasCode flags (a placeholder stub does not count as code)
  scenes.forEach((scene) => {
    scene.hasCode = isRealSceneCode(readSceneTsx(dir, scene.id));
  });

  buildReadme(dir, film);
}

function readSceneTsx(dir, sceneId) {
  const file = sceneTsxPath(dir, sceneId);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

/**
 * True when the file is a real scene component (not the generated placeholder).
 * @param {string} code
 */
function isRealSceneCode(code) {
  const text = String(code || '');
  if (!text.trim()) return false;
  if (text.trimStart().startsWith(STUB_MARKER)) return false;
  return /export\s+default/.test(text) && /sceneConfig/.test(text);
}

/** "Does this scene have code the user actually wrote?" */
function sceneHasCode(dir, sceneId) {
  return isRealSceneCode(readSceneTsx(dir, sceneId));
}

function saveSceneTsx(dir, sceneId, code) {
  const text = String(code || '');
  if (!text.trim()) throw new Error('الكود فارغ');
  if (text.trimStart().startsWith(STUB_MARKER)) {
    throw new Error('لم يتم تغيير الكود — الصق كود المشهد من الشات بوت بدل النسخة التجريبية');
  }
  if (!/export\s+default/.test(text)) {
    throw new Error('الكود يجب أن يحتوي على export default للمكوّن');
  }
  if (!/sceneConfig/.test(text)) {
    throw new Error('الكود يجب أن يحتوي على تصدير sceneConfig');
  }
  fs.writeFileSync(sceneTsxPath(dir, sceneId), text, 'utf-8');
  return sceneTsxPath(dir, sceneId);
}

function getScene(dir, film, sceneId) {
  const scene = (film.scenes || []).find((item) => item.id === sceneId);
  if (!scene) throw new Error(`مشهد غير موجود: ${sceneId}`);
  return scene;
}

// ---------------------------------------------------------------------------
// generated files
// ---------------------------------------------------------------------------

function buildSceneStub(scene, film) {
  const localDuration = scene.durationInFrames;
  return `${STUB_MARKER}
// Auto-generated placeholder for ${scene.id} — replace this whole file with the
// code you get from the chatbot (see prompts/${scene.id}.md).
import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

// Timing of this scene inside the film (informative — the film Root uses it).
export const sceneConfig = {
  id: '${scene.id}',
  start: ${scene.start},
  end: ${scene.end},
  fps: ${film.fps},
  width: ${film.width},
  height: ${film.height},
};

// ${scene.title}
// Narration (${scene.duration}s, ${localDuration} frames at ${film.fps}fps):
// ${scene.text.replace(/\n/g, ' ')}

const Scene${scene.id.replace(/^s/, '')}: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const intro = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const outro = interpolate(
    frame,
    [Math.max(0, durationInFrames - 12), durationInFrames - 1],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 100%)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
        direction: 'rtl',
        fontFamily: 'Tajawal, Cairo, Arial, sans-serif',
        opacity: outro,
      }}
    >
      <div
        style={{
          transform: \`translateY(\${interpolate(intro, [0, 1], [40, 0])}px)\`,
          textAlign: 'center',
          color: '#f8fafc',
          fontSize: 76,
          fontWeight: 700,
          lineHeight: 1.35,
        }}
      >
        ${JSON.stringify(scene.title)}
      </div>
      <div
        style={{
          marginTop: 28,
          color: '#c4b5fd',
          fontSize: 34,
          opacity: interpolate(intro, [0, 1], [0, 1]),
        }}
      >
        ${JSON.stringify(scene.id)} · ${scene.duration}s
      </div>
    </AbsoluteFill>
  );
};

export default Scene${scene.id.replace(/^s/, '')};
`;
}

function buildScenePrompt(scene) {
  const wordsTable = scene.words
    .slice(0, 120)
    .map((word) => `| ${word.localStartFrame} | ${word.localEndFrame} | ${word.word} |`)
    .join('\n');

  const linesBlock = scene.lines
    .map(
      (line) =>
        `- [${line.localStartFrame} → ${line.localEndFrame}] ${line.text}`
    )
    .join('\n');

  const jsonBlock = JSON.stringify(
    {
      sceneId: scene.sceneId,
      fps: scene.fps,
      width: scene.width,
      height: scene.height,
      durationInFrames: scene.durationInFrames,
      durationSeconds: scene.duration,
      title: scene.title,
      text: scene.text,
      lines: scene.lines,
      words: scene.words,
    },
    null,
    2
  );

  return `# برومت توليد مشهد واحد (${scene.sceneId} · ${scene.title})

أنت مبرمج Remotion محترف. مهمتك: كتابة **مكوّن مشهد واحد** داخل React/Remotion
يرافق هذا الجزء من التعليق الصوتي، بحيث تظهر العناصر في نفس لحظة نطق كلماتها.

## بيانات المشهد (JSON)
\`\`\`json
${jsonBlock}
\`\`\`

## الجُمل مع توقيتاتها داخل المشهد (بالإطارات)
${linesBlock}

## توقيت الكلمات (frame محلي يبدأ من 0 داخل المشهد)
| startFrame | endFrame | الكلمة |
|---|---|---|
${wordsTable}

## أسلوب "NEON DARK" (اتبعه بدقة)
- خلفية داكنة: تدرج #0a0a0f → #1e1b4b (أو radial-gradient). **لا خلفيات فاتحة**.
- ألوان نيون (اختر 2-3 لكل مشهد، ثابتة عبر الفيلم): purple #a855f7, blue #3b82f6, cyan #22d3ee, green #10b981, amber #fbbf24, red #ef4444.
- **Chips/badges**: pill (border-radius 999)، border 1px accent، fill translucent (accent+'18')، نص accent، padding 10px 22px، 30-34px، font-weight 700، glow box-shadow 0 0 24px rgba(accent,0.35).
- **Cards**: border-radius 16، bg rgba(255,255,255,0.04)، border 1px rgba(255,255,255,0.1)، backdrop-blur.
- خطوط: Cairo/Tajawal/Arial (نظام)؛ headlines 72-96px weight 800؛ code/أرقام JetBrains Mono نيون.
- **خلفيات**: matrix rain (خطوط/نقاط عمودية بطيئة) أو grid خفيف 4% — implement with divs + interpolate (NO canvas, NO Math.random; use seededRandom helper).
- **motion**: spring (damping 14-18, stiffness 120-180) للدخول، خروج في آخر 8-12 إطار (fade+scale)، stagger 4-8 إطارات، أرقام count-up.
- **safe zones**: top 10% / bottom 15% فارغة (Reels UI). RTL direction rtl.
- **text-shadow** glow على العناوين: 0 0 30px rgba(accent,0.5).

## عناصر بصرية / أيقونات / أشكال (motion graphics — إلزامي)
- **لا تكتفِ بالنص**. كل مشهد يجب أن يحتوي على **عنصر بصري** (أيقونة/شكل/رسم/مخطط) يُفسّر الفكرة.
- **أيقونات**: SVG inline (paths) — brain, chip, code, globe, lock, arrow, check, gear, database, network, play, clock, star, etc. حجم 80-160px، لون نيون، glow.
- **أشكال هندسية** (Remotion @remotion/shapes أو SVG): دوائر، حلقات، مثلثات، hexagons، rings (progress ring)، أسهم، خطوط متصلة (pipelines/nodes).
- **رسوم توضيحية**: مخططات (flowchart)، timelines، bar charts متحركة، node graphs، binary grids (0/1)، matrices.
- **أيقونات متحركة**: pulse/glow، rotate، draw (stroke-dashoffset)، scale pop.
- **خلفيات**: matrix rain، grid، particles (divs positioned via seededRandom + interpolate) — لا canvas.
- **أرقام/عدادات**: count-up with interpolate + Math.round (أرقام لاتينية).
- **رسوم "neon"**: glow (box-shadow/text-shadow 0 0 24-40px)، borders luminous، gradients.
- **تجنب**: نص فقط بدون شكل؛ بطاقات فارغة؛ صور خارجية (no network).
- **أمثلة per scene**:
   - "اللغة" → brain icon + floating words.
   - "0 و 1" → binary grid + chip icon.
   - "كومبيلر" → pipeline nodes (source → compiler → machine code) with arrows.
   - "خطأ 404" → warning triangle + glitch.
   - "نجاح" → check circle + chime glow.
- استخدم @remotion/shapes (Rect, Circle, Triangle, Star, Pie, Polygon) أو SVG paths.

## حركة غنية / مؤثرات / جاذبية (RICH MOTION - إلزامي، لا تقلّل)
- **طبقات (layers)**: خلفية (gradient/matrix) + طبقة وسط (أشكال/رسوم) + أمامية (نص/أيقونات). كل طبقة بحركة مختلفة (parallax).
- **عمق (depth)**: scale + blur + opacity + translateZ (perspective) لإحساس 3D.
- **Kinetic typography**: قسّم النص إلى كلمات/أحرف، كل واحد بـ spring (stagger 2-4 frames)، entrance (fade+slide+scale)، exit (shrink+fade).
- **رسوم متحركة (animated illustrations)**:
   - أيقونة تُرسم (stroke-dashoffset 0->length) ثم تمتلئ (fill fade-in).
   - أشكال تنمو (scale 0->1 with overshoot spring).
   - أسهم تُرسم (line draw) ثم رأس السهم يظهر.
   - nodes تنبض (pulse scale 1->1.12->1) مع glow.
- **مخططات (data viz)**: bars تنمو من 0، rings (stroke-dasharray animated)، counters count-up، timelines with nodes popping.
- **جزيئات/particles**: 20-40 نقطة صغيرة تطفو (seededRandom positions + sine drift via interpolate)، blur 1-2px.
- **transitions**: wipe (mask)، scale-zoom (0.9->1 + blur)، blur-dissolve، slide+fade، morph (shape transform).
- **micro-interactions**: hover-like pulses، glow breathing (sin wave on opacity)، shimmer sweep across text/cards.
- **easing**: استخدم Easing.out(Easing.cubic/expo/back)؛ spring with damping 10-16 for bouncy, 18-24 for smooth.
- **stagger**: 3-8 frames بين siblings؛ waves (wave offset per index).
- **parallax**: foreground moves 1.2x، mid 1x، bg 0.6x speed.
- **لا تكرر** نفس animation في كل مشهد - تنوع (pop, slide, wipe, draw, scale, blur).
- **attractiveness**: كل مشهد يجب أن "يلفت الانتباه" في أول 0.5s (hook visual) و "يشرح" في 2-3s (main visual) و "ينتهي نظيف" (exit).
- **clarity**: visual metaphor لكل مفهوم (لغة->دماغ+كلمات، 0/1->grid، كومبيلر->pipeline، نجاح->check+ring).
- استخدم @remotion/noise (noise2D/3D) للحركات العضوية (organic drift) - deterministic.
- استخدم @remotion/shapes (Rect, Circle, Triangle, Star, Pie, Polygon, Ring) + SVG paths.
- **تجنب**: static frames, single fade-in for everything, no movement.

## المطلوب
- ملف واحد \`.tsx\` يحتوي:
  - \`export const sceneConfig = ${JSON.stringify(scene.configHint)}\`
  - \`export default\` لمكوّن React واحد للمشهد.
- استخدم \`useCurrentFrame()\` و \`useVideoConfig()\`: مدة المشهد = **${scene.durationInFrames} إطار** عند **${scene.fps} fps**، ومقاس الشاشة **${scene.width}×${scene.height}**.
- العناصر البصرية لازم تتزامن مع توقيتات الكلمات/الجُمل أعلاه (± إطارين).
- ابدأ بمشهد واضح من الإطار 0 وانتهِ بانتقال نظيف في آخر 8–12 إطار (fade/خروج).
- **لا** تضع \`<Audio>\` أو \`staticFile\` للتعليق الصوتي: النظام يضيف الصوت تلقائيًا.
- إن احتجت صورة/شعار: استخدم \`staticFile('name.png')\` فقط إن كان الملف موجودًا فعلًا في \`public/\`.
- عربي RTL: \`direction: 'rtl'\`، خطوط \`Tajawal\` أو \`Cairo\` أو \`Arial\`، وأرقام لاتينية إن أردت.
- لا شبكة، لا \`Date.now()\`، لا \`Math.random()\`، لا مكتبات غير المتاحة:
  react, remotion, @remotion/*, framer-motion, three, @react-three/fiber, @react-three/drei, d3, lodash, zod.
- لا تكتب أي شيء خارج الكود: أعد ملف TSX كاملًا فقط.
`;
}

function buildReadme(dir, film) {
  const rows = (film.scenes || [])
    .map(
      (scene) =>
        `| ${scene.id} | ${timecode(scene.start)} – ${timecode(scene.end)} | ${scene.duration}s | ${scene.title} |`
    )
    .join('\n');

  const readme = `# ${film.name}

فيلم طويل مبني على تعليق صوتي واحد: كل مشهد ملف TSX مستقل، ويتم رندر المشاهد
منفردة أو كفيلم كامل.

- التعليق الصوتي: \`public/${film.audio}\` (${film.audioDuration || '?'} ثانية)
- الدقة: ${film.width}×${film.height} · ${film.fps} fps
- عدد المشاهد: ${(film.scenes || []).length}

| المشهد | من – إلى | المدة | العنوان |
|---|---|---|---|
${rows}

## طريقة العمل
1. افتح \`prompts/sNN.md\` وانسخه إلى الشات بوت (GPT/Claude/Gemini) لتوليد كود المشهد.
2. الصق الكود في \`scenes/sNN.tsx\` (أو من واجهة الأداة).
3. ارندر المشهد للمراجعة السريعة، ثم ارندر الفيلم الكامل.

## من سطر الأوامر
\`\`\`bat
node\\node.exe renderer\\render-film.js --project="${dir}" --mode=scene --scene=s01
node\\node.exe renderer\\render-film.js --project="${dir}" --mode=still --scene=s01 --time=3
node\\node.exe renderer\\render-film.js --project="${dir}" --mode=film
\`\`\`
`;

  fs.writeFileSync(path.join(dir, 'README.md'), readme, 'utf-8');
}

module.exports = {
  FILM_VERSION,
  STUB_MARKER,
  createFilm,
  loadFilm,
  listFilms,
  writeFilmFile,
  writeSceneArtifacts,
  readSceneTsx,
  isRealSceneCode,
  sceneHasCode,
  saveSceneTsx,
  getScene,
  sceneJsonPath,
  sceneTsxPath,
  scenePromptPath,
  buildScenePrompt,
  buildSceneStub,
  readJson,
  writeJson,
  slugify,
  timecode,
  round3,
};
