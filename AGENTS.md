# PRs on Edge — agent memory

> Single source of truth for any agent working on this repo.
> Read top to bottom before doing anything. Update Status as you go.

---

## What this is

**PRs on Edge** — a generative UI app for GitHub PR triage.
Built for the AI Tinkerers Generative UI Hackathon (May 9, 2026), Track: **Kill the Dashboard**.

The pitch: paste a GitHub repo into the chat. The agent reads the open PRs, picks the right interface for the situation (swipe stack, risk matrix, or contributor view), and renders it. No fixed dashboard — the agent decides. Progressive disclosure: surface info first, dig deeper on demand.

**Stack:** Next.js 15 + CopilotKit v2 + LangGraph Deep Agents + Gemini 3.1 Flash-Lite + GitHub REST API (no DB, no vector search).

**Hackathon protocols used:** CopilotKit `useFrontendTool` (controlled generative UI) + AG-UI (agent ↔ frontend state) + LangGraph.

---

## Architecture

```
apps/
  frontend/          ← Next.js 15, React, Tailwind, CopilotKit v2
    src/app/leads/page.tsx   ← main canvas (all frontend tools registered here)
    src/app/layout.tsx
    src/components/
      copilot/ToolFallbackCard.tsx   ← catch-all tool render
      threads-drawer/                ← persistent conversation threads
  bff/               ← Hono BFF, bridges frontend ↔ LangGraph agent
    src/server.ts
  agent/             ← Python LangGraph agent
    main.py          ← entry point, wires tools + runtime
    src/
      github_tools.py   ← 3 backend tools (GitHub REST API via httpx)
      pr_state.py       ← PRStateMiddleware (canvas state schema)
      prompts.py        ← system prompt for the PR triage agent
      runtime.py        ← switchable runtime (Gemini deep/react, Claude react)
      timing.py         ← TimingMiddleware
      intelligence_cleanup.py
  mcp/               ← Manufact mcp-use MCP server (not yet customized)
deployment/
  docker-compose.yml ← CopilotKit Intelligence (threads, Postgres, Redis)
```

### Agent state shape (canonical — match exactly)

```ts
type AgentState = {
  prs: PR[]                     // loaded from get_open_prs
  repo: { owner, name } | null  // currently loaded repo
  selectedPR: PR | null         // full PR with files array
  view: "swipe" | "risk-matrix" | "contributor-focus" | "dependency-graph"
  header: { title, subtitle }
  highlightedPRNumbers: number[]
}

type PR = {
  number, title, author, author_avatar?,
  body?, changed_files?, created_at?, updated_at?,
  labels?, html_url?, draft?, risk_score?   // 0-100 heuristic
}
```

### Backend tools (Python, `apps/agent/src/github_tools.py`)

| Tool | What it does |
|---|---|
| `get_open_prs(owner, repo)` | Fetches all open PRs, slim shape, heuristic risk_score. Returns `Command(update={prs, repo, header})` |
| `get_pr_details(owner, repo, pr_number)` | Full PR + files + patch snippets. Returns `Command(update={selectedPR})` |
| `get_contributor_history(owner, repo, handle)` | Last 50 closed PRs filtered by author → merge rate + titles |

Risk score heuristic lives in `_risk_score()` in `github_tools.py`: additions+deletions, file count, sensitive labels (security, breaking, auth, billing, payment, migration).

### Frontend tools (registered in `apps/frontend/src/app/leads/page.tsx`)

| Tool | What it does |
|---|---|
| `setHeader({title?, subtitle?})` | Updates workspace heading |
| `setView("swipe"\|"risk-matrix"\|"contributor-focus")` | Switches the canvas view mode |
| `selectPR(prNumber\|null)` | Opens/closes the PR detail panel |
| `highlightPRs({numbers[]})` | Violet ring on specific PR cards |
| `renderPRCard({number, title, author, risk_score?})` | Inline PR card in chat |
| `renderRiskSummary({})` | Inline risk distribution bar chart in chat |

---

## Status

Last updated: 2026-05-09

### Done
- Forked CopilotKit hackathon starter kit
- Removed Notion integration entirely (Notion MCP, lead store, lead state)
- Created `github_tools.py` — 3 tools hitting GitHub REST API via httpx
- Created `pr_state.py` — PRStateMiddleware with PR canvas state schema
- Rewrote `prompts.py` — PR triage agent prompt with view selection policy
- Updated `main.py` — wired GitHub tools + PR state
- Fixed `scripts/check-env.sh` — removed Notion checks, GEMINI_API_KEY only required
- Rewrote `apps/frontend/src/app/leads/page.tsx` — full PR triage canvas:
  - PR card grid sorted by risk score (high → low)
  - Color-coded risk badges (red/amber/green)
  - PR detail panel (right side, shows on click or `selectPR`)
  - Highlight ring on `highlightPRs` tool call
  - Inline `renderPRCard` and `renderRiskSummary` in chat
  - Chat suggestions: load repo, highlight risky, switch view, contributor check
  - Empty state with instructions
- CopilotKit Intelligence (threads) running via Docker, databases fixed
- Built three distinct view layouts in `apps/frontend/src/app/leads/page.tsx`:
  - `"swipe"` — SwiPR-style card stack: 3 visible stacked cards, physics drag (right=approve/green, left=changes/red, down=skip), action buttons with keyboard hints (J/F/space), `isContentEditable` guard so chat input is not interrupted
  - `"risk-matrix"` — three scrollable columns (High ≥70 / Medium 40-69 / Low <40) with color-coded headers and counts
  - `"contributor-focus"` — PRs grouped by author, sorted by PR count, author avatar + handle + count badge
  - `"dependency-graph"` — Real DAG: parses `#N` refs from PR bodies. Solid arrow = explicit keyword (depends on/blocked by/requires). Dashed = bare mention. Sugiyama-style layer layout (no-deps left → dependents right). Independent PRs shown as compact chips below graph.
  - Added manual view tab switcher in the header (pills) so you can switch without the agent
  - All views share `sortedPRs` (risk-desc), `highlightedPRNumbers`, `selectedPR` detail panel
  - Fixed keyboard capture bug: SwipeView now checks `isContentEditable` before consuming arrow/space keys so the chat input works normally

### Pending — in priority order

1. **Auto view selection on load** — after `get_open_prs`, agent should call `setView` based on what it sees:
   - `risk-matrix` if 5+ PRs with risk_score ≥ 60
   - `contributor-focus` if 1-2 authors own >40% of PRs
   - `swipe` otherwise
   The prompt already instructs this; verify it actually fires.

2. **Deploy MCP server via Manufact** — `apps/mcp/` contains the mcp-use server. Replace the Notion/leads resources with PR tools so the same agent works in Claude Desktop. Run `npm run -w mcp deploy`. Add Claude Desktop config:
   ```json
   { "mcpServers": { "prs-on-edge": { "url": "<manufact-url>" } } }
   ```

3. **Wire `renderRiskSummary` to the view** — right now it only renders in chat. Should also appear as a summary strip above the PR grid when 10+ PRs are loaded.

4. **Record decisions** — add a `record_decision(pr_number, action)` frontend tool so the agent can track approve/skip/changes-requested decisions during a swipe session.

5. **Polish swipe UX** — spring physics card animation (Framer Motion), color tint on edge cross (green right, red left), keyboard shortcuts.

6. **Demo prep** — pre-run `resend/resend-node` to verify end-to-end, record Loom fallback video.

7. **Group PRs by category** — classify PRs by topic (bug fix, feature, chore, docs, security) and group cards accordingly in the risk-matrix view.

8. **PR dependency graph** — detect PRs that depend on each other (shared files, stacked branches, cross-references in PR body) and surface dependency links between cards.

9. **Priority ranking by age** — rank PRs for review order by how long they have been open (`created_at` ascending — oldest first). Surface as an ordered list the agent can read back.

10. **Release target classification** — classify each PR into a release target category and surface it on the card. Use PR title, labels, and body to determine category:

    | Category | Classification signals |
    |---|---|
    | **Feature** | labels: `feature`, `enhancement`, `new`; title prefix: `feat:` |
    | **Bug Fix** | labels: `bug`, `fix`, `hotfix`; title prefix: `fix:`, `bug:` |
    | **Maintenance** | labels: `chore`, `refactor`, `deps`, `ci`, `infra`; title prefix: `chore:`, `refactor:` |
    | **Simple Fix** | labels: `typo`, `docs`, `style`, `trivial`; title prefix: `docs:`, `style:`; <5 lines changed |

    Classification logic (in priority order):
    1. Explicit label match (most reliable)
    2. Conventional commit prefix in title (`feat:`, `fix:`, `chore:`, `docs:`)
    3. Keyword scan of PR title and body
    4. Fall back to `changed_files` count + diff size heuristic for simple fix

    Agent should call `setView("release-targets")` to group cards by category. Each group shows its release cadence hint: Feature → minor release, Bug Fix → patch release, Maintenance → no release needed, Simple Fix → patch or no release.

---

## Env setup

```
.env (root)                      — read by Next.js + BFF
apps/agent/.env                  — read by langgraph dev (Python agent)
```

Required:
- `GEMINI_API_KEY` — Gemini 3.1 Flash-Lite (from aistudio.google.com, starts with AIza)
- `COPILOTKIT_LICENSE_TOKEN` — from `npx copilotkit@latest license`

Optional but important:
- `GITHUB_TOKEN` — GitHub PAT, no scopes needed. 5000 req/hr vs 60 unauthenticated. **Set this before the demo.**

---

## Running locally

```bash
# First time: fix the Intelligence databases if they don't exist
docker exec hackathon-intelligence-notion-postgres-1 psql -U intelligence -d postgres -c "CREATE DATABASE intelligence_app;"
docker exec hackathon-intelligence-notion-postgres-1 psql -U intelligence -d postgres -c "CREATE DATABASE intelligence_app_shadow;"
docker restart hackathon-intelligence-notion-intelligence-1

# Every time
npm run dev
```

Opens at `http://localhost:3010`.

The agent runs at `http://localhost:8133` (LangGraph dev server).

---

## How to test

1. Open `http://localhost:3010`
2. Type in the chat: `"Load the open PRs for resend/resend-node"`
3. Canvas should populate with PR cards sorted by risk score
4. Try: `"Highlight the high-risk PRs"` → violet rings on cards
5. Try: `"Show me PR #X"` → detail panel opens on the right
6. Try: `"Switch to risk-matrix view"` → `setView` fires (layout change pending, see task 1)
7. Click any PR card directly → detail panel opens

---

## Decisions log

| Decision | Why |
|---|---|
| Fork CopilotKit starter, swap Notion for GitHub | Starter has CopilotKit + LangGraph + Gemini + mcp-use wired and running. Faster than building from scratch. |
| No DB, no vector search | Live GitHub API calls are sufficient for demo. Eliminates Neon/pgvector/Drizzle setup. |
| httpx over Octokit | Python agent, httpx is already a transitive dep, no extra install. |
| Risk score heuristic, not LLM | Fast, deterministic, no extra API call. Good enough for sorting cards. |
| All three views share same data | Agent calls `get_open_prs` once, `setView` switches layout client-side. No re-fetch on view change. |
| GITHUB_TOKEN optional | App works unauthenticated (60 req/hr). Token only needed for heavy usage / demo. |
| `motion` package (not `framer-motion`) for swipe | Starter already had `motion` v12 in package.json. Same API, just the renamed package. Uses `AnimatePresence`, `useMotionValue`, `useTransform` for the card stack. |
| SwiPR card design ported, not imported | SwiPR uses its own DB/API shape. Adapted the visual design (stacked cards, green/red drag overlays, action button row) to our `PR` type inline in page.tsx. |
| Dependency graph uses label+author edges, no file-path data | `get_open_prs` returns file counts but not paths. Graph edges = same author. Risk tier = node color. Good enough for demo without an extra API call. |
| Manual view tabs in header | Added pill switcher alongside the agent-driven `setView` so you can test layout switching without typing in chat. |
| `sortedPRs` passed to all three views | Risk-matrix and contributor-focus both benefit from pre-sorted data; contributor groups sort by PR count on top of that. |
