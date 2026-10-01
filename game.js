// Pure game logic: no DOM, so it can be tested with `node --test web/*.test.js`.

export const MAX_TRIES = 5;

export function newGame(puzzle) {
  return { puzzleId: puzzle.id, answer: puzzle.answer, guesses: [], solved: false };
}

// Returns a new state. Guessing a struck-out option or guessing after solving
// changes nothing (D-020: wrong picks are struck out, keep going until right).
export function guess(state, optionKey) {
  if (state.solved || state.guesses.includes(optionKey)) return state;
  const guesses = [...state.guesses, optionKey];
  return { ...state, guesses, solved: optionKey === state.answer };
}

export function isStruckOut(state, optionKey) {
  return state.guesses.includes(optionKey) && optionKey !== state.answer;
}

export function tries(state) {
  return state.guesses.length;
}

// One square per try: red for a wrong pick, green for the solve (D-021).
export function resultRow(state) {
  return state.guesses.map((key) => (key === state.answer ? "🟩" : "🟥")).join("");
}

// A spoiler-free result that explains itself to someone who has never played:
//   Whydle #12: got it in 3 tries
//   🟥🟥🟩  🔥 4-day streak
//   Five things, ranked in a hidden order. Can you work out why?
//   https://whydle.app/
export function shareText(puzzleNumber, state, url, streak = 0) {
  const count = tries(state);
  const headline = count === 1 ? "got it first try!" : `got it in ${count} tries`;
  const squares = resultRow(state) + (streak >= 2 ? `  🔥 ${streak}-day streak` : "");
  return [
    `Whydle #${puzzleNumber}: ${headline}`,
    squares,
    "Five things, ranked in a hidden order. Can you work out why?",
    url,
  ]
    .filter(Boolean)
    .join("\n");
}

// For the reveal: does this option's ranking match the displayed order?
export function matchesOrder(option) {
  return option.ranks.every((rank, index) => rank === index + 1);
}
