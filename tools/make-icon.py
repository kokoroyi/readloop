"""生成 tray/ReadLoop.ico（纸色底 + 书页/文字线 + 棕色书脊）。

用法：python tools/make-icon.py
依赖：Pillow。仅开发期使用，产物 ico 已提交，不需要每次构建。
"""

from pathlib import Path

from PIL import Image, ImageDraw

PAPER = (246, 241, 231, 255)
INK = (42, 37, 32, 255)
BROWN = (138, 90, 59, 255)
MUTED = (170, 150, 128, 255)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tray" / "ReadLoop.ico"


def draw_icon(size: int) -> Image.Image:
    scale = 8
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = int(s * 0.06)
    radius = int(s * 0.2)
    d.rounded_rectangle((pad, pad, s - pad, s - pad), radius=radius, fill=PAPER, outline=BROWN, width=max(1, int(s * 0.05)))

    # 书页区域
    left = int(s * 0.24)
    right = int(s * 0.74)
    top = int(s * 0.24)
    bottom = int(s * 0.78)
    d.rounded_rectangle((left, top, right, bottom), radius=int(s * 0.03), fill=(255, 253, 246, 255), outline=INK, width=max(1, int(s * 0.035)))

    # 书脊
    d.rectangle((left, top, left + int(s * 0.05), bottom), fill=BROWN)
    # 文字线
    line_x0 = left + int(s * 0.13)
    line_x1 = right - int(s * 0.09)
    for i, frac in enumerate((0.2, 0.38, 0.56, 0.74)):
        y = top + int((bottom - top) * frac)
        width = max(1, int(s * 0.03))
        x1 = line_x1 if i < 3 else line_x1 - int((line_x1 - line_x0) * 0.35)
        d.line((line_x0, y, x1, y), fill=INK if i < 2 else MUTED, width=width)

    # 书签
    bx = right - int(s * 0.06)
    d.polygon(
        [
            (bx, top),
            (bx + int(s * 0.12), top),
            (bx + int(s * 0.12), top + int(s * 0.22)),
            (bx + int(s * 0.06), top + int(s * 0.16)),
            (bx, top + int(s * 0.22)),
        ],
        fill=(176, 106, 66, 255),
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    sizes = [16, 32, 48, 64, 128, 256]
    frames = [draw_icon(n) for n in sizes]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[-1].save(OUT, format="ICO", sizes=[(n, n) for n in sizes], append_images=frames[:-1])
    # 同时导出一张 PNG 供前端 favicon 参考
    frames[-1].save(ROOT / "tray" / "ReadLoop.png")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
