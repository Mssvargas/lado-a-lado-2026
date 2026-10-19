"""Gera index.html a partir de tools/template.html e dos dados em data/.

Uso (na raiz do repositório):
    python tools/build.py [URL_DO_SITE]
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = sys.argv[1] if len(sys.argv) > 1 else "https://mssvargas.github.io/lado-a-lado-2026/"
REPO_URL = "https://github.com/Mssvargas/lado-a-lado-2026"


def blob(name: str) -> str:
    data = json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))
    return json.dumps(data, ensure_ascii=False).replace("</", "<\\/")


def main() -> None:
    html = (ROOT / "tools" / "template.html").read_text(encoding="utf-8")
    html = html.replace("/*__COMPARATIVO__*/null", blob("comparativo.json"))
    html = html.replace("/*__CHECAGENS__*/null", blob("checagens.json"))
    html = html.replace("__SITE_URL__", SITE_URL.rstrip("/") + "/")
    html = html.replace("__REPO_URL__", REPO_URL)
    (ROOT / "index.html").write_text(html, encoding="utf-8", newline="\n")
    print("index.html", len(html))


if __name__ == "__main__":
    main()
