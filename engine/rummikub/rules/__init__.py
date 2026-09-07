"""Import submodules directly when possible.

`validate_entire_table` stays available as a lazy export so `meld` can import
`rules.runs` without pulling the validator (circular import).
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "TableValidationError",
    "make_group",
    "make_run",
    "try_make_meld",
    "validate_entire_table",
    "validate_meld",
]


def __getattr__(name: str) -> Any:
    if name in __all__:
        from rummikub.rules import table_validator as _validator

        return getattr(_validator, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
