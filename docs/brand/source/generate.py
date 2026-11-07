"""Litti brand kit generator: diff-check symbol, wordmark, lockups, colour variants.

Usage: python brand.py <out_dir>
Everything is solid-fill paths (no <text>, no strokes, no filters).
"""
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kit')

# ---------------- palette ----------------
INK = '#0A0D12'      # near-black, dark backgrounds + wordmark on light
PAPER = '#F7F5F0'    # warm off-white, light backgrounds
WHITE = '#FFFFFF'
BRASS = '#F5B942'    # primary: the colour of a key (on dark)
BRASS_DEEP = '#A8700A'  # brass for light backgrounds (>= 3:1 on white)

COLOURWAYS = {
    # name: (symbol colour, wordmark colour, background it is designed for)
    'brass-on-dark': (BRASS, WHITE, INK),
    'brass-on-light': (BRASS_DEEP, INK, WHITE),
    'ink': (INK, INK, WHITE),
    'white': (WHITE, WHITE, INK),
    'on-brass': (INK, INK, BRASS),
    'green': ('#2EA043', INK, WHITE),
    'violet': ('#7C5CFF', INK, WHITE),
    'blue': ('#2F81F7', INK, WHITE),
    'red': ('#E5484D', INK, WHITE),
    'slate': ('#8B97A8', WHITE, INK),
}


def lum(hexc):
    r, g, b = (int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


# ---------------- geometry helpers ----------------
def clip_band(polygon, y0, y1):
    def clip(pts, keep, inter):
        out = []
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            if keep(p):
                out.append(p)
                if not keep(q):
                    out.append(inter(p, q))
            elif keep(q):
                out.append(inter(p, q))
        return out

    def at_y(y):  # only called on edges that cross y, so q.y != p.y
        return lambda p, q: (p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]), y)

    pts = clip(polygon, lambda p: p[1] >= y0, at_y(y0))
    return clip(pts, lambda p: p[1] <= y1, at_y(y1)) if pts else []


def check_polys(bar, gap, bands, left_band, w):
    """Check mark (45-degree arms) sliced into `bands` horizontal diff-line stripes.

    The long arm starts at stripe 0, the short arm at stripe `left_band`, and the V tip
    ends exactly at the bottom of the last stripe, so there are no slivers.
    Returns polygons in raw coordinates (top of first stripe at y=0, V tip at x=0).
    """
    p = bar + gap
    yB = p * (bands - 1) + bar
    yL = p * left_band
    span_long, span_left = yB, yB - yL
    outline = [(-span_left, yL), (-span_left + w, yL), (0, yB - w),
               (span_long - w, 0), (span_long, 0), (0, yB)]
    polys = []
    for k in range(bands):
        piece = clip_band(outline, p * k, p * k + bar)
        if len(piece) >= 3:
            polys.append(piece)
    return polys


def fit(polys, box):
    """Scale + translate polygons to fit centred in box=(x, y, w, h)."""
    xs = [x for pl in polys for x, _ in pl]
    ys = [y for pl in polys for _, y in pl]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    s = min(box[2] / (x1 - x0), box[3] / (y1 - y0))
    ox = box[0] + (box[2] - (x1 - x0) * s) / 2 - x0 * s
    oy = box[1] + (box[3] - (y1 - y0) * s) / 2 - y0 * s
    return [[(x * s + ox, y * s + oy) for x, y in pl] for pl in polys], (x1 - x0) * s, (y1 - y0) * s


def path(polys, fill):
    d = ' '.join('M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in pl) + ' Z' for pl in polys)
    return f'<path fill="{fill}" d="{d}"/>'


# Master symbol: 4 stripes, short arm joins at stripe 2.
MASTER = check_polys(bar=26, gap=13, bands=4, left_band=2, w=54)
# Small-size cut (favicon, <= 32 px): 3 fat stripes, wide gaps.
SMALL = check_polys(bar=40, gap=20, bands=3, left_band=1, w=66)


# ---------------- wordmark "litti" (bars; the two t's share one crossbar = the bolt) ----------------
def wordmark(x0, y0, scale, fill):
    """Wordmark with its top-left at (x0, y0). Native size 228 x 160 (ascender to baseline)."""
    s = 28
    shapes = []

    def r(x, y, w, h):
        shapes.append(f'<rect x="{x0 + x * scale:.2f}" y="{y0 + (y - 48) * scale:.2f}" width="{w * scale:.2f}" height="{h * scale:.2f}"/>')

    def dot(cx, cy, rad):
        shapes.append(f'<circle cx="{x0 + cx * scale:.2f}" cy="{y0 + (cy - 48) * scale:.2f}" r="{rad * scale:.2f}"/>')

    r(0, 48, s, 160)                      # l
    r(50, 120, s, 88); dot(64, 90, 14)    # i
    r(100, 72, s, 136)                    # t
    r(150, 72, s, 136)                    # t
    r(86, 116, 106, 26)                   # shared crossbar: the bolt
    r(200, 120, s, 88); dot(214, 90, 14)  # i
    return f'<g fill="{fill}">' + ''.join(shapes) + '</g>'


WORD_W, WORD_H = 228, 160


def svg(w, h, body, title, bg=None):
    bgr = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{bgr}{body}</svg>\n')


def symbol_svg(fill, small=False, bg=None, title='Litti'):
    polys, _, _ = fit(SMALL if small else MASTER, (20, 20, 216, 216))
    return svg(256, 256, path(polys, fill), title, bg)


def horizontal_svg(sym_fill, word_fill, bg=None, pad=32):
    # Symbol height matches wordmark ascender height (160); 44px gap; `pad` around (0 = tight, for UI headers).
    polys, sw, sh = fit(MASTER, (pad, pad, 400, 160))
    shift = pad - min(x for pl in polys for x, _ in pl)  # left-align the symbol (fit() centres it)
    polys = [[(x + shift, y) for x, y in pl] for pl in polys]
    sx1 = max(x for pl in polys for x, _ in pl)
    gap = 44
    width = int(sx1 + gap + WORD_W + pad)
    return svg(width, 160 + 2 * pad, path(polys, sym_fill) + wordmark(sx1 + gap, pad, 1, word_fill), 'Litti', bg)


def stacked_svg(sym_fill, word_fill, bg=None):
    width = 320
    polys, sw, sh = fit(MASTER, (32, 32, width - 64, 150))
    word_scale = 0.8
    wy = 32 + 150 + 40
    wx = (width - WORD_W * word_scale) / 2
    height = int(wy + WORD_H * word_scale + 32)
    return svg(width, height, path(polys, sym_fill) + wordmark(wx, wy, word_scale, word_fill), 'Litti', bg)


def wordmark_svg(fill, bg=None):
    return svg(WORD_W + 64, WORD_H + 64, wordmark(32, 32, 1, fill), 'Litti', bg)


def main():
    os.makedirs(OUT, exist_ok=True)
    sub = lambda *p: os.path.join(OUT, *p)
    for d in ('logo', 'colours'):
        os.makedirs(sub(d), exist_ok=True)

    def write(rel, content):
        with open(sub(rel), 'w', encoding='utf8') as f:
            f.write(content)

    # Masters (transparent backgrounds)
    write('logo/litti-symbol.svg', symbol_svg(BRASS))
    write('logo/litti-symbol-light-bg.svg', symbol_svg(BRASS_DEEP))
    write('logo/litti-symbol-small.svg', symbol_svg(BRASS, small=True))
    write('logo/litti-symbol-black.svg', symbol_svg('#000000'))
    write('logo/litti-symbol-white.svg', symbol_svg(WHITE))
    write('logo/litti-horizontal-dark.svg', horizontal_svg(BRASS, WHITE))
    write('logo/litti-horizontal-light.svg', horizontal_svg(BRASS_DEEP, INK))
    write('logo/litti-horizontal-black.svg', horizontal_svg('#000000', '#000000'))
    write('logo/litti-horizontal-white.svg', horizontal_svg(WHITE, WHITE))
    write('logo/litti-horizontal-dark-tight.svg', horizontal_svg(BRASS, WHITE, pad=0))
    write('logo/litti-horizontal-light-tight.svg', horizontal_svg(BRASS_DEEP, INK, pad=0))
    write('logo/litti-stacked-dark.svg', stacked_svg(BRASS, WHITE))
    write('logo/litti-stacked-light.svg', stacked_svg(BRASS_DEEP, INK))
    write('logo/litti-wordmark-ink.svg', wordmark_svg(INK))
    write('logo/litti-wordmark-white.svg', wordmark_svg(WHITE))
    # App/avatar tile: brass symbol on ink, rounded square.
    tile = ('<rect width="256" height="256" rx="56" fill="' + INK + '"/>'
            + path(fit(MASTER, (40, 40, 176, 176))[0], BRASS))
    write('logo/litti-app-icon.svg', svg(256, 256, tile, 'Litti'))

    # Favicon: small-size cut, brass on an ink tile, so it reads on light and dark browser tabs.
    fav = ('<rect width="256" height="256" rx="56" fill="' + INK + '"/>'
           + path(fit(SMALL, (36, 44, 184, 168))[0], BRASS))
    write('logo/litti-favicon.svg', svg(256, 256, fav, 'Litti'))

    # Social preview card (GitHub: 1280x640). Lockup + tagline on ink.
    polys, sw, sh = fit(MASTER, (300, 170, 300, 200))
    sx1 = max(x for pl in polys for x, _ in pl)
    word_scale = 200 / WORD_H
    card = (path(polys, BRASS) + wordmark(sx1 + 56, 170, word_scale, WHITE)
            + '<text x="640" y="490" text-anchor="middle" fill="#C9D1D9" '
              'font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="34">'
              'Proof of review for AI coding agents</text>'
            + '<text x="640" y="540" text-anchor="middle" fill="#8B97A8" '
              'font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24">'
              'Your approve button is a spring lock. Litti makes sure someone turned the key.</text>')
    write('social-preview.svg', svg(1280, 640, card, 'Litti — proof of review for AI coding agents', INK))

    # Colour variants: symbol + horizontal, each on its intended background.
    for name, (sym, word, bg) in COLOURWAYS.items():
        write(f'colours/litti-symbol-{name}.svg', symbol_svg(sym, bg=bg))
        write(f'colours/litti-horizontal-{name}.svg', horizontal_svg(sym, word, bg=bg))

    # "Diff edition": stripes alternate added/removed green and red, like a diff.
    polys = fit(MASTER, (20, 20, 216, 216))[0]
    diff = ''.join(path([pl], '#2EA043' if i % 2 == 0 else '#E5484D') for i, pl in enumerate(polys))
    write('colours/litti-symbol-diff-edition.svg', svg(256, 256, diff, 'Litti', INK))

    print('contrast BRASS on INK  %.2f' % contrast(BRASS, INK))
    print('contrast BRASS_DEEP on WHITE %.2f' % contrast(BRASS_DEEP, WHITE))
    print('contrast INK on BRASS %.2f' % contrast(INK, BRASS))
    for name, (sym, word, bg) in COLOURWAYS.items():
        print(f'  {name:15s} symbol {contrast(sym, bg):5.2f}  wordmark {contrast(word, bg):5.2f}')


if __name__ == '__main__':
    main()
