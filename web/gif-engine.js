// Fallback JavaScript GIF Encoder (NeuQuant palette + LZW) for zero-dependency instant previews
// while running standalone or when Wasm is loading

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

    // Hash table for string codes
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
    outs.push(0); // block terminator
  }
}

export function createFastGif(frames, width, height, delayMs, loop = true) {
  const bytes = [];
  const appendStr = (s) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  const appendU16 = (v) => {
    bytes.push(v & 0xff);
    bytes.push((v >> 8) & 0xff);
  };

  // 1. Header
  appendStr("GIF89a");

  // 2. Screen descriptor
  appendU16(width);
  appendU16(height);
  bytes.push(0xF7); // 256 colors
  bytes.push(0);
  bytes.push(0);

  // 3. Palette (Standard 6x7x6 cube)
  for (let r = 0; r < 6; ++r) {
    for (let g = 0; g < 7; ++g) {
      for (let b = 0; b < 6; ++b) {
        bytes.push(Math.round(r * 255 / 5));
        bytes.push(Math.round(g * 255 / 6));
        bytes.push(Math.round(b * 255 / 5));
      }
    }
  }
  // Remaining 4
  const extra = [32, 64, 128, 200];
  for (let x of extra) bytes.push(x, x, x);

  // 4. Netscape loop
  if (loop) {
    bytes.push(0x21, 0xFF, 11);
    appendStr("NETSCAPE2.0");
    bytes.push(3, 1);
    appendU16(0);
    bytes.push(0);
  }

  // Quantize function
  const quantize = (r, g, b) => {
    let ri = Math.min(5, Math.floor((r * 5 + 127) / 255));
    let gi = Math.min(6, Math.floor((g * 6 + 127) / 255));
    let bi = Math.min(5, Math.floor((b * 5 + 127) / 255));
    return ri * 42 + gi * 6 + bi;
  };

  const delayCs = Math.max(1, Math.round(delayMs / 10));

  for (let frame of frames) {
    // Graphic control
    bytes.push(0x21, 0xF9, 4, 0x04);
    appendU16(delayCs);
    bytes.push(0, 0);

    // Image descriptor
    bytes.push(0x2C);
    appendU16(0);
    appendU16(0);
    appendU16(width);
    appendU16(height);
    bytes.push(0);

    // Indexed pixels
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

  bytes.push(0x3B); // Trailer
  return new Uint8Array(bytes);
}
