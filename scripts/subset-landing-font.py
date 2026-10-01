from pathlib import Path
from fontTools import subset

html = Path("cloud/index.html").read_text(encoding="utf-8")
chars = set(ch for ch in html if ord(ch) > 0x7F) | set(chr(c) for c in range(0x20, 0x7F))
text = "".join(sorted(chars))

# Source fonts (OFL-1.1), downloaded into .local/:
#   gh release download v1.522 -R lxgw/LxgwWenKai -p LXGWWenKai-Medium.ttf -D .local/wenkai
#   gh release download 2026.09.25 -R TakWolf/fusion-pixel-font \
#     -p fusion-pixel-font-8px-proportional-otf.woff2-v2026.09.25.zip -D .local/fusion-pixel  (then unzip into x/)
jobs = [
    (".local/wenkai/LXGWWenKai-Medium.ttf", "cloud/assets/lxgw-wenkai-zh.woff2"),
    (".local/fusion-pixel/x/fusion-pixel-8px-proportional-zh_hans.otf.woff2", "cloud/assets/fusion-pixel-zh-8.woff2"),
]
for src, dst in jobs:
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    subset.save_font(font, dst, opts)
    cmap = font.getBestCmap()
    missing = "".join(c for c in chars if ord(c) not in cmap and not c.isspace())
    print(dst, Path(dst).stat().st_size, "bytes, missing:", missing)
