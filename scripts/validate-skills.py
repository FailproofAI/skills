#!/usr/bin/env python3
"""Validate every skill under skills/ before it ships.

Catches the silent-skip traps: SKILL.md missing / nested too deep, frontmatter
not at the very top, missing name/description, folder name != frontmatter name.
Also catches the silent-TRUNCATION trap: a description over DESCRIPTION_MAX_CHARS
is cut off rather than rejected, and what it loses is the trailing scope ("NOT for
...") that stops the skill firing on the wrong requests — so an over-long
description doesn't fail, it misfires. Nothing else checks this.
Also flags absolute /home/ paths that won't exist for installers.

No third-party deps. Exit 0 if clean (warnings allowed), 1 on any error.
Run:  python3 scripts/validate-skills.py
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"
SCANNABLE = {".md", ".yaml", ".yml", ".py", ".txt", ".json", ".sql"}

# An agent reads only the first DESCRIPTION_MAX_CHARS of `description:` when deciding
# whether to load a skill. Over that it is truncated, NOT rejected.
DESCRIPTION_MAX_CHARS = 1024
DESCRIPTION_WARN_CHARS = 1000

errors: list[str] = []
warnings: list[str] = []




def _description_value(fm: str) -> str | None:
    """Return the parsed value of `description:` from a frontmatter block.

    Hand-rolled on purpose: this script has no third-party deps, so PyYAML is not
    available. Handles the block-scalar form every skill here uses
    (`description: |-`) plus the plain inline form. Returns None if absent.

    Getting this right matters: an indentation-stripping shortcut under-counts a
    block scalar badly (it can report ~850 for a value PyYAML measures at ~1090),
    which would pass a description that ships truncated — the exact bug this
    check exists to catch.
    """
    m = re.search(r"(?m)^description:[ \t]*(\|[-+]?|>[-+]?)?[ \t]*(.*)$", fm)
    if not m:
        return None
    style, inline = m.group(1), m.group(2)
    if not style:
        # plain inline scalar: description: some text
        return inline.strip().strip("\"'") or None

    # block scalar: collect the indented lines that follow
    rest = fm[m.end():].lstrip("\n")
    lines = fm[m.end():].split("\n")[1:] if fm[m.end():].startswith("\n") else fm[m.end():].split("\n")
    body = []
    indent = None
    for line in lines:
        if not line.strip():
            body.append("")
            continue
        cur = len(line) - len(line.lstrip())
        if indent is None:
            indent = cur
        if cur < indent:
            break            # dedented => next key, block is over
        body.append(line[indent:])
    if indent is None:
        return None

    # YAML chomping: `-` strips every trailing newline, `+` keeps them all, and the
    # bare form clips to exactly one. The difference is only a character or two —
    # which is the whole ballgame for a check whose threshold is a character count.
    trailing = 0
    while body and body[-1] == "":
        body.pop(); trailing += 1
    chomp = style[-1] if style and style[-1] in "-+" else "clip"
    if chomp == "+":
        suffix = "\n" * trailing
    elif chomp == "-":
        suffix = ""
    else:
        suffix = "\n" if body else ""

    if style.startswith(">"):
        # folded: lines within a paragraph join with a space; a blank line between
        # paragraphs folds to a SINGLE newline (not two).
        paras, buf = [], []
        for line in body:
            if line == "":
                if buf:
                    paras.append(" ".join(buf)); buf = []
            else:
                buf.append(line)
        if buf:
            paras.append(" ".join(buf))
        return "\n".join(paras) + suffix
    return "\n".join(body) + suffix


def check_skill(d: Path) -> None:
    name = d.name
    sk = d / "SKILL.md"

    if not sk.is_file():
        deeper = list(d.rglob("SKILL.md"))
        if deeper:
            errors.append(f"{name}: SKILL.md nested too deep ({deeper[0].relative_to(SKILLS)}); "
                          f"it must be at skills/{name}/SKILL.md")
        else:
            errors.append(f"{name}: missing skills/{name}/SKILL.md")
        return

    text = sk.read_text(encoding="utf-8")

    # frontmatter must start at the very first byte
    if not text.startswith("---\n"):
        errors.append(f"{name}: SKILL.md must begin with '---' on line 1 "
                      f"(no blank line/content before frontmatter) — else it is silently skipped")
        return
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        errors.append(f"{name}: SKILL.md frontmatter block is not closed with a second '---'")
        return
    fm = m.group(1)

    nm = re.search(r"(?m)^name:\s*(.*)$", fm)
    if not nm or not nm.group(1).strip():
        errors.append(f"{name}: frontmatter missing a non-empty 'name:'")
    elif nm.group(1).strip().strip('"\'') != name:
        warnings.append(f"{name}: folder name != frontmatter name "
                        f"'{nm.group(1).strip()}' (frontmatter wins; keep them matching)")

    desc = re.search(r"(?m)^description:\s*(.*)$", fm)
    if not desc:
        errors.append(f"{name}: frontmatter missing a 'description:'")
    else:
        val = desc.group(1).strip()
        if val in ("", "|", "|-", "|+", ">", ">-", ">+"):
            # block scalar — require at least one indented non-blank line after it
            after = fm[desc.end():]
            if not re.search(r"(?m)^\s+\S", after):
                errors.append(f"{name}: 'description:' block is empty")

        parsed = _description_value(fm)
        if parsed:
            n = len(parsed)
            if n > DESCRIPTION_MAX_CHARS:
                errors.append(
                    f"{name}: description is {n} chars, over the {DESCRIPTION_MAX_CHARS} limit — "
                    f"it will be SILENTLY TRUNCATED, losing the trailing scope that stops the "
                    f"skill firing on the wrong requests. Cut {n - DESCRIPTION_MAX_CHARS} chars.")
            elif n > DESCRIPTION_WARN_CHARS:
                warnings.append(
                    f"{name}: description is {n} chars, close to the {DESCRIPTION_MAX_CHARS} "
                    f"truncation limit ({DESCRIPTION_MAX_CHARS - n} spare)")


def scan_leakage(d: Path) -> None:
    for f in d.rglob("*"):
        if f.is_file() and f.suffix in SCANNABLE:
            t = f.read_text(encoding="utf-8", errors="ignore")
            if "/home/" in t:
                warnings.append(f"{d.name}: absolute '/home/...' path in "
                                f"{f.relative_to(SKILLS)} (won't exist for installers)")


def main() -> int:
    if not SKILLS.is_dir():
        print("FAIL: no skills/ directory found"); return 1
    skill_dirs = sorted(p for p in SKILLS.iterdir() if p.is_dir())
    if not skill_dirs:
        print("FAIL: no skills found under skills/"); return 1

    for d in skill_dirs:
        check_skill(d)
        scan_leakage(d)

    for w in warnings:
        print("WARN:", w)
    for e in errors:
        print("FAIL:", e)
    print(f"\n{len(skill_dirs)} skill(s) checked · {len(errors)} error(s) · {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
