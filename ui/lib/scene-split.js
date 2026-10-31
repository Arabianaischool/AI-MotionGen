/**
 * Scene splitter
 *
 * Turns a word-level transcript (faster-whisper output) into an ordered list of
 * scenes that tile the whole narration with no gaps and no overlaps.
 *
 * Strategy (fully deterministic, no random, no clock):
 *   1. Normalise the transcript into "units" (whisper segments, or word slices
 *      when a single segment is longer than the maximum scene length).
 *   2. Greedily merge units into scenes: keep merging until the scene reaches
 *      the target length, then only break on a natural break (a pause in the
 *      voice or a sentence-ending punctuation) — never exceeding the maximum.
 *   3. Post-pass: merge scenes that ended up shorter than the minimum.
 *   4. Snap every boundary to a frame and pad it a little (a scene starts a
 *      touch before the first word and ends a touch after the last one) so the
 *      visuals do not cut on the exact phoneme.
 *
 * Output scenes are frame-aligned:
 *   start/end       seconds (derived from startFrame/endFrame, so they are exact)
 *   startFrame/endFrame/durationInFrames  integers at the film fps
 */

const DEFAULTS = {
  fps: 30,
  minSceneSeconds: 6,
  targetSceneSeconds: 14,
  maxSceneSeconds: 24,
  padSeconds: 0.18,
  pauseBreakSeconds: 0.45,
};

// Arabic + Latin sentence terminators. "،" and "," are soft breaks only.
const HARD_END = /[.!?؟…。]+["'”’»)\]]?\s*$/;
const SOFT_END = /[,،;؛:]+["'”’»)\]]?\s*$/;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function frameOf(seconds, fps) {
  return Math.round(seconds * fps);
}

/**
 * Split one whisper segment into word chunks of at most `chunkSeconds`.
 * Falls back to proportional slicing when word timestamps are missing.
 */
function splitSegment(segment, chunkSeconds) {
  const start = Number(segment.start) || 0;
  const end = Number(segment.end) || 0;
  const text = String(segment.text || '').trim();
  const words = Array.isArray(segment.words) ? segment.words : [];

  if (end - start <= chunkSeconds) {
    return [{ start, end, text, words, segmentIds: [segment.id] }];
  }

  // Without word timings we can only slice proportionally on character count.
  if (words.length < 2) {
    const pieces = [];
    const duration = end - start;
    const count = Math.max(2, Math.ceil(duration / chunkSeconds));
    const chars = Math.max(1, text.length);
    for (let i = 0; i < count; i += 1) {
      const fromChar = Math.floor((chars * i) / count);
      const toChar = Math.floor((chars * (i + 1)) / count);
      const fromTime = start + (duration * i) / count;
      const toTime = start + (duration * (i + 1)) / count;
      pieces.push({
        start: fromTime,
        end: toTime,
        text: text.slice(fromChar, toChar).trim(),
        words: [],
        segmentIds: [segment.id],
      });
    }
    return pieces;
  }

  const chunks = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0];
    const last = current[current.length - 1];
    chunks.push({
      start: Number(first.start),
      end: Number(last.end),
      text: current.map((w) => w.word).join(' ').replace(/\s+([،.!؟])/g, '$1').trim(),
      words: current,
      segmentIds: [segment.id],
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    const span = Number(current[current.length - 1].end) - Number(current[0].start);
    if (span >= chunkSeconds) flush();
  }
  flush();
  return chunks.length ? chunks : [{ start, end, text, words, segmentIds: [segment.id] }];
}

/**
 * Build scene objects from a transcript.
 *
 * @param {Object} transcript  { segments: [...], duration }
 * @param {Object} [options]
 * @returns {{scenes: Array, settings: Object, totals: Object}}
 */
function splitScenes(transcript, options = {}) {
  const settings = {
    fps: Number(options.fps) || DEFAULTS.fps,
    minSceneSeconds: Number(options.minSceneSeconds) || DEFAULTS.minSceneSeconds,
    targetSceneSeconds: Number(options.targetSceneSeconds) || DEFAULTS.targetSceneSeconds,
    maxSceneSeconds: Number(options.maxSceneSeconds) || DEFAULTS.maxSceneSeconds,
    padSeconds:
      options.padSeconds === undefined ? DEFAULTS.padSeconds : Number(options.padSeconds),
    pauseBreakSeconds:
      options.pauseBreakSeconds === undefined
        ? DEFAULTS.pauseBreakSeconds
        : Number(options.pauseBreakSeconds),
  };

  if (settings.maxSceneSeconds <= settings.minSceneSeconds) {
    settings.maxSceneSeconds = settings.minSceneSeconds + 6;
  }
  if (settings.targetSceneSeconds > settings.maxSceneSeconds) {
    settings.targetSceneSeconds = settings.maxSceneSeconds;
  }
  if (settings.targetSceneSeconds < settings.minSceneSeconds) {
    settings.targetSceneSeconds = settings.minSceneSeconds;
  }

  const rawSegments = Array.isArray(transcript)
    ? transcript
    : (transcript && Array.isArray(transcript.segments) ? transcript.segments : []);

  const audioDuration =
    Number(options.audioDuration) ||
    (transcript && Number(transcript.duration)) ||
    (rawSegments.length ? Number(rawSegments[rawSegments.length - 1].end) : 0);

  const segments = rawSegments
    .map((segment) => ({
      id: segment.id,
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: String(segment.text || '').trim(),
      words: Array.isArray(segment.words) ? segment.words : [],
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  const units = [];
  for (const segment of segments) {
    for (const piece of splitSegment(segment, settings.maxSceneSeconds * 0.9)) {
      if (piece.end > piece.start) units.push(piece);
    }
  }

  // ---- greedy merge -------------------------------------------------------
  const groups = [];
  let current = null;

  const startGroup = (unit) => ({
    start: unit.start,
    end: unit.end,
    text: unit.text,
    words: unit.words.slice(),
    units: [unit],
  });

  for (const unit of units) {
    if (!current) {
      current = startGroup(unit);
      continue;
    }

    const gap = unit.start - current.end;
    const combined = unit.end - current.start;
    const length = current.end - current.start;
    const naturalBreak = gap >= settings.pauseBreakSeconds || HARD_END.test(current.text);
    const tooLong = combined > settings.maxSceneSeconds;
    const reachedTarget = length >= settings.targetSceneSeconds;
    // do not drift too far past the target when the voice gives no clear pause
    const softCap = Math.min(settings.maxSceneSeconds, settings.targetSceneSeconds * 1.35);
    const pastSoftCap = length >= softCap;

    if (!tooLong && !(reachedTarget && naturalBreak) && !pastSoftCap) {
      current.end = Math.max(current.end, unit.end);
      current.text = `${current.text} ${unit.text}`.replace(/\s+/g, ' ').trim();
      current.words = current.words.concat(unit.words);
      current.units.push(unit);
    } else {
      groups.push(current);
      current = startGroup(unit);
    }
  }
  if (current) groups.push(current);

  // ---- merge anything shorter than the minimum ---------------------------
  const merged = [];
  for (const group of groups) {
    const length = group.end - group.start;
    const previous = merged[merged.length - 1];
    if (
      previous &&
      length < settings.minSceneSeconds &&
      group.end - previous.start <= settings.maxSceneSeconds * 1.2
    ) {
      previous.end = group.end;
      previous.text = `${previous.text} ${group.text}`.replace(/\s+/g, ' ').trim();
      previous.words = previous.words.concat(group.words);
      previous.units = previous.units.concat(group.units);
    } else {
      merged.push(group);
    }
  }

  // ---- frame snapping, padding, no overlap ------------------------------
  const endLimit = audioDuration > 0 ? audioDuration : merged.length ? merged[merged.length - 1].end : 0;
  const pad = Math.max(0, settings.padSeconds);
  const scenes = [];
  let previousEndFrame = 0;

  merged.forEach((group, index) => {
    const start = Math.max(0, group.start - pad);
    let end = Math.min(endLimit || group.end, group.end + pad);
    if (end <= start) end = start + 1 / settings.fps;
    if (endLimit && end > endLimit) end = endLimit;

    // Scenes must tile the film: scene N starts exactly where N-1 ended, so the
    // film never shows a black gap between narration parts. Any lead-in padding
    // the next scene would have had is absorbed by the previous scene instead.
    let startFrame = index === 0 ? 0 : previousEndFrame;
    let endFrame = frameOf(end, settings.fps);
    if (endFrame <= startFrame) endFrame = startFrame + 1;

    const id = `s${String(index + 1).padStart(2, '0')}`;
    const durationInFrames = endFrame - startFrame;

    scenes.push({
      id,
      index: index + 1,
      startFrame,
      endFrame,
      durationInFrames,
      start: round3(startFrame / settings.fps),
      end: round3(endFrame / settings.fps),
      duration: round3(durationInFrames / settings.fps),
      title: makeTitle(group.text, index + 1),
      text: group.text,
      lines: group.units.map((unit) => ({
        start: round3(unit.start),
        end: round3(unit.end),
        endFrame: frameOf(unit.end, settings.fps),
        startFrame: frameOf(unit.start, settings.fps),
        text: unit.text,
      })),
      words: group.words.map((word) => ({
        start: round3(Number(word.start) || 0),
        end: round3(Number(word.end) || 0),
        word: String(word.word || '').trim(),
      })),
    });

    previousEndFrame = endFrame;
  });

  // The film must cover the narration: stretch the last scene to the end.
  if (scenes.length && endLimit > 0) {
    const last = scenes[scenes.length - 1];
    const filmEndFrame = frameOf(endLimit, settings.fps);
    if (filmEndFrame > last.endFrame) {
      last.endFrame = filmEndFrame;
      last.durationInFrames = last.endFrame - last.startFrame;
      last.end = round3(last.endFrame / settings.fps);
      last.duration = round3(last.durationInFrames / settings.fps);
    }
  }

  return {
    scenes,
    settings,
    totals: {
      audioDuration: round3(endLimit),
      sceneCount: scenes.length,
      filmDurationInFrames: scenes.length ? scenes[scenes.length - 1].endFrame : 0,
      filmDuration: scenes.length ? scenes[scenes.length - 1].end : 0,
    },
  };
}

/**
 * Human readable scene title from the first few words of its text.
 */
function makeTitle(text, index) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s،,.!?؟:;]+/, '')
    .trim();
  if (!clean) return `مشهد ${index}`;
  const words = clean.split(' ').slice(0, 7).join(' ');
  return words.length > 60 ? `${words.slice(0, 57)}…` : words;
}

/**
 * Evenly re-split scenes into `count` parts (used by the UI "split scene" action).
 * Keeps the same objects but recalculates ids/times.
 */
function renumberScenes(scenes) {
  return scenes.map((scene, index) => {
    const id = `s${String(index + 1).padStart(2, '0')}`;
    return { ...scene, id, index: index + 1 };
  });
}

module.exports = {
  splitScenes,
  makeTitle,
  renumberScenes,
  DEFAULTS,
};
