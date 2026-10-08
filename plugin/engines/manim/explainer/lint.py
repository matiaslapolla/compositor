"""Narration lint: ASD-STE100 writing rules, adapted to Spanish voice-over.

Usage: python -m explainer.lint [--json] episodes/<slug>.py [...]
--json prints [{file, line, level, message}] instead of text lines.
Exit code 1 when any error is found; warnings never fail.
"""

import ast
import json
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

from explainer.engines import house, resolve
from explainer.narration import parse, strip_bookmarks

GLOSSARY = resolve("glossary.toml")  # resolved from COMPOSITOR_EXPLAIN_HOME
NARRATING_CALLS = {"voiceover", "narrate", "show_title"}
MAX_WORDS = 25  # STE: descriptive sentences
WARN_WORDS = 20  # STE: procedural sentences
MAX_SENTENCES = 3  # one beat = one idea; split longer blocks
UNSPEAKABLE = re.compile(r"[()\[\]{}=^_*/\\<>%#|~]|\d[.,]\d")


@dataclass(frozen=True)
class Finding:
    line: int
    level: str
    message: str

    def __str__(self) -> str:
        return f"{self.line}: {self.level}: {self.message}"


def narration(source: str) -> list[tuple[int, str]]:
    """Every literal narration string in a scene file, with its line."""
    found = []
    for node in ast.walk(ast.parse(source)):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr not in NARRATING_CALLS:
            continue
        candidates = [k.value for k in node.keywords if k.arg in ("text", "line")]
        if node.func.attr != "show_title" and node.args:
            candidates.append(node.args[0])
        for c in candidates:
            if isinstance(c, ast.Constant) and isinstance(c.value, str):
                found.append((c.lineno, c.value))
    return sorted(found)


def load_glossary(lang: str, path: Path = GLOSSARY) -> dict[str, str]:
    """Map each forbidden synonym to the one approved term."""
    with path.open("rb") as f:
        terms = tomllib.load(f).get(lang, {})
    return {syn.lower(): term for term, synonyms in terms.items() for syn in synonyms}


def check(text: str, line: int, forbidden: dict[str, str]) -> list[Finding]:
    findings = []
    plain = strip_bookmarks(text)
    sentences = parse(plain)
    if len(sentences) > MAX_SENTENCES:
        findings.append(Finding(line, "warn", f"{len(sentences)} sentences in one beat; split it"))
    for s in sentences:
        n = sum(w.is_word for w in s.words)
        snippet = plain[s.start : s.end][:50]
        if n > MAX_WORDS:
            findings.append(Finding(line, "error", f"{n} words (max {MAX_WORDS}): {snippet!r}"))
        elif n > WARN_WORDS:
            findings.append(Finding(line, "warn", f"{n} words (aim ≤ {WARN_WORDS}): {snippet!r}"))
    lowered = plain.lower()
    for synonym, term in forbidden.items():
        if re.search(rf"\b{re.escape(synonym)}\b", lowered):
            findings.append(Finding(line, "error", f"'{synonym}' → use '{term}' (one word per concept)"))
    for match in UNSPEAKABLE.finditer(plain):
        findings.append(Finding(line, "warn", f"'{match.group()}' reads badly aloud; write it in words"))
    return findings


def lint(path: Path, forbidden: dict[str, str] | None = None) -> list[Finding]:
    if forbidden is None:
        forbidden = load_glossary(house().lexicon_lang)
    findings = []
    for line, text in narration(path.read_text()):
        findings += check(text, line, forbidden)
    return findings


def main(args: list[str]) -> int:
    as_json = "--json" in args  # machine-readable findings for the explain-lint gate
    paths = [a for a in args if a != "--json"]
    failed = False
    rows = []
    for p in paths:
        for f in lint(Path(p)):
            rows.append({"file": p, "line": f.line, "level": f.level, "message": f.message})
            failed |= f.level == "error"
    if as_json:
        print(json.dumps(rows, ensure_ascii=False))
    else:
        for r in rows:
            print(f"{r['file']}:{r['line']}: {r['level']}: {r['message']}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
