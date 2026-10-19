/*
 * FineNotes' bridge to whisper.cpp (MIT), compiled to one single-threaded
 * WebAssembly module (see build.sh). It runs inside a Web Worker, which
 * needs no SharedArrayBuffer and so no cross-origin isolation: Obsidian has
 * neither on the desktop nor on the iPad.
 *
 * The worker loads a model from bytes it hands over, then transcribes one
 * window of 16 kHz mono float samples at a time and reads the segments
 * back. Progress is reported through an imported JavaScript function; a
 * cancel is the worker being terminated, since nothing else can run while
 * whisper_full does.
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten.h>

#include "whisper.h"

/* The worker's progress handler: percent of the window decoded. */
EM_JS(void, fn_on_progress, (int percent), { if (Module.onProgress) Module.onProgress(percent); });

static void on_progress(struct whisper_context *ctx, struct whisper_state *state, int progress, void *user) {
    (void)ctx;
    (void)state;
    (void)user;
    fn_on_progress(progress);
}

static void quiet_log(enum ggml_log_level level, const char *text, void *user) {
    (void)level;
    (void)text;
    (void)user;
}

/* Options the worker may set before loading or transcribing (benchmarks compare them). */
static int opt_flash_attn = 1;
static int opt_fallback = 1;

/* `flash`: flash attention (read at fn_init). `fallback`: retry a window at higher temperatures when its decoding looks wrong. */
EMSCRIPTEN_KEEPALIVE
void fn_configure(int flash, int fallback) {
    opt_flash_attn = flash != 0;
    opt_fallback = fallback != 0;
}

EMSCRIPTEN_KEEPALIVE
void *fn_malloc(int bytes) { return malloc((size_t)bytes); }

EMSCRIPTEN_KEEPALIVE
void fn_free(void *ptr) { free(ptr); }

/* A context from model bytes in the heap; NULL when they are not a model. The bytes may be freed after. */
EMSCRIPTEN_KEEPALIVE
struct whisper_context *fn_init(void *model, int bytes) {
    whisper_log_set(quiet_log, NULL);
    struct whisper_context_params params = whisper_context_default_params();
    params.use_gpu = false;
    params.flash_attn = opt_flash_attn != 0;
    return whisper_init_from_buffer_with_params(model, (size_t)bytes, params);
}

EMSCRIPTEN_KEEPALIVE
void fn_release(struct whisper_context *ctx) {
    if (ctx) whisper_free(ctx);
}

/* 1 when the model knows many languages, 0 for an English-only (*.en) model. */
EMSCRIPTEN_KEEPALIVE
int fn_is_multilingual(struct whisper_context *ctx) { return whisper_is_multilingual(ctx); }

/*
 * Transcribe `n` samples. `language` is an ISO 639-1 code, or "auto" to
 * detect it per window; `prompt` (may be empty) is the text before this
 * window, so a sentence cut by the window goes on in the same style.
 * Returns the number of segments, or a negative number on failure.
 */
EMSCRIPTEN_KEEPALIVE
int fn_transcribe(struct whisper_context *ctx, const float *samples, int n, const char *language,
                  const char *prompt, int translate) {
    struct whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = 1;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_special = false;
    params.print_timestamps = false;
    params.translate = translate != 0;
    params.language = language;
    params.detect_language = false;
    params.no_context = true;
    params.initial_prompt = (prompt && prompt[0]) ? prompt : NULL;
    params.suppress_blank = true;
    params.suppress_nst = true;
    if (!opt_fallback) params.temperature_inc = 0.0f;
    params.progress_callback = on_progress;
    params.progress_callback_user_data = NULL;
    if (whisper_full(ctx, params, samples, n) != 0) return -1;
    return whisper_full_n_segments(ctx);
}

/* The language of the last window, as a code ("en"). */
EMSCRIPTEN_KEEPALIVE
const char *fn_language(struct whisper_context *ctx) {
    return whisper_lang_str(whisper_full_lang_id(ctx));
}

EMSCRIPTEN_KEEPALIVE
const char *fn_segment_text(struct whisper_context *ctx, int i) { return whisper_full_get_segment_text(ctx, i); }

/* Segment start and end in centiseconds from the start of the window. */
EMSCRIPTEN_KEEPALIVE
int fn_segment_t0(struct whisper_context *ctx, int i) { return (int)whisper_full_get_segment_t0(ctx, i); }

EMSCRIPTEN_KEEPALIVE
int fn_segment_t1(struct whisper_context *ctx, int i) { return (int)whisper_full_get_segment_t1(ctx, i); }

/* How sure the model is that the segment holds no speech, in thousandths. */
EMSCRIPTEN_KEEPALIVE
int fn_segment_no_speech(struct whisper_context *ctx, int i) {
    return (int)(whisper_full_get_segment_no_speech_prob(ctx, i) * 1000.0f);
}
