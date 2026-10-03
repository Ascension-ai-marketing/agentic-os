#!/usr/bin/env python3
"""Contrast auditor for the theme tokens.

Parses :root / .dark from src/styles.css, converts oklch to sRGB, and checks
every pair that a user actually reads against WCAG AA. Run it after touching
the palette:  python3 scripts/contrast-audit.py
"""
import math, re, sys, pathlib

def oklch_to_srgb(L, C, H):
    h = math.radians(H)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return tuple(max(0.0, min(1.0, v)) for v in (lr, lg, lb))

def to_hex(lin):
    def enc(c):
        c = 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
        return max(0, min(255, round(c * 255)))
    return "#%02x%02x%02x" % tuple(enc(c) for c in lin)

def luminance(lin):
    r, g, b = lin
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def parse_block(css, sel):
    m = re.search(re.escape(sel) + r"\s*\{(.*?)\n\}", css, re.S)
    if not m:
        return {}
    out = {}
    for name, val in re.findall(r"--([\w-]+):\s*([^;]+);", m.group(1)):
        v = val.strip()
        ok = re.match(r"oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)", v)
        if ok:
            out[name] = oklch_to_srgb(*(float(x) for x in ok.groups()))
        else:
            # oklch(1 0 0 / 8%) — an alpha token. Reporting it as opaque white
            # claims a 19:1 border that the user never sees; composite it over
            # the block's own background so the number is the real one.
            al = re.match(r"oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*/\s*([\d.]+)%\s*\)", v)
            out[name] = ("ALPHA", oklch_to_srgb(*(float(x) for x in al.groups()[:3])),
                         float(al.group(4)) / 100) if al else None
    # Resolve alpha tokens over --background now that it is known.
    bg = out.get("background")
    if isinstance(bg, tuple) and len(bg) == 3 and not isinstance(bg[0], str):
        for k, v in list(out.items()):
            if isinstance(v, tuple) and len(v) == 3 and v[0] == "ALPHA":
                _, col, a = v
                out[k] = tuple(col[i] * a + bg[i] * (1 - a) for i in range(3))
    return out

# (foreground, background, minimum, label)
PAIRS = [
    ("foreground", "background", 4.5, "body text on page"),
    ("card-foreground", "card", 4.5, "text on card"),
    ("muted-foreground", "background", 4.5, "secondary text on page"),
    ("muted-foreground", "card", 4.5, "secondary text on card"),
    ("popover-foreground", "popover", 4.5, "text in popover"),
    ("primary-foreground", "primary", 4.5, "text on primary button"),
    ("secondary-foreground", "secondary", 4.5, "text on secondary button"),
    ("accent-foreground", "accent", 4.5, "text on accent surface"),
    ("destructive-foreground", "destructive", 4.5, "text on destructive"),
    ("sidebar-foreground", "sidebar", 4.5, "sidebar text"),
    ("sidebar-accent-foreground", "sidebar-accent", 4.5, "sidebar active item"),
    ("border", "background", 1.4, "border against page (decorative)"),
    ("input", "background", 3.0, "input boundary (UI component)"),
    ("ring", "background", 3.0, "focus ring (UI component)"),
]

css = pathlib.Path("src/styles.css").read_text()
fails = 0
for sel in (":root", ".dark"):
    toks = parse_block(css, sel)
    if not toks:
        print(f"!! {sel} not found"); continue
    print(f"\n=== {sel} ({'light' if sel == ':root' else 'dark'}) ===")
    for fg, bg, minimum, label in PAIRS:
        a, b = toks.get(fg), toks.get(bg)
        if a is None or b is None:
            print(f"  --   {label:34s} (alpha/absent token, skipped)")
            continue
        r = contrast(a, b)
        ok = r >= minimum
        if not ok: fails += 1
        print(f"  {'PASS' if ok else 'FAIL'} {label:34s} {r:5.2f}:1  (min {minimum})  "
              f"{to_hex(a)} on {to_hex(b)}")

print(f"\n{fails} failing pair(s)")
sys.exit(1 if fails else 0)
