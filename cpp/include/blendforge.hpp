#pragma once

#include <cstdint>
#include <vector>
#include <string>
#include <algorithm>
#include <cmath>

namespace blendforge {

enum class TransitionMode {
    Crossfade = 0,
    WipeLeftToRight = 1,
    WipeTopToBottom = 2,
    CircleWipe = 3,
    PixelDissolve = 4,
    ZoomBlend = 5
};

struct TransitionConfig {
    int width{0};
    int height{0};
    int steps{15};
    int delay_ms{100}; // delay per frame in milliseconds (10ms unit in gif = delay_ms / 10)
    TransitionMode mode{TransitionMode::Crossfade};
    bool loop{true};
    bool bounce{false}; // A -> B -> A
};

// Generates RGBA frame buffers for each intermediate step
std::vector<std::vector<uint8_t>> generate_frames(
    const uint8_t* img_a,
    const uint8_t* img_b,
    const TransitionConfig& config
);

// Encodes RGBA frames into a valid GIF byte stream
std::vector<uint8_t> encode_gif(
    const std::vector<std::vector<uint8_t>>& frames,
    int width,
    int height,
    int delay_ms,
    bool loop
);

} // namespace blendforge
