// Renders promo.html to assets/skillgantry-promo.mp4: seek, screenshot, pipe to ffmpeg.
// Needs ffmpeg, Google Chrome and playwright-core (not a repo dependency):
//   npm i --prefix /tmp/pw playwright-core && PW=/tmp/pw/package.json node assets/promo/render.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = createRequire(process.env.PW ?? import.meta.url)('playwright-core');
const here = fileURLToPath(new URL('.', import.meta.url));
const FPS = 30, SECONDS = 30;

// The terminal footage: 14 s of the README gif (marking, the run, findings, issues) at 2x.
const frames = mkdtempSync(join(tmpdir(), 'sg-promo-'));
execFileSync('ffmpeg', ['-v', 'error', '-i', join(here, '../tui-screenshot/skillgantry-user-journey.gif'), 
  '-vf', `trim=9.5:23.5,setpts=(PTS-STARTPTS)/2,fps=${FPS}`, '-q:v', '1', join(frames, '%04d.jpg')]);
const count = readdirSync(frames).length;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${pathToFileURL(join(here, 'promo.html'))}?frames=${encodeURIComponent(pathToFileURL(frames).href)}&count=${count}`);
await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));

const only = process.env.STILLS; // STILLS=2,7,12 writes those seconds as PNGs instead of encoding
if (only) {
  for (const s of only.split(',')) {
    await page.evaluate((ms) => window.seek(ms), s * 1000);
    await page.screenshot({ path: join(process.env.OUT ?? frames, `still-${s}.png`) });
  }
} else {
  const out = join(here, '../skillgantry-promo.mp4');
  const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', FPS, '-i', '-',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < FPS * SECONDS; f++) {
    await page.evaluate((ms) => window.seek(ms), (f * 1000) / FPS);
    const shot = await page.screenshot({ type: 'jpeg', quality: 100 });
    if (!ffmpeg.stdin.write(shot)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  }
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on('close', r));
  console.log(out);
}
await browser.close();
