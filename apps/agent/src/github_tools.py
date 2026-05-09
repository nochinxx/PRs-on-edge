"""GitHub backend tools for the PR triage agent.

Four tools replacing the Notion integration:
- get_open_prs: fetch all open PRs for a repo, populate canvas state
- get_pr_details: fetch files + diff for a specific PR
- get_contributor_history: recent PR history for an author
- compute_risk_score: heuristic 0-100 from PR metadata (no API call)
"""

from __future__ import annotations

import json
import os
from typing import Annotated, Any, Dict, List

import httpx
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool, InjectedToolCallId
from langgraph.types import Command

GITHUB_API = "https://api.github.com"


def _headers() -> Dict[str, str]:
    token = os.getenv("GITHUB_TOKEN", "")
    h = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _risk_score(pr: Dict[str, Any]) -> int:
    """Heuristic risk 0-100 from PR metadata fields."""
    score = 0

    additions = pr.get("additions", 0) or 0
    deletions = pr.get("deletions", 0) or 0
    changed_files = pr.get("changed_files", 0) or 0
    total_lines = additions + deletions

    if total_lines > 500:
        score += 30
    elif total_lines > 200:
        score += 20
    elif total_lines > 50:
        score += 10

    if changed_files > 20:
        score += 25
    elif changed_files > 10:
        score += 15
    elif changed_files > 5:
        score += 8

    labels = [str(l.get("name", "")).lower() for l in (pr.get("labels") or [])]
    risky = {"security", "breaking", "breaking-change", "auth", "billing", "payment", "migration"}
    if any(l in risky for l in labels):
        score += 30

    if pr.get("draft"):
        score = max(0, score - 15)

    return min(100, max(0, score))


def _slim_pr(pr: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "number": pr["number"],
        "title": pr["title"],
        "author": pr["user"]["login"],
        "author_avatar": pr["user"]["avatar_url"],
        "body": (pr.get("body") or "")[:400],
        "changed_files": pr.get("changed_files", 0),
        "created_at": pr["created_at"],
        "updated_at": pr["updated_at"],
        "labels": [l["name"] for l in (pr.get("labels") or [])],
        "html_url": pr["html_url"],
        "draft": pr.get("draft", False),
        "risk_score": _risk_score(pr),
    }


@tool
def get_open_prs(
    owner: Annotated[str, "GitHub repo owner (user or org name)"],
    repo: Annotated[str, "GitHub repo name"],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Fetch all open PRs for a GitHub repo and populate the canvas.

    Returns a Command that sets `prs`, `repo`, and `header` on agent state
    so the frontend canvas updates immediately. The agent just needs to
    relay the summary line — no need to call any frontend setter after this.
    """
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
                headers=_headers(),
                params={
                    "state": "open",
                    "per_page": 100,
                    "sort": "updated",
                    "direction": "desc",
                },
            )
            resp.raise_for_status()
            raw = resp.json()

        prs = [_slim_pr(p) for p in raw]

        risky_count = sum(1 for p in prs if p["risk_score"] >= 60)
        draft_count = sum(1 for p in prs if p["draft"])

        summary = (
            f"Loaded {len(prs)} open PRs from {owner}/{repo}. "
            f"{risky_count} high-risk (score ≥ 60), {draft_count} drafts."
        )

        return Command(
            update={
                "prs": prs,
                "repo": {"owner": owner, "name": repo},
                "header": {
                    "title": f"{owner}/{repo}",
                    "subtitle": f"{len(prs)} open PRs · {risky_count} high-risk",
                },
                "messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)],
            }
        )
    except Exception as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"Failed to fetch PRs for {owner}/{repo}: {e}",
                        tool_call_id=tool_call_id,
                    )
                ]
            }
        )


@tool
def get_pr_details(
    owner: Annotated[str, "GitHub repo owner"],
    repo: Annotated[str, "GitHub repo name"],
    pr_number: Annotated[int, "The PR number to inspect"],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Fetch full details + changed files for a specific PR.

    Sets `selectedPR` on agent state so the frontend detail panel opens.
    Call this when the user taps into a card or asks about a specific PR.
    """
    try:
        with httpx.Client(timeout=15) as client:
            pr_resp = client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}",
                headers=_headers(),
            )
            pr_resp.raise_for_status()
            pr = pr_resp.json()

            files_resp = client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/files",
                headers=_headers(),
                params={"per_page": 30},
            )
            files_resp.raise_for_status()
            files = files_resp.json()

        slim_files = [
            {
                "filename": f["filename"],
                "status": f["status"],
                "additions": f["additions"],
                "deletions": f["deletions"],
                "patch": (f.get("patch") or "")[:500],
            }
            for f in files[:20]
        ]

        detail = {
            "number": pr["number"],
            "title": pr["title"],
            "author": pr["user"]["login"],
            "author_avatar": pr["user"]["avatar_url"],
            "body": (pr.get("body") or "")[:1000],
            "additions": pr.get("additions", 0),
            "deletions": pr.get("deletions", 0),
            "changed_files": pr.get("changed_files", 0),
            "files": slim_files,
            "risk_score": _risk_score(pr),
            "html_url": pr["html_url"],
            "draft": pr.get("draft", False),
        }

        summary = (
            f"PR #{pr_number} '{pr['title']}' by {pr['user']['login']}: "
            f"{pr.get('additions',0)}+ {pr.get('deletions',0)}- "
            f"across {pr.get('changed_files',0)} files. "
            f"Risk score: {detail['risk_score']}/100."
        )

        return Command(
            update={
                "selectedPR": detail,
                "messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)],
            }
        )
    except Exception as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"Failed to fetch PR #{pr_number}: {e}",
                        tool_call_id=tool_call_id,
                    )
                ]
            }
        )


@tool
def get_contributor_history(
    owner: Annotated[str, "GitHub repo owner"],
    repo: Annotated[str, "GitHub repo name"],
    handle: Annotated[str, "GitHub username to look up"],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> str:
    """Fetch a contributor's recent closed PR history in this repo.

    Returns a JSON string with their merge rate and recent PR titles.
    Use this to assess whether a first-time contributor is trustworthy
    or to understand a repeat contributor's pattern.
    """
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
                headers=_headers(),
                params={
                    "state": "closed",
                    "per_page": 50,
                    "sort": "updated",
                    "direction": "desc",
                },
            )
            resp.raise_for_status()
            closed = resp.json()

        author_prs = [
            p for p in closed if p["user"]["login"].lower() == handle.lower()
        ]
        merged = [p for p in author_prs if p.get("merged_at")]

        return json.dumps(
            {
                "handle": handle,
                "total_closed_prs": len(author_prs),
                "merged": len(merged),
                "merge_rate": (
                    f"{int(len(merged) / len(author_prs) * 100)}%"
                    if author_prs
                    else "n/a (no closed PRs found)"
                ),
                "recent_titles": [p["title"] for p in author_prs[:5]],
            },
            ensure_ascii=False,
        )
    except Exception as e:
        return json.dumps({"error": str(e)})


def load_github_tools() -> List[Any]:
    """Return the GitHub backend tool list for the agent."""
    tools: List[Any] = [
        get_open_prs,
        get_pr_details,
        get_contributor_history,
    ]
    print(f"[github_tools] Loaded {len(tools)} tools", flush=True)
    token = os.getenv("GITHUB_TOKEN", "")
    if not token:
        print(
            "[github_tools] WARN: GITHUB_TOKEN not set — unauthenticated (60 req/hr). "
            "Set it in agent/.env for 5000 req/hr.",
            flush=True,
        )
    return tools
