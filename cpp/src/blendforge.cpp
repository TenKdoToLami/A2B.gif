#include "blendforge.hpp"
#include "gif_encoder.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
#include <emscripten/val.h>
using namespace emscripten;
#endif

namespace blendforge {

static inline uint8_t lerp_channel(uint8_t a, uint8_t b, float t) {
    return static_cast<uint8_t>(a + t * (b - a));
}

// 8x8 Bayer matrix for pixel matrix dissolve
static const uint8_t BAYER_8[64] = {
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
};

static inline float get_bayer_threshold(int x, int y) {
    int bx = x & 7;
    int by = y & 7;
    return static_cast<float>(BAYER_8[by * 8 + bx]) / 64.0f;
}

std::vector<std::vector<uint8_t>> generate_frames(
    const uint8_t* img_a,
    const uint8_t* img_b,
    const TransitionConfig& config
) {
    int total_frames = std::max(2, config.steps);
    int w = config.width;
    int h = config.height;
    size_t frame_bytes = static_cast<size_t>(w) * h * 4;

    std::vector<std::vector<uint8_t>> frames;
    frames.reserve(total_frames);

    float center_x = w * 0.5f;
    float center_y = h * 0.5f;
    float max_dist = std::sqrt(center_x * center_x + center_y * center_y);

    for (int step = 0; step < total_frames; ++step) {
        float t = static_cast<float>(step) / static_cast<float>(total_frames - 1);
        std::vector<uint8_t> frame(frame_bytes);

        for (int y = 0; y < h; ++y) {
            for (int x = 0; x < w; ++x) {
                size_t idx = (static_cast<size_t>(y) * w + x) * 4;

                uint8_t a_r = img_a[idx + 0], a_g = img_a[idx + 1], a_b = img_a[idx + 2], a_a = img_a[idx + 3];
                uint8_t b_r = img_b[idx + 0], b_g = img_b[idx + 1], b_b = img_b[idx + 2], b_a = img_b[idx + 3];

                float blend = 0.0f;

                switch (config.mode) {
                    case TransitionMode::Crossfade: {
                        blend = t;
                        break;
                    }
                    case TransitionMode::WipeLeftToRight: {
                        float pos = static_cast<float>(x) / static_cast<float>(w);
                        float edge = 0.1f; // softness edge
                        blend = std::clamp((t * (1.0f + edge) - pos) / edge, 0.0f, 1.0f);
                        break;
                    }
                    case TransitionMode::WipeTopToBottom: {
                        float pos = static_cast<float>(y) / static_cast<float>(h);
                        float edge = 0.1f;
                        blend = std::clamp((t * (1.0f + edge) - pos) / edge, 0.0f, 1.0f);
                        break;
                    }
                    case TransitionMode::CircleWipe: {
                        float dx = x - center_x;
                        float dy = y - center_y;
                        float dist = std::sqrt(dx * dx + dy * dy);
                        float target_dist = t * max_dist;
                        float edge = 15.0f; // pixel feathering
                        blend = std::clamp((target_dist - dist) / edge, 0.0f, 1.0f);
                        break;
                    }
                    case TransitionMode::PixelDissolve: {
                        float threshold = get_bayer_threshold(x, y);
                        blend = (t >= threshold) ? 1.0f : 0.0f;
                        break;
                    }
                    case TransitionMode::StrideSwap: {
                        int pixel_idx = y * w + x;
                        int bucket = (pixel_idx * 10007) % std::max(1, config.steps);
                        blend = (bucket <= step) ? 1.0f : 0.0f;
                        break;
                    }
                    case TransitionMode::FluidWarp: {
                        float u = static_cast<float>(x) / static_cast<float>(w);
                        float v = static_cast<float>(y) / static_cast<float>(h);
                        float flow_x = std::sin(v * 7.5f + t * 4.0f) * std::cos(u * 5.0f);
                        float flow_y = std::cos(u * 7.5f - t * 4.0f) * std::sin(v * 5.0f);
                        float wave_pos = (flow_x + flow_y) * 0.25f + 0.5f;
                        blend = std::clamp((t - wave_pos * 0.3f) / 0.7f, 0.0f, 1.0f);
                        break;
                    }
                    case TransitionMode::ParticleDrift: {
                        float u = static_cast<float>(x) / static_cast<float>(w);
                        float v = static_cast<float>(y) / static_cast<float>(h);
                        float lum_a = (0.299f * a_r + 0.587f * a_g + 0.114f * a_b) / 255.0f;
                        float lum_b = (0.299f * b_r + 0.587f * b_g + 0.114f * b_b) / 255.0f;
                        float diff = (lum_a - lum_b) * 0.5f;
                        blend = std::clamp((t - (u + diff) * 0.3f) / 0.7f, 0.0f, 1.0f);
                        break;
                    }
                }

                frame[idx + 0] = lerp_channel(a_r, b_r, blend);
                frame[idx + 1] = lerp_channel(a_g, b_g, blend);
                frame[idx + 2] = lerp_channel(a_b, b_b, blend);
                frame[idx + 3] = lerp_channel(a_a, b_a, blend);
            }
        }
        frames.push_back(std::move(frame));
    }

    if (config.bounce && frames.size() > 2) {
        size_t orig_size = frames.size();
        for (int i = static_cast<int>(orig_size) - 2; i > 0; --i) {
            frames.push_back(frames[i]);
        }
    }

    return frames;
}

std::vector<uint8_t> encode_gif(
    const std::vector<std::vector<uint8_t>>& frames,
    int width,
    int height,
    int delay_ms,
    bool loop
) {
    return gif::create_gif(frames, width, height, delay_ms, loop);
}

} // namespace blendforge

#ifdef __EMSCRIPTEN__

// Emscripten JavaScript Binding Layer
emscripten::val create_morph_gif_wasm(
    const std::string& raw_a,
    const std::string& raw_b,
    int width,
    int height,
    int steps,
    int delay_ms,
    int mode_idx,
    bool bounce
) {
    using namespace blendforge;

    TransitionConfig config;
    config.width = width;
    config.height = height;
    config.steps = steps;
    config.delay_ms = delay_ms;
    config.mode = static_cast<TransitionMode>(mode_idx);
    config.loop = true;
    config.bounce = bounce;

    const uint8_t* ptr_a = reinterpret_cast<const uint8_t*>(raw_a.data());
    const uint8_t* ptr_b = reinterpret_cast<const uint8_t*>(raw_b.data());

    auto frames = generate_frames(ptr_a, ptr_b, config);
    auto gif_bytes = encode_gif(frames, width, height, delay_ms, true);

    // Return as JavaScript Uint8Array
    return val(typed_memory_view(gif_bytes.size(), gif_bytes.data()));
}

EMSCRIPTEN_BINDINGS(blendforge_module) {
    emscripten::function("createMorphGif", &create_morph_gif_wasm);
}

#endif
