#!/usr/bin/env python3
"""List the harness surface of a repository, grouped by HAF-1 kind. Stdlib only, read-only.

  discover.py [repo-root]          # Markdown checklist of what to read
  discover.py [repo-root] --json   # same, as JSON

It only finds candidates by path and a few content markers; the analyst still reads every file it lists.
Tracked files are taken from `git ls-files` when available, so worktrees, node_modules and build output are skipped.
"""
import fnmatch
import json
import os
import subprocess
import sys

# kind → (label, glob patterns). A file can match several kinds.
SURFACE = {
    "guide": ("Context & guides", [
        "AGENTS.md", "*/AGENTS.md", "CLAUDE.md", "*/CLAUDE.md", "GEMINI.md", "CONVENTIONS.md",
        ".cursorrules", ".cursor/rules/*", ".windsurfrules", ".windsurf/rules/*", ".clinerules*",
        ".github/copilot-instructions.md", ".github/instructions/*", ".aider.conf.yml", ".codex/*",
        "CONTRIBUTING.md", "docs/adr/*", "docs/decisions/*", "adr/*", "docs/architecture/*",
        "docs/domain/*", "docs/engineering/*", "*glossary*",
    ]),
    "orchestration": ("Skills, commands, subagents", [
        ".claude/skills/*/SKILL.md", ".claude/commands/*", ".claude/agents/*", ".agents/*",
        ".github/prompts/*", ".github/chatmodes/*", ".cursor/commands/*", ".gemini/commands/*",
    ]),
    "gate": ("Pre-action gates & permissions", [
        ".claude/settings.json", ".claude/settings.local.json", ".claude/hooks/*", ".cursor/hooks.json",
        ".codex/config.toml", ".gemini/settings.json", ".github/rulesets/*", "CODEOWNERS", ".github/CODEOWNERS",
    ]),
    "sensor": ("Sensors (local hooks, linters, arch rules)", [
        "lefthook.yml", "lefthook.yaml", ".husky/*", ".pre-commit-config.yaml", ".lintstagedrc*",
        "eslint.config.*", ".eslintrc*", "biome.json", "ruff.toml", "pyproject.toml", ".golangci.yml",
        "clippy.toml", "*/clippy.toml", "deny.toml", "*/deny.toml", ".dependency-cruiser.*",
        "archunit*", "*import-linter*", ".semgrep*", "commitlint.config.*",
    ]),
    "remote": ("CI / CD / supply chain", [
        ".github/workflows/*", ".gitlab-ci.yml", ".circleci/*", "azure-pipelines.yml", "Jenkinsfile",
        ".github/dependabot.yml", "renovate.json", ".renovaterc*", ".gitleaks.toml", ".secretlintrc*",
        "release-please-config.json", ".release-please-manifest.json",
    ]),
    "verification": ("Test strength & verification", [
        "stryker.config.*", "*/stryker.config.*", "mutants.toml", "*/mutants.toml", "vitest.config.*",
        "*/vitest.config.*", "playwright.config.*", "*/playwright.config.*", "*.feature", "k6*",
        "jest.config.*", "pytest.ini", "codecov.yml",
    ]),
    "state": ("State, memory, specs", [
        ".specs/*", "specs/*", ".planning/*", "STATE.md", "ROADMAP.md", "*LESSONS*", "*lessons*",
        "memory/*", ".claude/memory/*", "TODO.md", "PLAN.md",
    ]),
    "measurement": ("Measurement & ratchets", [
        ".harness-score*", ".quality-baseline*", "*baseline*.json", ".betterer*", "sonar-project.properties",
    ]),
}
MARKERS = {
    "gate": ["PreToolUse", "permissionDecision", "--no-verify"],
    "sensor": ["PostToolUse", "pre-commit", "pre-push"],
    "governance": ["Approved", "escalat", "delegat", "maintainer"],
}


def tracked_files(root):
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files"], capture_output=True, text=True, check=True
        ).stdout
        return [p for p in out.splitlines() if p]
    except (OSError, subprocess.CalledProcessError):
        files = []
        skip = {".git", "node_modules", "dist", "build", "target", ".turbo", "worktrees"}
        for d, dirs, names in os.walk(root):
            dirs[:] = [x for x in dirs if x not in skip]
            for n in names:
                files.append(os.path.relpath(os.path.join(d, n), root))
        return files


def match(path, patterns):
    base = os.path.basename(path)
    for pat in patterns:
        if fnmatch.fnmatch(path, pat) or fnmatch.fnmatch(path, pat + "/*") or fnmatch.fnmatch(path, "*/" + pat):
            return True
        if "/" not in pat and fnmatch.fnmatch(base, pat):
            return True
    return False


def tools_detected(files):
    s = set(files)
    has = lambda prefix: any(f.startswith(prefix) for f in files)
    tools = []
    if "CLAUDE.md" in s or has(".claude/"):
        tools.append("claude-code")
    if ".cursorrules" in s or has(".cursor/"):
        tools.append("cursor")
    if "AGENTS.md" in s or has(".codex/"):
        tools.append("codex / AGENTS.md readers")
    if ".github/copilot-instructions.md" in s or has(".github/instructions/"):
        tools.append("copilot")
    if "GEMINI.md" in s or has(".gemini/"):
        tools.append("gemini")
    if has(".windsurf") or ".windsurfrules" in s:
        tools.append("windsurf")
    if has(".aider"):
        tools.append("aider")
    return tools


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    root = os.path.abspath(args[0] if args else ".")
    files = tracked_files(root)
    found = {k: [] for k in SURFACE}
    for f in files:
        for kind, (_, pats) in SURFACE.items():
            if match(f, pats):
                found[kind].append(f)
    markers = {k: [] for k in MARKERS}
    scan = [f for f in files if f.endswith((".json", ".mjs", ".js", ".ts", ".py", ".sh", ".yml", ".yaml", ".toml"))
            and (f.startswith((".claude/", ".cursor/", ".codex/", ".gemini/", "scripts/", ".github/", ".husky/"))
                 or "/" not in f)]
    for f in scan[:2000]:
        try:
            with open(os.path.join(root, f), encoding="utf-8", errors="ignore") as fh:
                text = fh.read(200_000)
        except OSError:
            continue
        for kind, words in MARKERS.items():
            if any(w in text for w in words):
                markers[kind].append(f)
    tests = [f for f in files if (f.startswith(("scripts/", ".claude/hooks/", ".husky/", "tools/"))
                                  and ("test" in f or "spec" in f))]
    result = {
        "root": root,
        "tracked_files": len(files),
        "tools": tools_detected(files),
        "surface": {k: sorted(v) for k, v in found.items()},
        "content_markers": {k: sorted(v) for k, v in markers.items()},
        "harness_tests": sorted(tests),
    }
    if "--json" in argv:
        print(json.dumps(result, indent=2))
        return 0
    print(f"# Harness surface of {root}\n")
    print(f"- Tracked files: {len(files)}")
    print(f"- Agent tools configured: {', '.join(result['tools']) or 'none detected'}\n")
    for kind, (label, _) in SURFACE.items():
        items = result["surface"][kind]
        print(f"## {label} ({len(items)})")
        for f in items[:80]:
            print(f"- [ ] {f}")
        if len(items) > 80:
            print(f"- … and {len(items) - 80} more")
        print()
    print("## Files with harness markers (hooks, permissions, approvals)")
    for kind, items in result["content_markers"].items():
        print(f"- {kind}: {len(items)} → " + ", ".join(items[:15]) + (" …" if len(items) > 15 else ""))
    print(f"\n## Tests of the harness itself ({len(tests)})")
    for f in tests[:40]:
        print(f"- {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
