#!/usr/bin/env python3
"""Validate every skill under skills/ before it ships.

Catches the silent-skip traps: SKILL.md missing / nested too deep, frontmatter
not at the very top, missing name/description, folder name != frontmatter name.
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

errors: list[str] = []
warnings: list[str] = []


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
