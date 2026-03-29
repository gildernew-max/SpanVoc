// app.js
// Session Manager — connects SRS engine to the UI
// Depends on: vocab-1-250.js, vocab-251-500.js, srs.js
// Called by: index.html
//
// Responsibilities:
//   - Initialize SRS with all loaded vocab chunks
//   - Manage current card state and session flow
//   - Translate user button presses into SRS quality scores
//   - Emit UI update events (no direct DOM manipulation here)
//   - Handle boss battle mode (every 50 cards reviewed)
//
// UI contract:
//   App.init()                  — call once on page load
//   App.getCurrentCard()        — returns current card or null
//   App.answer(rating)          — rating: 'easy'|'good'|'hard'|'miss'
//   App.skip()                  — skip current card (no SRS impact)
//   App.getStats()              — returns stats object for UI rendering
//   App.filterByDeck(deck)      — 'all' | 'nouns' | 'verbs' | 'adjectives' | 'phrases' | 'rules'
//   App.isBossBattle()          — returns true if boss battle mode is active
//   App.on(event, callback)     — subscribe to app events
//
// Events emitted:
//   'cardChanged'   — new card ready, payload: { card, stats }
//   'cardAnswered'  — answer recorded, payload: { card, rating, xpEarned, stats }
//   'sessionDone'   — no more cards this session, payload: { stats }
//   'bossBattle'    — boss battle triggered, payload: { cards }
//   'levelUp'       — user leveled up, payload: { level, title }
//   'streakUpdated' — streak changed, payload: { streak }

const App = (() => {

  // ── Internal State ─────────────────────────────────────────────────────────

  let _currentCard   = null;
  let _activeDeck    = 'all';
  let _cardsAnswered = 0;       // This session
  let _prevLevel     = 1;
  let _listeners     = {};      // event → [callbacks]
  let _bossBattle    = false;
  let _bossDeck      = [];      // Cards queued for boss battle
  let _bossIndex     = 0;

  // Boss battle triggers every N correct answers
  const BOSS_TRIGGER = 50;
  const BOSS_CARDS   = 10;      // Number of rapid-fire cards in boss battle

  // Rating → SM-2 quality score
  const QUALITY = {
    easy: 5,
    good: 4,
    hard: 2,
    miss: 0,
  };

  // ── Event System ───────────────────────────────────────────────────────────

  function on(event, callback) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(callback);
  }

  function _emit(event, payload) {
    (_listeners[event] || []).forEach(cb => {
      try { cb(payload); } catch(e) { console.error('App event error:', e); }
    });
  }

  // ── Vocab Loading ──────────────────────────────────────────────────────────

  function _getAllVocab() {
    // Collect all loaded vocab chunks in order
    // New chunks (vocab-501-750.js etc.) just need to be included in index.html
    // and added to this array — no other changes needed
    const chunks = [];
    if (typeof VOCAB_1_250   !== 'undefined') chunks.push(...VOCAB_1_250);
    if (typeof VOCAB_251_500 !== 'undefined') chunks.push(...VOCAB_251_500);
    if (typeof VOCAB_501_750 !== 'undefined') chunks.push(...VOCAB_501_750);
    if (typeof VOCAB_751_1000 !== 'undefined') chunks.push(...VOCAB_751_1000);
    return chunks;
  }

  function _filterByDeck(cards) {
    if (_activeDeck === 'all') return cards;
    return cards.filter(c => c.pos && c.pos.toLowerCase().includes(_activeDeck.replace('s','')));
  }

  // ── Session Flow ───────────────────────────────────────────────────────────

  function _advance() {
    if (_bossBattle) {
      _nextBossCard();
      return;
    }

    _currentCard = SRS.getNextCard();

    if (!_currentCard) {
      _emit('sessionDone', { stats: getStats() });
      return;
    }

    _emit('cardChanged', { card: _currentCard, stats: getStats() });
  }

  function _checkLevelUp(statsBefore, statsAfter) {
    if (statsAfter.level > statsBefore.level) {
      _emit('levelUp', { level: statsAfter.level, title: statsAfter.title });
    }
  }

  function _checkBossBattle() {
    if (_cardsAnswered > 0 && _cardsAnswered % BOSS_TRIGGER === 0) {
      _triggerBossBattle();
    }
  }

  // ── Boss Battle ────────────────────────────────────────────────────────────

  function _triggerBossBattle() {
    // Pick BOSS_CARDS random cards from learned cards for rapid-fire review
    const all = _getAllVocab();
    const learned = all.filter(c => {
      const stats = SRS.getStats();
      // Use cards that have been seen at least once
      return true; // In practice, filter by schedule data — simplified here
    });

    // Shuffle and take first BOSS_CARDS
    const shuffled = [...all].sort(() => Math.random() - 0.5);
    _bossDeck  = shuffled.slice(0, BOSS_CARDS);
    _bossIndex = 0;
    _bossBattle = true;

    _emit('bossBattle', { cards: _bossDeck });
    _nextBossCard();
  }

  function _nextBossCard() {
    if (_bossIndex >= _bossDeck.length) {
      _bossBattle = false;
      _advance();
      return;
    }
    _currentCard = _bossDeck[_bossIndex++];
    _emit('cardChanged', { card: _currentCard, stats: getStats(), isBoss: true });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init() {
    const allVocab = _getAllVocab();
    if (allVocab.length === 0) {
      console.error('App: No vocab loaded. Make sure vocab-1-250.js is included.');
      return;
    }

    SRS.init(allVocab);
    _prevLevel = SRS.getStats().level;
    _cardsAnswered = 0;
    _bossBattle = false;

    _advance();
  }

  function getCurrentCard() {
    return _currentCard;
  }

  function answer(rating) {
    if (!_currentCard) return;

    const q = QUALITY[rating];
    if (q === undefined) {
      console.warn('App.answer: invalid rating', rating);
      return;
    }

    const statsBefore = getStats();
    const result = SRS.recordAnswer(_currentCard.rank, q);
    const statsAfter  = getStats();

    _cardsAnswered++;

    _emit('cardAnswered', {
      card:     _currentCard,
      rating,
      xpEarned: result.xpEarned,
      stats:    statsAfter,
    });

    _checkLevelUp(statsBefore, statsAfter);
    _checkBossBattle();
    _emit('streakUpdated', { streak: statsAfter.streak });

    _advance();
  }

  function skip() {
    if (!_currentCard) return;
    // No SRS impact — just move on
    _advance();
  }

  function getStats() {
    const s = SRS.getStats();

    // Add session-level data
    return {
      ...s,
      sessionAnswered: _cardsAnswered,
      isBossBattle:    _bossBattle,
    };
  }

  function filterByDeck(deck) {
    _activeDeck = deck;
    // Restart session with filtered deck
    // Note: SRS progress is global — filter only affects card selection display
    // For true deck filtering, re-init SRS with filtered cards
    const allVocab = _getAllVocab();
    const filtered = _filterByDeck(allVocab);
    SRS.init(filtered);
    _cardsAnswered = 0;
    _advance();
  }

  function isBossBattle() {
    return _bossBattle;
  }

  // Add a new vocab chunk at runtime (e.g., user unlocks next 250 words)
  function loadChunk(chunkArray) {
    SRS.addCards(chunkArray);
  }

  return {
    init,
    getCurrentCard,
    answer,
    skip,
    getStats,
    filterByDeck,
    isBossBattle,
    loadChunk,
    on,
  };

})();

// ── Usage (called from index.html after DOM ready) ─────────────────────────
//
//   App.on('cardChanged', ({ card, stats }) => {
//     renderCard(card);
//     renderStats(stats);
//   });
//
//   App.on('cardAnswered', ({ xpEarned, stats }) => {
//     showXPPopup(xpEarned);
//     renderStats(stats);
//   });
//
//   App.on('levelUp', ({ level, title }) => {
//     showLevelUpModal(level, title);
//   });
//
//   App.on('sessionDone', ({ stats }) => {
//     showSessionSummary(stats);
//   });
//
//   App.on('bossBattle', ({ cards }) => {
//     showBossBattleIntro();
//   });
//
//   App.init();
//
// ── Adding vocab later ─────────────────────────────────────────────────────
//
//   // In index.html, just add the new script tag:
//   // <script src="vocab-501-750.js"></script>
//   // app.js _getAllVocab() will automatically detect and include it.
//   // No other changes needed anywhere.
