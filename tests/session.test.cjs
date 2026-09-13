const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function boot() {
  const elements = new Map();
  const timers = [];
  const storage = new Map();
  const context = vm.createContext({
    console,
    localStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener() {}, getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: '', style: {}, classList: { add() {}, remove() {} },
        setAttribute(name, value) { this[name] = String(value); },
        addEventListener() {},
      });
      return elements.get(id);
    } },
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
  });
  for (const file of ['vocab-1-250.js', 'vocab-251-500.js', 'srs.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  vm.runInContext('App.start()', context);
  return { run: code => vm.runInContext(code, context), elements, timers };
}

test('rapid repeated answers award XP and advance the schedule only once', () => {
  const app = boot();
  app.run('App.reveal(); App.answer(4); App.answer(4); App.reveal(); App.answer(5)');
  assert.equal(app.run('SRS.getStats().xp'), 7);
  assert.equal(app.elements.get('session-total').textContent, 1);
  assert.equal(app.timers.filter(t => t.delay === 400).length, 1);
  app.timers.find(t => t.delay === 400).fn();
  assert.equal(app.elements.get('card-rank').textContent, '#2');
  app.run('App.reveal(); App.answer(5)');
  assert.equal(app.run('SRS.getStats().xp'), 17);
});

test('answering before reveal does not change progress', () => {
  const app = boot();
  app.run('App.answer(5)');
  assert.equal(app.run('SRS.getStats().xp'), 0);
  assert.equal(app.elements.get('session-total').textContent, 0);
});

test('Play Again starts another 20-card session without resetting earned progress', () => {
  const app = boot();
  function answerNext() {
    app.run('App.reveal(); App.answer(4)');
    const index = app.timers.findIndex(t => t.delay === 400);
    assert.notEqual(index, -1);
    app.timers.splice(index, 1)[0].fn();
  }
  for (let i = 0; i < 20; i++) answerNext();
  assert.equal(app.elements.get('complete-total').textContent, 20);
  app.run('App.restartSession()');
  assert.equal(app.elements.get('card-rank').textContent, '#21');
  assert.equal(app.run('SRS.getStats().xp'), 140);
  assert.equal(app.elements.get('session-total').textContent, 0);
  for (let i = 0; i < 20; i++) answerNext();
  assert.equal(app.elements.get('complete-total').textContent, 20);
  assert.equal(app.run('SRS.getStats().xp'), 280);
});

test('counters reflect the next displayed card after a transition', () => {
  const app = boot();
  app.run('App.reveal(); App.answer(4)');
  app.timers.find(t => t.delay === 400).fn();
  assert.equal(app.elements.get('stat-new').textContent, app.run('SRS.getStats().new'));
  assert.equal(app.elements.get('stat-due').textContent, app.run('SRS.getStats().due'));
});

test('missed cards return after two intervening answers', () => {
  const app = boot();
  function answerAndAdvance(quality) {
    app.run(`App.reveal(); App.answer(${quality})`);
    const index = app.timers.findIndex(t => t.delay === 400);
    assert.notEqual(index, -1);
    app.timers.splice(index, 1)[0].fn();
  }

  answerAndAdvance(0);
  assert.equal(app.elements.get('card-rank').textContent, '#2');
  assert.equal(app.elements.get('stat-retry').textContent, 1);
  answerAndAdvance(4);
  assert.equal(app.elements.get('card-rank').textContent, '#3');
  answerAndAdvance(4);
  assert.equal(app.elements.get('card-rank').textContent, '#1');
  assert.equal(app.elements.get('stat-retry').textContent, 0);
});

test('long-term progress reports practiced and mastered vocabulary', () => {
  const app = boot();
  function answerAndAdvance(quality) {
    app.run(`App.reveal(); App.answer(${quality})`);
    const index = app.timers.findIndex(t => t.delay === 400);
    app.timers.splice(index, 1)[0].fn();
  }

  assert.equal(app.elements.get('mastery-label').textContent, '0 of 500 practiced · 0 mastered');
  answerAndAdvance(4);
  assert.equal(app.elements.get('mastery-label').textContent, '1 of 500 practiced · 0 mastered');
  assert.equal(app.elements.get('mastery-bar-fill')['aria-valuenow'], '0.2');
});

test('index provides every UI element required by the app', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const requiredIds = [...appSource.matchAll(/getElementById\('([^']+)'\)/g)]
    .map(match => match[1]);

  for (const id of new Set(requiredIds)) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id} in index.html`);
  }
});
