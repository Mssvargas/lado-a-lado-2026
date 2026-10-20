"""Gera index.html a partir de tools/template.html e dos dados em data/.

A eleição atual (ano, candidatos, exemplos) vem de data/eleicao.json.

Uso (na raiz do repositório):
    python tools/build.py [URL_DO_SITE]
"""

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = sys.argv[1] if len(sys.argv) > 1 else "https://lado-a-lado-2026-six.vercel.app/"
REPO_URL = "https://github.com/Mssvargas/lado-a-lado-2026"


def load(name: str) -> object:
    return json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))


def blob(data: object) -> str:
    return json.dumps(data, ensure_ascii=False).replace("</", "<\\/")


def names(cands: list[dict[str, str]]) -> str:
    nomes = [c["nome"] for c in cands]
    return nomes[0] if len(nomes) == 1 else ", ".join(nomes[:-1]) + " e " + nomes[-1]


def ballot(cands: list[dict[str, str]]) -> str:
    e = html.escape
    return "".join(
        f'\n      <div class="c"><span class="num">{e(c["numero"])}</span><div><div class="nm">{e(c["nome"])}</div>'
        f'<div class="pl">{e(c["partido"])} · <i>{e(c["plano"])}</i></div></div></div>'
        for c in cands
    ) + "\n    "


def main() -> None:
    eleicao = load("eleicao.json")
    assert isinstance(eleicao, dict)
    cands = eleicao["candidatos"]
    html_text = (ROOT / "tools" / "template.html").read_text(encoding="utf-8")
    subs = {
        "/*__ELEICAO__*/null": blob(eleicao),
        "/*__COMPARATIVO__*/null": blob(load("comparativo.json")),
        "/*__CHECAGENS__*/null": blob(load("checagens.json")),
        "__BALLOT__": ballot(cands),
        "__NOMES__": html.escape(names(cands)),
        "__ANO__": str(eleicao["ano"]),
        "__EXEMPLO_ESPECTRO__": html.escape(eleicao.get("exemplo_espectro", "")),
        "__EXEMPLO_CHECAGEM__": html.escape((eleicao.get("exemplos_checagem") or [""])[0]),
        "__SITE_URL__": SITE_URL.rstrip("/") + "/",
        "__REPO_URL__": REPO_URL,
    }
    write("index.html", html_text, subs)

    # Página de resumo (leve, para compartilhar no WhatsApp)
    comp = load("comparativo.json")
    assert isinstance(comp, dict)
    temas = [
        {"id": t["id"], "nome": t["nome"], "em_comum": t.get("em_comum", ""),
         "itens": [{"candidato": i["candidato"], "proposta": i["proposta"], "pagina": i.get("pagina")} for i in t["itens"]]}
        for t in comp["temas"]
    ]
    resumo_subs = dict(subs)
    resumo_subs.update({
        "/*__TEMAS__*/null": blob(temas),
        "/*__RESUMO__*/null": blob(load("resumo.json")),
        "__TURNO__": html.escape(eleicao.get("turno", "")),
    })
    write("resumo.html", (ROOT / "tools" / "resumo-template.html").read_text(encoding="utf-8"), resumo_subs)


def write(name: str, text: str, subs: dict[str, str]) -> None:
    for key, value in subs.items():
        text = text.replace(key, value)
    left = [k for k in subs if k in text]
    if left:
        raise SystemExit(f"{name}: marcadores sem substituir: {left}")
    (ROOT / name).write_text(text, encoding="utf-8", newline="\n")
    print(name, len(text))


if __name__ == "__main__":
    main()
