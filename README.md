# A2B.gif ⚡

> **A high-performance C++20 WebAssembly GIF morph engine running entirely in the browser on GitHub Pages.**

Takes two images **A** and **B**, interpolates between them across custom frame counts, delays, and transition modes, and outputs an animated `.gif` file directly in the browser. Zero server costs or backend infrastructure required.

---

## 🚀 Live Demo

Deployable on GitHub Pages directly through GitHub Actions.

---

## ✨ Features

- **C++20 & WebAssembly Core**: High-speed image interpolation, palette quantization (6x7x6 color cube), and LZW GIF encoding.
- **Client-Side Execution**: Runs 100% inside the browser using Emscripten Wasm (with built-in instant JS fallback).
- **Multiple Transition Modes**:
  - `Crossfade`: Smooth linear alpha blend
  - `Horizontal Wipe`: Left-to-right directional wipe with feathered edges
  - `Vertical Wipe`: Top-to-bottom directional wipe
  - `Radial Circle Wipe`: Center outward circular expansion
  - `Matrix Pixel Dissolve`: High-frequency noise dissolve
  - `Smooth Cubic Blend`: Cubic bezier eased interpolation
- **Custom Controls**:
  - Steps / intermediate frame count (4 to 40 frames)
  - Frame delay (30 ms to 500 ms)
  - Max resolution scaling (256px, 400px, 600px)
  - Ping-Pong / Bounce loop mode (`A → B → A`)
- **Drag & Drop UI**: Clean modern glassmorphic interface with real-time preview and instant download.

---

## 📂 Repository Structure

```text
A2Bgif/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions workflow: emsdk compile + GitHub Pages deploy
├── cpp/
│   ├── CMakeLists.txt          # CMake configuration for Emscripten / Native builds
│   ├── include/
│   │   ├── blendforge.hpp      # Transition types, configuration, and interfaces
│   │   └── gif_encoder.hpp     # C++20 LZW GIF encoder with Netscape looping
│   ├── src/
│   │   └── blendforge.cpp      # Transition math and Emscripten bindings (embind)
│   ├── build_wasm.bat          # Local Windows build script for Emscripten
│   └── build_wasm.sh           # Local Linux/macOS build script
├── web/
│   ├── index.html              # Modern web app UI
│   ├── index.css               # Styling (dark glassmorphism, responsive)
│   ├── app.js                  # Main controller and Wasm bridge
│   ├── gif-engine.js           # Lightweight fallback encoder
│   └── wasm/                   # Destination for compiled blendforge.js & blendforge.wasm
└── README.md
```

---

## 🛠️ CLI & Build Commands

| Command | Platform | Description |
| :--- | :--- | :--- |
| `cd cpp && ./build_wasm.sh` | Linux / macOS | Compiles C++20 code into `web/wasm/blendforge.js` using `emcc`. |
| `cd cpp && build_wasm.bat` | Windows | Compiles C++20 code into `web/wasm/blendforge.js` using `emcc`. |
| `npx serve web` or `python -m http.server -d web 8080` | Any | Runs local preview server for testing. |

### Build Parameters Reference

| Flag | Default | Description |
| :--- | :--- | :--- |
| `-std=c++20` | `c++20` | Enables C++20 language features. |
| `-O3 -flto` | `Enabled` | Peak performance optimization and Link Time Optimization. |
| `--bind` | `Enabled` | Emscripten Embind for seamless C++ to JS type translation. |
| `-s WASM=1` | `1` | Outputs WebAssembly binary. |
| `-s ALLOW_MEMORY_GROWTH=1` | `1` | Dynamically allocates memory for large images. |
| `-s MODULARIZE=1` | `1` | Wraps output in `BlendForgeModule()` factory promise. |

---

## 🌐 GitHub Pages Deployment

1. Push this repository to GitHub under the name `A2B.gif`.
2. Go to **Settings** → **Pages** → **Build and deployment**.
3. Set **Source** to **GitHub Actions**.
4. Push to branch `main` — the workflow at `.github/workflows/deploy.yml` will automatically compile the C++20 Wasm module and deploy your website to:
   ```
   https://<your-username>.github.io/A2B.gif/
   ```

---

## 📄 License

MIT
