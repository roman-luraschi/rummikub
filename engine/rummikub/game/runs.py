from __future__ import annotations

from rummikub.game.tile import MAX_RANK, MIN_RANK, NUM_RANKS


def step_rank(rank: int, steps: int = 1) -> int:
    return ((rank - MIN_RANK + steps) % NUM_RANKS) + MIN_RANK


def next_rank(rank: int) -> int:
    return step_rank(rank, 1)


def prev_rank(rank: int) -> int:
    return step_rank(rank, -1)


def run_ranks_from_start(start: int, length: int) -> list[int]:
    return [step_rank(start, i) for i in range(length)]


def ranks_form_run(ranks: list[int]) -> bool:
    """True if ranks are a contiguous arc on the 1..13 circle, no duplicate ranks."""
    if len(ranks) < 3:
        return False
    if len(ranks) != len(set(ranks)):
        return False
    if any(not MIN_RANK <= rank <= MAX_RANK for rank in ranks):
        return False
    unique = sorted(ranks)
    n = len(unique)
    if n == NUM_RANKS:
        return True
    gaps = [unique[i + 1] - unique[i] for i in range(n - 1)]
    wrap_gap = unique[0] + NUM_RANKS - unique[-1]
    return sum(1 for gap in (*gaps, wrap_gap) if gap == 1) == n - 1


def run_display_order(ranks: list[int]) -> list[int]:
    """Order ranks along the circle, starting after the unused gap (12,13,1 not 1,12,13)."""
    unique = sorted(set(ranks))
    n = len(unique)
    if n == NUM_RANKS:
        return list(range(MIN_RANK, MAX_RANK + 1))
    best_start = unique[0]
    best_gap = unique[0] + NUM_RANKS - unique[-1]
    for i in range(n - 1):
        gap = unique[i + 1] - unique[i]
        if gap > best_gap:
            best_gap = gap
            best_start = unique[i + 1]
    return run_ranks_from_start(best_start, n)


def covering_run_ranks(numbered: list[int], extra: int = 0) -> list[int]:
    """Shortest circular arc covering `numbered`, with `extra` joker slots."""
    unique = sorted(set(numbered))
    if not unique:
        raise ValueError("Run needs at least one numbered tile")
    need = len(unique) + extra
    if need > NUM_RANKS:
        raise ValueError("Run longer than the circle")
    candidates: list[tuple[int, int, list[int]]] = []
    for start in range(MIN_RANK, MAX_RANK + 1):
        ranks = run_ranks_from_start(start, need)
        if set(unique) <= set(ranks):
            wraps = int(max(ranks) - min(ranks) + 1 != need)
            candidates.append((wraps, start, ranks))
    if not candidates:
        raise ValueError("Cannot infer run ranks")
    candidates.sort()
    return candidates[0][2]
