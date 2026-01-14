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

function createFastGif(frames, width, height, delayMs, loop = true) {
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
  bytes.push(0xF7, 0, 0);

  for (let r = 0; r < 6; ++r) {
    for (let g = 0; g < 7; ++g) {
      for (let b = 0; b < 6; ++b) {
        bytes.push(Math.round(r * 255 / 5));
        bytes.push(Math.round(g * 255 / 6));
        bytes.push(Math.round(b * 255 / 5));
      }
    }
  }
  const extra = [32, 64, 128, 200];
  for (let x of extra) bytes.push(x, x, x);

  if (loop) {
    bytes.push(0x21, 0xFF, 11);
    appendStr("NETSCAPE2.0");
    bytes.push(3, 1);
    appendU16(0);
    bytes.push(0);
  }

  const quantize = (r, g, b) => {
    let ri = Math.min(5, Math.floor((r * 5 + 127) / 255));
    let gi = Math.min(6, Math.floor((g * 6 + 127) / 255));
    let bi = Math.min(5, Math.floor((b * 5 + 127) / 255));
    return ri * 42 + gi * 6 + bi;
  };

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
  // If running via HTTP/HTTPS, attempt loading WebAssembly
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    try {
      const script = document.createElement('script');
      script.src = 'wasm/blendforge.js';
      script.onload = async () => {
        if (window.BlendForgeModule) {
          wasmModule = await window.BlendForgeModule();
          updateBadge(true);
        }
      };
      script.onerror = () => updateBadge(false);
      document.head.appendChild(script);
    } catch {
      updateBadge(false);
    }
  } else {
    // When opened directly via file://, browser prevents Wasm loading due to CORS
    updateBadge(false);
  }
}

function updateBadge(isWasm) {
  const badge = document.querySelector('.sub-tag');
  if (badge) {
    badge.textContent = isWasm ? 'C++20 WASM ACTIVE' : 'CLIENT ENGINE ACTIVE';
    if (!isWasm) {
      badge.style.background = 'rgba(6, 182, 212, 0.15)';
      badge.style.borderColor = 'rgba(6, 182, 212, 0.3)';
      badge.style.color = '#67e8f9';
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

const stepInput = document.getElementById('step-count');
const stepVal = document.getElementById('step-val');
const delayInput = document.getElementById('frame-delay');
const delayVal = document.getElementById('delay-val');
const modeSelect = document.getElementById('transition-mode');
const bounceInput = document.getElementById('bounce-mode');

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
let currentFrameCount = 0;
let currentForwardCount = 0;
let currentBounce = false;

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
      } else {
        imgBData = img;
        previewB.src = dataUrl;
        previewB.style.display = 'block';
        contentB.style.display = 'none';
        dropB.classList.add('has-image');
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

  // Exact same dimensions
  if (wA === wB && hA === hB) {
    let w = wA - (wA % 2);
    let h = hA - (hA % 2);
    return { width: Math.max(2, w), height: Math.max(2, h) };
  }

  // Base canvas resolution on the smaller image (by area)
  const areaA = wA * hA;
  const areaB = wB * hB;
  let targetW = areaA <= areaB ? wA : wB;
  let targetH = areaA <= areaB ? hA : hB;

  let finalW = targetW - (targetW % 2);
  let finalH = targetH - (targetH % 2);
  return { width: Math.max(2, finalW), height: Math.max(2, finalH) };
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

if (btnGenerate) {
  btnGenerate.addEventListener('click', async () => {
    if (!imgAData || !imgBData) return;

    btnGenerate.disabled = true;
    btnGenerate.innerHTML = `<span class="spinner"></span> Generating...`;

    const steps = parseInt(stepInput.value, 10);
    const delayMs = parseInt(delayInput.value, 10);
    const mode = parseInt(modeSelect.value, 10);
    const bounce = bounceInput.checked;

    const { width, height } = determineDimensions();

    setTimeout(async () => {
      const startTime = performance.now();
      try {
        const { dataA, dataB } = processImages(width, height);
        let gifBytes = null;
        let usedEngine = "Client-Side Engine";

        // Always produce intermediate frames for the step-by-step gallery
        const intermediateFrames = [];
        const totalFrames = steps;
        const centerX = width * 0.5;
        const centerY = height * 0.5;
        const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

        const bayer8 = [
           0, 32,  8, 40,  2, 34, 10, 42,
          48, 16, 56, 24, 50, 18, 58, 26,
          12, 44,  4, 36, 14, 46,  6, 38,
          60, 28, 52, 20, 62, 30, 54, 22,
           3, 35, 11, 43,  1, 33,  9, 41,
          51, 19, 59, 27, 49, 17, 57, 25,
          15, 47,  7, 39, 13, 45,  5, 37,
          63, 31, 55, 23, 61, 29, 53, 21
        ];

        const getDissolveThreshold = (x, y) => {
          const bx = x % 8;
          const by = y % 8;
          const bayerVal = bayer8[by * 8 + bx] / 64.0;
          const pseudo = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1;
          return 0.7 * bayerVal + 0.3 * pseudo;
        };

        for (let s = 0; s < totalFrames; ++s) {
          const t = s / (totalFrames - 1);
          const frame = new Uint8Array(width * height * 4);

          for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
              const idx = (y * width + x) * 4;
              let blend = t;

              if (mode === 1) {
                const pos = x / width;
                blend = Math.max(0, Math.min(1, (t * 1.1 - pos) / 0.1));
              } else if (mode === 2) {
                const pos = y / height;
                blend = Math.max(0, Math.min(1, (t * 1.1 - pos) / 0.1));
              } else if (mode === 3) {
                const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
                blend = Math.max(0, Math.min(1, (t * maxDist - dist) / 15.0));
              } else if (mode === 4) {
                const threshold = getDissolveThreshold(x, y);
                blend = t >= threshold ? 1.0 : 0.0;
              } else if (mode === 5) {
                blend = t * t * (3 - 2 * t);
              }

              for (let c = 0; c < 4; ++c) {
                frame[idx + c] = Math.round(dataA[idx + c] + blend * (dataB[idx + c] - dataA[idx + c]));
              }
            }
          }
          intermediateFrames.push(frame);
        }

        let gifFrames = intermediateFrames;
        if (bounce && intermediateFrames.length > 2) {
          gifFrames = [...intermediateFrames];
          for (let i = intermediateFrames.length - 2; i > 0; --i) {
            gifFrames.push(intermediateFrames[i]);
          }
        }

        if (wasmModule && typeof wasmModule.createMorphGif === 'function') {
          usedEngine = "C++20 WebAssembly";
          const strA = String.fromCharCode.apply(null, dataA);
          const strB = String.fromCharCode.apply(null, dataB);
          gifBytes = wasmModule.createMorphGif(strA, strB, width, height, steps, delayMs, mode, bounce);
        } else {
          gifBytes = createFastGif(gifFrames, width, height, delayMs, true);
        }

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        const blob = new Blob([gifBytes], { type: 'image/gif' });

        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = URL.createObjectURL(blob);

        gifResult.src = activeBlobUrl;
        btnDownload.href = activeBlobUrl;
        btnDownload.download = `A2B_morph_${width}x${height}.gif`;

        const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
        perfMetrics.textContent = `Rendered ${steps} frames (${width}x${height}) in ${elapsed}s • Size: ${sizeMb} MB • Engine: ${usedEngine}`;

        // Populate Scrollable Steps Strip (with clear A->B and B->A bounce groupings)
        if (stepsStrip && stepsContainer) {
          stepsStrip.innerHTML = '';
          const forwardCount = intermediateFrames.length;
          const returnCount = bounce && intermediateFrames.length > 2 ? intermediateFrames.length - 2 : 0;

          if (bounce && returnCount > 0) {
            stepsCountLabel.textContent = `${forwardCount + returnCount} frames (${forwardCount} A→B + ${returnCount} B→A)`;
          } else {
            stepsCountLabel.textContent = `${forwardCount} steps (A → B)`;
          }

          let addedDivider = false;

          gifFrames.forEach((frameBytes, idx) => {
            const isReturn = bounce && idx >= forwardCount;

            // Insert vertical visual divider before the return loop starts
            if (isReturn && !addedDivider) {
              const divider = document.createElement('div');
              divider.className = 'step-divider';
              divider.innerHTML = `<span>⟲ Return Loop<br>(B → A)</span>`;
              stepsStrip.appendChild(divider);
              addedDivider = true;
            }

            const card = document.createElement('div');
            card.className = isReturn ? 'step-card return' : 'step-card';

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(new Uint8ClampedArray(frameBytes.buffer), width, height);
            ctx.putImageData(imgData, 0, 0);

            const meta = document.createElement('div');
            meta.className = 'step-meta';

            if (!isReturn) {
              const pct = Math.round((idx / (forwardCount - 1)) * 100);
              meta.innerHTML = `<span class="step-num">#${idx + 1}</span><span class="step-pct">A→B (${pct}%)</span>`;
            } else {
              const returnIndex = idx - forwardCount + 1;
              meta.innerHTML = `<span class="step-num">#${idx + 1}</span><span class="step-pct">B→A</span>`;
            }

            card.appendChild(canvas);
            card.appendChild(meta);

            // Click step card to open inspector above the strip
            card.addEventListener('click', () => {
              showInspectedFrame(idx);
            });

            stepsStrip.appendChild(card);
          });

          // Save current state for inspector
          currentRenderedFrames = gifFrames;
          currentFrameWidth = width;
          currentFrameHeight = height;
          currentForwardCount = forwardCount;
          currentBounce = bounce;

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

  // Update labels
  const isReturn = currentBounce && index >= currentForwardCount;
  if (!isReturn) {
    const pct = Math.round((index / (currentForwardCount - 1)) * 100);
    inspectorTitle.innerHTML = `Step #${index + 1} &bull; Forward (A &rarr; B) &bull; <span style="color:var(--accent)">${pct}%</span>`;
  } else {
    inspectorTitle.innerHTML = `Step #${index + 1} &bull; Return Loop (B &rarr; A)`;
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
