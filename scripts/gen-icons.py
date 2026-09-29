"""生成静态默认图标（= 图标三态的 "off" 态），逻辑与 src/lib/icon.ts 的 renderIcon 逐行对齐。

静态图标只在 background 还没来得及 setIcon 时兜底显示；三态仍由 background 现画。
"""

import struct
import zlib
from pathlib import Path

SIZE = 16, 32, 48, 128
BG = (107, 114, 128, 255)  # ICON_COLORS.off
GLYPH = [
    ".......",
    ".......",
    ".......",
    ".#####.",
    ".#####.",
    ".......",
    ".......",
]


def inside_rounded_rect(x: int, y: int, size: int, radius: int) -> bool:
    cx, cy = x + 0.5, y + 0.5
    near_x = min(cx, size - cx)
    near_y = min(cy, size - cy)
    if near_x >= radius or near_y >= radius:
        return True
    dx, dy = radius - near_x, radius - near_y
    return dx * dx + dy * dy <= radius * radius


def render(size: int) -> bytes:
    pixels = [[(0, 0, 0, 0)] * size for _ in range(size)]
    radius = max(1, round(size / 4))
    for y in range(size):
        for x in range(size):
            if inside_rounded_rect(x, y, size, radius):
                pixels[y][x] = BG

    rows = len(GLYPH)
    columns = len(GLYPH[0])
    scale = max(1, (size - 2) // max(rows, columns))
    origin_x = (size - columns * scale) // 2
    origin_y = (size - rows * scale) // 2
    for row, line in enumerate(GLYPH):
        for column, ch in enumerate(line):
            if ch != "#":
                continue
            for dy in range(scale):
                for dx in range(scale):
                    x = origin_x + column * scale + dx
                    y = origin_y + row * scale + dy
                    if 0 <= x < size and 0 <= y < size:
                        pixels[y][x] = (255, 255, 255, 255)

    raw = b"".join(b"\x00" + b"".join(struct.pack("4B", *px) for px in row) for row in pixels)
    return raw


def png(raw: bytes, size: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(render(size), 9))
        + chunk(b"IEND", b"")
    )


out = Path(__file__).resolve().parent.parent / "public" / "icon"
out.mkdir(parents=True, exist_ok=True)
for size in SIZE:
    (out / f"{size}.png").write_bytes(png(render(size), size))
    print(f"生成 {out / f'{size}.png'}")
