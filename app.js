import { guess, isStruckOut, matchesOrder, newGame, resultRow, shareText, tries } from "./game.js";
import { computeStats, dateOfPuzzle, localIsoDate, msUntilTomorrow, puzzleNumber } from "./daily.js";

const STORAGE_KEY = "whydle-progress-v1";
const app = document.getElementById("app");
const helpDialog = document.getElementById("help");
const statsDialog = document.getElementById("stats");
const announcer = document.getElementById("announcer");

// Screen readers hear only this short message, not the whole re-rendered puzzle.
function announce(text) {
  announcer.textContent = "";
  requestAnimationFrame(() => (announcer.textContent = text));
}

let data = null; // { launch_date, puzzles }
let today = 0; // today's puzzle number (0 or less before launch)
let current = null; // the puzzle on screen
let game = null;
let selected = null; // option chosen but not yet locked in
let viewing = null; // after solving: whose values are shown
let message = "";
let countdownTimer = null;

// ---------- storage (per-browser conveniences; the page works without it) ----------

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && saved.version === 1) return saved;
  } catch {}
  return { version: 1, seenHelp: false, games: {}, daily: {} };
}

let progress = loadProgress();

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {}
}

// ---------- startup ----------

async function start() {
  try {
    const response = await fetch("puzzles.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    app.innerHTML = `<p class="loading">Couldn't load the puzzle (${escapeHtml(error.message)}).</p>`;
    return;
  }
  if (!data.puzzles.length) {
    app.innerHTML = `<p class="loading">The first puzzle arrives on ${escapeHtml(data.launch_date)}.</p>`;
    return;
  }
  const params = new URLSearchParams(location.search);
  // ?date=YYYY-MM-DD pretends it's another day, but only on a local development
  // copy. The live site always uses the player's own date, and its puzzles.json
  // only contains puzzles that have already started somewhere in the world.
  const devCopy = ["localhost", "127.0.0.1"].includes(location.hostname);
  const override = devCopy && /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date") : null;
  const date = override || localIsoDate();
  today = puzzleNumber(date, data.launch_date);
  const requested = Number(params.get("p"));
  open(Number.isInteger(requested) && requested >= 1 && requested <= lastPlayable() ? requested : defaultNumber());

  document.getElementById("open-help").addEventListener("click", () => helpDialog.showModal());
  document.getElementById("open-stats").addEventListener("click", showStats);
  for (const dialog of [helpDialog, statsDialog]) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close]")) dialog.close();
    });
  }
  helpDialog.addEventListener("close", () => {
    progress.seenHelp = true;
    saveProgress();
  });
  if (!progress.seenHelp) helpDialog.showModal();
}

// Before launch, puzzle 1 is playable as a preview; after that, never beyond today.
function lastPlayable() {
  return Math.min(Math.max(today, 1), data.puzzles.length);
}

function defaultNumber() {
  return today > data.puzzles.length ? data.puzzles.length : Math.max(today, 1);
}

function puzzleByNumber(number) {
  return data.puzzles.find((puzzle) => puzzle.number === number);
}

function isDaily(number) {
  return number === today;
}

function open(number) {
  current = puzzleByNumber(number);
  game = newGame(current);
  for (const key of progress.games[number]?.guesses ?? []) game = guess(game, key);
  selected = null;
  viewing = game.solved ? current.answer : null;
  message = "";
  const url = new URL(location.href);
  if (number === defaultNumber()) url.searchParams.delete("p");
  else url.searchParams.set("p", String(number));
  history.replaceState(null, "", url);
  render();
}

// ---------- actions ----------

function lockIn() {
  if (!selected) return;
  const option = current.options.find((candidate) => candidate.key === selected);
  game = guess(game, selected);
  progress.games[current.number] = { guesses: game.guesses };
  if (game.solved) {
    viewing = current.answer;
    message = "";
    // Only a puzzle finished on its own day counts toward stats and streaks.
    if (isDaily(current.number)) progress.daily[current.number] = tries(game);
  } else {
    message = `Not ${option.label.toLowerCase()}. Try again.`;
  }
  saveProgress();
  selected = null;
  render();
  if (game.solved) {
    const count = tries(game);
    announce(`${count === 1 ? "First try!" : `Solved in ${count} tries.`} They're sorted by ${option.label.toLowerCase()}.`);
    app.querySelector(".result")?.focus();
  } else {
    announce(message);
    // Keep keyboard users in the options instead of dropping focus to the page.
    app.querySelector(".option:not(.is-struck)")?.focus();
  }
}

async function shareResult(button) {
  const streak = isDaily(current.number) ? computeStats(progress.daily, today).currentStreak : 0;
  const text = shareText(current.number, game, location.origin + location.pathname, streak);
  // Phones get the native share sheet; elsewhere the text is copied.
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      if (error.name === "AbortError") return; // the player closed the sheet
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied!";
  } catch {
    button.textContent = "Couldn't copy";
  }
  setTimeout(() => (button.textContent = "Share result"), 2000);
}

function showStats() {
  const stats = computeStats(progress.daily, today);
  const most = Math.max(1, ...stats.distribution);
  const todayTries = progress.daily[today];
  statsDialog.querySelector(".stats-body").innerHTML = `
    <div class="stat-grid">
      ${statTile(stats.played, "Played")}
      ${statTile(`${stats.firstTryPercent}%`, "First try")}
      ${statTile(stats.currentStreak, "Streak")}
      ${statTile(stats.maxStreak, "Best streak")}
    </div>
    <h3>Tries to solve</h3>
    <ol class="distribution">
      ${stats.distribution
        .map((count, index) => `
          <li class="${todayTries === index + 1 ? "is-today" : ""}">
            <span class="bar-label">${index + 1}</span>
            <span class="bar" style="--share: ${count / most}"><span>${count}</span></span>
          </li>`)
        .join("")}
    </ol>
    ${stats.played ? `<p class="stats-note">Average ${stats.averageTries} tries. Archive games don't count.</p>` : `<p class="stats-note">Solve today's puzzle to start your stats.</p>`}
  `;
  statsDialog.showModal();
}

function statTile(value, label) {
  return `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`;
}

// ---------- rendering ----------

function render() {
  clearInterval(countdownTimer);
  const view = game.solved ? current.options.find((option) => option.key === viewing) : null;
  const number = current.number;

  app.innerHTML = `
    <section class="puzzle">
      <nav class="meta" aria-label="Puzzles">
        <button class="nav-step" data-go="${number - 1}" aria-label="Previous puzzle" ${number <= 1 ? "disabled" : ""}>‹</button>
        <span class="meta-text">${metaText(number)}</span>
        <button class="nav-step" data-go="${number + 1}" aria-label="Next puzzle" ${number >= lastPlayable() ? "disabled" : ""}>›</button>
      </nav>
      ${number !== defaultNumber() ? `<p class="back-today"><button class="link" data-go="${defaultNumber()}">Back to today's puzzle</button></p>` : ""}

      <h2 class="prompt">Why are these in this order?</h2>
      <p class="category-chip">${escapeHtml(current.category)}</p>

      <div class="ladder">
        <span class="end">Highest</span>
        <ol class="rows" reversed aria-label="Ranked from highest to lowest">
          ${current.items.map((item, row) => rowHtml(item, row, view)).reverse().join("")}
        </ol>
        <span class="end">Lowest</span>
      </div>
      ${view ? captionHtml(view) : ""}

      ${game.solved ? resultHtml() : guessingHtml()}
    </section>
  `;

  app.querySelectorAll("[data-go]").forEach((button) =>
    button.addEventListener("click", () => open(Number(button.dataset.go))),
  );
  app.querySelectorAll(".option").forEach((button) =>
    button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (game.solved) viewing = key;
      else if (!isStruckOut(game, key)) selected = selected === key ? null : key;
      render();
      app.querySelector(`.option[data-key="${key}"]`)?.focus();
    }),
  );
  app.querySelector(".lock")?.addEventListener("click", lockIn);
  const share = app.querySelector(".share");
  share?.addEventListener("click", () => shareResult(share));
  app.querySelector(".see-stats")?.addEventListener("click", showStats);
  startCountdown();
}

function metaText(number) {
  const when = formatDate(dateOfPuzzle(number, data.launch_date));
  if (today < 1) return `Preview <span class="dot">·</span> launches ${formatDate(data.launch_date)}`;
  if (isDaily(number)) return `#${number} <span class="dot">·</span> Today`;
  return `#${number} <span class="dot">·</span> ${when}`;
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function rowHtml(item, row, view) {
  const name = view
    ? `<a href="${item.url}" target="_blank" rel="noopener">${escapeHtml(item.label)}</a>`
    : escapeHtml(item.label);
  let value = "";
  if (view) {
    const rank = view.ranks[row];
    const offRank = rank !== row + 1 ? `<span class="off-rank" title="This option would put it at number ${rank}">#${rank}</span>` : "";
    value = `<span class="value">${escapeHtml(view.values[row])}${offRank}</span>`;
  }
  return `
    <li class="row rank-${row + 1}" style="--step: ${row}">
      <span class="rank" aria-hidden="true">${row + 1}</span>
      <span class="name">${name}</span>
      ${value}
    </li>`;
}

function captionHtml(view) {
  const note = matchesOrder(view)
    ? "the answer, from lowest at the bottom to highest at the top."
    : "red numbers show where this option would rank each item instead.";
  const source = view.source
    ? ` Source: <a href="${escapeHtml(view.source.url)}" target="_blank" rel="noopener">${escapeHtml(view.source.note)}</a>.`
    : "";
  return `<p class="view-caption">Showing <strong>${escapeHtml(view.label.toLowerCase())}</strong>: ${note}${source}</p>`;
}

function squaresHtml() {
  if (!game.guesses.length) return "";
  return `<p class="tries" aria-label="${tries(game)} ${tries(game) === 1 ? "try" : "tries"} so far">${resultRow(game)}</p>`;
}

function guessingHtml() {
  const buttons = current.options
    .map((option) => {
      const struck = isStruckOut(game, option.key);
      const isSelected = selected === option.key;
      return `<button class="option ${struck ? "is-struck" : ""} ${isSelected ? "is-selected" : ""}"
        data-key="${option.key}" aria-pressed="${isSelected}" ${struck ? 'aria-disabled="true"' : ""}>
        ${escapeHtml(option.label)}</button>`;
    })
    .join("");
  return `
    <div class="options" role="group" aria-label="Possible answers">
      <p class="options-label">Pick the hidden order</p>
      ${buttons}
    </div>
    <div class="actions">
      <button class="lock" ${selected ? "" : "disabled"}>Lock in</button>
    </div>
    ${squaresHtml()}
    <p class="feedback" role="status">${escapeHtml(message)}</p>
  `;
}

function resultHtml() {
  const answer = current.options.find((option) => option.key === current.answer);
  const count = tries(game);
  const verdict = count === 1 ? "First try!" : `Solved in ${count} tries`;
  const daily = isDaily(current.number);
  const buttons = current.options
    .map((option) => {
      const mark = matchesOrder(option) ? "✓" : "✗";
      return `<button class="option ${option.key === viewing ? "is-selected" : ""} ${option.key === current.answer ? "is-answer" : ""}"
        data-key="${option.key}" aria-pressed="${option.key === viewing}">
        <span class="mark" aria-hidden="true">${mark}</span> ${escapeHtml(option.label)}</button>`;
    })
    .join("");
  return `
    <div class="result" tabindex="-1">
      <p class="verdict">${verdict}</p>
      <p class="answer">They're sorted by <strong>${escapeHtml(answer.label.toLowerCase())}</strong>.</p>
      <p class="tries">${resultRow(game)}</p>
      <div class="result-actions">
        <button class="share">Share result</button>
        <button class="see-stats secondary">Stats</button>
      </div>
      ${daily ? `<p class="countdown">Next puzzle in <span class="clock"></span></p>` : ""}
    </div>
    <div class="options" role="group" aria-label="Compare options">
      <p class="options-label">Compare the options</p>
      ${buttons}
    </div>
  `;
}

function startCountdown() {
  const clock = app.querySelector(".clock");
  if (!clock) return;
  const tick = () => {
    const total = Math.max(0, Math.floor(msUntilTomorrow() / 1000));
    const pad = (value) => String(value).padStart(2, "0");
    clock.textContent = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

start();
