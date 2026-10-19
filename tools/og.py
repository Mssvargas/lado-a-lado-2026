"""Gera og.png (prévia do link em WhatsApp e redes). Uso: python tools/og.py"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
F = "C:/Windows/Fonts/"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(F + name, size)


def main() -> None:
    w, h = 1200, 630
    bg, ink, muted, accent, line = "#F5F6F8", "#161B26", "#586174", "#4A47A3", "#DCE0E8"
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 14], fill=accent)
    d.text((72, 70), "ELEIÇÃO PRESIDENCIAL 2026 · PLANOS DE GOVERNO OFICIAIS", font=font("seguisb.ttf", 26), fill=muted)
    d.text((72, 118), "Lado a Lado 2026", font=font("georgiab.ttf", 92), fill=ink)
    d.text((72, 250), "O que cada plano propõe, tema por tema,", font=font("segoeui.ttf", 40), fill=ink)
    d.text((72, 302), "em linguagem simples, com a página de cada trecho.", font=font("segoeui.ttf", 40), fill=ink)
    y = 420
    for x0, num, nome in ((72, "13", "Lula · PT"), (612, "22", "Flávio Bolsonaro · PL")):
        d.rounded_rectangle([x0, y, x0 + 516, y + 120], radius=16, fill="#FFFFFF", outline=line, width=2)
        d.rounded_rectangle([x0 + 22, y + 26, x0 + 122, y + 94], radius=10, fill=ink)
        d.text((x0 + 72, y + 60), num, font=font("consolab.ttf", 44), fill="#FFFFFF", anchor="mm")
        d.text((x0 + 146, y + 60), nome, font=font("seguisb.ttf", 36), fill=ink, anchor="lm")
    d.text((72, 580), "Página independente · sem vínculo com partidos, campanhas ou com o TSE", font=font("segoeui.ttf", 24), fill=muted)
    im.save(ROOT / "og.png", optimize=True)
    print("og.png", (ROOT / "og.png").stat().st_size)


if __name__ == "__main__":
    main()
