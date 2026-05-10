#!/usr/bin/env python3
"""
Open GitHub issues for the most-requested missing keywords.

Idempotent: skips any keyword that already has an open issue with a title
containing the same keyword (case-insensitive).

For each new keyword cluster, asks the local Ollama to draft a short issue
body. The model is given the keyword, frequency, and the project's CLAUDE.md
skill schema as context, so the draft includes a usable starting structure.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import shutil
import subprocess
import sys
import urllib.request
import urllib.error
from pathlib import Path

LABEL = "needs-skill"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True, help="local repo path")
    p.add_argument("--gh-repo", required=True, help="owner/repo")
    p.add_argument("--since", required=True, help="ISO-8601 cutoff")
    p.add_argument("--top-n", type=int, default=3)
    p.add_argument("--ollama-url", default="http://localhost:11434")
    p.add_argument("--model", default="gemma3:12b")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def load_misses(repo: Path, since: str) -> collections.Counter[str]:
    log = repo / "reports" / "missing-keywords.log"
    counter: collections.Counter[str] = collections.Counter()
    if not log.exists():
        return counter
    for line in log.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get("timestamp", "") < since:
            continue
        kw = (e.get("keyword") or "").strip().lower()
        if kw:
            counter[kw] += 1
    return counter


def existing_issue_titles(gh_repo: str) -> list[str]:
    """All open issue titles, lowercased, for dedupe."""
    try:
        out = subprocess.check_output(
            [
                "gh", "issue", "list",
                "--repo", gh_repo,
                "--state", "open",
                "--limit", "200",
                "--json", "title",
            ],
            text=True,
        )
        return [i["title"].lower() for i in json.loads(out)]
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError):
        return []


def existing_label(gh_repo: str, label: str) -> bool:
    try:
        out = subprocess.check_output(
            ["gh", "label", "list", "--repo", gh_repo, "--json", "name"],
            text=True,
        )
        return any(l["name"] == label for l in json.loads(out))
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError):
        return False


def ensure_label(gh_repo: str, label: str) -> None:
    if existing_label(gh_repo, label):
        return
    subprocess.run(
        ["gh", "label", "create", label,
         "--repo", gh_repo,
         "--color", "C5DEF5",
         "--description", "A user keyword had no matching skill — write one"],
        check=False,
    )


def ollama_chat(url: str, model: str, prompt: str, timeout: int = 120) -> str:
    body = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.4},
    }).encode()
    req = urllib.request.Request(
        f"{url}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
            return data.get("response", "").strip()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"[issues] ollama error: {e}", file=sys.stderr)
        return ""


SKILL_SCHEMA_HINT = """\
Skills follow this JSON schema (from CLAUDE.md):

{
  "id": "community.<slug>.v1",
  "keywords": ["primary keyword", "alias 1", "alias 2"],
  "contexts": ["nextjs", "react"],
  "title": "Human-readable title",
  "summary": "One sentence describing what this skill covers.",
  "source": "community",
  "declaration": "What the agent announces to the user before executing.",
  "instructions": "## Step-by-step Markdown ...",
  "version": "1.0.0",
  "updated_at": "ISO-8601"
}

Quality bar: 3+ keyword variants, numbered steps, Common Errors & Fixes, What NOT to Do.
"""


def draft_body(url: str, model: str, keyword: str, count: int) -> str:
    prompt = f"""You are helping the maintainer of Kira (https://github.com/aibenyclaude-coder/Kira).

A real Kira user issued `kira_lookup("{keyword}")` and got zero matching skills.
This happened {count} time(s) since the last digest run.

Draft a GitHub issue body asking the community to write the missing skill.

Sections:
1. **Why this matters** — 1–2 sentences on why this keyword surfaced.
2. **Suggested coverage** — 4–8 bullet points naming concrete steps the skill should explain.
3. **Skill skeleton** — a ready-to-fill JSON code block matching the schema below. Use slug derived from the keyword. Leave `instructions` as a single placeholder line.
4. **How to contribute** — link to CONTRIBUTING.md, mention the first-1000 contributor incentive.

{SKILL_SCHEMA_HINT}

Be concrete and short — under 350 words. Markdown only. Do not invent technical claims about libraries you are not certain about; stay general where you are unsure.
"""
    return ollama_chat(url, model, prompt) or _fallback_body(keyword, count)


def _fallback_body(keyword: str, count: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", keyword.strip().lower()).strip("-") or "missing"
    return f"""\
## Missing skill for keyword: `{keyword}`

`kira_lookup("{keyword}")` returned 0 results, observed **{count}** time(s) since the last intel run.

This issue is auto-opened by the nightly intel script. The community is invited to add a skill covering this keyword.

### Skill skeleton

```json
{{
  "id": "community.{slug}.v1",
  "keywords": ["{keyword}"],
  "contexts": [],
  "title": "TODO",
  "summary": "TODO",
  "source": "community",
  "declaration": "TODO",
  "instructions": "## TODO",
  "version": "1.0.0",
  "updated_at": "TODO"
}}
```

See [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md). The first 1,000 contributors get permanent free access to all Kira features (including future Pro tier).
"""


def main() -> int:
    args = parse_args()
    if shutil.which("gh") is None:
        print("[issues] gh not found, skipping", file=sys.stderr)
        return 0

    misses = load_misses(Path(args.repo), args.since)
    if not misses:
        print("[issues] no missing-keyword events since last run", file=sys.stderr)
        return 0

    top = misses.most_common(args.top_n)
    existing = existing_issue_titles(args.gh_repo)
    ensure_label(args.gh_repo, LABEL)

    opened = 0
    for kw, n in top:
        title = f"Missing skill: {kw}"
        if any(kw in t for t in existing):
            print(f"[issues] skip (already exists or covered): {kw}", file=sys.stderr)
            continue
        body = draft_body(args.ollama_url, args.model, kw, n)
        if args.dry_run:
            print(f"[issues] DRY-RUN would open: {title}\n{body}\n---")
            continue
        try:
            subprocess.run(
                ["gh", "issue", "create",
                 "--repo", args.gh_repo,
                 "--title", title,
                 "--body", body,
                 "--label", LABEL],
                check=True,
            )
            opened += 1
        except subprocess.CalledProcessError as e:
            print(f"[issues] failed to open {title}: {e}", file=sys.stderr)
    print(f"[issues] opened {opened} new issue(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
