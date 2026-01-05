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

// Pseudo-random noise function for deterministic pixel dissolve
static inline float hash2d(int x, int y) {
    int n = x + y * 57;
    n = (n << 13) ^ n;
    return (1.0f - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0f) * 0.5f + 0.5f;
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
                        float noise = hash2d(x, y);
                        blend = (t >= noise) ? 1.0f : 0.0f;
                        break;
                    }
                    case TransitionMode::ZoomBlend: {
                        // Smooth cubic easing crossfade
                        float ease_t = t * t * (3.0f - 2.0f * t);
                        blend = ease_t;
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
