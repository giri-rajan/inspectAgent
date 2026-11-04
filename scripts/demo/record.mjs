// Records the demo video takes from the real running app (web :3000, API :8000 with the Meta key).
//   node scripts/demo/record.mjs [cards|inspect|insights|rules|line ...]   (default: all)
// Each take is captured with the CDP screencast at 1920x1080 into demo/out/takes/<take>/, with
// marks.json (scene starts, sped-up model waits) that scripts/demo/build.py turns into the edit.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const PW = process.env.PLAYWRIGHT ?? "/Users/giridhararajan/.npm/_npx/9833c18b2d85bc59/node_modules/playwright";
const { chromium } = require(PW);

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const OUT = path.join(ROOT, "demo/out");
const APP = process.env.APP_URL ?? "http://localhost:3000";
const CLOSE_URL = process.env.CLOSE_URL ?? "InspectAgent · Meta AI Developer Hackathon";
const OVERLAY = fs.readFileSync(path.join(ROOT, "scripts/demo/overlay.js"), "utf8");
const VOICE = path.join(OUT, "voice-note.wav");
// how much faster the live model waits play in the edit; the on-screen timer shows the same factor
const SPEED = { model: Number(process.env.FAST_MODEL ?? 8), agent: Number(process.env.FAST_AGENT ?? 10), line: Number(process.env.FAST_LINE ?? 6) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- capture

async function capture(page, name) {
  const dir = path.join(OUT, "takes", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const marks = [];
  let n = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const file = `frames/${String(n++).padStart(6, "0")}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  return {
    mark(label) {
      marks.push({ label, t: Date.now() / 1000 });
      console.log(`  [${name}] ${label}`);
    },
    async stop() {
      await sleep(400);
      marks.push({ label: "end", t: Date.now() / 1000 });
      await cdp.send("Page.stopScreencast").catch(() => {});
      fs.writeFileSync(path.join(dir, "take.json"), JSON.stringify({ frames, marks }, null, 1));
      console.log(`  [${name}] ${frames.length} frames`);
    },
  };
}

// ---------------------------------------------------------------- human-looking input

async function moveTo(page, x, y, ms = 480) {
  const from = await page.evaluate(() => window.__demoPos ?? { x: innerWidth / 2, y: innerHeight / 2 });
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(16);
  }
}

async function hover(page, loc, ms) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await moveTo(page, b.x + b.width / 2, b.y + b.height / 2, ms);
}

async function click(page, loc, { ms, pause = 140 } = {}) {
  await hover(page, loc, ms);
  await sleep(pause);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}

async function typeInto(page, loc, text) {
  await click(page, loc);
  await page.keyboard.type(text, { delay: 55 });
}

async function scrollBy(page, dy, ms = 900) {
  await page.evaluate(
    ([dy, ms]) =>
      new Promise((done) => {
        const y0 = scrollY;
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          scrollTo(0, y0 + dy * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
          k < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      }),
    [dy, ms],
  );
}

async function toTop(page) {
  const y = await page.evaluate(() => scrollY);
  if (y > 0) await scrollBy(page, -y, 700);
}

const caption = (page, title, sub) => page.evaluate(([a, b]) => window.__demo.caption(a, b), [title, sub ?? ""]);

/** Run a slow live model call sped up in the edit, with an on-screen timer saying so. */
async function fast(page, cap, label, factor, fn) {
  await page.evaluate(([l, f]) => window.__demo.wait(l, f), [label, factor]);
  cap.mark(`fast:${factor}:start`);
  await fn();
  cap.mark("fast:end");
  await page.evaluate(() => window.__demo.waitEnd());
}

// ---------------------------------------------------------------- takes

async function takeCards(ctx) {
  const page = await ctx.newPage();
  const sample = fs.readFileSync(path.join(ROOT, "data/samples/sample_10.jpg")).toString("base64");
  const html = fs
    .readFileSync(path.join(ROOT, "scripts/demo/cards.html"), "utf8")
    .replace("SAMPLE_IMG", `data:image/jpeg;base64,${sample}`)
    .replace("CLOSE_URL", CLOSE_URL);
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(-50, -50);
  const cap = await capture(page, "cards");
  for (const [id, hold] of [["title", 5500], ["problem", 11000], ["arch", 13000], ["close", 7000]]) {
    cap.mark(`card:${id}`);
    await page.evaluate((id) => window.show(id, id === "arch" ? 380 : 520), id);
    await sleep(hold);
  }
  await cap.stop();
}

const detections = (page) => page.getByRole("heading", { name: "Detections" });

async function inspectSample(page, cap, title, label = "SAM 3.1 segmenting · Muse Spark judging") {
  await click(page, page.getByRole("img", { name: title, exact: true }));
  await fast(page, cap, label, SPEED.model, async () => {
    await detections(page).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    await detections(page).waitFor({ state: "visible", timeout: 120000 });
  });
  await toTop(page);
}

async function rerun(page, cap) {
  await click(page, page.getByRole("button", { name: "Re-run" }));
  await fast(page, cap, "SAM 3.1 segmenting · Muse Spark judging", SPEED.model, async () => {
    await detections(page).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    await detections(page).waitFor({ state: "visible", timeout: 120000 });
  });
  await toTop(page);
}

async function takeInspect(ctx) {
  const page = await ctx.newPage();
  await page.goto(APP + "/", { waitUntil: "networkidle" });
  await page.getByRole("img", { name: "Mixed defects", exact: true }).waitFor();
  await sleep(800);
  const cap = await capture(page, "inspect");

  // S2: inspect one casting
  cap.mark("scene:S2");
  await caption(page, "Inspect", "A phone photo of a casting. No training photos for this part.");
  await sleep(1600);
  await hover(page, page.getByRole("img", { name: "Crack + burr", exact: true }), 600);
  await sleep(300);
  await inspectSample(page, cap, "Mixed defects");
  await caption(page, "SAM 3.1 finds · Muse Spark judges", "Masks for each plain-word prompt, measured in mm, judged against the factory’s rules");
  await sleep(2000);
  const cards = page.locator("section").filter({ has: detections(page) }).locator("div.cursor-pointer");
  await click(page, cards.nth(0));
  await sleep(2200);
  await click(page, cards.nth(2));
  await sleep(2000);
  await click(page, cards.nth(2));
  await sleep(300);

  // S3: a new defect class in words
  cap.mark("scene:S3");
  await scrollBy(page, -400, 500);
  await caption(page, "Zero-shot", "Type a new defect in words and inspect again. No retraining.");
  await typeInto(page, page.getByLabel("Add a defect to look for"), "sand inclusion");
  await sleep(200);
  await page.keyboard.press("Enter");
  await sleep(500);
  await rerun(page, cap);
  await sleep(900);
  await scrollBy(page, 420, 900);
  await sleep(1800);
  await scrollBy(page, -420, 600);

  // S4: teach with one click, then a spoken note
  cap.mark("scene:S4");
  await caption(page, "Teach", "Mark a false detection once. Look-alikes stop holding parts.");
  await click(page, page.getByRole("button", { name: "Next part" }));
  await page.getByRole("img", { name: "Scratch only", exact: true }).waitFor();
  await sleep(300);
  await click(page, page.getByRole("button", { name: "sand inclusion", exact: true }).first(), { ms: 400 });
  await sleep(200);
  await inspectSample(page, cap, "Scratch only");
  await sleep(1600);
  await click(page, page.getByRole("button", { name: "Not a defect" }).first());
  await sleep(350);
  await click(page, page.getByRole("button", { name: "Shadow / lighting" }));
  await sleep(300);
  await click(page, page.getByRole("button", { name: "Save", exact: true }));
  await sleep(1600);
  await rerun(page, cap);
  await sleep(2800);

  cap.mark("scene:S4b");
  await caption(page, "Muse Voice Transcribe", "The operator speaks a note; it is stored with the inspection.");
  await click(page, page.getByRole("button", { name: "Voice note" }));
  await sleep(4600);
  await click(page, page.getByRole("button", { name: "Voice note" }));
  await fast(page, cap, "Muse Voice Transcribe", SPEED.model, async () => {
    await page.waitForFunction(() => document.querySelector("#op-note")?.value.length > 10, null, { timeout: 60000 });
  });
  await sleep(2600);
  await caption(page, "");
  await cap.stop();
  await page.close();
}

async function takeInsights(ctx) {
  const page = await ctx.newPage();
  await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find root cause/ }).waitFor();
  await sleep(1500);
  const cap = await capture(page, "insights");

  // S5: dashboard
  cap.mark("scene:S5");
  await caption(page, "Dashboard", "Six weeks of production: 8,300 castings, 3 furnaces, 3 shifts, 3 suppliers");
  await sleep(1000);
  await hover(page, page.getByRole("heading", { name: /hot spot/ }), 700);
  await sleep(2600);
  await scrollBy(page, 520, 1100);
  await sleep(2200);
  await scrollBy(page, 560, 1100);
  await sleep(2400);
  await scrollBy(page, -1080, 900);
  await sleep(300);

  // S6: root-cause agent
  cap.mark("scene:S6");
  await caption(page, "Root-cause agent", "Muse Spark calls analytics tools over the history, tests each hypothesis, drafts an 8D");
  await click(page, page.getByRole("button", { name: /Find root cause/ }));
  await page.waitForURL(/rootcause/);
  await fast(page, cap, "Muse Spark agent · tool calling", SPEED.agent, async () => {
    await page.getByRole("button", { name: "Download PDF" }).waitFor({ timeout: 240000 });
    await sleep(1500);
  });
  await sleep(800);
  await hover(page, page.getByRole("heading", { name: "Key findings" }), 600);
  await sleep(2400);
  const dl = page.waitForEvent("download");
  await click(page, page.getByRole("button", { name: "Download PDF" }));
  const file = await dl;
  const pdf = path.join(OUT, "8d.pdf");
  await file.saveAs(pdf);
  await sleep(600);

  // show the downloaded 8D (first page) on screen
  cap.mark("scene:S6b");
  const png = path.join(OUT, "8d.png");
  execFileSync("sips", ["-s", "format", "png", "-Z", "1800", pdf, "--out", png], { stdio: "ignore" });
  const img = fs.readFileSync(png).toString("base64");
  await page.evaluate((src) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:#010102;display:grid;place-items:center;opacity:0;transition:opacity .4s";
    wrap.innerHTML = `<img src="${src}" style="height:92vh;margin-top:-4vh;border-radius:6px;background:#fff;box-shadow:0 24px 64px rgb(0 0 0/.6);transform:translateY(24px);transition:transform .5s ease">`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => {
      wrap.style.opacity = "1";
      wrap.querySelector("img").style.transform = "none";
    });
  }, `data:image/png;base64,${img}`);
  await caption(page, "8D / CAPA report", "Downloaded as a PDF, ready for the quality engineer");
  await sleep(4500);
  await cap.stop();
  await page.close();
}

async function takeRules(ctx) {
  const page = await ctx.newPage();
  await page.goto(APP + "/", { waitUntil: "networkidle" });
  await page.getByRole("img", { name: "Gas porosity", exact: true }).waitFor();
  await sleep(800);
  const cap = await capture(page, "rules");

  cap.mark("scene:S7");
  await caption(page, "Rules in plain English", "Rule R3: reject any pore over 2 mm");
  await inspectSample(page, cap, "Gas porosity");
  await sleep(2000);
  await click(page, page.getByRole("link", { name: "Parts & rules", exact: true }), { ms: 450 });
  await page.getByLabel("Rule R3 text").waitFor();
  await sleep(300);
  await caption(page, "Change a rule, no retraining", "The customer now accepts pores up to 4 mm on this part");
  const text = page.getByLabel("Rule R3 text");
  await hover(page, text, 500);
  await text.click({ clickCount: 3 });
  await page.keyboard.type("Reject if any hole is bigger than 4 mm.", { delay: 22 });
  const limit = page.locator("div").filter({ has: text }).filter({ has: page.getByLabel("Size limit in mm") }).last().getByLabel("Size limit in mm");
  await click(page, limit);
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("4", { delay: 80 });
  await sleep(300);
  await click(page, page.getByRole("button", { name: "Save changes" }), { ms: 450 });
  await sleep(1300);
  await click(page, page.getByRole("link", { name: "Inspect", exact: true }), { ms: 450 });
  await page.getByRole("img", { name: "Gas porosity", exact: true }).waitFor();
  await caption(page, "Same casting, new rule", "The next inspection uses it immediately");
  await sleep(300);
  await inspectSample(page, cap, "Gas porosity");
  await sleep(3000);
  await caption(page, "");
  await cap.stop();
  await page.close();
}

async function takeLine(ctx) {
  const page = await ctx.newPage();
  await page.goto(APP + "/line", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start line" }).waitFor();
  await sleep(1200);
  const cap = await capture(page, "line");

  cap.mark("scene:S8");
  await caption(page, "Line mode", "A phone over the conveyor inspects and logs every casting, hands-free");
  await sleep(700);
  await click(page, page.getByRole("button", { name: "Every 2 s" }));
  await sleep(250);
  await click(page, page.getByRole("button", { name: "Start line" }));
  await fast(page, cap, "Live line · SAM 3.1 + Muse Spark per casting", SPEED.line, async () => {
    await sleep(Number(process.env.LINE_SECONDS ?? 75) * 1000);
  });
  await sleep(1400);
  await click(page, page.getByRole("button", { name: "Stop line" }));
  await sleep(1000);
  await caption(page, "");
  await cap.stop();
  await page.close();
}

// ---------------------------------------------------------------- main

const TAKES = { cards: takeCards, inspect: takeInspect, insights: takeInsights, rules: takeRules, line: takeLine };
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TAKES);

if (!fs.existsSync(VOICE)) {
  // a short operator note for the fake microphone, followed by silence so it is not looped
  const aiff = path.join(OUT, "voice-note.aiff");
  execFileSync("say", ["-v", "Eddy (English (US))", "-r", "170", "-o", aiff, "Ladle was cold on this heat. Pouring started late on furnace two."]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-af", "apad=pad_dur=4", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", VOICE]);
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--window-size=1920,1080", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${VOICE}%noloop`, "--autoplay-policy=no-user-gesture-required"],
});
for (const name of want) {
  console.log(`take ${name}`);
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1.2,
    colorScheme: "dark",
    acceptDownloads: true,
    permissions: ["microphone", "camera"],
  });
  await ctx.addInitScript(OVERLAY);
  try {
    await TAKES[name](ctx);
  } catch (e) {
    console.error(`take ${name} failed:`, e.message);
    process.exitCode = 1;
  }
  await ctx.close();
}
await browser.close();
