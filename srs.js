// srs.js
// Cleaned SM-2 Spaced Repetition Engine
// Compatible with vocab arrays whose card IDs live on `rank`

const SRS = (() => {
  // ── Constants ─────────────────────────────────────────────────────────────

  const STORAGE_KEY = "lexico_srs_v2";

  const DAY_MS = 24 * 60 * 60 * 1000;

  const DEFAULT_EF = 2.5;
  const MIN_EF = 1.3;
  const NEW_CARDS_PER_SESSION = 20;

  const XP_EASY = 10;
  const XP_GOOD = 7;
  const XP_HARD = 3;
  const XP_MISS = 0;

  const LEVELS = [
    { level: 1, title: "Principiante", xp: 0 },
    { level: 2, title: "Aprendiz", xp: 100 },
    { level: 3, title: "Estudiante", xp: 300 },
    { level: 4, title: "Conocedor", xp: 600 },
    { level: 5, title: "Competente", xp: 1000 },
    { level: 6, title: "Avanzado", xp: 1500 },
    { level: 7, title: "Experto", xp: 2200 },
    { level: 8, title: "Maestro", xp: 3000 },
    { level: 9, title: "Erudito", xp: 4000 },
    { level: 10, title: "Políglota", xp: 5500 },
  ];

  // ── State ────────────────────────────────────────────────────────────────

  let state = createEmptyState();

  function createEmptyState() {
    return {
      cards: [],
      cardMap: {},
      progress: {
        schedules: {}, // id -> schedule
        xp: 0,
        streak: {
          count: 0,
          lastDate: null,
        },
      },
      session: {
        newCardsSeen: 0,
      },
    };
  }

  // ── Schedule Model ───────────────────────────────────────────────────────

  function createDefaultSchedule() {
    return {
      ef: DEFAULT_EF,
      interval: 0,
      repetitions: 0,
      nextReview: 0,
      lastReview: null,
      introduced: false, // prevents accidental "ghost due" behavior
    };
  }

  function cloneSchedule(schedule) {
    return {
      ef: schedule.ef,
      interval: schedule.interval,
      repetitions: schedule.repetitions,
      nextReview: schedule.nextReview,
      lastReview: schedule.lastReview,
      introduced: schedule.introduced,
    };
  }

  // Pure function
  function updateSchedule(schedule, quality, now) {
    const current = cloneSchedule(schedule ?? createDefaultSchedule());

    let { ef, interval, repetitions } = current;

    if (quality >= 3) {
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.max(1, Math.round(interval * ef));
      }
      repetitions += 1;
    } else {
      repetitions = 0;
      interval = 1;
    }

    ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    ef = Math.max(ef, MIN_EF);

    return {
      ef,
      interval,
      repetitions,
      nextReview: now + interval * DAY_MS,
      lastReview: now,
      introduced: true,
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  function serializeProgress(progress) {
    return JSON.stringify(progress);
  }

  function normalizeLoadedProgress(raw) {
    if (!raw || typeof raw !== "object") {
      return {
        schedules: {},
        xp: 0,
        streak: { count: 0, lastDate: null },
      };
    }

    const schedules =
      raw.schedules && typeof raw.schedules === "object" ? raw.schedules : {};

    const xp = Number.isFinite(raw.xp) ? raw.xp : 0;

    const streak =
      raw.streak && typeof raw.streak === "object"
        ? {
            count: Number.isFinite(raw.streak.count) ? raw.streak.count : 0,
            lastDate:
              typeof raw.streak.lastDate === "string" ? raw.streak.lastDate : null,
          }
        : { count: 0, lastDate: null };

    const normalizedSchedules = {};

    for (const [id, value] of Object.entries(schedules)) {
      if (!value || typeof value !== "object") continue;

      normalizedSchedules[id] = {
        ef: Number.isFinite(value.ef) ? value.ef : DEFAULT_EF,
        interval: Number.isFinite(value.interval) ? value.interval : 0,
        repetitions: Number.isFinite(value.repetitions) ? value.repetitions : 0,
        nextReview: Number.isFinite(value.nextReview) ? value.nextReview : 0,
        lastReview: Number.isFinite(value.lastReview) ? value.lastReview : null,
        introduced: value.introduced !== false,
      };
    }

    return {
      schedules: normalizedSchedules,
      xp,
      streak,
    };
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, serializeProgress(state.progress));
      return true;
    } catch (error) {
      console.warn("SRS: failed to save progress", error);
      return false;
    }
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeLoadedProgress(null);

      const parsed = JSON.parse(raw);
      return normalizeLoadedProgress(parsed);
    } catch (error) {
      console.warn("SRS: failed to load progress", error);
      return normalizeLoadedProgress(null);
    }
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  function getCardId(card) {
    return String(card.rank);
  }

  function todayString(now) {
    return new Date(now).toDateString();
  }

  function yesterdayString(now) {
    return new Date(now - DAY_MS).toDateString();
  }

  function getSchedule(id) {
    return state.progress.schedules[id] || null;
  }

  function hasSchedule(id) {
    return !!state.progress.schedules[id];
  }

  function isIntroduced(id) {
    const schedule = getSchedule(id);
    return !!(schedule && schedule.introduced);
  }

  function isDue(id, now) {
    const schedule = getSchedule(id);
    if (!schedule) return false;
    if (!schedule.introduced) return false;
    return now >= schedule.nextReview;
  }

  function isNew(id) {
    return !hasSchedule(id);
  }

  function getXPForQuality(quality) {
    if (quality >= 5) return XP_EASY;
    if (quality >= 4) return XP_GOOD;
    if (quality >= 3) return XP_HARD;
    return XP_MISS;
  }

  function getLevelInfo(xp) {
    let current = LEVELS[0];

    for (const level of LEVELS) {
      if (xp >= level.xp) current = level;
      else break;
    }

    const next = LEVELS.find((level) => level.xp > xp) || null;

    return {
      level: current.level,
      title: current.title,
      xpThreshold: current.xp,
      nextXP: next ? next.xp : null,
      nextTitle: next ? next.title : null,
    };
  }

  function updateStreak(now) {
    const today = todayString(now);
    const yesterday = yesterdayString(now);
    const streak = state.progress.streak;

    if (streak.lastDate === today) return;

    if (streak.lastDate === yesterday) {
      streak.count += 1;
    } else {
      streak.count = 1;
    }

    streak.lastDate = today;
  }

  function ensureCardMap(cards) {
    const map = {};
    for (const card of cards) {
      map[getCardId(card)] = card;
    }
    return map;
  }

  function sortDueCards(cards, now) {
    return [...cards].sort((a, b) => {
      const aSchedule = getSchedule(getCardId(a));
      const bSchedule = getSchedule(getCardId(b));

      const aNext = aSchedule ? aSchedule.nextReview : now;
      const bNext = bSchedule ? bSchedule.nextReview : now;

      return aNext - bNext;
    });
  }

  // ── Card Queries ──────────────────────────────────────────────────────────

  function getDueCards(now = Date.now()) {
    return state.cards.filter((card) => isDue(getCardId(card), now));
  }

  function getNewCards() {
    return state.cards.filter((card) => isNew(getCardId(card)));
  }

  function getLearnedCount() {
    return Object.values(state.progress.schedules).filter(
      (schedule) => schedule && schedule.repetitions >= 2
    ).length;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init(allCards) {
    if (!Array.isArray(allCards)) {
      throw new Error("SRS.init(allCards): allCards must be an array");
    }

    state = createEmptyState();
    state.cards = [...allCards];
    state.cardMap = ensureCardMap(state.cards);
    state.progress = loadProgress();
    state.session.newCardsSeen = 0;
  }

  function addCards(moreCards) {
    if (!Array.isArray(moreCards)) {
      throw new Error("SRS.addCards(moreCards): moreCards must be an array");
    }

    for (const card of moreCards) {
      const id = getCardId(card);
      if (!state.cardMap[id]) {
        state.cards.push(card);
        state.cardMap[id] = card;
      }
    }
  }

  function getNextCard(now = Date.now()) {
    const dueCards = sortDueCards(getDueCards(now), now);
    if (dueCards.length > 0) {
      return dueCards[0];
    }

    if (state.session.newCardsSeen >= NEW_CARDS_PER_SESSION) {
      return null;
    }

    const newCards = getNewCards();
    if (newCards.length === 0) {
      return null;
    }

    const nextNewCard = newCards[0];
    const id = getCardId(nextNewCard);

    state.progress.schedules[id] = {
      ...createDefaultSchedule(),
      introduced: true,
    };

    state.session.newCardsSeen += 1;
    saveProgress();

    return nextNewCard;
  }

  // quality expected: 0, 2, 4, 5 (or any 0-5 number)
  function recordAnswer(id, quality, now = Date.now()) {
    const cardId = String(id);

    if (!state.cardMap[cardId]) {
      throw new Error(`SRS.recordAnswer: unknown card id "${cardId}"`);
    }

    const currentSchedule = getSchedule(cardId) || {
      ...createDefaultSchedule(),
      introduced: true,
    };

    const updatedSchedule = updateSchedule(currentSchedule, quality, now);
    state.progress.schedules[cardId] = updatedSchedule;

    const earned = getXPForQuality(quality);
    state.progress.xp += earned;

    updateStreak(now);
    saveProgress();

    return {
      xpEarned: earned,
      totalXP: state.progress.xp,
      schedule: cloneSchedule(updatedSchedule),
    };
  }

  function getStats(now = Date.now()) {
    const due = getDueCards(now).length;
    const newCount = getNewCards().length;
    const learned = getLearnedCount();
    const levelInfo = getLevelInfo(state.progress.xp);

    return {
      due,
      new: newCount,
      learned,
      total: state.cards.length,
      streak: state.progress.streak.count,
      xp: state.progress.xp,
      level: levelInfo.level,
      title: levelInfo.title,
      nextXP: levelInfo.nextXP,
      nextTitle: levelInfo.nextTitle,
      xpThreshold: levelInfo.xpThreshold,
    };
  }

  function resetAll() {
    state.progress = {
      schedules: {},
      xp: 0,
      streak: {
        count: 0,
        lastDate: null,
      },
    };

    state.session.newCardsSeen = 0;
    saveProgress();
  }

  function getLevels() {
    return [...LEVELS];
  }

  return {
    init,
    addCards,
    getNextCard,
    recordAnswer,
    getStats,
    resetAll,
    getLevels,
  };
})();
