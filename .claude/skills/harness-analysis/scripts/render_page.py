#!/usr/bin/env python3
"""Render the HAF-1 visual page from one scorecard (or two, for a comparison). Stdlib only.

  render_page.py A.json [B.json] --out page.html [--lang pt-BR]

The page is self-contained HTML (no build step): assets/page.html with the scorecards embedded as JSON.
--lang defaults to the first scorecard's "lang" field, then "en".
"""
import json
import os
from html import escape as html_escape
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "..", "assets", "page.html")


def embed(card):
    # JSON inside <script>: keep "</script>" and "<!--" from closing or commenting the tag.
    return json.dumps(card, ensure_ascii=False).replace("</", "<\\/").replace("<!--", "<\\!--")


def main(argv):
    args, opts, i = [], {}, 1
    while i < len(argv):
        if argv[i].startswith("--"):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            args.append(argv[i])
            i += 1
    if not args or "out" not in opts or len(args) > 2:
        print(__doc__)
        return 2
    cards = []
    for p in args:
        with open(p, encoding="utf-8") as f:
            cards.append(json.load(f))
    lang = opts.get("lang") or cards[0].get("lang") or "en"
    with open(TEMPLATE, encoding="utf-8") as f:
        html = f.read()
    # Placeholders survive formatters: `/*SCORECARD_A*/ null`, `/*LANG*/ 'en'`.
    slots = {
        r"/\*SCORECARD_A\*/\s*null": embed(cards[0]),
        r"/\*SCORECARD_B\*/\s*null": embed(cards[1]) if len(cards) > 1 else "null",
        r"/\*LANG\*/\s*(['\"])en\1": json.dumps(lang),
        r"<title>Harness Scorecard</title>": f"<title>{html_escape(cards[0]['repo'])} Harness Scorecard</title>",
    }
    for pattern, value in slots.items():
        html, n = re.subn(pattern, lambda _m, v=value: v, html, count=1)
        if n != 1:
            print(f"template slot not found: {pattern}", file=sys.stderr)
            return 1
    with open(opts["out"], "w", encoding="utf-8") as f:
        f.write(html)
    print(opts["out"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
