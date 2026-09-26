const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/vision/engine.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ delayBitmap = false, autoReady = true } = {}) {
  let clock = 0, nextTimer = 0, resolveBitmap;
  const workers = [], captures = [], observations = [], failures = [], timers = new Map(), intervals = new Map();
  class Stream { constructor(tracks) { this.tracks = tracks; } getVideoTracks() { return this.tracks; } }
  class Worker {
    constructor(url) { this.url = url; this.posts = []; this.terminations = 0; workers.push(this); }
    postMessage(value, transfer) {
      this.posts.push({ value, transfer });
      if (value.type === 'INIT' && autoReady) queueMicrotask(() => this.emit({ type: 'READY' }));
    }
    emit(data) { this.onmessage?.({ data }); }
    terminate() { this.terminations++; }
  }
  const bitmap = { closed: 0, close() { this.closed++; } };
  const createImageBitmap = (video, options) => {
    captures.push({ time: video.currentTime, options });
    return delayBitmap ? new Promise(resolve => { resolveBitmap = resolve; }) : Promise.resolve(bitmap);
  };
  const exports = {};
  new Function('exports', 'Worker', 'MediaStream', 'performance', 'createImageBitmap', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'DOMException', source)(
    exports, Worker, Stream, { now: () => clock }, createImageBitmap,
    callback => { const id = ++nextTimer; timers.set(id, callback); return id; }, id => timers.delete(id),
    callback => { const id = ++nextTimer; intervals.set(id, callback); return id; }, id => intervals.delete(id), DOMException,
  );
  const controller = new AbortController(), track = { readyState: 'live', muted: false, enabled: true };
  const video = { readyState: 2, paused: false, ended: false, currentTime: 0, videoWidth: 640, videoHeight: 480, srcObject: new Stream([track]) };
  return {
    controller, video, track, captures, bitmap, workers, observations, failures, intervals, timers,
    at(value) { clock = value; }, finishBitmap() { resolveBitmap(bitmap); },
    start: () => exports.createEvaluationWorker('CPU', controller.signal, (value, stats) => observations.push({ value, stats }), message => failures.push(message)),
    frames: () => workers[0].posts.filter(post => post.value.type === 'FRAME'),
    reply(at = clock) { workers[0].emit({ type: 'OBSERVATION', observation: { at, bodies: { ok: true, boxes: [], saturated: false }, faces: { ok: true, faces: [], saturated: false } }, durationMs: 10 }); },
  };
}
const calibration = { yaw: 0, pitch: 0 };

test('frozen decoded camera frame cannot acquire fresh observation timestamps', async () => {
  const f = fixture(), engine = await f.start();
  await engine.frame(f.video, calibration); f.reply(0);
  f.at(5000); await engine.frame(f.video, calibration);
  assert.equal(f.captures.length, 1); assert.equal(f.frames().length, 1);
  f.video.currentTime = .1; await engine.frame(f.video, calibration);
  assert.equal(f.frames().length, 2); assert.equal(f.frames()[1].value.at, 5000);
  engine.close();
});

test('paused, ended, unready, muted, disabled and ended-track cameras do not submit observations', async () => {
  for (const change of [f => { f.video.paused = true; }, f => { f.video.ended = true; }, f => { f.video.readyState = 1; }, f => { f.track.muted = true; }, f => { f.track.enabled = false; }, f => { f.track.readyState = 'ended'; }, f => { f.video.srcObject.tracks = []; }]) {
    const f = fixture(), engine = await f.start(); change(f);
    await engine.frame(f.video, calibration);
    assert.equal(f.captures.length, 0); assert.equal(f.frames().length, 0); assert.equal(f.observations.length, 0);
    engine.close();
  }
});

test('only one capture/inference is in flight and a skipped frame can be retried when worker completes', async () => {
  const f = fixture({ delayBitmap: true }), engine = await f.start();
  const capture = engine.frame(f.video, calibration);
  f.at(400); f.video.currentTime = .4; await engine.frame(f.video, calibration);
  assert.equal(f.captures.length, 1); assert.equal(f.frames().length, 0);
  f.finishBitmap(); await capture;
  assert.equal(f.frames().length, 1); assert.equal(f.frames()[0].transfer[0], f.bitmap);
  f.reply(0); assert.equal(f.observations[0].stats.dropped, 1);
  const retry = engine.frame(f.video, calibration); f.finishBitmap(); await retry;
  assert.equal(f.frames().length, 2); assert.equal(f.frames()[1].value.at, 400);
  engine.close();
});

test('closing during frame capture releases the bitmap and never transfers or observes it', async () => {
  const f = fixture({ delayBitmap: true }), engine = await f.start();
  const pending = engine.frame(f.video, calibration); engine.close(); f.finishBitmap(); await pending;
  assert.equal(f.bitmap.closed, 1); assert.equal(f.frames().length, 0); assert.equal(f.workers[0].terminations, 1);
  f.reply(0); assert.equal(f.observations.length, 0); assert.equal(f.intervals.size, 0);
  engine.close(); assert.equal(f.workers[0].terminations, 1);
});

test('abort closes an initialized worker and ignores late responses', async () => {
  const f = fixture(), engine = await f.start();
  await engine.frame(f.video, calibration); f.controller.abort(); f.reply(0);
  assert.equal(f.observations.length, 0); assert.equal(f.workers[0].terminations, 1); assert.equal(f.intervals.size, 0);
  f.at(1000); f.video.currentTime = 1; await engine.frame(f.video, calibration);
  assert.equal(f.frames().length, 1); engine.close();
});

test('abort during initialization rejects promptly and removes the initialization timer', async () => {
  const f = fixture({ autoReady: false }), pending = f.start();
  f.controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(f.workers[0].terminations, 1); assert.equal(f.timers.size, 0); assert.equal(f.intervals.size, 0);
});

test('late model results become unavailable outcomes rather than measured empty scenes', async () => {
  const f = fixture(), engine = await f.start();
  await engine.frame(f.video, calibration); f.at(1500); f.reply(0);
  const observation = f.observations[0].value;
  assert.equal(observation.at, 1500); assert.equal(observation.bodies.ok, false); assert.equal(observation.faces.ok, false);
  engine.close();
});

test('stalled inference terminates the worker and reports failure without a zero observation', async () => {
  const f = fixture(), engine = await f.start();
  await engine.frame(f.video, calibration); f.at(10001);
  [...f.intervals.values()].forEach(callback => callback());
  assert.equal(f.workers[0].terminations, 1); assert.match(f.failures[0], /Inference stalled/); assert.equal(f.observations.length, 0);
  assert.equal(f.intervals.size, 0); engine.close();
});
