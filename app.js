(() => {
  const $ = (id) => document.getElementById(id);

  const stage = $("stage");
  const canvasWrap = $("canvas-wrap");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");
  const loupe = $("loupe");
  const loupeCanvas = $("loupe-canvas");
  const loupeCtx = loupeCanvas.getContext("2d");
  const panel = $("panel");
  const swatch = $("swatch");
  const vHex = $("v-hex");
  const vRgb = $("v-rgb");
  const vHsl = $("v-hsl");
  const historyEl = $("history");
  const toast = $("toast");
  const dropVeil = $("drop-veil");
  const fileInput = $("file-input");

  // offscreen buffer holds the source image at native resolution.
  // the visible canvas is just a viewport onto it.
  const buffer = document.createElement("canvas");
  const bctx = buffer.getContext("2d", { willReadFrequently: true });

  let canvasRect = null;
  let hasImage = false;
  // view transform: screen_px = buffer_px * scale + t   (CSS-px units)
  const view = { scale: 1, tx: 0, ty: 0 };
  let history = [];
  let current = null;

  // ---------- toast ----------
  let toastTimer = null;
  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1400);
  };

  // ---------- color math ----------
  const toHex = (r, g, b) =>
    "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
  const toRgb = (r, g, b) => `rgb(${r}, ${g}, ${b})`;
  const toHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  };

  // ---------- copy ----------
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`copied ${text}`);
    } catch {
      showToast("copy failed");
    }
  };

  // ---------- image loading ----------
  const isLoadableUrl = (s) => /^(https?:|data:image\/)/i.test(s);

  const loadFromBlob = (blob) => {
    if (!blob || !blob.type.startsWith("image/")) {
      showToast("not an image");
      return;
    }
    const url = URL.createObjectURL(blob);
    loadFromUrl(url, () => URL.revokeObjectURL(url));
  };

  const loadFromUrl = (url, onDone) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      drawImage(img);
      onDone?.();
    };
    img.onerror = () => {
      showToast("couldn't load image");
      onDone?.();
    };
    img.src = url;
  };

  const drawImage = (img) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) { showToast("empty image"); return; }
    buffer.width = w;
    buffer.height = h;
    bctx.drawImage(img, 0, 0);
    try { bctx.getImageData(0, 0, 1, 1); }
    catch { showToast("cross-origin image — can't read pixels"); return; }

    stage.classList.remove("empty");
    canvasWrap.hidden = false;
    panel.hidden = false;
    hasImage = true;
    fitView();
  };

  // ---------- view transform ----------
  const dpr = () => window.devicePixelRatio || 1;
  const MIN_SCALE = 0.02;
  const MAX_SCALE = 128;

  const resizeCanvasToStage = () => {
    const r = stage.getBoundingClientRect();
    const ratio = dpr();
    canvas.width = Math.max(1, Math.round(r.width * ratio));
    canvas.height = Math.max(1, Math.round(r.height * ratio));
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
    canvasRect = canvas.getBoundingClientRect();
  };

  const fitView = () => {
    resizeCanvasToStage();
    if (!hasImage) return;
    const cssW = canvasRect.width;
    const cssH = canvasRect.height;
    // 95% of the smaller axis, never up-scale past 1x on initial fit
    const scale = Math.min(cssW / buffer.width, cssH / buffer.height, 1) * 0.95;
    view.scale = scale;
    view.tx = (cssW - buffer.width * scale) / 2;
    view.ty = (cssH - buffer.height * scale) / 2;
    redraw();
  };

  const redraw = () => {
    const ratio = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!hasImage) return;
    // crisp pixels when zoomed in past 1.5x; smooth when zoomed out
    ctx.imageSmoothingEnabled = view.scale < 1.5;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(
      view.scale * ratio, 0, 0, view.scale * ratio,
      view.tx * ratio, view.ty * ratio
    );
    ctx.drawImage(buffer, 0, 0);
  };

  const clientToBuffer = (clientX, clientY) => {
    if (!canvasRect || !hasImage) return null;
    const x = clientX - canvasRect.left;
    const y = clientY - canvasRect.top;
    if (x < 0 || y < 0 || x >= canvasRect.width || y >= canvasRect.height) return null;
    const bxf = (x - view.tx) / view.scale;
    const byf = (y - view.ty) / view.scale;
    const bx = Math.floor(bxf);
    const by = Math.floor(byf);
    if (bx < 0 || by < 0 || bx >= buffer.width || by >= buffer.height) return null;
    return { bx, by };
  };

  const sampleAt = (clientX, clientY) => {
    const p = clientToBuffer(clientX, clientY);
    if (!p) return null;
    const d = bctx.getImageData(p.bx, p.by, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3], bx: p.bx, by: p.by };
  };

  const zoomAt = (clientX, clientY, factor) => {
    if (!canvasRect || !hasImage) return;
    const cx = clientX - canvasRect.left;
    const cy = clientY - canvasRect.top;
    // buffer coord under the cursor before zoom
    const bxf = (cx - view.tx) / view.scale;
    const byf = (cy - view.ty) / view.scale;
    view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    // keep that buffer coord under the cursor after zoom
    view.tx = cx - bxf * view.scale;
    view.ty = cy - byf * view.scale;
    redraw();
  };

  const panBy = (dx, dy) => {
    view.tx += dx;
    view.ty += dy;
    redraw();
  };

  // ---------- color setting / history ----------
  const setCurrent = (s) => {
    if (!s) return;
    current = s;
    const hex = toHex(s.r, s.g, s.b);
    swatch.style.background = hex;
    vHex.textContent = hex;
    vRgb.textContent = toRgb(s.r, s.g, s.b);
    vHsl.textContent = toHsl(s.r, s.g, s.b);
  };

  const addHistory = (s) => {
    const hex = toHex(s.r, s.g, s.b);
    history = [hex, ...history.filter((h) => h !== hex)].slice(0, 16);
    renderHistory();
  };

  const renderHistory = () => {
    historyEl.innerHTML = "";
    for (const hex of history) {
      const b = document.createElement("button");
      b.type = "button";
      b.style.background = hex;
      b.title = `copy ${hex}`;
      b.addEventListener("click", () => {
        const [r, g, b2] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((p) => parseInt(p, 16));
        setCurrent({ r, g, b: b2 });
        copy(hex);
      });
      historyEl.appendChild(b);
    }
    $("copy-all").hidden = history.length === 0;
  };

  $("copy-all").addEventListener("click", () => {
    if (history.length) copy(history.join("\n"));
  });

  // ---------- loupe ----------
  const LOUPE_SIZE = 120;
  // odd sample count → the center pixel's midpoint sits exactly under the crosshair
  const LOUPE_SAMPLES = 11;
  const LOUPE_HALF = (LOUPE_SAMPLES - 1) / 2;

  const showLoupe = (clientX, clientY, s) => {
    if (!s) { loupe.hidden = true; return; }
    loupe.hidden = false;
    loupe.style.left = clientX + "px";
    loupe.style.top = clientY + "px";
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    // source from the buffer so loupe quality is independent of view zoom
    loupeCtx.drawImage(
      buffer,
      s.bx - LOUPE_HALF, s.by - LOUPE_HALF, LOUPE_SAMPLES, LOUPE_SAMPLES,
      0, 0, LOUPE_SIZE, LOUPE_SIZE
    );
  };

  const updateHoverAt = (clientX, clientY) => {
    const s = sampleAt(clientX, clientY);
    if (s) {
      setCurrent(s);
      showLoupe(clientX, clientY, s);
    } else {
      loupe.hidden = true;
    }
  };

  // ---------- pointer: click-to-pick vs drag-to-pan ----------
  const DRAG_THRESHOLD = 4;
  let down = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    canvas.setPointerCapture(e.pointerId);
    const isMiddle = e.button === 1;
    down = {
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      panning: isMiddle, // middle button is always pan, never pick
    };
    if (isMiddle) canvas.style.cursor = "grabbing";
  });

  // suppress Windows/Linux middle-click autoscroll on Chrome/Firefox/Edge
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  canvas.addEventListener("auxclick", (e) => {
    if (e.button === 1) e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (down) {
      const totalDx = e.clientX - down.startX;
      const totalDy = e.clientY - down.startY;
      if (!down.panning && Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD) {
        down.panning = true;
        canvas.style.cursor = "grabbing";
      }
      if (down.panning) {
        panBy(e.clientX - down.lastX, e.clientY - down.lastY);
        down.lastX = e.clientX;
        down.lastY = e.clientY;
      }
    }
    updateHoverAt(e.clientX, e.clientY);
  });

  const endPointer = (e) => {
    if (!down) return;
    const wasPan = down.panning;
    down = null;
    canvas.style.cursor = "";
    if (!wasPan) {
      const s = sampleAt(e.clientX, e.clientY);
      if (s) {
        setCurrent(s);
        addHistory(s);
        copy(toHex(s.r, s.g, s.b));
      }
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener("pointerleave", () => {
    if (!down) loupe.hidden = true;
  });

  // ---------- wheel: classify trackpad vs mouse wheel ----------
  // Observation from logs: trackpad swipes always carry some horizontal
  // component (deltaX != 0) from finger placement, while mouse wheels send
  // deltaX = 0/-0 even when scrolled fast. Once any event in a gesture
  // shows deltaX != 0, we lock into pan mode briefly so pure-vertical
  // follow-up events in the same swipe also pan.
  let trackpadLockUntil = 0;

  const zoomFromWheel = (e) => {
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 50;
    else if (e.deltaMode === 2) dy *= canvasRect.height;
    dy = Math.max(-50, Math.min(50, dy));
    zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.01));
  };

  canvas.addEventListener("wheel", (e) => {
    if (!hasImage) return;
    e.preventDefault();
    const now = performance.now();

    if (e.ctrlKey) {
      zoomFromWheel(e); // pinch
    } else if (e.deltaX !== 0) {
      trackpadLockUntil = now + 400;
      panBy(-e.deltaX, -e.deltaY);
    } else if (now < trackpadLockUntil) {
      panBy(0, -e.deltaY);
    } else {
      zoomFromWheel(e);
    }
    updateHoverAt(e.clientX, e.clientY);
  }, { passive: false });

  // ---------- value copy buttons ----------
  document.querySelectorAll(".val").forEach((el) => {
    el.addEventListener("click", () => {
      const which = el.dataset.copy;
      const val = which === "hex" ? vHex.textContent
        : which === "rgb" ? vRgb.textContent
        : vHsl.textContent;
      if (val && val !== "—") copy(val);
    });
  });

  swatch.addEventListener("click", () => {
    if (vHex.textContent && vHex.textContent !== "—") copy(vHex.textContent);
  });

  // ---------- inputs ----------
  $("btn-open").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) loadFromBlob(f);
    fileInput.value = "";
  });

  $("btn-url").addEventListener("click", () => {
    const url = prompt("image url:");
    if (!url) return;
    const trimmed = url.trim();
    if (!isLoadableUrl(trimmed)) { showToast("need an http(s) or data: image url"); return; }
    loadFromUrl(trimmed);
  });

  $("btn-reset").addEventListener("click", () => {
    stage.classList.add("empty");
    canvasWrap.hidden = true;
    panel.hidden = true;
    hasImage = false;
    current = null;
    redraw();
  });

  // ---------- paste ----------
  window.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        loadFromBlob(item.getAsFile());
        e.preventDefault();
        return;
      }
    }
    const text = e.clipboardData.getData("text")?.trim();
    if (text && isLoadableUrl(text)) {
      loadFromUrl(text);
      e.preventDefault();
    }
  });

  // ---------- drag & drop ----------
  let dragCounter = 0;
  window.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types.includes("Files") &&
        !e.dataTransfer?.types.includes("text/uri-list")) return;
    e.preventDefault();
    dragCounter++;
    dropVeil.hidden = false;
  });
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files") ||
        e.dataTransfer?.types.includes("text/uri-list")) {
      e.preventDefault();
    }
  });
  window.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropVeil.hidden = true;
    }
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropVeil.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) { loadFromBlob(file); return; }
    const uri = (e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "").trim();
    if (uri && isLoadableUrl(uri)) loadFromUrl(uri);
  });

  // ---------- resize ----------
  let resizeRaf;
  window.addEventListener("resize", () => {
    if (!hasImage) return;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(fitView);
  });

  // ---------- keyboard ----------
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && hasImage) { $("btn-reset").click(); return; }
    if (e.key === "0" && hasImage && !e.metaKey && !e.ctrlKey) { fitView(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "c" && current && window.getSelection()?.toString() === "") {
      copy(toHex(current.r, current.g, current.b));
    }
  });

  // prevent default browser file-drop nav
  ["dragover", "drop"].forEach((ev) =>
    document.body.addEventListener(ev, (e) => e.preventDefault())
  );
})();
