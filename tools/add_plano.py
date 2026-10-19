"""Adiciona o plano de governo de qualquer candidato ao site.

Converte o PDF em texto por página (data/planos/<id>.json) e registra o plano em
data/planos.json, que alimenta a aba "Planos na íntegra" e a busca.

Uso (na raiz do repositório):
    python tools/add_plano.py caminho/plano.pdf --id lula-2022 --candidato "Lula" \
        --partido PT --ano 2022 --titulo "Diretrizes para..." --pdf-url https://...

Requer o pdftotext (Poppler; vem com o Git for Windows em mingw64/bin).
"""

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "data" / "planos.json"


def extract_pages(pdf: Path) -> list[dict[str, object]]:
    exe = shutil.which("pdftotext")
    if not exe:
        raise SystemExit("pdftotext não encontrado no PATH.")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "plano.txt"
        subprocess.run([exe, "-enc", "UTF-8", str(pdf), str(out)], check=True)
        raw = out.read_text(encoding="utf-8")
    pages: list[dict[str, object]] = []
    for number, text in enumerate(raw.split("\f"), start=1):
        clean = re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", text)).strip()
        if clean:
            pages.append({"p": number, "t": clean})
    return pages


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--id", required=True, help="slug único, ex.: lula-2022")
    ap.add_argument("--candidato", required=True)
    ap.add_argument("--partido", required=True)
    ap.add_argument("--ano", required=True, type=int)
    ap.add_argument("--titulo", required=True)
    ap.add_argument("--pdf-url", default=None, help="link público do PDF original")
    args = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9-]+", args.id):
        raise SystemExit("--id deve ter só letras minúsculas, números e hífen.")
    pages = extract_pages(args.pdf)
    if not pages:
        raise SystemExit("O PDF não tem texto extraível (pode ser imagem escaneada).")

    dest = ROOT / "data" / "planos" / f"{args.id}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"pages": pages}, ensure_ascii=False), encoding="utf-8")

    index: list[dict[str, object]] = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else []
    entry: dict[str, object] = {
        "id": args.id,
        "candidato": args.candidato,
        "partido": args.partido,
        "ano": args.ano,
        "titulo": args.titulo,
        "arquivo": f"data/planos/{args.id}.json",
        "pdf": args.pdf_url,
    }
    index = [e for e in index if e.get("id") != args.id] + [entry]
    index.sort(key=lambda e: (-int(str(e["ano"])), str(e["candidato"])))
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{args.id}: {len(pages)} páginas -> {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
