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
let currentFrameWidth = 0;
let currentFrameHeight = 0;
let currentForwardCount = 0;
let currentLoopMode = 'a-b-a';

// Sliders listener
if (stepInput && stepVal) {
  stepInput.addEventListener('input', () => {
    stepVal.textContent = stepInput.value;
  });
}
if (delayInput && delayVal) {
  delayInput.addEventListener('input', () => {
    delayVal.textContent = `${delayInput.value} ms`;
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
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

  for (let s = 0; s < totalFrames; ++s) {
    const rawT = s / (totalFrames - 1);
    const t = applyEasing(rawT, easing);
    const frame = new Uint8Array(width * height * 4);

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
          case 5: { // Smooth Cubic Blend
            blend = t * t * (3 - 2 * t);
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
        let phase1Frames = [];
        let phase2Frames = [];
        let phase1Title = 'A → B';
        let phase2Title = '';

        if (loopMode === 'a-to-b') {
          gifFrames = [...forwardFrames];
          phase1Frames = gifFrames;
          phase1Title = 'A → B';
        } else if (loopMode === 'b-to-a') {
          // Dedicated B -> A transition with fresh speed start at B
          const bToAFrames = generateIntermediateFrames(dataB, dataA, width, height, steps, mode, easing);
          gifFrames = bToAFrames;
          phase1Frames = gifFrames;
          phase1Title = 'B → A';
        } else if (loopMode === 'a-b-a') {
          // A -> B -> A: Leg 1 eases A -> B; speed resets at B; Leg 2 eases B -> A
          phase1Frames = [...forwardFrames];
          phase1Title = 'A → B';
          phase2Title = 'B → A';
          gifFrames = [...forwardFrames];

          const returnFrames = generateIntermediateFrames(dataB, dataA, width, height, steps, mode, easing);
          // Omit duplicate endpoints (Frame 0 which is B, and last frame which is A)
          if (returnFrames.length > 2) {
            for (let i = 1; i < returnFrames.length - 1; ++i) {
              gifFrames.push(returnFrames[i]);
              phase2Frames.push(returnFrames[i]);
            }
          }
        } else if (loopMode === 'b-a-b') {
          // B -> A -> B: Leg 1 eases B -> A; speed resets at A; Leg 2 eases A -> B
          const bToAFrames = generateIntermediateFrames(dataB, dataA, width, height, steps, mode, easing);
          phase1Frames = [...bToAFrames];
          phase1Title = 'B → A';
          phase2Title = 'A → B';
          gifFrames = [...bToAFrames];

          const returnFrames = generateIntermediateFrames(dataA, dataB, width, height, steps, mode, easing);
          if (returnFrames.length > 2) {
            for (let i = 1; i < returnFrames.length - 1; ++i) {
              gifFrames.push(returnFrames[i]);
              phase2Frames.push(returnFrames[i]);
            }
          }
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
          const hasPhase2 = phase2Frames.length > 0;

          if (hasPhase2) {
            stepsCountLabel.textContent = `${gifFrames.length} frames (${phase1Frames.length} ${phase1Title} + ${phase2Frames.length} ${phase2Title})`;
          } else {
            stepsCountLabel.textContent = `${gifFrames.length} frames (${phase1Title})`;
          }

          let addedDivider = false;

          gifFrames.forEach((frameBytes, idx) => {
            const isPhase2 = hasPhase2 && idx >= phase1Frames.length;

            if (isPhase2 && !addedDivider) {
              const divider = document.createElement('div');
              divider.className = 'step-divider';
              divider.innerHTML = `<span>⟲ Return Loop<br>(${phase2Title})</span>`;
              stepsStrip.appendChild(divider);
              addedDivider = true;
            }

            const card = document.createElement('div');
            card.className = isPhase2 ? 'step-card return' : 'step-card';

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(new Uint8ClampedArray(frameBytes.buffer), width, height);
            ctx.putImageData(imgData, 0, 0);

            const meta = document.createElement('div');
            meta.className = 'step-meta';

            if (!isPhase2) {
              const pct = Math.round((idx / (phase1Frames.length - 1)) * 100);
              meta.innerHTML = `<span class="step-num">#${idx + 1}</span><span class="step-pct">${phase1Title} (${pct}%)</span>`;
            } else {
              meta.innerHTML = `<span class="step-num">#${idx + 1}</span><span class="step-pct">${phase2Title}</span>`;
            }

            card.appendChild(canvas);
            card.appendChild(meta);

            card.addEventListener('click', () => {
              showInspectedFrame(idx);
            });

            stepsStrip.appendChild(card);
          });

          // Save current state for inspector
          currentRenderedFrames = gifFrames;
          currentFrameWidth = width;
          currentFrameHeight = height;
          currentForwardCount = phase1Frames.length;
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

  // Render on inspector canvas
  inspectorCanvas.width = currentFrameWidth;
  inspectorCanvas.height = currentFrameHeight;
  const ctx = inspectorCanvas.getContext('2d');
  const imgData = new ImageData(new Uint8ClampedArray(frameBytes.buffer), currentFrameWidth, currentFrameHeight);
  ctx.putImageData(imgData, 0, 0);

  // Update labels according to current loop mode
  const isSecondPhase = (currentLoopMode === 'a-b-a' || currentLoopMode === 'b-a-b') && index >= currentForwardCount;
  
  if (!isSecondPhase) {
    const dir = (currentLoopMode === 'b-to-a' || currentLoopMode === 'b-a-b') ? 'B &rarr; A' : 'A &rarr; B';
    const pct = Math.round((index / (currentForwardCount - 1)) * 100);
    inspectorTitle.innerHTML = `Step #${index + 1} &bull; ${dir} &bull; <span style="color:var(--accent)">${pct}%</span>`;
  } else {
    const dir = currentLoopMode === 'a-b-a' ? 'B &rarr; A (Return)' : 'A &rarr; B (Return)';
    inspectorTitle.innerHTML = `Step #${index + 1} &bull; ${dir}`;
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

initWasm();
