# Turns the two 1024 logos (rounded square on white) into full-bleed app icons
# plus rounded transparent PNGs for the web.
from PIL import Image, ImageDraw, ImageFilter
B = '/Users/ara/Downloads/shellhacks2026/stepsafe/brandguide/'
Z = 280  # corner zone size; eye art never enters it
for n in ['blue', 'dark']:
    im = Image.open(f'{B}logo-{n}-1024.png').convert('RGB')
    mask = im.convert('L').point(lambda v: 255 if v < 200 else 0)
    l, t, r, b = mask.getbbox(); k = 6  # trim anti-aliased edge columns
    im = im.crop((l + k, t + k, r - k, b - k)).resize((1024, 1024), Image.LANCZOS)
    px = im.load()
    # mark corner pixels that are off from the background (white margin + halo), grow 3 px, repaint
    bad = Image.new('L', (1024, 1024), 0); bp = bad.load()
    for y in range(1024):
        for x in range(1024):
            if (x < Z or x >= 1024 - Z) and (y < Z or y >= 1024 - Z):
                ref = px[Z if x < Z else 1023 - Z, y]
                if max(abs(a - b) for a, b in zip(px[x, y], ref)) > 12:
                    bp[x, y] = 255
    bp = bad.filter(ImageFilter.MaxFilter(7)).load()
    for y in range(1024):
        for x in range(1024):
            if bp[x, y]:
                px[x, y] = px[Z if x < Z else 1023 - Z, y]
    im.save(f'{B}appicon-{n}-1024.png')
    # rounded, transparent corners (4x supersampled mask)
    m = Image.new('L', (4096, 4096), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, 4095, 4095), radius=int(4096 * 0.225), fill=255)
    r = im.convert('RGBA'); r.putalpha(m.resize((1024, 1024), Image.LANCZOS))
    r.save(f'{B}logo-{n}-rounded-1024.png')
    r.resize((512, 512), Image.LANCZOS).save(f'{B}logo-{n}-rounded-512.png')
    r.resize((180, 180), Image.LANCZOS).save(f'{B}logo-{n}-rounded-180.png')
