# WQT Codex Contract (Evidence-First, Minimal-Diff)

This contract governs how Codex/AI assistants operate inside the WQT repo. If a request conflicts with this contract, the contract wins.

## 1) Prime directive
Restore correctness and UX responsiveness with **evidence-first debugging** and **minimal diffs**.
No guessing. No refactors. No scope creep.

## 2) Evidence-first workflow (mandatory)
Before any code edits, capture evidence that proves the failure mode.

Required evidence bundle (copy into AUDIT_NOTES.md or equivalent):
- Branch + commit SHA (git status -sb, git rev-parse HEAD)
- Repro steps (exact URLs + actions)
- DevTools Console: **first error** (full stack trace)
- DevTools Network: script load status (200/404), and failing requests (URL, status, response body)
- If backend involved: curl outputs with key headers OR relevant server log lines

If evidence cannot be captured, stop and output:
- what you tried
- what blocked you
- what evidence is needed next (exactly)

## 3) Classification before fixing
Classify the issue before patching. Use one of:
A) Script not loading (404/path/caching)
B) Script loads but crashes (syntax/TDZ/reference error)
C) Init not called / handlers not bound (DOMContentLoaded/early return)
D) Overlay blocks clicks (CSS/pointer-events/z-index)
E) Gating deadlock (health/auth waits forever)
F) Backend error masked as “Failed to fetch” (5xx/timeout/proxy)

Write the classification into the audit log with:
- file + line references (where applicable)
- why this class fits the evidence

## 4) Minimal-diff rules (non-negotiable)
- Prefer 1 commit; 2 max only if a missing import / ignore rule is required.
- Touch the smallest number of files possible.
- Do not rename/relocate files unless a broken path proves it.
- Do not reformat unrelated lines.
- Do not change UI styling except where required to restore function or show existing states.
- Do not broaden CORS or auth globally unless explicitly required and proven.

Stop condition (hard):
If fixing requires touching >5 files or causes broad conflict resolution, STOP and report why.

## 5) Observability rule (only if it helps restore correctness)
If the UI can brick silently, add a **tiny** boot-safe harness:
- `window.__WQT_BOOT_STEP` markers
- on init failure, show a visible banner (not just console)
- optional `?debug=1` minimal badge

Keep it lightweight and removable.

## 6) Output requirements (every task)
Provide:
1) Audit note (evidence + classification + root cause + file/line)
2) Patch summary (each file changed, one sentence why)
3) Minimal diffs (only touched sections)
4) Verification steps (commands + expected behavior)
5) Risk notes (only if evidence supports them)

## 7) Git discipline
- No force-push.
- No history rewrite.
- No deleting branches unless explicitly instructed.
- If tree is dirty: stop and ask what to do with untracked files (commit/delete/ignore).

## 8) Default task prompt format (use this every time)
- Reference: “Follow WQT_Codex_Contract.md. If UI boot issue, also follow WQT_Runbook_UI_Boot.md.”
- Branch: <branch>
- Symptom: <one sentence>
- Evidence: <console first error + network failures + exact click that fails>
- Scope: “minimal diff, no refactor”
- Deliverables: “AUDIT_NOTES update + minimal patch + verification steps”
