'use strict';

const DIFFICULTY_CONFIG = {
  easy: { pairs: 4, seconds: 60 },
  medium: { pairs: 6, seconds: 45 },
  hard: { pairs: 10, seconds: 60 },
};

const LIST_ENDPOINT = 'https://pokeapi.co/api/v2/pokemon?limit=1500';
const MAX_OFFICIAL_ARTWORK_ID = 1025;
const FLIP_BACK_DELAY_MS = 950;
const PEEK_DURATION_MS = 2500;
const PEEK_COOLDOWN_MS = 30000;
const PEEK_CHARGES_PER_GAME = 2;
const THEME_KEY = 'pokemon-memory-theme';
const CARD_BACK_IMAGE_SRC = '/images/back.webp';

function getBalancedGridDimensions(cardCount) {
  let bestCols = 1;
  let bestScore = Infinity;
  for (let c = 1; c <= cardCount; c += 1) {
    if (cardCount % c !== 0) {
      continue;
    }
    const r = cardCount / c;
    const score = Math.abs(r - c);
    if (score < bestScore || (score === bestScore && c > bestCols)) {
      bestScore = score;
      bestCols = c;
    }
  }
  return { cols: bestCols, rows: cardCount / bestCols };
}

function shuffle(array) {
  const arr = array.slice();
  let i = arr.length;
  while (i > 0) {
    const j = Math.floor(Math.random() * i);
    i -= 1;
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function fetchEligibleIds() {
  const response = await fetch(LIST_ENDPOINT);
  if (!response.ok) {
    throw new Error('Could not load Pokémon list.');
  }
  const data = await response.json();
  const ids = [];
  for (let i = 0; i < data.results.length; i += 1) {
    const url = data.results[i].url;
    const match = url.match(/\/(\d+)\/?$/);
    if (!match) {
      continue;
    }
    const id = parseInt(match[1], 10);
    if (id <= MAX_OFFICIAL_ARTWORK_ID) {
      ids.push(id);
    }
  }
  return ids;
}

async function fetchPokemonDetail(id) {
  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
  if (!response.ok) {
    return null;
  }
  const detail = await response.json();
  const artwork = detail.sprites && detail.sprites.other
    ? detail.sprites.other['official-artwork']
    : null;
  const imageUrl = artwork ? artwork.front_default : null;
  return {
    id: detail.id,
    name: detail.name,
    imageUrl,
  };
}

async function buildSpeciesList(pairCount) {
  const pool = shuffle(await fetchEligibleIds());
  const species = [];
  let index = 0;
  const maxAttempts = Math.min(pool.length, pairCount + 200);
  while (species.length < pairCount && index < maxAttempts) {
    const candidateId = pool[index];
    index += 1;
    const detail = await fetchPokemonDetail(candidateId);
    if (detail && detail.imageUrl) {
      species.push(detail);
    }
  }
  if (species.length < pairCount) {
    throw new Error('Could not load enough Pokémon images. Try again.');
  }
  return species;
}

function buildDeckFromSpecies(speciesList) {
  const deck = [];
  for (let i = 0; i < speciesList.length; i += 1) {
    const entry = speciesList[i];
    deck.push({ id: entry.id, name: entry.name, imageUrl: entry.imageUrl });
    deck.push({ id: entry.id, name: entry.name, imageUrl: entry.imageUrl });
  }
  return shuffle(deck);
}

function gameBootstrap() {
  const els = {
    grid: document.getElementById('game_grid'),
    btnStart: document.getElementById('btn-start'),
    btnReset: document.getElementById('btn-reset'),
    btnPeek: document.getElementById('btn-peek'),
    btnTheme: document.getElementById('btn-theme'),
    statClicks: document.getElementById('stat-clicks'),
    statMatched: document.getElementById('stat-matched'),
    statLeft: document.getElementById('stat-left'),
    statTotal: document.getElementById('stat-total'),
    statTime: document.getElementById('stat-time'),
    statPeek: document.getElementById('stat-peek'),
    banner: document.getElementById('message_banner'),
    errorLine: document.getElementById('error_line'),
    difficultyInputs: document.querySelectorAll('input[name="difficulty"]'),
  };

  const state = {
    phase: 'idle',
    speciesList: [],
    deck: [],
    totalPairs: 0,
    matchedPairs: 0,
    clicks: 0,
    timeLimitSeconds: 0,
    timeRemainingSeconds: 0,
    timerId: null,
    firstCardEl: null,
    lockBoard: false,
    peekCharges: PEEK_CHARGES_PER_GAME,
    peekCooldownUntil: 0,
    peekTimeoutId: null,
    loading: false,
  };

  function getDifficultyKey() {
    let key = 'easy';
    for (let i = 0; i < els.difficultyInputs.length; i += 1) {
      const input = els.difficultyInputs[i];
      if (input.checked) {
        key = input.value;
        break;
      }
    }
    return key;
  }

  function applyThemeFromStorage() {
    const stored = localStorage.getItem(THEME_KEY);
    const theme = stored === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    els.btnTheme.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'light'
      : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    els.btnTheme.textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
  }

  function clearTimer() {
    if (state.timerId !== null) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function hideBanner() {
    els.banner.textContent = '';
    els.banner.classList.add('message-banner--hidden');
    els.banner.classList.remove('message-banner--win');
    els.banner.classList.remove('message-banner--lose');
  }

  function showBannerWin() {
    els.banner.textContent = 'You Won - Congratulations';
    els.banner.classList.remove('message-banner--hidden');
    els.banner.classList.add('message-banner--win');
    els.banner.classList.remove('message-banner--lose');
  }

  function showBannerLose() {
    els.banner.textContent = 'Time is up — game over.';
    els.banner.classList.remove('message-banner--hidden');
    els.banner.classList.add('message-banner--lose');
    els.banner.classList.remove('message-banner--win');
  }

  function updateStats() {
    els.statClicks.textContent = String(state.clicks);
    els.statMatched.textContent = String(state.matchedPairs);
    els.statLeft.textContent = String(state.totalPairs - state.matchedPairs);
    els.statTotal.textContent = String(state.totalPairs);
    els.statPeek.textContent = String(state.peekCharges);
    if (state.phase === 'playing') {
      els.statTime.textContent = formatTime(state.timeRemainingSeconds);
    } else if (state.phase === 'idle') {
      els.statTime.textContent = '—';
    } else {
      els.statTime.textContent = formatTime(state.timeRemainingSeconds);
    }
  }

  function setBoardLocked(locked) {
    if (locked) {
      els.grid.classList.add('board-locked');
    } else {
      els.grid.classList.remove('board-locked');
    }
  }

  function endWin() {
    if (state.phase !== 'playing') {
      return;
    }
    state.phase = 'won';
    clearTimer();
    setBoardLocked(true);
    els.btnPeek.disabled = true;
    showBannerWin();
    updateStats();
  }

  function endLose() {
    if (state.phase !== 'playing') {
      return;
    }
    state.phase = 'lost';
    clearTimer();
    setBoardLocked(true);
    els.btnPeek.disabled = true;
    showBannerLose();
    updateStats();
  }

  function tickTimer() {
    if (state.phase !== 'playing') {
      return;
    }
    state.timeRemainingSeconds -= 1;
    updateStats();
    updatePeekButton();
    if (state.timeRemainingSeconds <= 0) {
      state.timeRemainingSeconds = 0;
      endLose();
    }
  }

  function startTimer() {
    clearTimer();
    state.timerId = window.setInterval(tickTimer, 1000);
  }

  function renderGrid() {
    els.grid.innerHTML = '';
    els.grid.classList.remove('game-grid--empty');
    if (state.deck.length === 0) {
      els.grid.style.gridTemplateColumns = '';
      els.grid.classList.add('game-grid--empty');
      return;
    }
    const dimensions = getBalancedGridDimensions(state.deck.length);
    els.grid.style.gridTemplateColumns = `repeat(${dimensions.cols}, minmax(0, 1fr))`;
    for (let i = 0; i < state.deck.length; i += 1) {
      const cardData = state.deck[i];
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.pokemonId = String(cardData.id);
      card.dataset.cardIndex = String(i);

      const inner = document.createElement('div');
      inner.className = 'card-inner';

      const front = document.createElement('img');
      front.className = 'front_face';
      front.src = cardData.imageUrl;
      front.alt = cardData.name;

      const back = document.createElement('img');
      back.className = 'back_face';
      back.src = CARD_BACK_IMAGE_SRC;
      back.alt = '';
      back.decoding = 'async';

      inner.appendChild(front);
      inner.appendChild(back);
      card.appendChild(inner);
      card.addEventListener('click', () => onCardClick(card));
      els.grid.appendChild(card);
    }
  }

  function resetRoundState() {
    state.firstCardEl = null;
    state.lockBoard = false;
    hideBanner();
    const cards = els.grid.querySelectorAll('.card');
    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      c.classList.remove('flip', 'matched', 'peek-show');
    }
  }

  function beginPlayingSession() {
    state.phase = 'playing';
    state.matchedPairs = 0;
    state.clicks = 0;
    state.firstCardEl = null;
    state.lockBoard = false;
    state.peekCharges = PEEK_CHARGES_PER_GAME;
    state.peekCooldownUntil = 0;
    state.timeRemainingSeconds = state.timeLimitSeconds;
    hideBanner();
    setBoardLocked(false);
    els.btnReset.disabled = false;
    els.btnPeek.disabled = false;
    updatePeekButton();
    updateStats();
    startTimer();
  }

  function reshuffleSameSpecies() {
    state.deck = buildDeckFromSpecies(state.speciesList);
    resetRoundState();
    renderGrid();
    beginPlayingSession();
  }

  async function startNewGame() {
    if (state.loading) {
      return;
    }
    if (state.peekTimeoutId !== null) {
      window.clearTimeout(state.peekTimeoutId);
      state.peekTimeoutId = null;
    }
    els.grid.classList.remove('peek-active');
    clearPeekShowFlags();
    els.errorLine.textContent = '';
    hideBanner();
    const diffKey = getDifficultyKey();
    const config = DIFFICULTY_CONFIG[diffKey];
    state.loading = true;
    els.btnStart.disabled = true;
    els.btnStart.textContent = 'Loading…';
    try {
      state.speciesList = await buildSpeciesList(config.pairs);
      state.totalPairs = config.pairs;
      state.timeLimitSeconds = config.seconds;
      state.deck = buildDeckFromSpecies(state.speciesList);
      resetRoundState();
      renderGrid();
      beginPlayingSession();
    } catch (err) {
      els.errorLine.textContent = err.message || 'Something went wrong.';
      state.phase = 'idle';
      state.deck = [];
      state.speciesList = [];
      els.grid.innerHTML = '';
      els.grid.style.gridTemplateColumns = '';
      els.grid.classList.add('game-grid--empty');
      els.btnReset.disabled = true;
      els.btnPeek.disabled = true;
      els.statTotal.textContent = '0';
      els.statLeft.textContent = '0';
      els.statMatched.textContent = '0';
      els.statClicks.textContent = '0';
      els.statTime.textContent = '—';
      els.statPeek.textContent = String(PEEK_CHARGES_PER_GAME);
    } finally {
      state.loading = false;
      els.btnStart.disabled = false;
      els.btnStart.textContent = 'Start';
    }
  }

  function onReset() {
    els.errorLine.textContent = '';
    if (state.speciesList.length === 0) {
      startNewGame();
      return;
    }
    clearTimer();
    if (state.peekTimeoutId !== null) {
      window.clearTimeout(state.peekTimeoutId);
      state.peekTimeoutId = null;
    }
    els.grid.classList.remove('peek-active');
    reshuffleSameSpecies();
  }

  function updatePeekButton() {
    const now = Date.now();
    const cooling = now < state.peekCooldownUntil;
    const disabled = state.phase !== 'playing'
      || state.peekCharges <= 0
      || cooling
      || state.lockBoard;
    els.btnPeek.disabled = disabled;
  }

  function clearPeekShowFlags() {
    const cards = els.grid.querySelectorAll('.card.peek-show');
    for (let i = 0; i < cards.length; i += 1) {
      cards[i].classList.remove('peek-show');
    }
    els.grid.classList.remove('peek-active');
    state.lockBoard = false;
    updatePeekButton();
  }

  function runPeek() {
    if (state.phase !== 'playing' || state.peekCharges <= 0) {
      return;
    }
    const now = Date.now();
    if (now < state.peekCooldownUntil) {
      return;
    }
    state.peekCharges -= 1;
    state.peekCooldownUntil = Date.now() + PEEK_COOLDOWN_MS;
    updateStats();

    state.lockBoard = true;
    els.grid.classList.add('peek-active');

    const cards = els.grid.querySelectorAll('.card:not(.matched)');
    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      if (!c.classList.contains('flip')) {
        c.classList.add('peek-show');
      }
    }

    if (state.peekTimeoutId !== null) {
      window.clearTimeout(state.peekTimeoutId);
    }
    state.peekTimeoutId = window.setTimeout(() => {
      clearPeekShowFlags();
      state.peekTimeoutId = null;
    }, PEEK_DURATION_MS);

    updatePeekButton();
  }

  function onCardClick(cardEl) {
    if (state.phase !== 'playing' || state.lockBoard) {
      return;
    }
    if (cardEl.classList.contains('matched')) {
      return;
    }
    if (cardEl.classList.contains('flip')) {
      return;
    }
    const flipped = els.grid.querySelectorAll('.card.flip:not(.matched)');
    if (flipped.length >= 2) {
      return;
    }

    cardEl.classList.add('flip');
    state.clicks += 1;
    updateStats();

    if (!state.firstCardEl) {
      state.firstCardEl = cardEl;
      return;
    }

    const second = cardEl;
    const firstId = state.firstCardEl.dataset.pokemonId;
    const secondId = second.dataset.pokemonId;

    if (state.firstCardEl === second) {
      return;
    }

    state.lockBoard = true;
    updatePeekButton();

    if (firstId === secondId) {
      state.matchedPairs += 1;
      updateStats();
      state.firstCardEl.classList.add('matched');
      second.classList.add('matched');
      state.firstCardEl = null;
      state.lockBoard = false;
      updatePeekButton();
      if (state.matchedPairs >= state.totalPairs) {
        endWin();
      }
    } else {
      window.setTimeout(() => {
        if (state.phase !== 'playing') {
          state.firstCardEl = null;
          state.lockBoard = false;
          updatePeekButton();
          return;
        }
        state.firstCardEl.classList.remove('flip');
        second.classList.remove('flip');
        state.firstCardEl = null;
        state.lockBoard = false;
        updatePeekButton();
      }, FLIP_BACK_DELAY_MS);

    }
  }

  els.btnStart.addEventListener('click', () => {
    startNewGame();
  });

  els.btnReset.addEventListener('click', () => {
    onReset();
  });

  els.btnPeek.addEventListener('click', () => {
    runPeek();
  });

  els.btnTheme.addEventListener('click', () => {
    toggleTheme();
  });

  for (let i = 0; i < els.difficultyInputs.length; i += 1) {
    els.difficultyInputs[i].addEventListener('change', () => {
      updatePeekButton();
    });
  }

  applyThemeFromStorage();
  updateStats();
}

document.addEventListener('DOMContentLoaded', gameBootstrap);
