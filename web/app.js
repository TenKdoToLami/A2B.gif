// A2B.gif Controller & GIF Engine (Self-contained for file:/// and HTTP)

// ==========================================
// 1. FAST GIF ENCODER (LZW + 6x7x6 PALETTE)
// ==========================================
class LZWEncoder {
  constructor(width, height, pixels, colorDepth) {
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.colorDepth = colorDepth;
  }

  encode(outs) {
    let initCodeSize = Math.max(2, this.colorDepth);
    outs.push(initCodeSize);

    let remaining = this.pixels.length;
    let cur = 0;
    const clearCode = 1 << initCodeSize;
    const eofCode = clearCode + 1;
    let codeSize = initCodeSize + 1;
    let maxCode = (1 << codeSize);

    let accum = [];
    let curBits = 0;
    let curWord = 0;

    const writeBits = (bits, count) => {
      curWord |= (bits << curBits);
      curBits += count;
      while (curBits >= 8) {
        accum.push(curWord & 0xff);
        curWord >>= 8;
        curBits -= 8;
        if (accum.length >= 254) {
          outs.push(accum.length);
          for (let b of accum) outs.push(b);
          accum = [];
        }
      }
    };

    writeBits(clearCode, codeSize);

    let table = new Map();
    let nextCode = eofCode + 1;

    let ent = this.pixels[cur++];
    remaining--;

    while (remaining > 0) {
      let c = this.pixels[cur++];
      remaining--;
      let key = (ent << 16) | c;
      if (table.has(key)) {
        ent = table.get(key);
      } else {
        writeBits(ent, codeSize);
        if (nextCode < 4096) {
          table.set(key, nextCode++);
          if (nextCode > maxCode) {
            codeSize++;
            maxCode = (1 << codeSize);
          }
        } else {
          table.clear();
          writeBits(clearCode, codeSize);
          codeSize = initCodeSize + 1;
          maxCode = (1 << codeSize);
          nextCode = eofCode + 1;
        }
        ent = c;
      }
    }

    writeBits(ent, codeSize);
    writeBits(eofCode, codeSize);

    if (curBits > 0) {
      accum.push(curWord & 0xff);
    }
    if (accum.length > 0) {
      outs.push(accum.length);
      for (let b of accum) outs.push(b);
    }
    outs.push(0);
  }
}

function createFastGif(frames, width, height, delayMs, colors = 256, loop = true) {
  const bytes = [];
  const appendStr = (s) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  const appendU16 = (v) => {
    bytes.push(v & 0xff);
    bytes.push((v >> 8) & 0xff);
  };

  appendStr("GIF89a");
  appendU16(width);
  appendU16(height);
  bytes.push(0xF7, 0, 0); // 8 bits per pixel (256 table entries max)

  // Palette generation based on chosen color depth
  const palette = [];
  let quantize = null;

  if (colors <= 64) {
    // 4x4x4 uniform cube = 64 colors
    for (let r = 0; r < 4; ++r) {
      for (let g = 0; g < 4; ++g) {
        for (let b = 0; b < 4; ++b) {
          palette.push(Math.round(r * 255 / 3), Math.round(g * 255 / 3), Math.round(b * 255 / 3));
        }
      }
    }
    // Pad remaining to 256
    while (palette.length < 256 * 3) palette.push(0);

    quantize = (r, g, b) => {
      let ri = Math.min(3, Math.floor((r * 3 + 64) / 255));
      let gi = Math.min(3, Math.floor((g * 3 + 64) / 255));
      let bi = Math.min(3, Math.floor((b * 3 + 64) / 255));
      return ri * 16 + gi * 4 + bi;
    };
  } else if (colors <= 128) {
    // 5x5x5 uniform cube = 125 colors + 3 grays
    for (let r = 0; r < 5; ++r) {
      for (let g = 0; g < 5; ++g) {
        for (let b = 0; b < 5; ++b) {
          palette.push(Math.round(r * 255 / 4), Math.round(g * 255 / 4), Math.round(b * 255 / 4));
        }
      }
    }
    palette.push(40, 40, 40, 128, 128, 128, 220, 220, 220);
    while (palette.length < 256 * 3) palette.push(0);

    quantize = (r, g, b) => {
      let ri = Math.min(4, Math.floor((r * 4 + 64) / 255));
      let gi = Math.min(4, Math.floor((g * 4 + 64) / 255));
      let bi = Math.min(4, Math.floor((b * 4 + 64) / 255));
      return ri * 25 + gi * 5 + bi;
    };
  } else {
    // 6x7x6 uniform cube = 252 colors + 4 grays (Standard 256)
    for (let r = 0; r < 6; ++r) {
      for (let g = 0; g < 7; ++g) {
        for (let b = 0; b < 6; ++b) {
          palette.push(Math.round(r * 255 / 5), Math.round(g * 255 / 6), Math.round(b * 255 / 5));
        }
      }
    }
    palette.push(32, 32, 32, 64, 64, 64, 128, 128, 128, 200, 200, 200);

    quantize = (r, g, b) => {
      let ri = Math.min(5, Math.floor((r * 5 + 127) / 255));
      let gi = Math.min(6, Math.floor((g * 6 + 127) / 255));
      let bi = Math.min(5, Math.floor((b * 5 + 127) / 255));
      return ri * 42 + gi * 6 + bi;
    };
  }

  for (let b of palette) bytes.push(b);

  if (loop) {
    bytes.push(0x21, 0xFF, 11);
    appendStr("NETSCAPE2.0");
    bytes.push(3, 1);
    appendU16(0);
    bytes.push(0);
  }

  const delayCs = Math.max(1, Math.round(delayMs / 10));

  for (let frame of frames) {
    bytes.push(0x21, 0xF9, 4, 0x04);
    appendU16(delayCs);
    bytes.push(0, 0);

    bytes.push(0x2C);
    appendU16(0);
    appendU16(0);
    appendU16(width);
    appendU16(height);
    bytes.push(0);

    const totalPixels = width * height;
    const indexed = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; ++i) {
      let r = frame[i * 4];
      let g = frame[i * 4 + 1];
      let b = frame[i * 4 + 2];
      indexed[i] = quantize(r, g, b);
    }

    const encoder = new LZWEncoder(width, height, indexed, 8);
    encoder.encode(bytes);
  }

  bytes.push(0x3B);
  return new Uint8Array(bytes);
}

// ==========================================
// 2. UI & APPLICATION CONTROLLER
// ==========================================
let wasmModule = null;
let imgAData = null;
let imgBData = null;
let activeBlobUrl = null;

async function initWasm() {
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    try {
      const script = document.createElement('script');
      script.src = 'wasm/blendforge.js';
      script.onload = async () => {
        if (window.BlendForgeModule) {
          wasmModule = await window.BlendForgeModule();
        }
      };
      document.head.appendChild(script);
    } catch {
      // Keep silent fallback
    }
  }
}

// Elements
const dropA = document.getElementById('drop-zone-a');
const dropB = document.getElementById('drop-zone-b');
const fileInputA = document.getElementById('file-a');
const fileInputB = document.getElementById('file-b');
const previewA = document.getElementById('preview-a');
const previewB = document.getElementById('preview-b');
const contentA = document.getElementById('zone-content-a');
const contentB = document.getElementById('zone-content-b');

const chipA = document.getElementById('meta-chip-a');
const chipB = document.getElementById('meta-chip-b');

const stepInput = document.getElementById('step-count');
const stepVal = document.getElementById('step-val');
const delayInput = document.getElementById('frame-delay');
const delayVal = document.getElementById('delay-val');

// Overhauled Config State
let selectedMode = 0;
let selectedEasing = 'smooth';
let selectedColors = 256;
let selectedScale = 1.0;
let selectedLoop = 'a-b-a';

// Guide & Mode Explanations Data
const MODE_INFO = {
  0: {
    name: 'Crossfade',
    desc: 'Smooth linear alpha cross-dissolve between pixels.',
    algo: 'Interpolates RGB color channels uniformly across each intermediate step from 0% to 100%.',
    use: [
      'Portraits and face morphs',
      'Natural landscape and lighting transitions',
      'Similar object compositions'
    ],
    tip: 'Pair with Smooth (S-Curve) easing for natural acceleration and soft settling.'
  },
  1: {
    name: 'Horizontal Wipe',
    desc: 'Linear sweep revealing Target Image from left to right.',
    algo: 'Advances a vertical dividing edge horizontally across width with smooth feathered pixel interpolation.',
    use: [
      'Before & After comparisons',
      'Timeline and landscape progressions',
      'UI component reveals'
    ],
    tip: 'Use shorter frame delays (50–80ms) for an energetic swipe velocity.'
  },
  2: {
    name: 'Vertical Wipe',
    desc: 'Directional sweep revealing Target Image from top to bottom.',
    algo: 'Sweeps a horizontal soft line vertically downward from y=0 to y=height.',
    use: [
      'Mobile screenshots and web scroll showcases',
      'Tall architectural photos',
      'Curtain-fall transitions'
    ],
    tip: 'Excellent for vertical smartphone format images.'
  },
  3: {
    name: 'Circle Wipe',
    desc: 'Radial circular expansion expanding outward from center.',
    algo: 'Expands a feathered circle centered on the canvas (x_mid, y_mid) from radius 0 to full diagonal reach.',
    use: [
      'Centered portraits and character icons',
      'Logo and emblem morphs',
      'Dramatic focal-point reveals'
    ],
    tip: 'Align the key subject of both images in the center for maximum visual impact.'
  },
  4: {
    name: 'Matrix Dissolve',
    desc: 'Ordered dither pixel dissolve using Bayer threshold matrix.',
    algo: 'Applies an 8×8 Bayer spatial matrix combined with high-frequency noise for block-by-block pixel handover.',
    use: [
      'Retro video game and pixel art',
      'Cyberpunk and sci-fi aesthetic',
      'High-contrast graphics'
    ],
    tip: 'Combine with 64 or 128 colors for an authentic vintage arcade aesthetic.'
  },
  5: {
    name: 'Stride Swap',
    desc: 'Systematic stride-based pixel swap step by step.',
    algo: 'Swaps every N-th pixel on step k with coprime spatial scattering, forming a fine digital weave.',
    use: [
      'Digital glitch aesthetics',
      'Cyberpunk transitions',
      'Geometric interlace reveals'
    ],
    tip: 'Higher step counts (30–60) produce an exceptionally dense crystalline lattice.'
  },
  6: {
    name: 'Fluid Warp',
    desc: 'Eulerian liquid flow distortion field.',
    algo: 'Distorts pixel sampling coordinates along smooth trigonometric turbulence currents while blending.',
    use: [
      'Organic water, smoke, or cloud morphs',
      'Abstract and artistic animations',
      'Atmospheric landscape transitions'
    ],
    tip: 'Pair with Smooth (S-Curve) easing for gentle acceleration and silky liquid settling.'
  },
  7: {
    name: 'Particle Drift',
    desc: 'Lagrangian pixel transport based on luminance gradients.',
    algo: 'Displaces pixels along directional flow vectors derived from image brightness gradients.',
    use: [
      'Dispersing sand and dust morphs',
      'High-contrast silhouette transitions',
      'Dynamic physical particle reveals'
    ],
    tip: 'Produces dramatic swirling motion between high-contrast light and dark compositions.'
  },
  8: {
    name: 'Vortex Spin',
    desc: 'Archimedean spiral vortex rotational twist.',
    algo: 'Rotates coordinates around canvas center proportional to distance, peaking at t=0.5.',
    use: [
      'Space, portal, and sci-fi transitions',
      'Dynamic character spins',
      'Stylized artistic logo reveals'
    ],
    tip: 'Align center points of both images for hypnotic rotational vortex symmetry.'
  },
  9: {
    name: 'Glitch CRT',
    desc: 'Analog VHS scanline jitter and RGB channel chromatic separation.',
    algo: 'Applies horizontal pseudo-random scanline slippage with displaced R and B channels.',
    use: [
      'Cyberpunk and retro video games',
      'Analog tape and security camera aesthetic',
      'High-impact musical beats'
    ],
    tip: 'Use fast frame delay (40–70ms) for high-voltage glitch impact.'
  }
};

// Category 1: Mode Button Selector
const modeBtns = document.querySelectorAll('.mode-btn');
modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode = parseInt(btn.dataset.mode, 10);
  });
});

// Category 2: Easing Selector
const easingBtns = document.querySelectorAll('#easing-selector .seg-btn');
easingBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    easingBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedEasing = btn.dataset.easing;
  });
});

// Category 3: Colors & Scale Selectors
const colorsBtns = document.querySelectorAll('#colors-selector .seg-btn');
colorsBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    colorsBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedColors = parseInt(btn.dataset.colors, 10);
  });
});

const scaleBtns = document.querySelectorAll('#scale-selector .seg-btn');
scaleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    scaleBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedScale = parseFloat(btn.dataset.scale);
  });
});

// Category 4: Loop Direction Selector
const loopBtns = document.querySelectorAll('#loop-selector .seg-btn');
loopBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    loopBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLoop = btn.dataset.loop;
  });
});

const btnGenerate = document.getElementById('btn-generate');
const outputSection = document.getElementById('output-section');
const gifResult = document.getElementById('gif-result');
const btnDownload = document.getElementById('btn-download');
const perfMetrics = document.getElementById('perf-metrics');
const stepsContainer = document.getElementById('steps-container');
const stepsStrip = document.getElementById('steps-strip');
const stepsCountLabel = document.getElementById('steps-count-label');

const stepInspector = document.getElementById('step-inspector');
const inspectorTitle = document.getElementById('inspector-title');
const inspectorCounter = document.getElementById('inspector-counter');
const inspectorPrev = document.getElementById('inspector-prev');
const inspectorNext = document.getElementById('inspector-next');
const inspectorClose = document.getElementById('inspector-close');
const inspectorCanvas = document.getElementById('inspector-canvas');

let currentInspectedIndex = -1;
let currentRenderedFrames = [];
let currentFramesMeta = [];
let currentFrameWidth = 0;
let currentFrameHeight = 0;
let currentForwardCount = 0;
let currentLoopMode = 'a-b-a';

// Timing Mode Switch State
let timingMode = 'steps-delay'; // 'steps-delay' or 'fps-duration'
const timingModeBtns = document.querySelectorAll('#timing-mode-selector .seg-btn');
const fieldsSteps = document.getElementById('timing-fields-steps');
const fieldsFps = document.getElementById('timing-fields-fps');
const fpsInput = document.getElementById('fps-rate');
const fpsVal = document.getElementById('fps-val');
const durationInput = document.getElementById('anim-duration');
const durationVal = document.getElementById('duration-val');

const pauseAInput = document.getElementById('pause-a');
const pauseAVal = document.getElementById('pause-a-val');
const pauseBInput = document.getElementById('pause-b');
const pauseBVal = document.getElementById('pause-b-val');
const btnSwapImages = document.getElementById('btn-swap-images');

timingModeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    timingModeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    timingMode = btn.dataset.timingMode;

    if (timingMode === 'steps-delay') {
      fieldsSteps.style.display = 'grid';
      fieldsFps.style.display = 'none';
      syncFpsToSteps();
    } else {
      fieldsSteps.style.display = 'none';
      fieldsFps.style.display = 'grid';
      syncStepsToFps();
    }
  });
});

function syncStepsToFps() {
  const steps = parseInt(stepInput.value, 10);
  const delayMs = parseInt(delayInput.value, 10);
  const totalDurationSec = (steps * delayMs) / 1000.0;
  const fps = Math.round(1000.0 / Math.max(20, delayMs));

  if (fpsInput) {
    fpsInput.value = Math.max(5, Math.min(50, fps));
    if (fpsVal) fpsVal.textContent = `${fpsInput.value} FPS`;
  }
  if (durationInput) {
    durationInput.value = Math.max(0.5, Math.min(8.0, totalDurationSec)).toFixed(2);
    if (durationVal) durationVal.textContent = `${durationInput.value} s`;
  }
}

function syncFpsToSteps() {
  const fps = parseInt(fpsInput.value, 10);
  const dur = parseFloat(durationInput.value);
  const steps = Math.max(4, Math.min(100, Math.round(fps * dur)));
  const delayMs = Math.max(30, Math.min(500, Math.round(1000.0 / fps)));

  if (stepInput) {
    stepInput.value = steps;
    if (stepVal) stepVal.textContent = steps;
  }
  if (delayInput) {
    delayInput.value = delayMs;
    if (delayVal) delayVal.textContent = `${delayMs} ms`;
  }
}

if (fpsInput && fpsVal) {
  fpsInput.addEventListener('input', () => {
    fpsVal.textContent = `${fpsInput.value} FPS`;
    syncFpsToSteps();
  });
}

if (durationInput && durationVal) {
  durationInput.addEventListener('input', () => {
    durationVal.textContent = `${durationInput.value} s`;
    syncFpsToSteps();
  });
}

if (pauseAInput && pauseAVal) {
  pauseAInput.addEventListener('input', () => {
    pauseAVal.textContent = `${parseFloat(pauseAInput.value).toFixed(1)} s`;
  });
}

if (pauseBInput && pauseBVal) {
  pauseBInput.addEventListener('input', () => {
    pauseBVal.textContent = `${parseFloat(pauseBInput.value).toFixed(1)} s`;
  });
}

// Quick Swap A ⇄ B button handler
if (btnSwapImages) {
  btnSwapImages.addEventListener('click', () => {
    if (!imgAData && !imgBData) return;

    // Swap JS image objects
    const tempImg = imgAData;
    imgAData = imgBData;
    imgBData = tempImg;

    // Swap previews
    const prevASrc = previewA.src;
    const prevADisp = previewA.style.display;
    const contADisp = contentA.style.display;
    const dropAClass = dropA.classList.contains('has-image');
    const chipAText = chipA.textContent;
    const chipAClass = chipA.className;

    previewA.src = previewB.src;
    previewA.style.display = previewB.style.display;
    contentA.style.display = contentB.style.display;
    dropA.classList.toggle('has-image', dropB.classList.contains('has-image'));
    chipA.textContent = chipB.textContent;
    chipA.className = chipB.className;

    previewB.src = prevASrc;
    previewB.style.display = prevADisp;
    contentB.style.display = contADisp;
    dropB.classList.toggle('has-image', dropAClass);
    chipB.textContent = chipAText;
    chipB.className = chipAClass;

    checkReady();
  });
}

// Sliders listener
if (stepInput && stepVal) {
  stepInput.addEventListener('input', () => {
    stepVal.textContent = stepInput.value;
    syncStepsToFps();
  });
}
if (delayInput && delayVal) {
  delayInput.addEventListener('input', () => {
    delayVal.textContent = `${delayInput.value} ms`;
    syncStepsToFps();
  });
}

// Image Loader
function handleImageFile(file, isA) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const img = new Image();
    img.onload = () => {
      if (isA) {
        imgAData = img;
        previewA.src = dataUrl;
        previewA.style.display = 'block';
        contentA.style.display = 'none';
        dropA.classList.add('has-image');
        if (chipA) {
          chipA.textContent = `${img.naturalWidth}×${img.naturalHeight} px`;
          chipA.classList.add('loaded');
        }
      } else {
        imgBData = img;
        previewB.src = dataUrl;
        previewB.style.display = 'block';
        contentB.style.display = 'none';
        dropB.classList.add('has-image');
        if (chipB) {
          chipB.textContent = `${img.naturalWidth}×${img.naturalHeight} px`;
          chipB.classList.add('loaded');
        }
      }
      checkReady();
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

if (fileInputA) {
  fileInputA.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImageFile(e.target.files[0], true);
    }
  });
}

if (fileInputB) {
  fileInputB.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImageFile(e.target.files[0], false);
    }
  });
}

[dropA, dropB].forEach((drop, idx) => {
  if (!drop) return;
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleImageFile(e.dataTransfer.files[0], idx === 0);
    }
  });
});

function checkReady() {
  if (btnGenerate) {
    btnGenerate.disabled = !(imgAData && imgBData);
  }
}

function determineDimensions() {
  const wA = imgAData.naturalWidth;
  const hA = imgAData.naturalHeight;
  const wB = imgBData.naturalWidth;
  const hB = imgBData.naturalHeight;

  let baseW = wA;
  let baseH = hA;

  if (wA !== wB || hA !== hB) {
    const areaA = wA * hA;
    const areaB = wB * hB;
    baseW = areaA <= areaB ? wA : wB;
    baseH = areaA <= areaB ? hA : hB;
  }

  // Apply user-selected resolution scale (1.0, 0.75, 0.5)
  let scaledW = Math.round(baseW * selectedScale);
  let scaledH = Math.round(baseH * selectedScale);

  scaledW = scaledW - (scaledW % 2);
  scaledH = scaledH - (scaledH % 2);
  return { width: Math.max(2, scaledW), height: Math.max(2, scaledH) };
}

// Scale down to fit within target canvas while maintaining aspect ratio and centering
function drawImageCentered(ctx, img, targetW, targetH) {
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  // Compute scale factor to fit within target dimensions
  const scale = Math.min(targetW / srcW, targetH / srcH);
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);

  const posX = Math.round((targetW - drawW) / 2);
  const posY = Math.round((targetH - drawH) / 2);

  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, srcW, srcH, posX, posY, drawW, drawH);
}

function processImages(targetWidth, targetHeight) {
  const canvasA = document.createElement('canvas');
  canvasA.width = targetWidth;
  canvasA.height = targetHeight;
  const ctxA = canvasA.getContext('2d');
  drawImageCentered(ctxA, imgAData, targetWidth, targetHeight);
  const dataA = ctxA.getImageData(0, 0, targetWidth, targetHeight).data;

  const canvasB = document.createElement('canvas');
  canvasB.width = targetWidth;
  canvasB.height = targetHeight;
  const ctxB = canvasB.getContext('2d');
  drawImageCentered(ctxB, imgBData, targetWidth, targetHeight);
  const dataB = ctxB.getImageData(0, 0, targetWidth, targetHeight).data;

  return { dataA, dataB };
}

// 8x8 Bayer threshold matrix for clean pixel/dither dissolve
const BAYER_8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21
];

/**
 * Computes deterministic dissolve threshold from Bayer matrix and spatial coordinates
 * @param {number} x
 * @param {number} y
 * @returns {number} threshold in range [0, 1]
 */
function getDissolveThreshold(x, y) {
  const bx = x % 8;
  const by = y % 8;
  const bayerVal = BAYER_8[by * 8 + bx] / 64.0;
  const pseudo = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1;
  return 0.7 * bayerVal + 0.3 * pseudo;
}

/**
 * Applies linearity/easing curve to normalize transition progress t
 * @param {number} t in [0, 1]
 * @param {string} easing 'linear', 'smooth', 'ease-in', 'ease-out'
 * @returns {number} eased progress in [0, 1]
 */
function applyEasing(t, easing) {
  switch (easing) {
    case 'smooth': // Smoothstep S-curve: slower near 0 and 1, faster in middle
      return t * t * (3 - 2 * t);
    case 'ease-in': // Quadratic ease-in: slow start, rapid finish
      return t * t;
    case 'ease-out': // Quadratic ease-out: rapid start, gentle finish
      return 1 - (1 - t) * (1 - t);
    case 'linear':
    default:
      return t;
  }
}

/**
 * Bilinear RGBA pixel sampler with edge clamp
 */
function sampleBilinear(data, width, height, x, y) {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(height - 1, y0 + 1));

  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  return [
    Math.round(data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11),
    Math.round(data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11),
    Math.round(data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11),
    Math.round(data[i00 + 3] * w00 + data[i10 + 3] * w10 + data[i01 + 3] * w01 + data[i11 + 3] * w11)
  ];
}

/**
 * Generates RGBA byte buffers for each transition step between Image A and Image B
 * @param {Uint8ClampedArray} dataA
 * @param {Uint8ClampedArray} dataB
 * @param {number} width
 * @param {number} height
 * @param {number} steps
 * @param {number} mode
 * @param {string} easing
 * @returns {Uint8Array[]} array of RGBA frame buffers
 */
function generateIntermediateFrames(dataA, dataB, width, height, steps, mode, easing = 'smooth') {
  const frames = [];
  const totalFrames = steps;
  const totalPixels = width * height;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

  // Precompute luminance map for Particle Drift (Mode 7) if selected
  let lumA = null, lumB = null;
  if (mode === 7) {
    lumA = new Float32Array(totalPixels);
    lumB = new Float32Array(totalPixels);
    for (let i = 0; i < totalPixels; ++i) {
      const idx = i * 4;
      lumA[i] = (0.299 * dataA[idx] + 0.587 * dataA[idx + 1] + 0.114 * dataA[idx + 2]) / 255.0;
      lumB[i] = (0.299 * dataB[idx] + 0.587 * dataB[idx + 1] + 0.114 * dataB[idx + 2]) / 255.0;
    }
  }

  for (let s = 0; s < totalFrames; ++s) {
    const rawT = s / (totalFrames - 1);
    const t = applyEasing(rawT, easing);
    const frame = new Uint8Array(width * height * 4);

    // MODE 5: Stride Swap (Nth pixel swap step by step)
    if (mode === 5) {
      // At step s, any pixel whose (pixelIndex * prime) % steps <= s has transitioned to B
      const prime = 10007;
      for (let i = 0; i < totalPixels; ++i) {
        const idx = i * 4;
        const bucket = (i * prime) % steps;
        const useB = bucket <= s;
        frame[idx + 0] = useB ? dataB[idx + 0] : dataA[idx + 0];
        frame[idx + 1] = useB ? dataB[idx + 1] : dataA[idx + 1];
        frame[idx + 2] = useB ? dataB[idx + 2] : dataA[idx + 2];
        frame[idx + 3] = useB ? dataB[idx + 3] : dataA[idx + 3];
      }
      frames.push(frame);
      continue;
    }

    // MODE 6: Fluid Warp (Eulerian vector field turbulence)
    if (mode === 6) {
      const warpAmp = Math.sin(t * Math.PI) * 28.0; // Max fluid wave displacement in mid-transition
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          const idx = (y * width + x) * 4;
          const u = x / width;
          const v = y / height;

          // Multi-frequency sinusoidal fluid curl vectors
          const flowX = Math.sin(v * 7.5 + t * 4.0) * Math.cos(u * 5.0) + Math.cos(v * 14.0) * 0.4;
          const flowY = Math.cos(u * 7.5 - t * 4.0) * Math.sin(v * 5.0) + Math.sin(u * 14.0) * 0.4;

          // Image A drifts along forward fluid stream; Image B pulls in from reverse stream
          const ax = x + flowX * warpAmp * (1.0 - t);
          const ay = y + flowY * warpAmp * (1.0 - t);
          const bx = x - flowX * warpAmp * t;
          const by = y - flowY * warpAmp * t;

          const pA = sampleBilinear(dataA, width, height, ax, ay);
          const pB = sampleBilinear(dataB, width, height, bx, by);

          for (let c = 0; c < 4; ++c) {
            frame[idx + c] = Math.round(pA[c] + t * (pB[c] - pA[c]));
          }
        }
      }
      frames.push(frame);
      continue;
    }

    // MODE 7: Particle Drift (Lagrangian brightness-guided pixel transport)
    if (mode === 7) {
      const driftAmp = Math.sin(t * Math.PI) * 35.0;
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          const idx = (y * width + x) * 4;
          const pixIdx = y * width + x;

          const xNext = Math.min(width - 1, x + 1);
          const yNext = Math.min(height - 1, y + 1);
          const gradAx = (lumA[y * width + xNext] - lumA[pixIdx]);
          const gradAy = (lumA[yNext * width + x] - lumA[pixIdx]);
          const gradBx = (lumB[y * width + xNext] - lumB[pixIdx]);
          const gradBy = (lumB[yNext * width + x] - lumB[pixIdx]);

          const driftX = (gradAx - gradBx) * driftAmp;
          const driftY = (gradAy - gradBy) * driftAmp;

          const ax = x + driftX * (1.0 - t);
          const ay = y + driftY * (1.0 - t);
          const bx = x - driftX * t;
          const by = y - driftY * t;

          const pA = sampleBilinear(dataA, width, height, ax, ay);
          const pB = sampleBilinear(dataB, width, height, bx, by);

          for (let c = 0; c < 4; ++c) {
            frame[idx + c] = Math.round(pA[c] + t * (pB[c] - pA[c]));
          }
        }
      }
      frames.push(frame);
      continue;
    }

    // MODE 8: Vortex Spin (Archimedean spiral vortex rotational twist)
    if (mode === 8) {
      const angleMax = Math.sin(t * Math.PI) * Math.PI * 2.5; // Max 450 degree twist
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          const idx = (y * width + x) * 4;
          const dx = x - centerX;
          const dy = y - centerY;
          const r = Math.sqrt(dx * dx + dy * dy);
          const theta = Math.atan2(dy, dx);

          const twist = angleMax * (1.0 - Math.min(1.0, r / maxDist));
          const thetaA = theta + twist * (1.0 - t);
          const thetaB = theta - twist * t;

          const ax = centerX + r * Math.cos(thetaA);
          const ay = centerY + r * Math.sin(thetaA);
          const bx = centerX + r * Math.cos(thetaB);
          const by = centerY + r * Math.sin(thetaB);

          const pA = sampleBilinear(dataA, width, height, ax, ay);
          const pB = sampleBilinear(dataB, width, height, bx, by);

          for (let c = 0; c < 4; ++c) {
            frame[idx + c] = Math.round(pA[c] + t * (pB[c] - pA[c]));
          }
        }
      }
      frames.push(frame);
      continue;
    }

    // MODE 9: Glitch CRT (Analog VHS scanline jitter and chromatic aberration)
    if (mode === 9) {
      const glitchIntensity = Math.sin(t * Math.PI);
      const chromaShift = Math.round(glitchIntensity * 14.0);
      for (let y = 0; y < height; ++y) {
        // Line-based jitter displacement
        const lineNoise = Math.sin(y * 19.3 + t * 47.1) * Math.cos(y * 7.7 + t * 12.3);
        const shiftX = Math.abs(lineNoise) > 0.6 ? Math.round(lineNoise * glitchIntensity * 32.0) : 0;

        for (let x = 0; x < width; ++x) {
          const idx = (y * width + x) * 4;
          const sampleX = Math.max(0, Math.min(width - 1, x + shiftX));

          // RGB chromatic channel splitting
          const rX = Math.max(0, Math.min(width - 1, sampleX + chromaShift));
          const bX = Math.max(0, Math.min(width - 1, sampleX - chromaShift));

          const idxR = (y * width + rX) * 4;
          const idxG = (y * width + sampleX) * 4;
          const idxB = (y * width + bX) * 4;

          const redA = dataA[idxR], redB = dataB[idxR];
          const greenA = dataA[idxG + 1], greenB = dataB[idxG + 1];
          const blueA = dataA[idxB + 2], blueB = dataB[idxB + 2];

          // Scanline darkness modulation
          const scanline = (y % 2 === 0) ? 0.92 : 1.0;

          frame[idx + 0] = Math.round((redA + t * (redB - redA)) * scanline);
          frame[idx + 1] = Math.round((greenA + t * (greenB - greenA)) * scanline);
          frame[idx + 2] = Math.round((blueA + t * (blueB - blueA)) * scanline);
          frame[idx + 3] = 255;
        }
      }
      frames.push(frame);
      continue;
    }

    // Standard spatial and alpha transitions (Modes 0 to 4)
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) {
        const idx = (y * width + x) * 4;
        let blend = t;

        switch (mode) {
          case 1: { // Horizontal Wipe
            const pos = x / width;
            blend = Math.max(0, Math.min(1, (t * 1.1 - pos) / 0.1));
            break;
          }
          case 2: { // Vertical Wipe
            const pos = y / height;
            blend = Math.max(0, Math.min(1, (t * 1.1 - pos) / 0.1));
            break;
          }
          case 3: { // Radial Circle Wipe
            const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
            blend = Math.max(0, Math.min(1, (t * maxDist - dist) / 15.0));
            break;
          }
          case 4: { // Matrix Dissolve
            blend = t >= getDissolveThreshold(x, y) ? 1.0 : 0.0;
            break;
          }
          default: { // Crossfade
            blend = t;
            break;
          }
        }

        for (let c = 0; c < 4; ++c) {
          frame[idx + c] = Math.round(dataA[idx + c] + blend * (dataB[idx + c] - dataA[idx + c]));
        }
      }
    }
    frames.push(frame);
  }
  return frames;
}

if (btnGenerate) {
  btnGenerate.addEventListener('click', async () => {
    if (!imgAData || !imgBData) return;

    btnGenerate.disabled = true;
    btnGenerate.innerHTML = `<span class="spinner"></span> Generating...`;

    const steps = parseInt(stepInput.value, 10);
    const delayMs = parseInt(delayInput.value, 10);
    const mode = selectedMode;
    const easing = selectedEasing;
    const colors = selectedColors;
    const loopMode = selectedLoop;

    const { width, height } = determineDimensions();

    setTimeout(async () => {
      const startTime = performance.now();
      try {
        const { dataA, dataB } = processImages(width, height);
        let gifBytes = null;

        // Base forward frames: A -> B
        const forwardFrames = generateIntermediateFrames(dataA, dataB, width, height, steps, mode, easing);

        // Build full animation sequence according to chosen loop mode
        let gifFrames = [];
        let framesMeta = [];
        let phase1Title = 'A → B';
        let phase2Title = '';
        let phase1Count = 0;
        let phase2Count = 0;

        // Read endpoint pause durations
        const pauseASec = pauseAInput ? parseFloat(pauseAInput.value) : 0;
        const pauseBSec = pauseBInput ? parseFloat(pauseBInput.value) : 0;
        const pauseAFramesCount = Math.round((pauseASec * 1000) / delayMs);
        const pauseBFramesCount = Math.round((pauseBSec * 1000) / delayMs);

        const frameA = forwardFrames[0];
        const frameB = forwardFrames[forwardFrames.length - 1];

        if (loopMode === 'a-to-b') {
          // A -> B: [Pause A] + [A -> B] + [Pause B]
          phase1Title = 'A → B';

          // Pause A at start
          for (let p = 0; p < pauseAFramesCount; ++p) {
            gifFrames.push(frameA);
            framesMeta.push({
              phase: 'hold-a',
              isHold: true,
              isReturn: false,
              isDividerBefore: false,
              label: pauseAFramesCount > 1 ? `Hold A (#${p + 1})` : 'Hold A',
              inspectorTitle: `Step #${gifFrames.length} &bull; Hold Image A &bull; <span style="color:#fbbf24">${pauseASec.toFixed(1)}s pause</span>`
            });
          }

          // Morph A -> B
          forwardFrames.forEach((frameBytes, i) => {
            const pct = Math.round((i / (forwardFrames.length - 1)) * 100);
            gifFrames.push(frameBytes);
            framesMeta.push({
              phase: 'forward',
              isHold: false,
              isReturn: false,
              isDividerBefore: false,
              label: `A → B (${pct}%)`,
              inspectorTitle: `Step #${gifFrames.length} &bull; A &rarr; B &bull; <span style="color:var(--primary)">${pct}%</span>`
            });
          });

          // Pause B at end before loop wraps
          for (let p = 0; p < pauseBFramesCount; ++p) {
            gifFrames.push(frameB);
            framesMeta.push({
              phase: 'hold-b',
              isHold: true,
              isReturn: false,
              isDividerBefore: false,
              label: pauseBFramesCount > 1 ? `Hold B (#${p + 1})` : 'Hold B',
              inspectorTitle: `Step #${gifFrames.length} &bull; Hold Image B &bull; <span style="color:#fbbf24">${pauseBSec.toFixed(1)}s pause</span>`
            });
          }

          phase1Count = gifFrames.length;

        } else if (loopMode === 'b-to-a') {
          // B -> A: [Pause B] + [B -> A] + [Pause A]
          const bToAFrames = generateIntermediateFrames(dataB, dataA, width, height, steps, mode, easing);
          phase1Title = 'B → A';

          // Pause B at start
          for (let p = 0; p < pauseBFramesCount; ++p) {
            gifFrames.push(frameB);
            framesMeta.push({
              phase: 'hold-b',
              isHold: true,
              isReturn: false,
              isDividerBefore: false,
              label: pauseBFramesCount > 1 ? `Hold B (#${p + 1})` : 'Hold B',
              inspectorTitle: `Step #${gifFrames.length} &bull; Hold Image B &bull; <span style="color:#fbbf24">${pauseBSec.toFixed(1)}s pause</span>`
            });
          }

          // Morph B -> A
          bToAFrames.forEach((frameBytes, i) => {
            const pct = Math.round((i / (bToAFrames.length - 1)) * 100);
            gifFrames.push(frameBytes);
            framesMeta.push({
              phase: 'forward',
              isHold: false,
              isReturn: false,
              isDividerBefore: false,
              label: `B → A (${pct}%)`,
              inspectorTitle: `Step #${gifFrames.length} &bull; B &rarr; A &bull; <span style="color:var(--primary)">${pct}%</span>`
            });
          });

          // Pause A at end before loop wraps
          for (let p = 0; p < pauseAFramesCount; ++p) {
            gifFrames.push(frameA);
            framesMeta.push({
              phase: 'hold-a',
              isHold: true,
              isReturn: false,
              isDividerBefore: false,
              label: pauseAFramesCount > 1 ? `Hold A (#${p + 1})` : 'Hold A',
              inspectorTitle: `Step #${gifFrames.length} &bull; Hold Image A &bull; <span style="color:#fbbf24">${pauseASec.toFixed(1)}s pause</span>`
            });
          }

          phase1Count = gifFrames.length;

        } else if (loopMode === 'a-b-a') {
          // A -> B -> A: [Pause A] + [A -> B] + [Pause B (Holdout Apex)] + [B -> A (without duplicate endpoints or end pause)]
          phase1Title = 'A → B';
          phase2Title = 'B → A';

          // Initial Pause on A
          for (let p = 0; p < pauseAFramesCount; ++p) {
            gifFrames.push(frameA);
            framesMeta.push({
              phase: 'hold-a',
              isHold: true,
              isReturn: false,
              isDividerBefore: false,
              label: pauseAFramesCount > 1 ? `Hold A (#${p + 1})` : 'Hold A',
              inspectorTitle: `Step #${gifFrames.length} &bull; Hold Image A &bull; <span style="color:#fbbf24">${pauseASec.toFixed(1)}s pause</span>`
            });
          }

          // Leg 1: A -> B
          forwardFrames.forEach((frameBytes, i) => {
            const pct = Math.round((i / (forwardFrames.length - 1)) * 100);
            gifFrames.push(frameBytes);
            framesMeta.push({
              phase: 'forward',
              isHold: false,
              isReturn: false,
              isDividerBefore: false,
              label: `A → B (${pct}%)`,
              inspectorTitle: `Step #${gifFrames.length} &bull; A &rarr; B &bull; <span style="color:var(--primary)">${pct}%</span>`
            });
          });

          phase1Count = gifFrames.length;

          // Leg 2: Holdout B at apex + return morph B -> A
          const returnFrames = generateIntermediateFrames(dataB, dataA, width, height, steps, mode, easing);

          // Intermediate Pause on B at apex (Holdout on B)
          for (let p = 0; p < pauseBFramesCount; ++p) {
            gifFrames.push(frameB);
            framesMeta.push({
              phase: 'hold-b',
              isHold: true,
              isReturn: true,
              isDividerBefore: (p === 0), // Divider right before the holdout image on B
              label: pauseBFramesCount > 1 ? `Holdout B (#${p + 1})` : 'Holdout B (Apex)',
              inspectorTitle: `Step #${gifFrames.length} &bull; Holdout on B (Apex) &bull; <span style="color:#fbbf24">${pauseBSec.toFixed(1)}s pause</span>`
            });
          }

          // Leg 2: B -> A (omit index 0 which is B and last index which is A so it loops seamlessly to Initial Pause A)
          if (returnFrames.length > 2) {
            for (let i = 1; i < returnFrames.length - 1; ++i) {
              const pct = Math.round((i / (returnFrames.length - 1)) * 100);
              gifFrames.push(returnFrames[i]);
              framesMeta.push({
                phase: 'return',
                isHold: false,
                isReturn: true,
                isDividerBefore: (pauseBFramesCount === 0 && i === 1), // If no pause on B, divider right before return
                label: `B → A (${pct}%)`,
                inspectorTitle: `Step #${gifFrames.length} &bull; B &rarr; A (Return) &bull; <span style="color:var(--accent)">${pct}%</span>`
              });
            }
          }

          phase2Count = gifFrames.length - phase1Count;

        } else if (loopMode === 'b-a-b') {
          // B -> A -> B: [Pause B] + [B -> A] + [Pause A (Holdout Apex)] + [A -> B (without duplicate endpoints or end pause)]
          const bToAFrames = generateIntermediateFrames(dataB, dataA, width, height, steps, mode, easing);
          phase1Title = 'B → A';
          phase2Title = 'A → B';

          // Initial Pause on B
          for (let p = 0; p < pauseBFramesCount; ++p) {
            gifFrames.push(frameB);
            framesMeta.push({
              phase: 'hold-b',
              isHold: true,
              isReturn: false,
              isDividerBefore: false,
              label: pauseBFramesCount > 1 ? `Hold B (#${p + 1})` : 'Hold B',
              inspectorTitle: `Step #${gifFrames.length} &bull; Hold Image B &bull; <span style="color:#fbbf24">${pauseBSec.toFixed(1)}s pause</span>`
            });
          }

          // Leg 1: B -> A
          bToAFrames.forEach((frameBytes, i) => {
            const pct = Math.round((i / (bToAFrames.length - 1)) * 100);
            gifFrames.push(frameBytes);
            framesMeta.push({
              phase: 'forward',
              isHold: false,
              isReturn: false,
              isDividerBefore: false,
              label: `B → A (${pct}%)`,
              inspectorTitle: `Step #${gifFrames.length} &bull; B &rarr; A &bull; <span style="color:var(--primary)">${pct}%</span>`
            });
          });

          phase1Count = gifFrames.length;

          // Leg 2: Holdout A at apex + return morph A -> B
          const returnFrames = generateIntermediateFrames(dataA, dataB, width, height, steps, mode, easing);

          // Intermediate Pause on A at apex (Holdout on A)
          for (let p = 0; p < pauseAFramesCount; ++p) {
            gifFrames.push(frameA);
            framesMeta.push({
              phase: 'hold-a',
              isHold: true,
              isReturn: true,
              isDividerBefore: (p === 0), // Divider right before the holdout image on A
              label: pauseAFramesCount > 1 ? `Holdout A (#${p + 1})` : 'Holdout A (Apex)',
              inspectorTitle: `Step #${gifFrames.length} &bull; Holdout on A (Apex) &bull; <span style="color:#fbbf24">${pauseASec.toFixed(1)}s pause</span>`
            });
          }

          // Leg 2: A -> B (omit index 0 which is A and last index which is B so it loops seamlessly to Initial Pause B)
          if (returnFrames.length > 2) {
            for (let i = 1; i < returnFrames.length - 1; ++i) {
              const pct = Math.round((i / (returnFrames.length - 1)) * 100);
              gifFrames.push(returnFrames[i]);
              framesMeta.push({
                phase: 'return',
                isHold: false,
                isReturn: true,
                isDividerBefore: (pauseAFramesCount === 0 && i === 1), // If no pause on A, divider right before return
                label: `A → B (${pct}%)`,
                inspectorTitle: `Step #${gifFrames.length} &bull; A &rarr; B (Return) &bull; <span style="color:var(--accent)">${pct}%</span>`
              });
            }
          }

          phase2Count = gifFrames.length - phase1Count;
        }
        gifBytes = createFastGif(gifFrames, width, height, delayMs, colors, true);

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        const blob = new Blob([gifBytes], { type: 'image/gif' });

        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = URL.createObjectURL(blob);

        gifResult.src = activeBlobUrl;
        btnDownload.href = activeBlobUrl;
        btnDownload.download = `A2B_morph_${width}x${height}.gif`;

        const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
        perfMetrics.textContent = `${gifFrames.length} frames • ${width}×${height} px • ${sizeMb} MB • Generated in ${elapsed}s`;

        // Populate Scrollable Steps Strip with grouped phases
        if (stepsStrip && stepsContainer) {
          stepsStrip.innerHTML = '';
          const hasPhase2 = phase2Count > 0;

          if (hasPhase2) {
            stepsCountLabel.textContent = `${gifFrames.length} frames (${phase1Count} ${phase1Title} + ${phase2Count} ${phase2Title})`;
          } else {
            stepsCountLabel.textContent = `${gifFrames.length} frames (${phase1Title})`;
          }

          gifFrames.forEach((frameBytes, idx) => {
            const meta = framesMeta[idx];

            if (meta && meta.isDividerBefore) {
              const divider = document.createElement('div');
              divider.className = 'step-divider';
              divider.innerHTML = `<span>⟲ Return Loop<br>(${phase2Title})</span>`;
              stepsStrip.appendChild(divider);
            }

            const card = document.createElement('div');
            let cardClass = 'step-card';
            if (meta && meta.isReturn) cardClass += ' return';
            if (meta && meta.isHold) cardClass += ' hold';
            card.className = cardClass;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(new Uint8ClampedArray(frameBytes.buffer), width, height);
            ctx.putImageData(imgData, 0, 0);

            const metaEl = document.createElement('div');
            metaEl.className = 'step-meta';
            const labelText = meta ? meta.label : `#${idx + 1}`;
            metaEl.innerHTML = `<span class="step-num">#${idx + 1}</span><span class="step-pct">${labelText}</span>`;

            card.appendChild(canvas);
            card.appendChild(metaEl);

            card.addEventListener('click', () => {
              showInspectedFrame(idx);
            });

            stepsStrip.appendChild(card);
          });

          // Save current state for inspector
          currentRenderedFrames = gifFrames;
          currentFramesMeta = framesMeta;
          currentFrameWidth = width;
          currentFrameHeight = height;
          currentForwardCount = phase1Count;
          currentLoopMode = loopMode;

          stepsContainer.style.display = 'flex';
        }

        outputSection.style.display = 'flex';
        outputSection.scrollIntoView({ behavior: 'smooth' });

      } catch (err) {
        console.error(err);
        alert("Error generating GIF: " + err.message);
      } finally {
        btnGenerate.disabled = false;
        btnGenerate.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          Generate GIF
        `;
      }
    }, 50);
  });
}

// ==========================================
// 3. STEP INSPECTOR CONTROLLER
// ==========================================
function showInspectedFrame(index) {
  if (!currentRenderedFrames || currentRenderedFrames.length === 0) return;
  if (index < 0) index = currentRenderedFrames.length - 1;
  if (index >= currentRenderedFrames.length) index = 0;

  currentInspectedIndex = index;
  const frameBytes = currentRenderedFrames[index];
  const meta = currentFramesMeta ? currentFramesMeta[index] : null;

  // Render on inspector canvas
  inspectorCanvas.width = currentFrameWidth;
  inspectorCanvas.height = currentFrameHeight;
  const ctx = inspectorCanvas.getContext('2d');
  const imgData = new ImageData(new Uint8ClampedArray(frameBytes.buffer), currentFrameWidth, currentFrameHeight);
  ctx.putImageData(imgData, 0, 0);

  // Update labels according to precomputed frame metadata
  if (meta && meta.inspectorTitle) {
    inspectorTitle.innerHTML = meta.inspectorTitle;
  } else {
    inspectorTitle.innerHTML = `Step #${index + 1}`;
  }
  inspectorCounter.textContent = `${index + 1} / ${currentRenderedFrames.length}`;

  // Update active border on step cards
  const allCards = stepsStrip.querySelectorAll('.step-card');
  allCards.forEach((c, i) => {
    c.classList.toggle('active', i === index);
  });

  // Scroll the active card smoothly into view inside the strip
  if (allCards[index]) {
    allCards[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  stepInspector.style.display = 'flex';
  stepInspector.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

if (inspectorPrev) {
  inspectorPrev.addEventListener('click', () => {
    if (currentInspectedIndex !== -1) {
      showInspectedFrame(currentInspectedIndex - 1);
    }
  });
}

if (inspectorNext) {
  inspectorNext.addEventListener('click', () => {
    if (currentInspectedIndex !== -1) {
      showInspectedFrame(currentInspectedIndex + 1);
    }
  });
}

if (inspectorClose) {
  inspectorClose.addEventListener('click', () => {
    stepInspector.style.display = 'none';
    currentInspectedIndex = -1;
    const allCards = stepsStrip.querySelectorAll('.step-card');
    allCards.forEach(c => c.classList.remove('active'));
  });
}

// Arrow Key Navigation (Left / Right / Esc)
window.addEventListener('keydown', (e) => {
  if (stepInspector && stepInspector.style.display !== 'none' && currentInspectedIndex !== -1) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      showInspectedFrame(currentInspectedIndex - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      showInspectedFrame(currentInspectedIndex + 1);
    } else if (e.key === 'Escape') {
      stepInspector.style.display = 'none';
      currentInspectedIndex = -1;
      const allCards = stepsStrip.querySelectorAll('.step-card');
      allCards.forEach(c => c.classList.remove('active'));
    }
  }
});

// ==========================================
// 4. EXPORT & UTILITY ACTIONS
// ==========================================
const btnCopyGif = document.getElementById('btn-copy-gif');
const copyBtnText = document.getElementById('copy-btn-text');
const btnExportWebp = document.getElementById('btn-export-webp');
const btnExportSpritesheet = document.getElementById('btn-export-spritesheet');

// Copy GIF to Clipboard
if (btnCopyGif) {
  btnCopyGif.addEventListener('click', async () => {
    if (!activeBlobUrl) return;
    try {
      btnCopyGif.disabled = true;
      copyBtnText.textContent = 'Copying...';
      const response = await fetch(activeBlobUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/gif': blob })
      ]);
      copyBtnText.textContent = '✓ Copied!';
      setTimeout(() => {
        copyBtnText.textContent = 'Copy to Clipboard';
        btnCopyGif.disabled = false;
      }, 2000);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
      // Fallback: copy blob URL
      try {
        await navigator.clipboard.writeText(location.href);
        copyBtnText.textContent = 'Link Copied!';
      } catch {
        copyBtnText.textContent = 'Copy not supported';
      }
      setTimeout(() => {
        copyBtnText.textContent = 'Copy to Clipboard';
        btnCopyGif.disabled = false;
      }, 2000);
    }
  });
}

// Export Sprite Sheet PNG (Grid layout)
if (btnExportSpritesheet) {
  btnExportSpritesheet.addEventListener('click', () => {
    if (!currentRenderedFrames || currentRenderedFrames.length === 0) return;

    const total = currentRenderedFrames.length;
    const cols = Math.min(10, Math.ceil(Math.sqrt(total)));
    const rows = Math.ceil(total / cols);

    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = cols * currentFrameWidth;
    sheetCanvas.height = rows * currentFrameHeight;
    const sheetCtx = sheetCanvas.getContext('2d');

    currentRenderedFrames.forEach((frameBytes, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = currentFrameWidth;
      tempCanvas.height = currentFrameHeight;
      const tempCtx = tempCanvas.getContext('2d');
      const imgData = new ImageData(new Uint8ClampedArray(frameBytes.buffer), currentFrameWidth, currentFrameHeight);
      tempCtx.putImageData(imgData, 0, 0);

      sheetCtx.drawImage(tempCanvas, col * currentFrameWidth, row * currentFrameHeight);
    });

    const link = document.createElement('a');
    link.download = `A2B_spritesheet_${total}frames.png`;
    link.href = sheetCanvas.toDataURL('image/png');
    link.click();
  });
}

// Export Animated Video (WebM / MP4 via MediaRecorder)
if (btnExportWebp) {
  btnExportWebp.addEventListener('click', () => {
    if (!currentRenderedFrames || currentRenderedFrames.length === 0) return;

    btnExportWebp.disabled = true;
    const origText = btnExportWebp.innerHTML;
    btnExportWebp.innerHTML = `<span class="spinner"></span> Encoding Video...`;

    const canvas = document.createElement('canvas');
    canvas.width = currentFrameWidth;
    canvas.height = currentFrameHeight;
    const ctx = canvas.getContext('2d');

    const stream = canvas.captureStream(30);
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const videoBlob = new Blob(chunks, { type: mimeType });
      const videoUrl = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `A2B_animation_${currentFrameWidth}x${currentFrameHeight}.webm`;
      a.click();

      btnExportWebp.innerHTML = origText;
      btnExportWebp.disabled = false;
    };

    recorder.start();

    // Render frames sequentially to canvas stream
    const delay = parseInt(delayInput.value, 10) || 100;
    let fIdx = 0;

    function renderNext() {
      if (fIdx >= currentRenderedFrames.length) {
        setTimeout(() => recorder.stop(), delay);
        return;
      }
      const frameBytes = currentRenderedFrames[fIdx++];
      const imgData = new ImageData(new Uint8ClampedArray(frameBytes.buffer), currentFrameWidth, currentFrameHeight);
      ctx.putImageData(imgData, 0, 0);
      setTimeout(renderNext, delay);
    }

    renderNext();
  });
}

initWasm();
