from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from rummikub.solver.types import SolverMode


class Difficulty(str, Enum):
    EASY = "easy"
    NORMAL = "normal"
    HARD = "hard"
    VERY_HARD = "very_hard"
    NIGHTMARE = "nightmare"


@dataclass(frozen=True, slots=True)
class DifficultyConfig:
    search_depth: int
    time_limit_ms: float
    simulation_count: int
    randomness: float
    opponent_model_accuracy: float
    use_monte_carlo: bool
    use_opponent_model: bool
    use_caching: bool
    solver_mode: SolverMode
    beam_k: int
    lookahead_top: int


CONFIGS: dict[Difficulty, DifficultyConfig] = {
    Difficulty.EASY: DifficultyConfig(
        search_depth=0,
        time_limit_ms=50,
        simulation_count=0,
        randomness=0.55,
        opponent_model_accuracy=0.0,
        use_monte_carlo=False,
        use_opponent_model=False,
        use_caching=True,
        solver_mode=SolverMode.ADD_ONLY,
        beam_k=8,
        lookahead_top=0,
    ),
    Difficulty.NORMAL: DifficultyConfig(
        search_depth=1,
        time_limit_ms=100,
        simulation_count=0,
        randomness=0.28,
        opponent_model_accuracy=0.25,
        use_monte_carlo=False,
        use_opponent_model=False,
        use_caching=True,
        solver_mode=SolverMode.LOCAL,
        beam_k=12,
        lookahead_top=0,
    ),
    Difficulty.HARD: DifficultyConfig(
        search_depth=1,
        time_limit_ms=200,
        simulation_count=8,
        randomness=0.12,
        opponent_model_accuracy=0.55,
        use_monte_carlo=False,
        use_opponent_model=True,
        use_caching=True,
        solver_mode=SolverMode.FULL,
        beam_k=20,
        lookahead_top=0,
    ),
    Difficulty.VERY_HARD: DifficultyConfig(
        search_depth=2,
        time_limit_ms=500,
        simulation_count=24,
        randomness=0.06,
        opponent_model_accuracy=0.8,
        use_monte_carlo=True,
        use_opponent_model=True,
        use_caching=True,
        solver_mode=SolverMode.FULL,
        beam_k=36,
        lookahead_top=4,
    ),
    Difficulty.NIGHTMARE: DifficultyConfig(
        search_depth=3,
        time_limit_ms=1000,
        simulation_count=48,
        randomness=0.02,
        opponent_model_accuracy=1.0,
        use_monte_carlo=True,
        use_opponent_model=True,
        use_caching=True,
        solver_mode=SolverMode.FULL,
        beam_k=64,
        lookahead_top=6,
    ),
}


def parse_difficulty(value: str | Difficulty) -> Difficulty:
    if isinstance(value, Difficulty):
        return value
    key = value.strip().lower().replace("-", "_")
    return Difficulty(key)
