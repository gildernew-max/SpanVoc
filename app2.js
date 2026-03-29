// app.js
// Session Manager — connects SRS engine to the UI
// Depends on: srs.js, vocab-1-250.js, vocab-251-500.js
//
// Responsibilities:
//   - Initialize SRS with all loaded vocab chunks
//   - Manage current session (current card, answer state)
//   - Drive gamification display (XP bar, level-up alerts, streak)
//   - Expose a simple API that index.html event handlers call directly
//
// To add more vocab later, just add the chunk to VOCAB_CHUNKS below.
// No other changes needed anywhere in the codebase.

// ── Vocab Registry ────────────────────────────────────────────────────────────
// Add new chunks here as you build them. Order doesn't matter.
const VOCAB_CHUNKS = [
  ...VOCAB_1_250,
  ...VOCAB_251_500,
  // ...VOCAB_501_750,   // uncomment when ready
  // ...VOCAB_751_1000,  // uncomment when ready
];

// ── App State ─────────────────────────────────────────────────────────────────
const App = (() => {

  let _currentCard   = null;   // Card object currently being shown
  let _isRevealed    = false;  // Whether answer side is showing
  let _sessionScore  = { correct: 0, incorrect: 0, total: 0 };
  let _prevXP        = 0;      // XP before last answer (for level-up detection)

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    SRS.init(VOCAB_CHUNKS);
    _prevXP = SRS.getStats().xp;
    _nextCard();
    _refreshStats();
  }

  // ── Card Flow ──────────────────────────────────────────────────────────────

  function _nextCard() {
    _currentCard = SRS.getNextCard();
    _isRevealed  = false;

    if (!_currentCard) {
      _showSessionComplete();
      return;
    }

    _renderCard(_currentCard);
    _setButtons('prompt');
  }

  function reveal() {
    if (!_currentCard || _isRevealed) return;
    _isRevealed = true;
    _setButtons('answer');
    _flipCard();
  }

  // q: 0=Miss, 2=Hard, 4=Good, 5=Easy
  function answer(q) {
    if (!_currentCard || !_isRevealed) return;

    const id     = _currentCard.rank;
    const result = SRS.recordAnswer(id, q);

    // Session score
    _sessionScore.total++;
    if (q >= 3) _sessionScore.correct++;
    else        _sessionScore.incorrect++;

    // Gamification
    _showXPGain(result.xpEarned);
    _checkLevelUp(result.totalXP);
    _refreshStats();

    // Advance after brief pause
    setTimeout(_nextCard, 400);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function _renderCard(card) {
    document.getElementById('card-spanish').textContent = card.spanish;
    document.getElementById('card-pos').textContent     = card.pos;
    document.getElementById('card-rank').textContent    = `#${card.rank}`;
    document.getElementById('card-english').textContent = card.english;
    document.getElementById('card-example').textContent = card.example;
    document.getElementById('card-tip').textContent     = card.tip ? '💡 ' + card.tip : '';

    // Reset flip
    document.getElementById('card').classList.remove('flipped');
  }

  function _flipCard() {
    document.getElementById('card').classList.add('flipped');
  }

  function _setButtons(mode) {
    document.getElementById('btn-prompt').style.display = mode === 'prompt' ? 'flex' : 'none';
    document.getElementById('btn-answer').style.display = mode === 'answer' ? 'flex' : 'none';
  }

  // ── Stats & Gamification ──────────────────────────────────────────────────

  function _refreshStats() {
    const s = SRS.getStats();

    // Streak & level
    document.getElementById('stat-streak').textContent  = s.streak;
    document.getElementById('stat-level').textContent   = s.level;
    document.getElementById('stat-title').textContent   = s.title;

    // XP bar
    const xpMin = s.xpThreshold;
    const xpMax = s.nextXP || s.xp + 1;
    const pct   = Math.min(100, Math.round(((s.xp - xpMin) / (xpMax - xpMin)) * 100));
    document.getElementById('xp-bar-fill').style.width = pct + '%';
    document.getElementById('xp-label').textContent    = s.nextXP
      ? `${s.xp} / ${s.nextXP} XP`
      : `${s.xp} XP — MAX`;

    // Card counts
    document.getElementById('stat-due').textContent     = s.due;
    document.getElementById('stat-new').textContent     = s.new;
    document.getElementById('stat-learned').textContent = s.learned;

    // Session score
    document.getElementById('session-correct').textContent   = _sessionScore.correct;
    document.getElementById('session-incorrect').textContent = _sessionScore.incorrect;
    document.getElementById('session-total').textContent     = _sessionScore.total;
  }

  function _showXPGain(xp) {
    if (xp <= 0) return;
    const el = document.getElementById('xp-toast');
    if (!el) return;
    el.textContent = `+${xp} XP`;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1200);
  }

  function _checkLevelUp(newXP) {
    const levels   = SRS.getLevels();
    const prevLevel = [...levels].reverse().find(l => l.xp <= _prevXP);
    const currLevel = [...levels].reverse().find(l => l.xp <= newXP);
    _prevXP = newXP;
    if (currLevel && prevLevel && currLevel.level > prevLevel.level) {
      _showLevelUp(currLevel);
    }
  }

  function _showLevelUp(levelInfo) {
    const el = document.getElementById('levelup-banner');
    if (!el) return;
    document.getElementById('levelup-title').textContent = levelInfo.title;
    document.getElementById('levelup-level').textContent = `Level ${levelInfo.level}`;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  function _showSessionComplete() {
    const pct = _sessionScore.total > 0
      ? Math.round((_sessionScore.correct / _sessionScore.total) * 100)
      : 0;

    const s = SRS.getStats();
    document.getElementById('complete-score').textContent   = pct + '%';
    document.getElementById('complete-correct').textContent = _sessionScore.correct;
    document.getElementById('complete-total').textContent   = _sessionScore.total;
    document.getElementById('complete-learned').textContent = s.learned;
    document.getElementById('complete-streak').textContent  = s.streak;
    document.getElementById('session-complete').classList.add('show');
  }

  // ── Session Controls ───────────────────────────────────────────────────────

  function restartSession() {
    _sessionScore = { correct: 0, incorrect: 0, total: 0 };
    document.getElementById('session-complete').classList.remove('show');
    _nextCard();
    _refreshStats();
  }

  function resetAllProgress() {
    if (!confirm('Reset ALL progress? This cannot be undone.')) return;
    SRS.resetAll();
    _sessionScore = { correct: 0, incorrect: 0, total: 0 };
    _prevXP = 0;
    _nextCard();
    _refreshStats();
  }

  // ── Keyboard Controls ─────────────────────────────────────────────────────

  function _initKeyboard() {
    document.addEventListener('keydown', e => {
      switch (e.key) {
        case ' ':
        case 'Enter':
          e.preventDefault();
          if (!_isRevealed) reveal();
          break;
        case '1': if (_isRevealed) answer(0); break;  // Miss
        case '2': if (_isRevealed) answer(2); break;  // Hard
        case '3': if (_isRevealed) answer(4); break;  // Good
        case '4': if (_isRevealed) answer(5); break;  // Easy
        case 'ArrowLeft':  if (_isRevealed) answer(0); break;
        case 'ArrowRight': if (_isRevealed) answer(5); break;
        case 'ArrowDown':  if (_isRevealed) answer(2); break;
        case 'ArrowUp':    if (_isRevealed) answer(4); break;
      }
    });
  }

  // ── Touch / Swipe ─────────────────────────────────────────────────────────

  function _initSwipe() {
    const wrapper = document.getElementById('card-wrapper');
    if (!wrapper) return;

    let startX = 0, startY = 0;

    wrapper.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    wrapper.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;

      // Tap (no real movement) — reveal
      if (Math.abs(dx) < 30 && Math.abs(dy) < 30) {
        if (!_isRevealed) reveal();
        return;
      }

      if (!_isRevealed) return;

      // Swipe gesture after reveal
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 60)       answer(5);  // → Easy
        else if (dx < -60) answer(0);  // ← Miss
      } else {
        if (dy < -60)      answer(4);  // ↑ Good
        else if (dy > 60)  answer(2);  // ↓ Hard
      }
    }, { passive: true });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  function start() {
    init();
    _initKeyboard();
    _initSwipe();
  }

  return { start, reveal, answer, restartSession, resetAllProgress };

})();

// Auto-start when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.start());
