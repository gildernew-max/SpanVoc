// srs.js
// SM-2 Spaced Repetition Engine
// Compatible with vocab-1-250.js and vocab-251-500.js (and future chunks)
// 
// SM-2 Algorithm:
//   - Each card has an ease factor (EF), interval, and repetitions count
//   - User rates recall 0-5 after each card
//   - Cards rated < 3 are reset and reviewed again soon
//   - Interval grows exponentially for well-remembered cards
//
// Public API:
//   SRS.init(allCards)          — load vocab, restore progress from localStorage
//   SRS.getNextCard()           — returns next card due for review, or null if done
//   SRS.recordAnswer(id, q)     — record answer quality (0-5), update schedule
//   SRS.getStats()              — returns { due, new, learned, streak, xp, level }
//   SRS.resetAll()              — wipe all progress (confirmation required in UI)
//   SRS.addCards(moreCards)     — add new vocab chunks without resetting progress

const SRS = (() => {

  // ── Constants ──────────────────────────────────────────────────────────────

  const STORAGE_KEY = 'lexico_srs_v1';
  const STREAK_KEY  = 'lexico_streak_v1';
  const XP_KEY      = 'lexico_xp_v1';

  const DEFAULT_EF       = 2.5;   // Starting ease factor
  const MIN_EF           = 1.3;   // Floor for ease factor
  const NEW_CARDS_PER_SESSION = 20; // Max new cards introduced per session

  // XP rewards
  const XP_EASY    = 10;
  const XP_GOOD    = 7;
  const XP_HARD    = 3;
  const XP_MISS    = 0;

  // Level thresholds (XP required to reach each level)
  const LEVELS = [
    { level: 1,  title: 'Principiante',   xp: 0     },
    { level: 2,  title: 'Aprendiz',       xp: 100   },
    { level: 3,  title: 'Estudiante',     xp: 300   },
    { level: 4,  title: 'Conocedor',      xp: 600   },
    { level: 5,  title: 'Competente',     xp: 1000  },
    { level: 6,  title: 'Avanzado',       xp: 1500  },
    { level: 7,  title: 'Experto',        xp: 2200  },
    { level: 8,  title: 'Maestro',        xp: 3000  },
    { level: 9,  title: 'Erudito',        xp: 4000  },
    { level: 10, title: 'Políglota',      xp: 5500  },
  ];

  // ── Internal State ─────────────────────────────────────────────────────────

  let _allCards    = [];   // Full vocab array (all loaded chunks)
  let _cardMap     = {};   // id → card object (for fast lookup)
  let _schedules   = {};   // id → { ef, interval, repetitions, nextReview, lastReview }
  let _sessionNew  = 0;    // New cards introduced this session
  let _totalXP     = 0;
  let _streak      = { count: 0, lastDate: null };

  // ── Persistence ────────────────────────────────────────────────────────────

  function _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_schedules));
      localStorage.setItem(XP_KEY,      JSON.stringify(_totalXP));
      localStorage.setItem(STREAK_KEY,  JSON.stringify(_streak));
    } catch(e) {
      console.warn('SRS: localStorage write failed', e);
    }
  }

  function _load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      const x = localStorage.getItem(XP_KEY);
      const k = localStorage.getItem(STREAK_KEY);
      if (s) _schedules = JSON.parse(s);
      if (x) _totalXP   = JSON.parse(x);
      if (k) _streak    = JSON.parse(k);
    } catch(e) {
      console.warn('SRS: localStorage read failed', e);
    }
  }

  // ── SM-2 Core ──────────────────────────────────────────────────────────────

  // q = answer quality: 0-5
  //   5 = perfect, instant recall
  //   4 = correct with slight hesitation
  //   3 = correct with difficulty
  //   2 = incorrect but easy to recall when shown
  //   1 = incorrect, difficult
  //   0 = complete blackout
  //
  // UI maps to: 0=Miss(0), 1=Hard(2), 2=Good(4), 3=Easy(5)

  function _sm2(schedule, q) {
    let { ef, interval, repetitions } = schedule;

    if (q >= 3) {
      // Correct answer — advance interval
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * ef);
      }
      repetitions += 1;
    } else {
      // Incorrect — reset repetitions, short interval
      repetitions = 0;
      interval = 1;
    }

    // Update ease factor
    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (ef < MIN_EF) ef = MIN_EF;

    const now = Date.now();
    const nextReview = now + interval * 24 * 60 * 60 * 1000;

    return { ef, interval, repetitions, nextReview, lastReview: now };
  }

  function _defaultSchedule() {
    return {
      ef:          DEFAULT_EF,
      interval:    0,
      repetitions: 0,
      nextReview:  0,   // 0 = never reviewed = due immediately
      lastReview:  null,
    };
  }

  // ── Card Selection ─────────────────────────────────────────────────────────

  function _isDue(id) {
    const s = _schedules[id];
    if (!s) return false;                    // Not initialized
    return Date.now() >= s.nextReview;
  }

  function _isNew(id) {
    return !_schedules[id];
  }

  function _getDueCards() {
    return _allCards.filter(c => _schedules[c.rank] && _isDue(c.rank));
  }

  function _getNewCards() {
    return _allCards.filter(c => _isNew(c.rank));
  }

  // Sort due cards: lowest next review first (most overdue first)
  function _sortByDue(cards) {
    return [...cards].sort((a, b) => {
      const sa = _schedules[a.rank];
      const sb = _schedules[b.rank];
      return (sa?.nextReview || 0) - (sb?.nextReview || 0);
    });
  }

  // ── Streak Logic ───────────────────────────────────────────────────────────

  function _updateStreak() {
    const today = new Date().toDateString();
    const last  = _streak.lastDate;

    if (last === today) return; // Already recorded today

    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (last === yesterday) {
      _streak.count += 1;
    } else if (last !== today) {
      _streak.count = 1; // Reset — missed a day
    }
    _streak.lastDate = today;
  }

  // ── XP & Levels ───────────────────────────────────────────────────────────

  function _xpForQuality(q) {
    if (q >= 5) return XP_EASY;
    if (q >= 4) return XP_GOOD;
    if (q >= 3) return XP_HARD;
    return XP_MISS;
  }

  function _getLevel(xp) {
    let current = LEVELS[0];
    for (const l of LEVELS) {
      if (xp >= l.xp) current = l;
      else break;
    }
    const nextLevel = LEVELS.find(l => l.xp > xp) || null;
    return {
      level:       current.level,
      title:       current.title,
      xpThreshold: current.xp,
      nextXP:      nextLevel ? nextLevel.xp : null,
      nextTitle:   nextLevel ? nextLevel.title : null,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init(allCards) {
    _allCards = allCards;
    _cardMap  = {};
    allCards.forEach(c => { _cardMap[c.rank] = c; });
    _load();
    _sessionNew = 0;
  }

  // Add more vocab chunks without resetting existing progress
  function addCards(moreCards) {
    moreCards.forEach(c => {
      if (!_cardMap[c.rank]) {
        _allCards.push(c);
        _cardMap[c.rank] = c;
      }
    });
  }

  // Returns the next card object to show, or null if session is done
  function getNextCard() {
    // 1. Due cards first (most overdue)
    const due = _sortByDue(_getDueCards());
    if (due.length > 0) return due[0];

    // 2. New cards (up to session limit)
    if (_sessionNew < NEW_CARDS_PER_SESSION) {
      const newCards = _getNewCards();
      if (newCards.length > 0) {
        // Initialize schedule for this card
        const card = newCards[0];
        _schedules[card.rank] = _defaultSchedule();
        _sessionNew++;
        return card;
      }
    }

    // 3. Nothing left for this session
    return null;
  }

  // Record answer. q = 0 (miss) | 2 (hard) | 4 (good) | 5 (easy)
  function recordAnswer(id, q) {
    if (!_schedules[id]) {
      _schedules[id] = _defaultSchedule();
    }

    // Update SM-2 schedule
    _schedules[id] = _sm2(_schedules[id], q);

    // Award XP
    const earned = _xpForQuality(q);
    _totalXP += earned;

    // Update streak
    _updateStreak();

    // Persist
    _save();

    return { xpEarned: earned, totalXP: _totalXP };
  }

  function getStats() {
    const due     = _getDueCards().length;
    const newCount= _getNewCards().length;
    const learned = Object.keys(_schedules).filter(id => {
      const s = _schedules[id];
      return s && s.repetitions >= 2;
    }).length;

    const levelInfo = _getLevel(_totalXP);

    return {
      due,
      new:     newCount,
      learned,
      total:   _allCards.length,
      streak:  _streak.count,
      xp:      _totalXP,
      level:   levelInfo.level,
      title:   levelInfo.title,
      nextXP:  levelInfo.nextXP,
      nextTitle: levelInfo.nextTitle,
      xpThreshold: levelInfo.xpThreshold,
    };
  }

  function resetAll() {
    _schedules  = {};
    _totalXP    = 0;
    _streak     = { count: 0, lastDate: null };
    _sessionNew = 0;
    _save();
  }

  // Expose LEVELS for UI progress bars
  function getLevels() {
    return [...LEVELS];
  }

  return { init, addCards, getNextCard, recordAnswer, getStats, resetAll, getLevels };

})();

// Usage example:
//
//   SRS.init([...VOCAB_1_250, ...VOCAB_251_500]);
//
//   const card = SRS.getNextCard();
//   // show card to user...
//   const result = SRS.recordAnswer(card.rank, 4); // 4 = Good
//   console.log(result.xpEarned, result.totalXP);
//
//   const stats = SRS.getStats();
//   console.log(stats.streak, stats.level, stats.title);
//
// To add vocab later (no progress reset):
//   SRS.addCards(VOCAB_501_750);
