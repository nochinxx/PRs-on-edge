"""LangGraph entry point for `langgraph dev --port 8133`.

Wires:
- A switchable runtime (Gemini Flash-Lite + deepagents | Gemini Flash-Lite + react |
  Claude Sonnet 4.6 + react) selected by `AGENT_RUNTIME`.
- GitHub backend tools (get_open_prs, get_pr_details, get_contributor_history)
- TimingMiddleware, PRStateMiddleware, CopilotKitMiddleware
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

from src.intelligence_cleanup import wipe_orphan_threads
from src.github_tools import load_github_tools
from src.prompts import build_system_prompt
from src.runtime import build_graph


load_dotenv()

wipe_orphan_threads()

_AGENT_RUNTIME = os.getenv("AGENT_RUNTIME", "gemini-flash-deep")
print(f"[runtime] AGENT_RUNTIME={_AGENT_RUNTIME}", flush=True)

_gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
if _AGENT_RUNTIME.startswith("gemini-") and (
    not _gemini_key or _gemini_key.startswith("stub")
):
    print(
        "\n  GEMINI_API_KEY is unset or a stub.\n"
        "   The agent will boot but chat will fail on the first turn.\n"
        "   Get a key at https://aistudio.google.com → Get API key,\n"
        "   then set GEMINI_API_KEY in apps/agent/.env.\n",
        flush=True,
    )

backend_tools = load_github_tools()

SYSTEM_PROMPT = build_system_prompt()

_use_noop = (
    _AGENT_RUNTIME.startswith("gemini-")
    and (not _gemini_key or _gemini_key.startswith("stub"))
)
if _use_noop:
    print(
        "\n[runtime] GEMINI_API_KEY missing or stub — using noop fallback graph.\n"
        "          Chat will reply with a setup pointer instead of hanging.\n",
        flush=True,
    )

graph = build_graph(
    "noop" if _use_noop else _AGENT_RUNTIME,
    tools=backend_tools,
    system_prompt=SYSTEM_PROMPT,
)


def main() -> None:
    import subprocess

    subprocess.run(
        ["langgraph", "dev", "--port", "8133"],
        check=True,
    )


if __name__ == "__main__":
    main()
