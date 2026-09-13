const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const source = readFileSync(join(__dirname, '..', 'particles.js'), 'utf8');

function setup() {
  const handlers = new Map();
  const frames = new Map();
  const media = new Map();
  const classes = new Set();
  let frameId = 0;
  let draws = 0;
  const ctx = Object.fromEntries(['clearRect', 'setTransform', 'beginPath', 'moveTo', 'lineTo', 'stroke'].map(k => [k, () => {}]));
  ctx.fillRect = ctx.strokeRect = () => { draws++; };
  const canvas = { getContext: () => ctx };
  const document = {
    hidden: false,
    querySelector: () => canvas,
    body: { classList: {
      contains: name => classes.has(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    } },
    addEventListener: (name, callback) => handlers.set(name, callback),
  };
  runInNewContext(source, {
    document,
    window: { addEventListener: (name, callback) => handlers.set(name, callback) },
    matchMedia(query) {
      const result = { matches: query.includes('hover'), addEventListener: (_, callback) => { result.change = callback; } };
      media.set(query, result);
      return result;
    },
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 3,
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  return {
    document, canvas, frames, media, classes,
    move: (x, type = 'mouse') => handlers.get('pointermove')({ clientX: x, clientY: 300, pointerType: type }),
    emit: name => handlers.get(name)(),
    tick(time) { const active = [...frames.values()]; frames.clear(); active.forEach(fn => fn(time)); },
    get draws() { return draws; },
  };
}

test('moving starts one loop, draws the trail, then becomes idle', () => {
  const app = setup();
  assert.equal(app.frames.size, 0);
  app.move(100); app.move(180); app.move(260);
  assert.equal(app.frames.size, 1);
  app.tick(100);
  assert.ok(app.draws > 0);
  for (let t = 150; t < 1800; t += 50) app.tick(t);
  assert.equal(app.frames.size, 0);
});

test('fast pointer movement is bounded and canvas resolution is capped', () => {
  const app = setup();
  for (let i = 0; i < 1000; i++) app.move(i * 15);
  app.tick(100);
  assert.ok(app.draws <= 80);
  assert.equal(app.canvas.width, 2880);
  assert.equal(app.canvas.height, 1800);
});

test('touch, reduced motion, and service dialog do not spawn particles', () => {
  const app = setup();
  app.move(100, 'touch');
  assert.equal(app.frames.size, 0);
  app.media.get('(prefers-reduced-motion: reduce)').matches = true;
  app.move(200);
  assert.equal(app.frames.size, 0);
  app.media.get('(prefers-reduced-motion: reduce)').matches = false;
  app.classes.add('portal-open');
  app.move(300);
  assert.equal(app.frames.size, 0);
});

test('hidden pages cancel work, and returning resumes only after movement', () => {
  const app = setup();
  app.move(100);
  app.document.hidden = true;
  app.emit('visibilitychange');
  assert.equal(app.frames.size, 0);
  assert.ok(app.classes.has('motion-paused'));
  app.document.hidden = false;
  app.emit('visibilitychange');
  assert.equal(app.frames.size, 0);
  assert.ok(!app.classes.has('motion-paused'));
  app.move(200);
  assert.equal(app.frames.size, 1);
});

test('changing motion preference and resizing clear pending animations', () => {
  const app = setup();
  app.move(100);
  app.media.get('(prefers-reduced-motion: reduce)').change();
  assert.equal(app.frames.size, 0);
  app.move(200);
  app.emit('resize');
  assert.equal(app.frames.size, 0);
});
