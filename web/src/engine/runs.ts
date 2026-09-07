import { MAX_RANK, MIN_RANK, NUM_RANKS } from "./tile";

export function stepRank(rank: number, steps = 1): number {
  const idx = ((rank - MIN_RANK + steps) % NUM_RANKS + NUM_RANKS) % NUM_RANKS;
  return idx + MIN_RANK;
}

export function nextRank(rank: number): number {
  return stepRank(rank, 1);
}

export function prevRank(rank: number): number {
  return stepRank(rank, -1);
}

export function runRanksFromStart(start: number, length: number): number[] {
  return Array.from({ length }, (_, i) => stepRank(start, i));
}

export function ranksFormRun(ranks: number[]): boolean {
  if (ranks.length < 3) return false;
  if (new Set(ranks).size !== ranks.length) return false;
  if (ranks.some((rank) => rank < MIN_RANK || rank > MAX_RANK)) return false;
  const unique = [...ranks].sort((a, b) => a - b);
  const n = unique.length;
  if (n === NUM_RANKS) return true;
  const gaps = unique.slice(0, -1).map((v, i) => unique[i + 1] - v);
  const wrapGap = unique[0] + NUM_RANKS - unique[n - 1];
  return [...gaps, wrapGap].filter((gap) => gap === 1).length === n - 1;
}

export function runDisplayOrder(ranks: number[]): number[] {
  const unique = [...new Set(ranks)].sort((a, b) => a - b);
  const n = unique.length;
  if (n === NUM_RANKS) {
    return Array.from({ length: NUM_RANKS }, (_, i) => MIN_RANK + i);
  }
  let bestStart = unique[0];
  let bestGap = unique[0] + NUM_RANKS - unique[n - 1];
  for (let i = 0; i < n - 1; i++) {
    const gap = unique[i + 1] - unique[i];
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = unique[i + 1];
    }
  }
  return runRanksFromStart(bestStart, n);
}
