# imgcolor

Pick a color from any image. Paste a screenshot, drop a file, or load a URL.

Static single-page app — no build step. Open `index.html` directly or host anywhere.

## Use

- **Paste** — ⌘V / Ctrl+V to paste a screenshot or image URL
- **Drop** — drag a file (or a link) onto the window
- **Open** — file picker for local images
- **URL** — load by URL (image host must allow CORS)

Hover the image to preview a color in the loupe. Click to copy the hex (also added to history). Click the swatch or any value chip to copy. `Esc` resets.

## Formats

Anything your browser can decode in an `<img>`: PNG, JPEG, WebP, GIF, BMP, AVIF, SVG. HEIC works in Safari; other browsers don't decode it natively.

## Deploy to GitHub Pages

1. Push to GitHub.
2. Repo → Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.

That's it. The `.nojekyll` file prevents Jekyll from touching anything.
