---
name: run-git-push
description: This skill should be used when the user asks to "push to git", "push to github", "commit and push", "save to git", or "publish the repo". It commits and pushes the AgentWard repo to GitHub while guaranteeing no real API keys or Band secrets are ever committed to the public repository.
version: 0.1.0
---

# Safe Git Push for AgentWard

AgentWard is a **public** GitHub repo (`https://github.com/mo7med2885b-del/AgentWard`).
The one rule that must never be broken: **real API keys and Band agent keys must never
enter git history.** All secrets live in `web/.env.local`, which is gitignored. This skill
is the procedure for committing and pushing safely.

Run every command from the repo root (the directory containing `.git`).

## Step 1 — Stage changes

```bash
git add -A
```

## Step 2 — Secret scan (REQUIRED GATE — do not skip)

Scan the staged content for the prefixes of this project's real keys. If anything matches,
**STOP** — do not commit. The pattern is split with string concatenation so this file does
not match itself, and excludes this skill's own directory.

```bash
PAT="sk-or-""v1-|band_""a_1781|rc_""bfe348|tvly-""dev-|16aeae""2be1|8b2238""20a6"
if git diff --cached -- . ':(exclude).claude/skills/run-git-push/*' | grep -nE "$PAT"; then
  echo "ABORT: a real secret is staged. Move it into web/.env.local and unstage."
else
  echo "PASS: no secrets staged"
fi
```

If it prints `ABORT`, fix the leak (move the value into `web/.env.local`, re-run `git add -A`)
before continuing.

## Step 3 — Commit

```bash
git commit -m "your message here"
```

End the commit message with the project's co-author trailer:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Step 4 — Push

In a headless shell, raw `git push` over HTTPS fails with a `/dev/tty` / "could not read
Username" error because there is no terminal to prompt for credentials. Configure `gh` as
the git credential helper first, then push:

```bash
gh auth setup-git
git push origin HEAD
```

Confirm with:

```bash
git status -sb        # should show "## main...origin/main" with no "ahead"
git remote get-url origin
```

## Gotchas

- **`git push` fails headless without `gh auth setup-git`.** The error is
  `fatal: could not read Username for 'https://github.com'`. The fix is always
  `gh auth setup-git` once per shell — it wires git to the authenticated `gh` token.
- **The secret scanner will flag its own pattern list.** That is why the pattern is built
  from concatenated fragments and the scan excludes `.claude/skills/run-git-push/*`.
  Never paste a full real key into this file.
- **`web/.env.local`, `.env`, and `example/` are gitignored** and must stay that way. Verify
  with `git check-ignore web/.env.local .env example/` — it should echo all three back
  (meaning they are ignored).
- **`.env.local.example` (placeholders only) IS committed** — that is intentional; it
  documents which env vars are needed without exposing values.

## First-time setup (only if the repo has no remote yet)

If `git remote -v` is empty, create the public repo and push in one step (requires
`gh auth login` done beforehand):

```bash
gh repo create AgentWard --public --source=. --remote=origin --push
```
