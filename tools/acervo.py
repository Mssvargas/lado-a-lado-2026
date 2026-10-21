"""Baixa e organiza o Acervo Constitucional a partir do Planalto (texto compilado oficial).

Cada documento vira data/acervo/<id>.json com os artigos separados, sem os trechos
revogados (que o Planalto mostra riscados). O índice fica em data/acervo.json.

Uso (na raiz do repositório):
    python tools/acervo.py            # baixa todos
    python tools/acervo.py cf lgpd    # só os indicados
"""

import html
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "acervo"
P = "https://www.planalto.gov.br/ccivil_03/"

DOCS: list[dict[str, str]] = [
    {"id": "cf", "titulo": "Constituição Federal de 1988 (com o ADCT)", "tipo": "Constituição", "url": P + "constituicao/constituicao.htm"},
    {"id": "codigo-penal", "titulo": "Código Penal (Decreto-Lei 2.848/1940)", "tipo": "Código", "url": P + "decreto-lei/del2848compilado.htm"},
    {"id": "clt", "titulo": "Consolidação das Leis do Trabalho (Decreto-Lei 5.452/1943)", "tipo": "Código", "url": P + "decreto-lei/del5452compilado.htm"},
    {"id": "cdc", "titulo": "Código de Defesa do Consumidor (Lei 8.078/1990)", "tipo": "Código", "url": P + "leis/l8078compilado.htm"},
    {"id": "eca", "titulo": "Estatuto da Criança e do Adolescente (Lei 8.069/1990)", "tipo": "Estatuto", "url": P + "leis/l8069compilado.htm"},
    {"id": "maria-da-penha", "titulo": "Lei Maria da Penha (Lei 11.340/2006)", "tipo": "Lei", "url": P + "_ato2004-2006/2006/lei/l11340.htm"},
    {"id": "lrf", "titulo": "Lei de Responsabilidade Fiscal (LC 101/2000)", "tipo": "Lei complementar", "url": P + "leis/lcp/lcp101.htm"},
    {"id": "arcabouco-fiscal", "titulo": "Regime Fiscal Sustentável, o arcabouço fiscal (LC 200/2023)", "tipo": "Lei complementar", "url": P + "leis/lcp/lcp200.htm"},
    {"id": "reforma-tributaria", "titulo": "IBS, CBS e Imposto Seletivo (LC 214/2025)", "tipo": "Lei complementar", "url": P + "leis/lcp/lcp214.htm"},
    {"id": "lei-eleicoes", "titulo": "Lei das Eleições (Lei 9.504/1997)", "tipo": "Lei", "url": P + "leis/l9504.htm"},
    {"id": "codigo-eleitoral", "titulo": "Código Eleitoral (Lei 4.737/1965)", "tipo": "Código", "url": P + "leis/l4737compilado.htm"},
    {"id": "lai", "titulo": "Lei de Acesso à Informação (Lei 12.527/2011)", "tipo": "Lei", "url": P + "_ato2011-2014/2011/lei/l12527.htm"},
    {"id": "lgpd", "titulo": "Lei Geral de Proteção de Dados (Lei 13.709/2018)", "tipo": "Lei", "url": P + "_ato2015-2018/2018/lei/l13709.htm"},
    {"id": "estatuto-idosa", "titulo": "Estatuto da Pessoa Idosa (Lei 10.741/2003)", "tipo": "Estatuto", "url": P + "leis/2003/l10.741.htm"},
    {"id": "lei-sus", "titulo": "Lei Orgânica da Saúde, o SUS (Lei 8.080/1990)", "tipo": "Lei", "url": P + "leis/l8080.htm"},
    {"id": "ldb", "titulo": "Lei de Diretrizes e Bases da Educação (Lei 9.394/1996)", "tipo": "Lei", "url": P + "leis/l9394.htm"},
]

ORDEM = ["PARTE", "LIVRO", "TITULO", "CAPITULO", "SECAO", "SUBSECAO"]
# "Art." com maiúscula: "art. 5º" minúsculo é citação dentro do texto, não início de artigo
# sufixo de letra colado ao número ("103-A", "401A"); "Art. 3º - A lei" é separador + texto
ART = re.compile(r"^Art\s*(?:\.\s*)+(\d+(?:\.\d{3})*\s*[º°oª]?(?:-?[A-Z]{1,2}\b)?)\.?\s*(.*)$")
HEAD = re.compile(
    r"^(PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|Se[çc][ãa]o|SUBSE[ÇC][ÃA]O|Subse[çc][ãa]o)\s+"
    r"([IVXLC]+|[ÚU]NIC[OA]|[ÚU]nic[oa]|GERAL|Geral|ESPECIAL|Especial|PRELIMINAR|Preliminar)\b"
)
ADCT = re.compile(r"ATO DAS DISPOSI[ÇC][ÕO]ES CONSTITUCIONAIS TRANSIT[ÓO]RIAS", re.I)
FECHO = re.compile(r"^Bras[íi]lia,\s*\d")  # local e data da assinatura: fim do texto normativo


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128"})
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):  # algumas páginas do Planalto são UTF-16
        return raw.decode("utf-16", errors="ignore")
    for enc in ("utf-8", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def to_lines(page: str) -> list[str]:
    page = re.sub(r"[\r\n]+", " ", page)  # quebra de linha do código-fonte não é parágrafo
    page = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", page)
    page = re.sub(r"(?is)<(strike|s|del)\b[^>]*>.*?</\1>", " ", page)  # texto revogado
    page = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</h\d>|</li>|</tr>", "\n", page)
    page = re.sub(r"(?s)<[^>]+>", " ", page)
    page = html.unescape(page).replace("\xa0", " ")
    lines = [re.sub(r"[ \t\r\f\v]+", " ", ln).strip() for ln in page.split("\n")]
    return [ln for ln in lines if ln]


def nivel_de(ln: str) -> str:
    n = HEAD.match(ln).group(1).upper()
    return n.replace("Í", "I").replace("Ç", "C").replace("Ã", "A").replace("ç", "C").replace("ã", "A")


def parse(doc: dict[str, str]) -> dict[str, object]:
    lines = to_lines(fetch(doc["url"]))
    artigos: list[dict[str, str]] = []
    hier: dict[str, str] = {}
    parte = ""
    cur: dict[str, str] | None = None
    pend = ""
    preambulo: list[str] = []
    for ln in lines:
        # o título do ADCT também aparece no sumário do topo; só vale depois do corpo da CF
        if ADCT.search(ln) and len(ln) < 90 and len(artigos) > 200:
            parte, hier, cur, pend = "ADCT", {}, None, ""
            continue
        if HEAD.match(ln) and len(ln) < 120:
            nivel = nivel_de(ln)
            if nivel in ORDEM:
                hier = {k: v for k, v in hier.items() if ORDEM.index(k) < ORDEM.index(nivel)}
            hier[nivel] = ln
            pend, cur = nivel, None
            continue
        if pend and not ART.match(ln) and len(ln) < 150 and not ln.startswith("("):
            nome = ln.capitalize() if ln.upper() == ln else ln
            hier[pend] = hier[pend] + " · " + nome
            pend = ""
            continue
        pend = ""
        if FECHO.match(ln):
            cur = None
            continue
        m = ART.match(ln)
        if m:
            num = re.sub(r"\s+", "", m.group(1)).rstrip(".")
            num = re.sub(r"(\d)[o°]", r"\1º", num)  # leis antigas escrevem "1o" com o sobrescrito
            num = re.sub(r"([\dº])([A-Z])", r"\1-\2", num)  # "401A" -> "401-A"
            caminho = " › ".join(v for k, v in sorted(hier.items(), key=lambda kv: ORDEM.index(kv[0]) if kv[0] in ORDEM else 9))
            cur = {"n": ("ADCT, " if parte else "") + "Art. " + num, "hier": caminho, "t": ln}
            artigos.append(cur)
            continue
        if cur is not None:
            if len(cur["t"]) < 20000:
                cur["t"] += "\n" + ln
        elif not artigos and len(preambulo) < 60:
            preambulo.append(ln)
    # o texto compilado às vezes mantém, sem riscar, a redação antiga logo antes da nova;
    # a última ocorrência de cada número é a vigente
    vigente: dict[str, dict[str, str]] = {}
    for a in artigos:
        a["t"] = re.sub(r"\n{2,}", "\n", a["t"]).strip()
        vigente.pop(a["n"], None)
        vigente[a["n"]] = a
    artigos = list(vigente.values())
    return {
        "id": doc["id"], "titulo": doc["titulo"], "tipo": doc["tipo"], "url": doc["url"],
        "baixado_em": date.today().isoformat(),
        "preambulo": "\n".join(preambulo[-4:]) if doc["id"] == "cf" else "",
        "artigos": [a for a in artigos if len(a["t"]) > 12],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    quais = set(sys.argv[1:])
    indice_path = ROOT / "data" / "acervo.json"
    indice: dict[str, dict[str, object]] = {}
    if indice_path.exists():
        indice = {d["id"]: d for d in json.loads(indice_path.read_text(encoding="utf-8"))["documentos"]}
    for doc in DOCS:
        if quais and doc["id"] not in quais:
            continue
        try:
            dados = parse(doc)
        except Exception as e:  # noqa: BLE001 - registra e segue para o próximo documento
            print(f"{doc['id']}: ERRO {e}")
            continue
        (OUT / f"{doc['id']}.json").write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
        meta = {k: dados[k] for k in ("id", "titulo", "tipo", "url", "baixado_em")}
        indice[doc["id"]] = meta | {"artigos": len(dados["artigos"]), "arquivo": f"data/acervo/{doc['id']}.json"}
        print(f"{doc['id']}: {len(dados['artigos'])} artigos")
    ordem = [d["id"] for d in DOCS]
    lista = sorted(indice.values(), key=lambda d: ordem.index(str(d["id"])) if d["id"] in ordem else 99)
    indice_path.write_text(json.dumps({"documentos": lista}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
