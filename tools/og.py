"""Gera og.png (prévia do link em WhatsApp e redes) a partir de data/eleicao.json.

Uso: python tools/og.py
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
F = "C:/Windows/Fonts/"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(F + name, size)


def main() -> None:
    eleicao = json.loads((ROOT / "data" / "eleicao.json").read_text(encoding="utf-8"))
    cands = eleicao["candidatos"]
    w, h = 1200, 630
    bg, ink, muted, accent, line = "#F5F6F8", "#161B26", "#586174", "#4A47A3", "#DCE0E8"
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 14], fill=accent)
    d.text((72, 70), f"ELEIÇÃO PRESIDENCIAL {eleicao['ano']} · PLANOS DE GOVERNO OFICIAIS", font=font("seguisb.ttf", 26), fill=muted)
    d.text((72, 118), f"Lado a Lado {eleicao['ano']}", font=font("georgiab.ttf", 92), fill=ink)
    d.text((72, 250), "O que cada plano propõe, tema por tema,", font=font("segoeui.ttf", 40), fill=ink)
    d.text((72, 302), "em linguagem simples, com a página de cada trecho.", font=font("segoeui.ttf", 40), fill=ink)
    shown = cands[:4]
    gap, x0, y = 24, 72, 420
    cw = (w - 2 * x0 - gap * (len(shown) - 1)) // len(shown)
    name_size = 36 if len(shown) <= 2 else 26
    for i, c in enumerate(shown):
        x = x0 + i * (cw + gap)
        d.rounded_rectangle([x, y, x + cw, y + 120], radius=16, fill="#FFFFFF", outline=line, width=2)
        d.rounded_rectangle([x + 22, y + 26, x + 122, y + 94], radius=10, fill=ink)
        d.text((x + 72, y + 60), c["numero"], font=font("consolab.ttf", 44), fill="#FFFFFF", anchor="mm")
        label = f"{c['nome']} · {c['partido']}" if len(shown) <= 2 else c["nome"]
        d.text((x + 146, y + 60), label, font=font("seguisb.ttf", name_size), fill=ink, anchor="lm")
    extra = f" · e mais {len(cands) - 4} candidatos" if len(cands) > 4 else ""
    d.text((72, 580), "Página independente · sem vínculo com partidos, campanhas ou com o TSE" + extra, font=font("segoeui.ttf", 24), fill=muted)
    im.save(ROOT / "og.png", optimize=True)
    print("og.png", (ROOT / "og.png").stat().st_size)


if __name__ == "__main__":
    main()
