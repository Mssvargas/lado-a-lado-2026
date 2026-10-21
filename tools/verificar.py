"""Confere os dados do site antes de publicar.

- Todo candidato de data/eleicao.json tem arquivo de plano.
- Todo "trecho" de data/comparativo.json existe literalmente na página indicada.
- Toda classificação de data/espectro.json aponta para um item que existe.
- Toda evidência do quadro de liberdade de expressão existe no plano.
- O número de checagens é igual para todos os candidatos.

Uso (na raiz do repositório):
    python tools/verificar.py
Sai com erro (código 1) se algo falhar.
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(rel: str) -> dict:
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def loose(text: str) -> str:
    text = re.sub(r"-\s*\n\s*", "", text)
    text = "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9%]+", " ", text).strip()


def found(pages: dict[int, str], page: object, quote: str) -> bool:
    segs = [loose(s) for s in re.split(r"\.\.\.|…", quote)]
    segs = [s for s in segs if len(s) > 10]
    text = pages.get(int(page)) if isinstance(page, (int, str)) and str(page).isdigit() else None
    return bool(text and segs and all(s in text for s in segs))


STATUS_OFICIAL = {"cumprida", "parcial", "nao_cumprida", "em_andamento", "nao_verificavel"}
# Reportagem não vale como prova na verificação oficial.
IMPRENSA = re.compile(r"(g1\.globo|globo\.com|folha\.uol|uol\.com\.br|estadao|metropoles|cnnbrasil|poder360|lupa|aosfatos|congressoemfoco|valor\.globo|veja\.abril|bbc\.)")


def verificar_verificacao(eleicao: dict) -> list[str]:
    """data/verificacao/*.json: status válido, item existente, evidência oficial com link."""
    erros: list[str] = []
    pasta = ROOT / "data" / "verificacao"
    if not pasta.is_dir():
        return erros
    levs = {lv["id"]: lv for lv in load("data/promessas.json")["levantamentos"]}
    vistos: set[tuple[str, int]] = set()
    for f in sorted(pasta.glob("*.json")):
        for it in json.loads(f.read_text(encoding="utf-8")).get("itens", []):
            chave = (it.get("levantamento"), it.get("indice"))
            lv = levs.get(chave[0])
            onde = f"verificação {f.name} {chave[0]}#{chave[1]}"
            if not lv or not isinstance(chave[1], int) or not 0 <= chave[1] < len(lv.get("itens", [])):
                erros.append(f"{onde}: não corresponde a uma promessa de data/promessas.json")
                continue
            if chave in vistos:
                erros.append(f"{onde}: verificada mais de uma vez")
            vistos.add(chave)
            st = it.get("status")
            if st not in STATUS_OFICIAL:
                erros.append(f"{onde}: status desconhecido {st}")
            atual = str(eleicao["ano"]) in str(lv.get("governo", ""))
            if st == "em_andamento" and not atual:
                erros.append(f"{onde}: 'em_andamento' só vale para o mandato atual")
            for ev in it.get("evidencias", []):
                url = str(ev.get("url") or "")
                if url and not url.startswith("https://") and not url.startswith("http://"):
                    erros.append(f"{onde}: link inválido {url[:60]}")
                if IMPRENSA.search(url):
                    erros.append(f"{onde}: reportagem usada como evidência oficial ({url[:60]})")
            if st != "nao_verificavel" and not it.get("evidencias"):
                erros.append(f"{onde}: status '{st}' sem evidência oficial")
    return erros


def verificar_acervo() -> list[str]:
    """data/acervo.json aponta para arquivos que existem e têm artigos."""
    erros: list[str] = []
    indice = ROOT / "data" / "acervo.json"
    if not indice.exists():
        return erros
    for d in json.loads(indice.read_text(encoding="utf-8"))["documentos"]:
        path = ROOT / d["arquivo"]
        if not path.exists():
            erros.append(f"acervo {d['id']}: arquivo não encontrado")
            continue
        artigos = json.loads(path.read_text(encoding="utf-8"))["artigos"]
        nomes = [a["n"] for a in artigos]
        if not artigos:
            erros.append(f"acervo {d['id']}: nenhum artigo extraído")
        if len(nomes) != len(set(nomes)):
            erros.append(f"acervo {d['id']}: artigos repetidos")
    return erros


def main() -> None:
    erros: list[str] = []
    eleicao = load("data/eleicao.json")
    ids = [c["id"] for c in eleicao["candidatos"]]
    planos: dict[str, dict[int, str]] = {}
    for c in eleicao["candidatos"]:
        path = ROOT / c["arquivo"]
        if not path.exists():
            erros.append(f"{c['id']}: arquivo de plano não encontrado ({c['arquivo']})")
            continue
        planos[c["id"]] = {p["p"]: loose(p["t"]) for p in json.loads(path.read_text(encoding="utf-8"))["pages"]}

    comp = load("data/comparativo.json")
    n_itens = {k: 0 for k in ids}
    for t in comp["temas"]:
        presentes = {it["candidato"] for it in t["itens"]}
        for k in ids:
            if k not in presentes:
                erros.append(f"tema {t['id']}: sem itens de {k}")
        for i, it in enumerate(t["itens"]):
            k = it["candidato"]
            if k not in ids:
                erros.append(f"tema {t['id']}#{i}: candidato '{k}' não está em eleicao.json")
                continue
            n_itens[k] += 1
            if it.get("trecho") and k in planos and not found(planos[k], it.get("pagina"), it["trecho"]):
                erros.append(f"tema {t['id']}#{i} ({k}, p. {it.get('pagina')}): trecho não encontrado: {it['trecho'][:70]}")

    esp = load("data/espectro.json")
    codigos = {c["codigo"] for c in esp["categorias"]}
    temas = {t["id"]: t for t in comp["temas"]}
    for x in esp["itens"]:
        t = temas.get(x["tema"])
        if not t or x["indice"] >= len(t["itens"]) or t["itens"][x["indice"]]["candidato"] != x["candidato"]:
            erros.append(f"espectro {x['tema']}#{x['indice']}: não corresponde a um item do comparativo")
        if x["categoria"] not in codigos:
            erros.append(f"espectro {x['tema']}#{x['indice']}: categoria desconhecida {x['categoria']}")
    for k, bloco in (esp.get("liberdade_expressao") or {}).get("candidatos", {}).items():
        for crit, resp in bloco.items():
            for ev in resp.get("evidencias", []):
                if k in planos and not found(planos[k], ev["pagina"], ev["trecho"]):
                    erros.append(f"liberdade de expressão {k}/{crit}: trecho não encontrado (p. {ev['pagina']})")

    resumo = load("data/resumo.json")
    por_tema = {t["id"]: t["resumos"] for t in resumo["temas"]}
    for t in comp["temas"]:
        r = por_tema.get(t["id"])
        if not r:
            erros.append(f"resumo: falta o tema {t['id']}")
            continue
        for k in ids:
            texto = r.get(k, "")
            if not texto:
                erros.append(f"resumo {t['id']}: falta {k}")
            elif len(re.findall(r"[.!?](\s|$)", texto)) > 2:
                erros.append(f"resumo {t['id']}/{k}: mais de 2 frases")
    palavras = {k: sum(len(r.get(k, "").split()) for r in por_tema.values()) for k in ids}
    if palavras and max(palavras.values()) > 1.15 * max(1, min(palavras.values())):
        erros.append(f"resumo desequilibrado em extensão: {palavras}")

    pasta_av = ROOT / "data" / "avaliacao"
    if pasta_av.is_dir():
        por_tema: dict[str, dict[str, int]] = {}
        for f in sorted(pasta_av.glob("*.json")):
            for a in json.loads(f.read_text(encoding="utf-8")).get("itens", []):
                t = temas.get(a.get("tema"))
                ok = t and isinstance(a.get("indice"), int) and a["indice"] < len(t["itens"]) and t["itens"][a["indice"]]["candidato"] == a.get("candidato")
                if not ok:
                    erros.append(f"avaliação {f.name} {a.get('tema')}#{a.get('indice')}: não corresponde a um item do comparativo")
                    continue
                por_tema.setdefault(a["tema"], {k: 0 for k in ids})[a["candidato"]] += 1
        for tema_id, cont in por_tema.items():
            if len(set(cont.values())) > 1:
                erros.append(f"avaliação {tema_id}: número de propostas avaliadas diferente por candidato {cont}")

    erros.extend(verificar_verificacao(eleicao))
    erros.extend(verificar_acervo())

    chk = load("data/checagens.json")["checagens"]
    contagem = {k: sum(1 for c in chk if c["candidato"] == k) for k in ids}
    if len(set(contagem.values())) > 1:
        erros.append(f"checagens desequilibradas: {contagem}")

    print("itens no comparativo:", n_itens, "| checagens:", contagem)
    if erros:
        print(f"\n{len(erros)} problema(s):")
        for e in erros:
            print(" -", e)
        sys.exit(1)
    print("Tudo certo.")


if __name__ == "__main__":
    main()
