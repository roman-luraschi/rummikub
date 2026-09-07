from __future__ import annotations

from dataclasses import dataclass, field

from rummikub.solver.types import TableConfiguration


@dataclass
class CandidateReport:
    action: str
    score: float
    terms: dict[str, float]
    table: str
    rack_used: str
    tiles_played: int


@dataclass
class BotDecision:
    action: str
    score: float
    reasons: dict[str, float]
    move: TableConfiguration | None
    initial_hand: str
    initial_table: str
    final_table: str
    discarded: str
    search_depth: int
    states_evaluated: int
    cache_hits: int
    simulation_count: int
    time_ms: float
    top_candidates: list[CandidateReport] = field(default_factory=list)
    difficulty: str = ""

    def format(self) -> str:
        lines = [
            "BOT DECISION",
            f"Difficulty: {self.difficulty}",
            f"Move: {self.action}",
            f"Score: {self.score:.2f}",
            "",
            f"Initial hand: {self.initial_hand}",
            f"Initial table: {self.initial_table}",
            f"Final table: {self.final_table}",
            f"Played: {self.discarded}",
            "",
            "Evaluation:",
        ]
        for name, value in self.reasons.items():
            lines.append(f"  {value:+.1f} {name}")
        lines += [
            "",
            f"Search depth: {self.search_depth}",
            f"States evaluated: {self.states_evaluated}",
            f"Cache hits: {self.cache_hits}",
            f"Simulations: {self.simulation_count}",
            f"Time: {self.time_ms:.1f}ms",
            "",
            "Top candidate moves:",
        ]
        for i, cand in enumerate(self.top_candidates, start=1):
            lines.append(
                f"  #{i} {cand.action}  score={cand.score:.2f}  played={cand.tiles_played}  {cand.rack_used}"
            )
        return "\n".join(lines)
