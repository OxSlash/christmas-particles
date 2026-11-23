// Copies the MediaPipe wasm runtime out of node_modules and makes sure the
// hand landmarker model is present, so a fresh clone works with `npm run dev`
// and a Vercel build has everything it needs without committing 35 MB of
// binaries to git.
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'mediapipe', 'wasm');
const modelPath = join(root, 'public', 'mediapipe', 'hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
];

/**
 * `public/mediapipe` is generated, not committed. On a deploy this script runs
 * during the build, so a failed download would otherwise produce a build that
 * goes green and ships an app with no hand tracking at all. In CI we fail the
 * build instead; locally we only warn so development is never blocked.
 */
const isCI = Boolean(process.env.VERCEL || process.env.CI);

function failOrWarn(message) {
  if (isCI) {
    console.error(`[setup-assets] ${message}`);
    process.exit(1);
  }
  console.warn(`[setup-assets] ${message}`);
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadModel() {
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      console.log(
        `[setup-assets] downloading hand_landmarker.task (~7.5 MB, attempt ${attempt}/${ATTEMPTS})…`,
      );
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Reject a truncated body or an HTML error page saved as the model. The
      // real file is ~7.5 MB, so anything far below that is not usable.
      if (buf.length < 4_000_000) {
        throw new Error(`suspicious size: ${(buf.length / 1e6).toFixed(2)} MB`);
      }
      await mkdir(dirname(modelPath), { recursive: true });
      await writeFile(modelPath, buf);
      console.log(`[setup-assets] saved ${(buf.length / 1e6).toFixed(1)} MB`);
      return;
    } catch (err) {
      if (attempt === ATTEMPTS) {
        failOrWarn(`could not download the hand landmarker model: ${err.message}`);
        console.warn(`[setup-assets] expected at ${modelPath}`);
        return;
      }
      // transient network hiccup: back off and retry
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

await mkdir(wasmDst, { recursive: true });
for (const f of WASM_FILES) {
  const src = join(wasmSrc, f);
  if (await exists(src)) {
    await copyFile(src, join(wasmDst, f));
  } else {
    failOrWarn(`missing wasm file: ${f} (expected in node_modules/@mediapipe/tasks-vision/wasm)`);
  }
}

if (await exists(modelPath)) {
  console.log('[setup-assets] model present');
} else {
  await downloadModel();
}
