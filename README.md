# imgcolor

Pick a color from any image. Paste a screenshot, drop a file, or load a URL.

Static single-page app — no build step. Open `index.html` directly or host anywhere.

## Use

Load an image:

- **Paste** — ⌘V / Ctrl+V to paste a screenshot or image URL
- **Drop** — drag a file (or a link) onto the window
- **Open** — file picker for local images
- **URL** — load by URL (image host must allow CORS)

Pick a color:

- Hover the image to preview a color in the loupe.
- Click to copy the hex (also added to history). Click the swatch or any value chip to copy.

Pan and zoom:

- **Scroll / pinch** — zoom around the cursor
- **Drag** — pan (or use two-finger trackpad swipe; middle-click drag also pans)
- **`0`** — fit image to window
- **`Esc`** — reset and load a different image

## Formats

Anything your browser can decode in an `<img>`: PNG, JPEG, WebP, GIF, BMP, AVIF, SVG.

## Deploy to GitHub Pages

1. Push to GitHub.
2. Repo → Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.

That's it. The `.nojekyll` file prevents Jekyll from touching anything.
