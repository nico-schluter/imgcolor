(() => {
  const $ = (id) => document.getElementById(id);

  const stage = $("stage");
  const canvasWrap = $("canvas-wrap");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
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

  let displayWidth = 0;
  let displayHeight = 0;
  let canvasRect = null;
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
    if (!w || !h) {
      showToast("empty image");
      return;
    }
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0);
    // probe for tainted canvas (cross-origin without CORS headers)
    try {
      ctx.getImageData(0, 0, 1, 1);
    } catch {
      showToast("cross-origin image — can't read pixels");
      return;
    }
    fitCanvas();
    stage.classList.remove("empty");
    canvasWrap.hidden = false;
    panel.hidden = false;
  };

  const fitCanvas = () => {
    // letterbox the canvas inside the stage (CSS handles max constraints)
    const stageRect = stage.getBoundingClientRect();
    const scale = Math.min(
      stageRect.width / canvas.width,
      stageRect.height / canvas.height,
      1
    );
    displayWidth = Math.round(canvas.width * scale);
    displayHeight = Math.round(canvas.height * scale);
    canvas.style.width = displayWidth + "px";
    canvas.style.height = displayHeight + "px";
    canvasRect = canvas.getBoundingClientRect();
  };

  // ---------- sampling ----------
  const sampleAt = (clientX, clientY) => {
    if (!canvasRect) return null;
    const x = clientX - canvasRect.left;
    const y = clientY - canvasRect.top;
    if (x < 0 || y < 0 || x >= canvasRect.width || y >= canvasRect.height) return null;
    const sx = Math.floor((x / canvasRect.width) * canvas.width);
    const sy = Math.floor((y / canvasRect.height) * canvas.height);
    const data = ctx.getImageData(sx, sy, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3], sx, sy };
  };

  const setCurrent = (s) => {
    if (!s) return;
    current = s;
    const hex = toHex(s.r, s.g, s.b);
    const rgb = toRgb(s.r, s.g, s.b);
    const hsl = toHsl(s.r, s.g, s.b);
    swatch.style.background = hex;
    vHex.textContent = hex;
    vRgb.textContent = rgb;
    vHsl.textContent = hsl;
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
  };

  // ---------- loupe ----------
  const LOUPE_SIZE = 120;
  const LOUPE_ZOOM = 12;
  const LOUPE_SAMPLES = LOUPE_SIZE / LOUPE_ZOOM; // pixels visible

  const showLoupe = (clientX, clientY, s) => {
    if (!s) {
      loupe.hidden = true;
      return;
    }
    loupe.hidden = false;
    loupe.style.left = clientX + "px";
    loupe.style.top = clientY + "px";

    const half = LOUPE_SAMPLES / 2;
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    loupeCtx.drawImage(
      canvas,
      s.sx - half, s.sy - half, LOUPE_SAMPLES, LOUPE_SAMPLES,
      0, 0, LOUPE_SIZE, LOUPE_SIZE
    );
  };

  // ---------- pointer events ----------
  canvas.addEventListener("pointermove", (e) => {
    const s = sampleAt(e.clientX, e.clientY);
    if (s) {
      setCurrent(s);
      showLoupe(e.clientX, e.clientY, s);
    }
  });

  canvas.addEventListener("pointerleave", () => {
    loupe.hidden = true;
  });

  canvas.addEventListener("click", (e) => {
    const s = sampleAt(e.clientX, e.clientY);
    if (!s) return;
    setCurrent(s);
    addHistory(s);
    copy(toHex(s.r, s.g, s.b));
  });

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
    loadFromUrl(url.trim());
  });

  $("btn-reset").addEventListener("click", () => {
    stage.classList.add("empty");
    canvasWrap.hidden = true;
    panel.hidden = true;
    current = null;
  });

  // ---------- paste ----------
  window.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        loadFromBlob(item.getAsFile());
        e.preventDefault();
        return;
      }
    }
    // fall through: maybe pasted a URL?
    const text = e.clipboardData.getData("text");
    if (text && /^https?:\/\//.test(text.trim())) {
      loadFromUrl(text.trim());
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
    if (file) {
      loadFromBlob(file);
      return;
    }
    const uri = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
    if (uri) loadFromUrl(uri.trim());
  });

  // ---------- resize ----------
  let resizeRaf;
  window.addEventListener("resize", () => {
    if (canvasWrap.hidden) return;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(fitCanvas);
  });

  // ---------- keyboard ----------
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !canvasWrap.hidden) {
      $("btn-reset").click();
    }
    // ⌘C / Ctrl+C copies current hex when nothing is selected
    if ((e.metaKey || e.ctrlKey) && e.key === "c" && current && window.getSelection()?.toString() === "") {
      copy(toHex(current.r, current.g, current.b));
    }
  });

  // ---------- prevent default browser file-drop nav ----------
  ["dragover", "drop"].forEach((ev) =>
    document.body.addEventListener(ev, (e) => e.preventDefault())
  );
})();
