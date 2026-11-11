#!/usr/bin/env python3
"""Génère le logo (PNG 16/48/128 + SVG) de Diversity Lingua."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
out = Path(__file__).resolve().parents[1] / "extension" / "public" / "icons"
out.mkdir(parents=True, exist_ok=True)
def icon(size):
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S // 4, fill=(11, 31, 42, 255))
    bw = int(S * .64); bx, by = int(S * .18), int(S * .2)
    d.rounded_rectangle([bx, by, bx + bw, by + int(S * .44)], radius=S // 9, fill=(255, 255, 255, 255))
    d.polygon([(bx + int(S * .12), by + int(S * .43)), (bx + int(S * .12), by + int(S * .62)), (bx + int(S * .3), by + int(S * .43))], fill=(255, 255, 255, 255))
    d.ellipse([int(S * .62), int(S * .52), int(S * .86), int(S * .76)], fill=(14, 107, 92, 255))
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int(S * .26))
        d.text((bx + bw // 2, by + int(S * .22)), "DL", fill=(11, 31, 42, 255), font=f, anchor="mm")
    except OSError:
        pass
    return img.resize((size, size), Image.LANCZOS)
for s in (16, 48, 128): icon(s).save(out / f"icon-{s}.png")
(out / "logo.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="32" fill="#0B1F2A"/><rect x="23" y="26" width="82" height="56" rx="14" fill="#fff"/><path d="M38 80v24l24-24z" fill="#fff"/><circle cx="92" cy="82" r="15" fill="#0E6B5C"/><text x="64" y="63" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="30" fill="#0B1F2A">DL</text></svg>')
print("icônes générées")
