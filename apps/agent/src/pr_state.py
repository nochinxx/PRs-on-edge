"""PRStateMiddleware — declares the PR triage canvas fields on the agent's
TypedDict state schema so they survive STATE_SNAPSHOT round-trips.

Mirrors the pattern from lead_state.py but for GitHub PR data instead of
Notion leads. The canvas fields are:
- prs: list of open PRs (slim shape from get_open_prs)
- repo: {owner, name} currently loaded
- selectedPR: full PR detail (from get_pr_details) or None
- view: 'swipe' | 'risk-matrix' | 'contributor-focus'
- header: {title, subtitle}
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from typing_extensions import NotRequired, TypedDict


def _replace(_left: Any, right: Any) -> Any:
    return right


class _RepoRef(TypedDict, total=False):
    owner: str
    name: str


class _Header(TypedDict, total=False):
    title: str
    subtitle: str


class PRCanvasState(AgentState):
    prs: NotRequired[Annotated[list, _replace]]
    repo: NotRequired[Annotated[_RepoRef, _replace]]
    selectedPR: NotRequired[Annotated[Optional[dict], _replace]]
    view: NotRequired[Annotated[str, _replace]]
    header: NotRequired[Annotated[_Header, _replace]]
    highlightedPRNumbers: NotRequired[Annotated[list, _replace]]


class PRStateMiddleware(AgentMiddleware[PRCanvasState, Any]):  # type: ignore[type-arg]
    """Contributes the PR canvas state schema to the agent graph.

    No auto-hydration here (unlike LeadStateMiddleware) — there's no local
    seed data. The canvas starts empty and populates when the agent calls
    get_open_prs.
    """

    state_schema = PRCanvasState

    def before_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return None
