import { createFastGif } from './gif-engine.js';

let wasmModule = null;
let imgAData = null;
let imgBData = null;
let activeBlobUrl = null;

// Initialize WebAssembly if compiled binary exists
async function initWasm() {
  try {
    if (window.BlendForgeModule) {
      wasmModule = await window.BlendForgeModule();
      console.log("[A2B.gif] WebAssembly C++20 module ready.");
      updateBadge(true);
      return;
    }
    // Attempt dynamic import if available
    const script = document.createElement('script');
    script.src = 'wasm/blendforge.js';
    script.onload = async () => {
      if (window.BlendForgeModule) {
        wasmModule = await window.BlendForgeModule();
        console.log("[A2B.gif] WebAssembly loaded dynamically.");
        updateBadge(true);
      }
    };
    script.onerror = () => {
      console.log("[A2B.gif] Wasm binary not built yet. Using browser fallback engine.");
      updateBadge(false);
    };
    document.head.appendChild(script);
  } catch (e) {
    console.warn("[A2B.gif] Wasm init fallback:", e);
    updateBadge(false);
  }
}

function updateBadge(isWasm) {
  const badge = document.querySelector('.sub-tag');
  if (badge) {
    badge.textContent = isWasm ? 'C++20 WASM ACTIVE' : 'C++20 READY / HYBRID';
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
const resolutionSelect = document.getElementById('render-resolution');
const bounceInput = document.getElementById('bounce-mode');

const btnGenerate = document.getElementById('btn-generate');
const outputSection = document.getElementById('output-section');
const gifResult = document.getElementById('gif-result');
const btnDownload = document.getElementById('btn-download');
const perfMetrics = document.getElementById('perf-metrics');

// Update UI Sliders
stepInput.addEventListener('input', () => stepVal.textContent = stepInput.value);
delayInput.addEventListener('input', () => delayVal.textContent = `${delayInput.value} ms`);

// Image Loading Helper
function handleImageFile(file, isA) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      if (isA) {
        imgAData = img;
        previewA.src = e.target.result;
        previewA.style.display = 'block';
        contentA.style.display = 'none';
      } else {
        imgBData = img;
        previewB.src = e.target.result;
        previewB.style.display = 'block';
        contentB.style.display = 'none';
      }
      checkReady();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

fileInputA.addEventListener('change', (e) => handleImageFile(e.target.files[0], true));
fileInputB.addEventListener('change', (e) => handleImageFile(e.target.files[0], false));

[dropA, dropB].forEach((drop, idx) => {
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleImageFile(e.dataTransfer.files[0], idx === 0);
    }
  });
});

function checkReady() {
  btnGenerate.disabled = !(imgAData && imgBData);
}

// Rescale images onto uniform canvas and extract raw RGBA
function processImages(targetWidth, targetHeight) {
  const canvasA = document.createElement('canvas');
  canvasA.width = targetWidth;
  canvasA.height = targetHeight;
  const ctxA = canvasA.getContext('2d');
  ctxA.drawImage(imgAData, 0, 0, targetWidth, targetHeight);
  const dataA = ctxA.getImageData(0, 0, targetWidth, targetHeight).data;

  const canvasB = document.createElement('canvas');
  canvasB.width = targetWidth;
  canvasB.height = targetHeight;
  const ctxB = canvasB.getContext('2d');
  ctxB.drawImage(imgBData, 0, 0, targetWidth, targetHeight);
  const dataB = ctxB.getImageData(0, 0, targetWidth, targetHeight).data;

  return { dataA, dataB };
}

// Generate GIF
btnGenerate.addEventListener('click', async () => {
  if (!imgAData || !imgBData) return;

  btnGenerate.disabled = true;
  btnGenerate.innerHTML = `<span class="spinner"></span> Generating...`;

  const steps = parseInt(stepInput.value, 10);
  const delayMs = parseInt(delayInput.value, 10);
  const mode = parseInt(modeSelect.value, 10);
  const maxDim = parseInt(resolutionSelect.value, 10);
  const bounce = bounceInput.checked;

  // Preserve aspect ratio from Image A
  let width = maxDim;
  let height = Math.round(maxDim * (imgAData.naturalHeight / imgAData.naturalWidth));
  // Round to even numbers for alignment
  width = width - (width % 2);
  height = height - (height % 2);

  setTimeout(async () => {
    const startTime = performance.now();
    try {
      const { dataA, dataB } = processImages(width, height);
      let gifBytes = null;
      let usedEngine = "JavaScript Fallback";

      if (wasmModule && typeof wasmModule.createMorphGif === 'function') {
        usedEngine = "C++20 WebAssembly";
        // Pass typed arrays as binary strings or memory
        const strA = String.fromCharCode.apply(null, dataA);
        const strB = String.fromCharCode.apply(null, dataB);
        gifBytes = wasmModule.createMorphGif(strA, strB, width, height, steps, delayMs, mode, bounce);
      } else {
        // Fallback generator matching C++ math
        const frames = [];
        const totalFrames = steps;
        const centerX = width * 0.5;
        const centerY = height * 0.5;
        const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

        const hash2d = (x, y) => {
          let n = (x + y * 57) | 0;
          n = (n << 13) ^ n;
          return (((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0) * 0.5;
        };

        for (let s = 0; s < totalFrames; ++s) {
          const t = s / (totalFrames - 1);
          const frame = new Uint8Array(width * height * 4);

          for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
              const idx = (y * width + x) * 4;
              let blend = t;

              if (mode === 1) { // Wipe L to R
                const pos = x / width;
                blend = Math.max(0, Math.min(1, (t * 1.1 - pos) / 0.1));
              } else if (mode === 2) { // Wipe T to B
                const pos = y / height;
                blend = Math.max(0, Math.min(1, (t * 1.1 - pos) / 0.1));
              } else if (mode === 3) { // Circle
                const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
                blend = Math.max(0, Math.min(1, (t * maxDist - dist) / 15.0));
              } else if (mode === 4) { // Pixel Dissolve
                blend = t >= hash2d(x, y) ? 1.0 : 0.0;
              } else if (mode === 5) { // Cubic
                blend = t * t * (3 - 2 * t);
              }

              for (let c = 0; c < 4; ++c) {
                frame[idx + c] = Math.round(dataA[idx + c] + blend * (dataB[idx + c] - dataA[idx + c]));
              }
            }
          }
          frames.push(frame);
        }

        if (bounce && frames.length > 2) {
          for (let i = frames.length - 2; i > 0; --i) {
            frames.push(frames[i]);
          }
        }

        gifBytes = createFastGif(frames, width, height, delayMs, true);
      }

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      const blob = new Blob([gifBytes], { type: 'image/gif' });
      
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = URL.createObjectURL(blob);

      gifResult.src = activeBlobUrl;
      btnDownload.href = activeBlobUrl;
      btnDownload.download = `A2B_morph_${width}x${height}.gif`;

      const sizeKb = (blob.size / 1024).toFixed(1);
      perfMetrics.textContent = `Rendered ${steps} frames (${width}x${height}) in ${elapsed}s • Size: ${sizeKb} KB • Engine: ${usedEngine}`;

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

initWasm();
