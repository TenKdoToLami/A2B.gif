#pragma once

// Single-header C++ GIF encoder using LZW compression and fixed/adaptive 256-color palette
#include <cstdint>
#include <vector>
#include <cstring>
#include <algorithm>

namespace blendforge::gif {

struct Color {
    uint8_t r, g, b;
};

// Generates uniform 6x7x6 color palette (252 colors) + 4 grayscale to fill 256
inline std::vector<Color> create_palette() {
    std::vector<Color> pal(256);
    int idx = 0;
    for (int r = 0; r < 6; ++r) {
        for (int g = 0; g < 7; ++g) {
            for (int b = 0; b < 6; ++b) {
                pal[idx++] = Color{
                    static_cast<uint8_t>(r * 255 / 5),
                    static_cast<uint8_t>(g * 255 / 6),
                    static_cast<uint8_t>(b * 255 / 5)
                };
            }
        }
    }
    // remaining 4 slots
    pal[252] = Color{32, 32, 32};
    pal[253] = Color{64, 64, 64};
    pal[254] = Color{128, 128, 128};
    pal[255] = Color{200, 200, 200};
    return pal;
}

inline uint8_t find_closest_palette_index(uint8_t r, uint8_t g, uint8_t b) {
    // Fast color quantization using 6x7x6 uniform cube mapping
    int ri = (r * 5 + 127) / 255;
    int gi = (g * 6 + 127) / 255;
    int bi = (b * 5 + 127) / 255;
    return static_cast<uint8_t>(ri * 42 + gi * 6 + bi);
}

// Simple bit writer for LZW
class BitWriter {
public:
    std::vector<uint8_t> buffer;
    uint32_t bit_buf{0};
    int bit_count{0};

    void write_bits(uint32_t value, int bits) {
        bit_buf |= (value << bit_count);
        bit_count += bits;
        while (bit_count >= 8) {
            buffer.push_back(static_cast<uint8_t>(bit_buf & 0xFF));
            bit_buf >>= 8;
            bit_count -= 8;
        }
    }

    void flush() {
        if (bit_count > 0) {
            buffer.push_back(static_cast<uint8_t>(bit_buf & 0xFF));
            bit_buf = 0;
            bit_count = 0;
        }
    }
};

// GIF LZW Encoder
inline std::vector<uint8_t> lzw_encode(const std::vector<uint8_t>& indexed_pixels, int min_code_size = 8) {
    BitWriter writer;
    const int clear_code = 1 << min_code_size;
    const int eoi_code = clear_code + 1;
    int code_size = min_code_size + 1;
    int next_code = eoi_code + 1;

    // Hash table for string table: key = (prefix << 8) | pixel
    const int HASH_SIZE = 5003;
    std::vector<int> hash_code(HASH_SIZE, -1);
    std::vector<int> hash_prefix(HASH_SIZE, -1);
    std::vector<uint8_t> hash_char(HASH_SIZE, 0);

    auto reset_table = [&]() {
        std::fill(hash_code.begin(), hash_code.end(), -1);
        std::fill(hash_prefix.begin(), hash_prefix.end(), -1);
        code_size = min_code_size + 1;
        next_code = eoi_code + 1;
    };

    writer.write_bits(clear_code, code_size);

    if (indexed_pixels.empty()) {
        writer.write_bits(eoi_code, code_size);
        writer.flush();
        return writer.buffer;
    }

    int prefix = indexed_pixels[0];

    for (size_t i = 1; i < indexed_pixels.size(); ++i) {
        uint8_t c = indexed_pixels[i];
        int hash = ((prefix << 8) | c) % HASH_SIZE;
        bool found = false;

        while (hash_code[hash] != -1) {
            if (hash_prefix[hash] == prefix && hash_char[hash] == c) {
                prefix = hash_code[hash];
                found = true;
                break;
            }
            hash = (hash + 1) % HASH_SIZE;
        }

        if (!found) {
            writer.write_bits(prefix, code_size);
            if (next_code < 4096) {
                hash_code[hash] = next_code++;
                hash_prefix[hash] = prefix;
                hash_char[hash] = c;
                if (next_code > (1 << code_size) && code_size < 12) {
                    code_size++;
                }
            } else {
                writer.write_bits(clear_code, code_size);
                reset_table();
            }
            prefix = c;
        }
    }

    writer.write_bits(prefix, code_size);
    writer.write_bits(eoi_code, code_size);
    writer.flush();

    // Package into GIF sub-blocks (max 255 bytes each)
    std::vector<uint8_t> block_stream;
    size_t offset = 0;
    while (offset < writer.buffer.size()) {
        size_t chunk_len = std::min(size_t(255), writer.buffer.size() - offset);
        block_stream.push_back(static_cast<uint8_t>(chunk_len));
        block_stream.insert(block_stream.end(), writer.buffer.begin() + offset, writer.buffer.begin() + offset + chunk_len);
        offset += chunk_len;
    }
    block_stream.push_back(0); // Block terminator
    return block_stream;
}

inline std::vector<uint8_t> create_gif(
    const std::vector<std::vector<uint8_t>>& rgba_frames,
    int width,
    int height,
    int delay_ms,
    bool loop = true
) {
    std::vector<uint8_t> out;
    if (rgba_frames.empty() || width <= 0 || height <= 0) return out;

    auto append_str = [&](const char* s) {
        out.insert(out.end(), s, s + std::strlen(s));
    };
    auto append_u16 = [&](uint16_t v) {
        out.push_back(static_cast<uint8_t>(v & 0xFF));
        out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    };

    // 1. Header: "GIF89a"
    append_str("GIF89a");

    // 2. Logical Screen Descriptor
    append_u16(static_cast<uint16_t>(width));
    append_u16(static_cast<uint16_t>(height));
    out.push_back(0xF7); // Global color table present, 8 bits/pixel, 256 colors
    out.push_back(0);    // Background color index
    out.push_back(0);    // Pixel aspect ratio

    // 3. Global Color Table (256 * 3 bytes)
    auto palette = create_palette();
    for (const auto& c : palette) {
        out.push_back(c.r);
        out.push_back(c.g);
        out.push_back(c.b);
    }

    // 4. Netscape 2.0 Loop Extension
    if (loop) {
        out.push_back(0x21); // Extension Introducer
        out.push_back(0xFF); // Application Extension
        out.push_back(11);   // Block Size
        append_str("NETSCAPE2.0");
        out.push_back(3);    // Sub-block data size
        out.push_back(1);    // Loop sub-block ID
        append_u16(0);       // 0 = Infinite loop
        out.push_back(0);    // Terminator
    }

    // 5. Frames
    uint16_t delay_cs = std::max<uint16_t>(1, static_cast<uint16_t>(delay_ms / 10)); // in 1/100 sec

    for (const auto& frame_rgba : rgba_frames) {
        // Graphics Control Extension
        out.push_back(0x21);
        out.push_back(0xF9);
        out.push_back(4);     // Block size
        out.push_back(0x04);  // Disposal method: do not dispose (overwrite)
        append_u16(delay_cs); // Frame delay
        out.push_back(0);     // Transparent color index (unused)
        out.push_back(0);     // Block terminator

        // Image Descriptor
        out.push_back(0x2C);
        append_u16(0); // Left
        append_u16(0); // Top
        append_u16(static_cast<uint16_t>(width));
        append_u16(static_cast<uint16_t>(height));
        out.push_back(0x00); // Local color table flag = 0

        // Quantize RGBA to indexed pixels
        size_t pixel_count = static_cast<size_t>(width) * height;
        std::vector<uint8_t> indexed(pixel_count);
        for (size_t i = 0; i < pixel_count; ++i) {
            uint8_t r = frame_rgba[i * 4 + 0];
            uint8_t g = frame_rgba[i * 4 + 1];
            uint8_t b = frame_rgba[i * 4 + 2];
            indexed[i] = find_closest_palette_index(r, g, b);
        }

        // LZW Minimum Code Size
        out.push_back(8);

        // LZW compressed data blocks
        auto lzw_blocks = lzw_encode(indexed, 8);
        out.insert(out.end(), lzw_blocks.begin(), lzw_blocks.end());
    }

    // 6. GIF Trailer
    out.push_back(0x3B);
    return out;
}

} // namespace blendforge::gif
