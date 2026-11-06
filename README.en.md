# Vision Nexus

> A unified vision capability hub for DSH agents: multi-backend scheduling, 14 vision tools, a visual workbench, and fine-grained governance.


[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.5-6e56cf.svg)](https://github.com/deepseek-ai)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933.svg)](https://nodejs.org)

**English · [简体中文](README.md)**

---

## Introduction

**One sentence**: dsh-vision-nexus completes the image-perception loop for text-only models — it turns "vision" into 14 vision tools that a DSH agent can call directly, while putting *which backend was used, how much quota was spent, which step was slow, and where it failed* under observation and control.

A text-only model cannot see an image. Vision Nexus supplies that link, guided by three convictions:

**Backends should be replaceable.** Cloud APIs trade latency and cost for quality; local Ollama trades privacy and speed; Tesseract works offline but cannot reason. They should not be mutually exclusive — a single adapter abstraction places them side by side and lets the scheduling strategy decide who runs and who is the fallback.

**Failures must be visible.** One vision request may pass through cache lookup, quota check, concurrency queueing, backend retry and circuit-breaker fallback. Every request carries its own `traceId`, the full call chain is persisted, and the panel shows per-stage timings.

**Secrets do not belong in a config file.** All credentials are read and written only through DSH's built-in Credentials module; config files hold reference names only, and logs and exports are redacted automatically.

### Repository at a glance

| Item | Value |
| --- | --- |
| Plugin ID / package name | `dsh-vision-nexus` |
| Version | `0.1.0` (releaseChannel: `beta`) |
| Tools | **14** (`src/shared/tool-catalog.ts` is the single source of truth) |
| HTTP routes | **30** registered route entries; `plugin.json` declares **37** method+path operations |
| Frontend tabs | **6** (`dashboard` / `canvas` / `tools` / `workbench` / `runtime` / `governance`) |
| Backend kinds | **5** (`openai-compat` / `ollama` / `python-local` / `tesseract` / `custom`) |
| Scheduling strategies | **4** (`sequential` / `weighted-round-robin` / `local-first` / `lowest-latency`) |
| License | Apache-2.0 |

---

## Features

### Capability matrix

| Area | Composition | Key facts |
| --- | --- | --- |
| Backend abstraction | 5 adapters | OpenAI-compatible multimodal API, local Ollama vision models, managed Python runtime, offline Tesseract OCR, custom HTTP templates |
| Scheduling engine | 4 strategies + circuit breaker | Sequential fallback / weighted round-robin / local-first / lowest-latency; the breaker is orthogonal to the strategy |
| Vision tools | 14 tools | One file per tool, each with its own enable flag, timeout and daily quota |
| Runtime governance | Cache / quota / concurrency / sandbox | Content-addressed cache, three-level quota, per-session and global concurrency gates, directory-allowlist sandbox |
| Observability | Traces / logs / metrics | Per-request `traceId`, levelled logs, 24-hour trend, backend traffic share |
| Configuration | Snapshots / import-export / hot reload | Save-switch-delete snapshots, export is redacted by design, settings apply hot without a restart |
| Frontend panel | 6 tabs | Dashboard / scheduling canvas / tools / workbench / runtime & security / quota & logs |
| Security | Secrets / uploads / egress / allowlists | Reference-only secrets, MIME + magic-byte + size checks, egress timeout with redirects disabled, agent allowlist |

### 14 tools

| Tool | Purpose | Backends | Default timeout | Daily quota |
| --- | --- | --- | --- | --- |
| `vision_insight` | Describe an image and answer arbitrary questions about it | `openai-compat` / `ollama` / `custom` | 120000 ms | 200 |
| `vision_ground` | Locate a described target and return normalised boxes | `openai-compat` / `ollama` / `custom` | 120000 ms | 100 |
| `vision_detect` | Detect every object with class, confidence and boxes | `openai-compat` / `ollama` / `custom` | 120000 ms | 100 |
| `vision_crop` | Crop a region by pixel or normalised coordinates | `python-local` | 30000 ms | 300 |
| `vision_image_diff` | Pixel-level comparison of two images with a diff ratio and heat map | `python-local` | 60000 ms | 100 |
| `vision_long_ocr` | Chunked OCR over long screenshots, re-joined in order | `tesseract` / `openai-compat` | 180000 ms | 60 |
| `vision_remove_bg` | Transparent PNG, optionally over a solid colour | `python-local` / `openai-compat` / `custom` | 120000 ms | 60 |
| `vision_extract_color` | Dominant colours with HEX / RGB / HSL and coverage | `python-local` | 30000 ms | 300 |
| `vision_html_capture` | Screenshot a URL or HTML snippet | `custom` | 90000 ms | 60 |
| `vision_svg_trace` | Trace a bitmap into clean SVG | `python-local` | 120000 ms | 60 |
| `vision_batch_ocr` | OCR many images with bounded concurrency | `tesseract` / `openai-compat` | 300000 ms | 20 |
| `vision_video_sample` | Extract frames by timestamp or interval | `python-local` | 180000 ms | 30 |
| `vision_chart_analyze` | Parse charts into a structured data table | `openai-compat` / `ollama` / `custom` | 120000 ms | 60 |
| `vision_code_scan` | Decode QR codes and 1D barcodes | `python-local` | 30000 ms | 300 |

Every tool has an **independent enable flag, timeout and quota**. A disabled tool is never registered with the model — the model simply cannot see it, which saves prompt budget and prevents accidental calls.

**Six of the 14 tools depend entirely on local algorithms** (`vision_crop`, `vision_image_diff`, `vision_extract_color`, `vision_svg_trace`, `vision_video_sample`, `vision_code_scan`), which is why they list only `python-local`; `vision_remove_bg` additionally treats the local algorithm as one of its optional backends. These operations are slow and expensive for a large model and take milliseconds locally.

### Runtime governance

- **Content-addressed cache**: keyed by `sha256(image) + tool + normalised args`; identical image and args are computed once. TTL defaults to 24 hours, capacity defaults to 512 MiB, eviction is LRU.
- **Three-level quota**: global (default 2000 / day), per backend (default 1000 / day) and per tool (see the table above); exceeding any level is rejected with a readable message.
- **Concurrency gates**: per session (default 2) and global (default 8); queueing is bounded, and overflow is rejected explicitly rather than hanging.
- **Task timeout**: default 120000 ms; on expiry the task is aborted and the slot is returned immediately.
- **Image buffer flow**: session-scoped deduplication, so one image is decoded once.

### Observability

- A `traceId` per request records image hash, candidate backends, chosen backend, per-stage timings, result summary and exceptions.
- Levelled logs (`debug` / `info` / `warn` / `error`) with filtering by keyword, level, backend and tool.
- Live dashboard metrics: request volume, success rate, failures, cache usage, backend traffic share and a 24-hour latency trend.

### Configuration management

- Configuration snapshots: save, switch in one click, delete.
- JSON import and export (export is redacted; secrets become the `<KEEP_EXISTING>` placeholder).
- Settings apply hot — the plugin is not restarted and routes are not dropped.

---

## Requirements

| Dependency | Version | Required | Behaviour when missing |
| --- | --- | --- | --- |
| DSH | `>= 0.2.1-rc.5` (`plugin.json` `engines.dsh`) | Yes | The plugin row is not loaded; no Vision Nexus entry appears in settings |
| Node.js | `^22.19.0 \|\| >=24.0.0` (`package.json` `engines.node`) | Only for source builds | `node scripts/build.mjs` cannot run, so no `lib/` is produced |
| Python | `python3 >= 3.10` (managed runtime) | Optional | The 6 pure-local tools return `VN_RUNTIME_MISSING`; every other tool is unaffected |
| Tesseract | `>= 5.0` (offline OCR fallback) | Optional | The offline path of `vision_long_ocr` / `vision_batch_ocr` is unavailable and can fall back to `openai-compat` |
| ffmpeg | `>= 6.0` (video frame sampling) | Optional | `vision_video_sample` is unavailable |

> **Measured on this machine**: DSH `0.2.2-rc.1` (the version of `@deepseek-ai/dsh-desktop-runtime`), which satisfies the `>= 0.2.1-rc.5` lower bound.
>
> A normal install (`dsh plugin add`) needs **no** Node and **no** clone — the published package already contains the built `lib/`.

---

## Installation commands

### Standard install (recommended, all users)

```bash
dsh plugin --profile desktop add dsh-vision-nexus
```

DSH pulls the published package from its plugin source and loads it; no clone, no Node, no build. Restart the DSH process and open **Settings → Vision Nexus** to see the 6 tabs.

### Pin a version

```bash
dsh plugin --profile desktop add dsh-vision-nexus@0.1.0
```

### Install from a Git repository

```bash
dsh plugin --profile desktop add git+https://github.com/Lonis89/dsh-vision-nexus.git
```

> When installing from Git, pnpm may block the `prepare` script. That script executes repository code during install — confirm you trust it, then follow pnpm's prompt to allowlist the package in the profile's `pnpm-workspace.yaml`.

### Install from local source (development only)

The `link:` prefix tells DSH this is a local directory rather than a published package; rebuild and restart after changing the source and it takes effect without reinstalling.

```bash
dsh plugin --profile desktop add link:<local-path>
```

### Upgrade

```bash
# Package install: adding again pulls the latest version
dsh plugin --profile desktop add dsh-vision-nexus

# Local link install: pull the source, rebuild, then restart the DSH process
node scripts/build.mjs
```

Upgrading from the old `vision-nexus` name: remove the old plugin first so the profile does not hold two rows, then install the new one. Data is migrated automatically on first start.

```bash
dsh plugin --profile desktop remove vision-nexus
dsh plugin --profile desktop add dsh-vision-nexus
```

### Uninstall

```bash
dsh plugin --profile desktop remove dsh-vision-nexus
```

Uninstalling does **not** delete the configuration, cache, logs or snapshots under `$DSH_HOME/dsh-vision-nexus`; remove that directory manually for a full cleanup.

### Confirming the install

1. `dsh --profile desktop --dump-config` lists a `dsh-vision-nexus` plugin row;
2. both `lib/index.js` and `lib/client.js` exist (for a local source install they are produced by `node scripts/build.mjs`);
3. after restarting DSH, the plugin list under **Settings → Plugins** shows `dsh-vision-nexus` enabled with no red error marker;
4. **Settings → Vision Nexus** opens and shows all 6 tabs.

> The CLI shape above (`dsh plugin --profile <profile> add|remove`) and the `link:` prefix are taken from the install notes in this repository's `cordis.patch.yml`. DSH CLI subcommands and flags evolve between versions, so **treat your local `dsh --help` as authoritative**; if the output differs, follow what `dsh --help` prints.

---

## Loading locally

### Prerequisites

- DSH `>= 0.2.1-rc.5` (verify with `dsh --version`)
- Node.js `^22.19.0 || >=24.0.0` (only for source development)
- A working DSH profile (`desktop` below)

### Steps (source install, development only)

**1. Clone or unpack to a local directory**

```bash
git clone https://github.com/Lonis89/dsh-vision-nexus.git
cd dsh-vision-nexus
```

**2. Build the artifacts**

The plugin ships as prebuilt ES modules, so `lib/` must exist before installing:

```bash
node scripts/build.mjs
```

The build script relies only on Node's built-in type stripping, so **TypeScript is not needed**.

**3. Check the directory layout**

```bash
ls
# package.json  plugin.json  cordis.patch.yml  lib/  src/  scripts/
```

`cordis.patch.yml` inserts the plugin into the profile and `lib/` is the build output; both are required.

**4. Install into the profile**

```bash
dsh plugin --profile desktop add link:<local-path>
```

Replace `<local-path>` with the actual path of the plugin root directory.

**5. Verify the mount**

```bash
dsh --profile desktop --dump-config | grep dsh-vision-nexus
```

The `dsh-vision-nexus` plugin row should appear.

**6. Start it and open the settings page**

After starting the profile, open Settings in the DSH sidebar and find the Vision Nexus entry.

### Loading a local directory from the plugin panel

For source development you can also install entirely through the GUI:

1. DSH sidebar → **Settings** at the bottom → find the **Plugins** section (called "Plugin Manager" in some versions)
2. Click **Add plugin** (or "+ Install") → choose **Local directory / Install from folder**
3. Pick the plugin root (the `dsh-vision-nexus` folder you cloned) in the system directory picker
4. The panel reads that directory's `package.json` and `cordis.patch.yml` and adds the plugin row to the profile
5. Wait for the status to move from **Installing** to **Enabled**

> If the panel offers no "Local directory" option, that DSH version only supports package-name installs. Use the CLI instead — `dsh plugin --profile desktop add link:<local-path>` — then refresh the page.

---

## First configuration

After install and enable, the entry lives in its **own settings section**, not inside the plugin list:

1. DSH sidebar → **Settings** at the bottom
2. Scroll the settings navigation down, past the plugin-management section, to **Vision Nexus**
3. Open it — 6 tabs appear

First-run configuration is three things: **configure one backend**, **optionally initialise Python**, **optionally add a directory allowlist**.

### 1. Configure a backend

Open the **Scheduling canvas** tab → add a backend. Fields per kind:

| Kind | Required fields | Optional fields | Notes |
| --- | --- | --- | --- |
| `openai-compat` | `baseUrl` (up to `/v1`), `model`, `apiKey` | `timeoutMs` / `retries` / `weight` / `priority` / `tags` | The plugin appends `/chat/completions`; the probe uses `/models` (costs no tokens) |
| `ollama` | `baseUrl` (e.g. `http://127.0.0.1:11434`), `model` | `timeoutMs` / `weight` / `priority` / `tags` | No API key; the `images` field accepts raw base64 only, which the plugin handles |
| `python-local` | none (local process) | `timeoutMs` / quota | `baseUrl` and `model` stay empty |
| `tesseract` | none (uses `tesseract` from PATH) | an absolute executable path in `baseUrl` | Offline OCR; languages are set per tool call |
| `custom` | `custom.endpoint` (URL template) | `custom.bodyTemplate` / `custom.resultPath` / `custom.authHeader` / `custom.authPrefix` / `custom.healthPath` | Template placeholders: `{{model}}` / `{{image}}` / `{{prompt}}` / `{{params}}` |

Common backend fields (`BackendSpec`, persisted in `state.json`; secrets excluded):

| Field | Type | Default | Range | Notes |
| --- | --- | --- | --- | --- |
| `id` | string | required | non-empty | Stable identifier, immutable after creation; used as a config key and part of the credential ref |
| `label` | string | same as `id` | — | Display name |
| `kind` | enum | required | 5 kinds | Selects the adapter |
| `enabled` | boolean | `true` | — | Whether it takes part in scheduling |
| `baseUrl` | string | `''` | — | API root |
| `model` | string | `''` | — | Model name; may be empty for local-runtime kinds |
| `apiKeyRef` | string | `''` (derived from `id`) | valid env-var name | Reference name only, never plaintext |
| `timeoutMs` | number | `60000` | 1000–900000 | Per-request timeout (ms) |
| `retries` | number | `0` | 0–10 | In-backend retries (excluding fallback) |
| `weight` | number | `1` | 1–100 | Weight under weighted round-robin |
| `priority` | number | `100` | 0–10000 | Lower runs first; canvas drag writes this back |
| `tags` | string[] | `[]` | — | Restricts the tools this backend serves; empty means "derive from the catalog" |
| `custom` | object | none | — | Template parameters for the custom adapter |

### 2. Secrets and credential references

- A backend stores only a **reference name** in `apiKeyRef`, of the form `VISION_NEXUS_{BACKEND_ID}_API_KEY`, derived from the backend ID: backend `openai-main` → `VISION_NEXUS_OPENAI_MAIN_API_KEY`.
- The real value is written through `ctx.credentials` into DSH's encrypted store; the API only ever returns the booleans `configured` and `writable`, **never plaintext**.
- Every call re-resolves the secret and **caches nothing**, so a rotated key takes effect immediately.
- An empty string always counts as "not configured": a blank key is never sent in a request.
- Exports replace the field with the `<KEEP_EXISTING>` placeholder; on import that placeholder means "keep the current value".

If the host provides no credentials service (`ctx.get('credentials')` returns undefined), `resolve()` returns undefined, `describe()` returns `writable: false` and `set()` throws `VN_CREDENTIAL_MISSING` — keyless local backends (Ollama / Tesseract / Python) still work.

### 3. Python runtime initialisation

Open **Runtime & security → Python managed runtime** and click "Initialise environment". See the next section.

### 4. Directory-allowlist sandbox

- Every disk read or write resolves the real path first and then compares it against the allowlist; an **empty allowlist denies all** disk access (fail-closed), rather than opening up.
- Out-of-bounds access returns `VN_SANDBOX_DENIED` with the rejected path, instead of failing silently.
- Containment uses `path.relative` rather than a string prefix, so `/allowed-evil` is not admitted by `/allowed`; symlink and `..` escapes are blocked too.
- The plugin's private directory (`$DSH_HOME/dsh-vision-nexus`) is always allowed, but never appears in the user-visible allowlist.
- The picker lives in **Runtime & security → Directory allowlist** and offers browsing plus a native picker; **browsing is subject to the allowlist as well**, so you cannot browse outside it.

---

## Configuring backends

### OpenAI-compatible multimodal API

Applies to OpenAI, DeepSeek vision models, relays, and self-hosted gateways such as vLLM / LM Studio / LiteLLM.

| Field | Example |
| --- | --- |
| Kind | `openai-compat` |
| Base URL | `https://api.openai.com/v1` |
| Model | `gpt-4o` |
| API key | `sk-...` (stored encrypted) |

Set the base URL up to `/v1`; the plugin appends `/chat/completions`, and the probe uses `/models` (no token cost).

### Ollama (local)

| Field | Example |
| --- | --- |
| Kind | `ollama` |
| Base URL | `http://127.0.0.1:11434` |
| Model | `llava:13b` / `qwen2.5-vl:7b` |
| API key | empty |

The probe additionally checks that the configured model really exists locally, which is far more useful than a bare "connection failed".

### Python managed runtime

| Field | Example |
| --- | --- |
| Kind | `python-local` |
| Base URL | empty (local process, no network) |
| Model | empty |

### Tesseract offline OCR

| Field | Example |
| --- | --- |
| Kind | `tesseract` |
| Base URL | empty (uses `tesseract` from PATH) or an absolute executable path |
| Model | empty |

**Offline fallback**: text extraction still works with no network and no vision model. Languages are set per tool call (default `chi_sim+eng`).

### Custom HTTP service

Any HTTP vision service can be wired in without changing code. Supply a template in the `custom` field:

```json
{
  "endpoint": "https://your-service.com/vision?model={{model}}",
  "bodyTemplate": "{\"model\":\"{{model}}\",\"prompt\":\"{{prompt}}\",\"image\":\"{{image}}\"}",
  "resultPath": "data.choices.0.message.content",
  "authHeader": "authorization",
  "authPrefix": "Bearer "
}
```

- `{{image}}` is replaced with a data URL; `{{prompt}}` / `{{model}}` / `{{params}}` behave the same way
- `resultPath` is a dot path that supports array indices (e.g. `choices.0`)
- `authHeader` defaults to `authorization` and `authPrefix` to `Bearer `
- If a `tags` array is set it restricts the supported tools (`*` allows all); when empty the tool catalog's declared backend kinds are used instead

---

## Python environment setup

### Why it is needed

**Six of the 14 tools depend entirely on local algorithms** (crop, palette, image diff, SVG trace, video sampling, code scanning). These are slow and expensive for a large model and take milliseconds locally. `vision_remove_bg` additionally lists Python as one of its optional backends — the vision model when available, the local algorithm when not.

Without Python the plugin **does not break**: the tools that need it return `VN_RUNTIME_MISSING` and everything else keeps working.

### One-click initialisation

Open **Runtime & security → Python managed runtime** and click "Initialise environment". The plugin will:

1. Detect a system interpreter (Windows prefers `py`, other platforms prefer `python3`)
2. Create an isolated virtual environment at `$DSH_HOME/dsh-vision-nexus/pyenv` (`python -m venv`)
3. Upgrade pip, then install `numpy>=1.26`, `pillow>=10.0` and `opencv-python-headless>=4.9`
4. Re-check health

Interpreter selection order: the venv interpreter, then a user-specified interpreter path, then auto-detection.

> Dependency list source: `defaultRequirements()` in `src/host/runtime/python-runtime.ts`. The repository's `python/requirements.txt` currently **does not exist**; `readRequirements()` falls back to that built-in list when the file is unreadable. If `python.requirements` in `state.json` is a non-empty array, it takes precedence.

### Manual setup

If initialisation fails, prepare it by hand:

```bash
# Create the venv
python -m venv "$DSH_HOME/dsh-vision-nexus/pyenv"

# Activate (Windows PowerShell)
& "$DSH_HOME\dsh-vision-nexus\pyenv\Scripts\Activate.ps1"

# Activate (Linux / macOS)
source "$DSH_HOME/dsh-vision-nexus/pyenv/bin/activate"

# Install dependencies
pip install "numpy>=1.26" "pillow>=10.0" "opencv-python-headless>=4.9"
```

Then put that venv's interpreter path into "Interpreter path" under Runtime & security.

### Health check

"Health check" verifies three things:

1. the interpreter is executable
2. the version is >= 3.10
3. the key packages import (`numpy`, `PIL`)

The report states exactly what is missing, for example "Missing dependencies: PIL, click 'Install dependencies'".

### Tesseract and ffmpeg

These are external dependencies, not installed through pip:

- **Tesseract**: needed by the offline path of `vision_long_ocr` / `vision_batch_ocr`. On Windows install `tesseract-ocr` and make sure `tesseract --version` works; Chinese needs the extra `chi_sim` language pack.
- **ffmpeg**: needed by `vision_video_sample`. Make sure `ffmpeg -version` works after installing.

When either is missing, only the affected tools return a clear error.

### Security notes

Every Python invocation spawns as an **argument array** with `shell: false`, which rules out command injection. Child processes are bounded: stdout is capped at 48 MiB and stderr at 4 MiB, and overflow is flagged explicitly rather than silently truncated into broken JSON. Termination is two-stage — SIGTERM, a 3-second grace period, then SIGKILL — so a process stuck in a native call cannot become a zombie.

---

## Tool reference

The 14 tools' metadata lives in `src/shared/tool-catalog.ts` as the **single source of truth**; the timeouts and quotas below are its `defaults`, and each can be overridden per tool in the **Tools** tab (timeout range 1000–900000 ms, quota 0–1000000 where `0` means unlimited).

| Tool | Purpose | Key parameters | Backends | Default timeout | Daily quota | Return shape | Example prompt (one) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `vision_insight` | Image question answering | `image`, `prompt`, `detail` | `openai-compat` / `ollama` / `custom` | 120000 ms | 200 | Natural-language text plus structured JSON | Use vision_insight to describe this image: colours, objects and scene |
| `vision_ground` | Target grounding | `image`, `target`, `maxBoxes` | `openai-compat` / `ollama` / `custom` | 120000 ms | 100 | List of normalised boxes | Use vision_ground to locate the "Sign in" button and return its normalised box |
| `vision_detect` | Object detection | `image`, `classes`, `minConfidence` | `openai-compat` / `ollama` / `custom` | 120000 ms | 100 | Class + confidence + boxes | Use vision_detect to detect every object with class and confidence |
| `vision_crop` | Region crop | `image`, `region`, `scale` | `python-local` | 30000 ms | 300 | PNG artifact | Use vision_crop to crop the top-left 20% and save it |
| `vision_image_diff` | Image diff | `image`/`imagePath`, `imageB`/`imagePathB`, `threshold`, `align` | `python-local` | 60000 ms | 100 | Diff ratio + heat map + highlights | Use vision_image_diff to compare these two screenshots and report the diff ratio |
| `vision_long_ocr` | Long screenshot OCR | `image`, `languages`, `layout` | `tesseract` / `openai-compat` | 180000 ms | 60 | Text re-joined in layout order | Use vision_long_ocr to read this long screenshot in reading order |
| `vision_remove_bg` | Background removal | `image`, `replaceColor`, `edgeFeather` | `python-local` / `openai-compat` / `custom` | 120000 ms | 60 | Transparent PNG (optionally solid colour) | Use vision_remove_bg to cut out the person and return a transparent PNG |
| `vision_extract_color` | Palette extraction | `image`, `count`, `region` | `python-local` | 30000 ms | 300 | HEX / RGB / HSL plus coverage | Use vision_extract_color to extract the dominant colours as HEX/RGB/HSL |
| `vision_html_capture` | Web capture | `url`, `html`, `viewport`, `fullPage`, `deviceScaleFactor` | `custom` | 90000 ms | 60 | PNG artifact | Use vision_html_capture to take a full-page screenshot of https://example.com |
| `vision_svg_trace` | SVG trace | `image`, `colorMode`, `smoothing`, `minArea` | `python-local` | 120000 ms | 60 | SVG artifact | Use vision_svg_trace to trace this bitmap into a clean SVG |
| `vision_batch_ocr` | Batch OCR | `images`, `languages`, `concurrency` | `tesseract` / `openai-compat` | 300000 ms | 20 | Structured text manifest | Use vision_batch_ocr on these 5 screenshots and export each text |
| `vision_video_sample` | Video frame sampling | `video`, `timestamps`, `intervalSec`, `maxFrames` | `python-local` | 180000 ms | 30 | Several PNG frames | Use vision_video_sample to extract a frame every 2 seconds, up to 5 frames |
| `vision_chart_analyze` | Chart analysis | `image`, `chartType`, `axesHint` | `openai-compat` / `ollama` / `custom` | 120000 ms | 60 | Structured data table | Use vision_chart_analyze to parse this bar chart into a data table |
| `vision_code_scan` | QR / barcode scan | `image`, `formats` | `python-local` | 30000 ms | 300 | Content + format + position | Use vision_code_scan to decode the QR code and print its content |

Additional notes:

- Three tools have `requiresImage = false` (`vision_html_capture`, `vision_batch_ocr`, `vision_video_sample`) and take `url`/`html`, `images` and `video` respectively.
- Each tool's `parameters` and `output.schema` must satisfy DSH's JSON Schema subset (`required` must be a string array on the `type: "object"` node); `scripts/check-dsh-contract.mjs` locks this down as a regression test.
- Artifacts (PNG / JPEG / SVG / JSON / text) are saved to the workspace by default and can be downloaded via `GET /api/dsh-vision-nexus/artifacts/{id}`.

---

## Acceptance prompts

Every prompt below can be copied straight to the agent. The last column names the tool it will call.

### English prompts

| Scenario | Copy-ready prompt | Tool the agent calls |
| --- | --- | --- |
| Image Q&A | Use vision_insight to describe this image and answer: how many cats are in it? | `vision_insight` |
| Grounding | Use vision_ground to locate the "Submit" button and return its normalised box | `vision_ground` |
| Detection | Use vision_detect to detect every object with class, confidence and boxes | `vision_detect` |
| Crop | Use vision_crop to crop the bottom-right quarter and save it scaled 2x | `vision_crop` |
| Image diff | Use vision_image_diff to compare these two UI screenshots and report the diff ratio and hot spots | `vision_image_diff` |
| Long OCR | Use vision_long_ocr to read this long scrolling screenshot in reading order | `vision_long_ocr` |
| Background removal | Use vision_remove_bg to cut out the product and return a transparent PNG | `vision_remove_bg` |
| Palette | Use vision_extract_color to extract the dominant colours with HEX, RGB, HSL and coverage | `vision_extract_color` |
| Web capture | Use vision_html_capture to take a full-page screenshot of https://example.com at width 1440 | `vision_html_capture` |
| SVG trace | Use vision_svg_trace to trace this logo bitmap into a clean single-colour SVG | `vision_svg_trace` |
| Batch OCR | Use vision_batch_ocr on these 8 invoice screenshots and export a text manifest | `vision_batch_ocr` |
| Video frames | Use vision_video_sample to extract one frame every 3 seconds, up to 6 frames | `vision_video_sample` |
| Chart parsing | Use vision_chart_analyze to parse this line chart into a time/value data table | `vision_chart_analyze` |
| QR / barcode | Use vision_code_scan to decode every QR code and barcode with its format | `vision_code_scan` |

### 中文提示词

| 场景 | 可直接复制的提示词 | Agent 调用的工具 |
| --- | --- | --- |
| 图像问答 | 用 vision_insight 描述这张图的内容，并回答：画面里有几只猫？ | `vision_insight` |
| 目标定位 | 用 vision_ground 定位图中的"提交"按钮，给出归一化坐标框 | `vision_ground` |
| 目标检测 | 用 vision_detect 检测这张图里的全部物体，输出类别、置信度和标注框 | `vision_detect` |
| 裁剪 | 用 vision_crop 把图中右下角 1/4 区域裁出来，放大 2 倍保存 | `vision_crop` |
| 图片差异 | 用 vision_image_diff 逐像素对比这两张 UI 截图，告诉我差异比例和高亮区域 | `vision_image_diff` |
| 长截图 OCR | 用 vision_long_ocr 识别这张滚动长截图，按阅读顺序输出全部文字 | `vision_long_ocr` |
| 抠图 | 用 vision_remove_bg 把商品主体抠出来，输出透明背景 PNG | `vision_remove_bg` |
| 主色提取 | 用 vision_extract_color 提取这张海报的主色调，给我 HEX、RGB、HSL 和占比 | `vision_extract_color` |
| 网页截图 | 用 vision_html_capture 对 https://example.com 做整页截图，宽度 1440 | `vision_html_capture` |
| SVG 矢量化 | 用 vision_svg_trace 把这个 logo 位图描摹成干净的单色 SVG | `vision_svg_trace` |
| 批量 OCR | 用 vision_batch_ocr 对目录里这 8 张发票截图批量识别，汇总成文本清单 | `vision_batch_ocr` |
| 视频抽帧 | 用 vision_video_sample 从这个视频每 3 秒抽一帧，最多 6 帧 | `vision_video_sample` |
| 图表解析 | 用 vision_chart_analyze 把这张折线图解析成「时间 / 数值」两列数据表 | `vision_chart_analyze` |
| 二维码 | 用 vision_code_scan 识别图中所有二维码和条形码，输出内容与格式 | `vision_code_scan` |

### A single multi-tool acceptance conversation

```text
Configure an OpenAI-compatible vision backend first. Then verify in order:
1. vision_insight describes this image;
2. vision_ground locates the "button" in it;
3. vision_crop cuts out the button region;
4. vision_extract_color extracts the button's main colour;
5. vision_remove_bg cuts out the button foreground.
For each step tell me the tool name, the backend and the elapsed time.
```

When all of it passes and the trace list shows this run's `traceId`, the plugin is working.

---

## Interface overview

The plugin registers as its own entry in the DSH settings page, "Vision Nexus" (the `settings.section` seat, `slotId = dsh-vision-nexus`, `order = 152`), with 6 tabs: `dashboard` / `canvas` / `tools` / `workbench` / `runtime` / `governance`. The look is glassmorphic, follows the host theme light/dark automatically, and stacks below 960px.

### Tab 1 · Dashboard (`dashboard`)

**What it does**: four KPI cards on top (requests today, success rate, failures, cache usage), then a donut chart of backend traffic share on the left and a 24-hour latency line chart on the right, with a tool-usage ranking and quick actions (jump to the workbench, one-click health check) at the bottom.

**Typical flow**: open it to get the overview → click "Health check" to probe every backend → jump into a tool from the ranking, or into the canvas from the empty state.

> When there have been no requests today the success rate renders as "—" rather than 0% or 100% — either number would lie (one paints a failure, the other paints health). Traffic share and series data come from `GET /overview` and `GET /series`.

### Tab 2 · Scheduling canvas (`canvas`)

**What it does**: each backend is a draggable node card whose top-left badge shows the current scheduling priority (1 runs first). Nodes carry a status light — green healthy / yellow throttled / red offline or cooling down — plus live latency and credential status.

**Typical flow**:
1. Click "Add backend" and fill in kind, base URL, key, timeout, retries and weight;
2. Drag nodes to reorder priority by vertical position; a "Save schedule" button appears (it writes back `priority` and the canvas coordinates);
3. Double-click a node to open the editor;
4. Click "Test" on a backend to verify connectivity (a success clears the circuit breaker immediately and resets the backoff counter);
5. Switch the scheduling strategy from the dropdown at the top.

Below the canvas a "Backend details" table offers a keyboard-accessible alternative to dragging.

### Tab 3 · Tools (`tools`)

**What it does**: a grid of 14 tool cards, each with a category icon, tool name, summary, enable switch, timeout input, quota input, and today's usage and last duration.

**Typical flow**:
1. The switch saves on click (a disabled tool is not registered with the model);
2. Timeout and quota validate and submit **on blur**, so typing does not fire a request per character;
3. Click a card to expand its details: supported backend kinds, today's successes and failures, English summary;
4. Bulk enable / disable from the top.

### Tab 4 · Workbench (`workbench`)

**What it does**: a three-column layout that stacks on narrow screens. Left: primary and comparison image inputs. Middle: tool dropdown plus run / stop buttons. Right: result preview (boxes overlaid on the image, diff heat map, OCR text, structured table, raw JSON).

**Typical flow**: drop an image in → pick a tool → run → copy the JSON or download an artifact; the last 8 characters of the trace ID appear at the bottom. This tab consumes no agent turns. See the next section.

### Tab 5 · Runtime & security (`runtime`)

**What it does**: five grouped cards —
1. **Python managed runtime**: enable switch, interpreter path, health check, one-click venv and dependency setup;
2. **Directory allowlist**: visual directory browser plus native picker, add / remove entries;
3. **Cache policy**: switch, TTL, capacity limit, current usage, one-click purge;
4. **Concurrency and circuit breaker**: per-session concurrency, global concurrency, task timeout, failure threshold, cooldown;
5. **Agent allowlist**: restrict tool calls by session ID.

**Typical flow**: this page uses a **draft + explicit save** model with a persistent save bar; switching tabs with unsaved changes raises a confirmation and a yellow dot appears on the tab.

### Tab 6 · Quota & logs (`governance`)

**What it does**:
- **Quota settings**: global daily limit, per-backend daily limit, statistics window (day / hour), plus a read-only per-tool usage table;
- **Runtime logs**: level dropdown, keyword search (350 ms debounce), filtering by tool / backend, one-click export (the exported file is redacted);
- **Configuration snapshots**: save a named snapshot, switch in one click, delete; plus JSON import and export.

**Typical flow**: adjust the limit → read the logs to locate a failure → save a snapshot as a known-good configuration.

---

## Using the workbench

The **Workbench** tab is a self-test entry point that consumes no agent turns. The workbench produces no vision capability of its own — it only calls configured backends — so first add at least one backend under **Scheduling canvas → Add backend** and click "Test" until it reports green.

### Three ways to supply an image

1. **Click to pick**: click the dashed box to open the file picker
2. **Drag and drop**: drag an image from the file explorer into the box
3. **Paste a screenshot**: subject to browser security policy; where it is unavailable, use option 1

After a successful upload the thumbnail and dimensions appear. Images flow between frontend and backend as a **content hash**: upload once, and every later tool references the same hash without re-decoding.

### Comparison image

Only `vision_image_diff` uses a second image. Both are shown after upload and are aligned automatically at run time (scaled when sizes differ; disable with the `align` argument).

### Run once

1. Open the **Workbench**
2. Drop or pick an image in the left column
3. Choose a tool in the middle column, e.g. `vision_insight`
4. Click **Run**
5. Results appear on the right

### Result area

Results render in order of availability:

1. **Box overlay**: `vision_ground` / `vision_detect` results are drawn straight onto the image with labels
2. **Image artifacts**: diff heat map, crop output, sampled frames, transparent cut-out, each downloadable
3. **OCR text**: the recognised text from `vision_long_ocr` / `vision_batch_ocr`
4. **Structured table**: the rows and columns parsed by `vision_chart_analyze`
5. **Raw JSON**: always shown and copyable in one click

### Stopping a task

Clicking "Stop" while a run is in flight sends a cancel request; the backend aborts the task and returns the concurrency slot immediately.

### Verifying the agent-side call

A passing workbench run proves the backend works. Return to the conversation and have the agent call a tool once:

```text
Use vision_insight to describe this image
```

If the agent calls it and returns a description, tool registration, permission checks and the scheduling chain are all in place.

---

## Configuration reference

These fields come from the Schemastery `Config` in `src/index.ts` (`plugin.json` records `config.schemaSource = "src/index.ts#Config"`). **All 11 fields are `volatile()`**: saving settings takes the hot-update path, where the Loader writes new values into references and broadcasts `loader/volatile-update` instead of reloading the row — so routes, cache and quota counters are not interrupted.

| Field | Type | Default | Range | Notes | Hot reload |
| --- | --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | `true` / `false` | Master switch; when off, no tools, no routes, no service | Yes (volatile) |
| `strategy` | enum | `local-first` | `sequential` / `weighted-round-robin` / `local-first` / `lowest-latency` | Scheduling strategy | Yes (volatile) |
| `perSessionConcurrency` | number | `2` | 1–64 | Max concurrent tasks per session | Yes (volatile) |
| `globalConcurrency` | number | `8` | 1–256 | Max concurrent tasks globally | Yes (volatile) |
| `taskTimeoutMs` | number | `120000` | 1000–3600000 | Per-task timeout (ms) | Yes (volatile) |
| `circuitThreshold` | number | `3` | 1–100 | Consecutive failures before the breaker opens | Yes (volatile) |
| `circuitCooldownSec` | number | `60` | 1–86400 | Breaker cooldown (s) | Yes (volatile) |
| `cacheEnabled` | boolean | `true` | `true` / `false` | Content-addressed cache switch | Yes (volatile) |
| `cacheTtlSec` | number | `86400` | 1–2592000 | Cache TTL (s); the default is 24 hours | Yes (volatile) |
| `logLevel` | enum | `info` | `debug` / `info` / `warn` / `error` | Log level | Yes (volatile) |
| `pythonEnabled` | boolean | `true` | `true` / `false` | Whether the managed Python runtime is enabled | Yes (volatile) |

> These are **plugin-level defaults**. Fine-grained adjustments made in the panel (backend list, per-tool timeout and quota, snapshots, canvas coordinates) persist in `$DSH_HOME/dsh-vision-nexus/state.json` and are managed by the service layer, outside the schema above. Writes are atomic (temp file + rename), and reads repair the structure (unknown fields dropped, missing fields defaulted, invalid enums fallen back).

### Other persisted defaults (`defaultState()`)

| Group | Field | Default | Range |
| --- | --- | --- | --- |
| `quota` | `globalPerDay` | `2000` | 0–10000000 (0 = unlimited) |
| `quota` | `perBackendPerDay` | `1000` | 0–10000000 |
| `quota` | `window` | `day` | `day` / `hour` |
| `cache` | `ttlSec` | `86400` | 1–2592000 |
| `cache` | `maxBytes` | `536870912` (512 MiB) | 0–64 GiB |
| `concurrency` | `perSession` / `global` / `taskTimeoutMs` | `2` / `8` / `120000` | 1–64 / 1–256 / 1000–3600000 |
| `circuit` | `failureThreshold` / `cooldownSec` / `maxCooldownSec` | `3` / `60` / `480` | 1–100 / 1–86400 / 1–86400 |
| `logging` | `level` / `retainDays` / `maxTraceRecords` | `info` / `14` / `5000` | enum / 1–365 / 100–50000 |

**Egress and upload hard limits** (`src/shared/constants.ts`): the default outbound HTTP timeout is **30 seconds**; the response body cap is **32 MiB** (the stream is cut immediately on overflow); a single image upload is capped at **20 MiB**.

---

## Scheduling strategies

The four strategies are not ranked — each matches a different situation. The default is `local-first`.

### Sequential fallback (`sequential`)

**Semantics**: try backends strictly in priority order; the next one runs only after the previous fails.
**Use it for**: primary/backup setups, e.g. "prefer the cheap cloud API, fall back to the local model".
**Note**: a lower priority number runs first. The cost is that every fallback waits for the previous timeout.

### Weighted round-robin (`weighted-round-robin`)

**Semantics**: spread traffic smoothly by weight so no backend is hammered.
**Use it for**: load-balancing several equivalent backends.
**Note**: a 3:1 weight means the first takes about 75% of requests. Round-robin only decides the **preferred** order; actual distribution is also shaped by cache hits and failure fallback — a cache hit never reaches a backend.

### Local-first (`local-first`)

**Semantics**: local compute (Ollama / Python runtime / Tesseract) always ranks ahead of the cloud.
**Use it for**: privacy-sensitive deployments, offline environments, cost saving. This is the **default**.
**Note**: local backends are still ordered among themselves by priority. Local models are usually slower than the cloud — if latency is a hard requirement, switch to lowest-latency.

### Lowest-latency (`lowest-latency`)

**Semantics**: order by exponentially weighted average latency, fastest first.
**Use it for**: latency-sensitive workloads, or backends whose performance swings and needs automatic selection.
**Note**: latency is an EWMA (smoothing factor 0.3), giving new samples 30% weight. A backend that has never succeeded is treated as 1000 ms neutral so it still gets a chance — otherwise a cold backend would never be selected.

### Circuit breaker (orthogonal to strategy)

Whatever the strategy, the breaker acts first:

```text
closed ──consecutive failures hit the threshold──> open ──cooldown ends──> half-open
                                                                              │
                                                              probe ok ───────┴──> closed
                                                              probe fails ───────> open (timer restarts)
```

- **Threshold and cooldown are configurable**, including **per-backend overrides**;
- A backend in cooldown takes **no part** in scheduling — it is excluded, not merely down-weighted;
- `half-open` admits exactly **one** probe, so the end of a cooldown cannot be swamped by concurrent requests.

**Exponential backoff**: when the same backend trips repeatedly, the cooldown grows 1×, 2×, 4×…, capped by `maxCooldownSec` (default 480 s):

| Trip count | Actual cooldown at a 60 s base |
| --- | --- |
| 1st | 60 s |
| 2nd | 120 s |
| 3rd | 240 s |
| 4th onward | 480 s (capped) |

A successful probe resets the backoff counter. Manually clicking "Test" and getting a success also closes the breaker immediately and resets the counter.

---

## Quota

### Three independent counters

| Level | Scope | Default |
| --- | --- | --- |
| Global | Total across all requests | 2000 / day |
| Per backend | Limit for one backend | 1000 / day |
| Per tool | Limit for one tool | See the tool defaults (highest 300, lowest 20) |

**Exceeding any level is rejected** and the message says which level was hit. `0` means that level is unlimited.

### Window rollover

- `day`: resets at local midnight
- `hour`: resets on the hour

Counters persist in `$DSH_HOME/dsh-vision-nexus/quota.json`, so **a restart does not bypass quota**.

### Check-then-reserve

Quota consumption is atomic: everything is checked first and reserved together, so a rejected request spends nothing. When a backend call fails, the quota is **refunded** — the request was never actually processed.

### Cache hits cost no quota

A content-addressed cache hit returns immediately without consuming quota or counting toward backend traffic share. Re-analysing the same image is free.

### Tuning advice

- **During development**: raise the global quota so debugging is not blocked
- **In production**: work backwards from budget. If one cloud call costs 0.01 and the daily budget is 20, set the per-backend quota to 2000
- **Local backends**: quota matters little (they cost nothing) but can cap resource usage

---

## Development and testing

### Installing dependencies

The plugin itself has **zero third-party runtime dependencies** (only `@deepseek-ai/schemastery`), so `node scripts/build.mjs` builds it directly. Type-checking or the frontend toolchain needs dev dependencies.

**Backend development (minimal set)**:

```bash
npm install --save-dev @types/node typescript
```

**Frontend development (minimal set)** — the client runtime imports only `react` / `react/jsx-runtime` from the host, so it needs just `react`, `react-dom` (peers, provided by the DSH host to avoid a second copy) and their type declarations. The UI primitives, drag canvas and charts are all in-repo code (`src/client/ui/`, `src/client/tabs/CanvasTab.ts`, `src/client/styles.ts`); the plugin does **not** depend on reactflow / echarts / tailwindcss / class-variance-authority / @radix-ui — an earlier revision declared them in `devDependencies` but never imported them, and they have been removed:

```bash
npm install --save-dev typescript "@types/node@^22.20.0" \
  "@types/react@~18.3.1" "@types/react-dom@~18.3.0" \
  react@^18.3.1 react-dom@^18.3.1
```

> The artifact is lightweight for the same reason: the published `lib/client.js` keeps only `react` and `react/jsx-runtime` as external dependencies (injected by the host). The canvas uses Pointer Events, the charts are hand-written SVG, and styling follows the DSH theme CSS variables (automatic light/dark) — so reactflow / echarts / tailwindcss / class-variance-authority appear neither in `package.json` nor in the artifact.

### Frontend / backend boundary

The plugin splits its code into three layers, and **the boundary is a hard constraint** enforced by `scripts/check-boundaries.mjs` in tests:

| Layer | Directory | Allowed dependencies | Forbidden |
| --- | --- | --- | --- |
| Backend plugin logic | `src/host/**`, `src/shared/**`, `src/index.ts` | Node built-ins, `@deepseek-ai/schemastery` | `src/client/**`, react, any frontend library |
| Frontend code | `src/client/**` | react, react-dom, `src/shared/**` types | `src/host/**` runtime implementations |
| Backend test scripts | `scripts/smoke.mjs` and friends | Only `src/shared/**`, `src/host/**` | react, hooks / components under `src/client` |

**Why the isolation is mandatory**: backend scripts run in Node with no DOM and no React. The moment a backend script imports `src/client/hooks.ts` (which does `import 'react'`), an environment with only backend dependencies throws:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react'
```

`assertBackendOnly()` in `scripts/smoke.mjs` intercepts this before the import and turns a vague module-resolution error into a clear assertion failure, while `scripts/check-boundaries.mjs` scans the source and names the offending file and line. When logic needs to be shared, move it into `src/shared/` rather than importing the frontend from the backend.

### Dictionaries and `locale/*.json`

`src/client/locales.ts` is the **single source of truth** for the dictionaries; `locale/zh.json` and `locale/en.json` are its generated artifacts (the targets of `plugin.json`'s `i18n.files`).

After changing any copy, regenerate rather than editing the JSON by hand:

```bash
npm run gen:locales
```

`npm run check` verifies that the JSON matches the source exactly (keys and values) and fails otherwise.

### Test commands

**Run everything at once** (recommended; this is what CI uses):

```bash
npm run test
```

It is driven by `scripts/run-all-tests.mjs` and runs **backend → frontend → boundaries → DSH contract → encoding** in a fixed order. Unlike `a && b && c`, all five suites **always run** and a summary table is printed at the end; any failing suite makes the process exit non-zero.

Individual suites:

```bash
npm run test:backend        # backend smoke only
npm run test:frontend       # frontend render check only
npm run test:boundaries     # frontend/backend boundary check only
npm run test:dsh-contract   # DSH contract only (JSON Schema subset for the 14 tools)
npm run test:encoding       # encoding check only (UTF-8 / no BOM / no replacement chars)
npm run test:sequential     # strict short-circuit version (stops at the first failure)
```

### What each suite actually tests

| Suite | Script | What it verifies |
| --- | --- | --- |
| `test:backend` | `scripts/smoke.mjs` | Pure-logic behaviour of tool input schemas plus scheduling / circuit breaking / cache / quota / concurrency / image metadata / sandbox / redaction / config import-export; `assertBackendOnly()` blocks boundary-violating frontend imports before they load |
| `test:frontend` | `scripts/render-check.mjs` | Chinese/English dictionary alignment, stylesheet completeness, API client behaviour, validation and view-extraction logic; it reads only React-free modules, so React is not installed |
| `test:boundaries` | `scripts/check-boundaries.mjs` | Whether the three layers (`src/host` / `src/shared` / `src/client`) are crossed, whether the frontend dependency list is complete, and whether every `scripts/**/*.mjs` carries the UTF-8 bootstrap |
| `test:dsh-contract` | `scripts/check-dsh-contract.mjs` | Locks DSH's JSON Schema subset rules into a regression test across all 14 tools' `parameters` and `output.schema` (for example, `required` must be a string array on the `type: "object"` node) |
| `test:encoding` | `scripts/check-encoding.mjs` | Scans all source for GBK files, BOMs and U+FFFD replacement characters, turning encoding problems into a failing test |

> Any test script accepts `--report <file>`; `scripts/lib/utf8.mjs` writes it directly as UTF-8, which is convenient for archiving and for CI:
>
> ```bash
> node scripts/run-all-tests.mjs --report ./test-report.txt
> node scripts/smoke.mjs --report ./smoke-report.txt
> ```

### Release-quality checks

```bash
npm run check             # manifest consistency (plugin.json ↔ package.json ↔ tool-catalog, incl. frontend deps)
npm run check:imports     # relative-import reachability and duplicate exports
npm run check:build       # build-artifact loadability
npm run check:readme      # README fact check
```

### New scripts must carry the UTF-8 bootstrap

Every script under `scripts/` that prints Chinese needs these two lines at the top:

```js
import { bootstrapConsole } from './lib/utf8.mjs'

bootstrapConsole()
```

`check-boundaries.mjs` **scans every `.mjs` under `scripts/`**, so a script missing those lines fails outright — nobody has to remember to update a list. Only two categories are exempt: `scripts/lib/**` (an imported utility library) and pure ESM loader hooks (which never produce output).

### CI matrix

On a push to `main` / `master` / `develop`, or on a PR targeting the main branch, `.github/workflows/ci.yml` will:

1. Run on the **Ubuntu + Windows** × **Node 22 + 24** matrix (`fail-fast: false`, so the whole matrix finishes):
   - `node scripts/build.mjs` (build)
   - `node scripts/run-all-tests.mjs` (all five suites: backend / frontend / boundaries / DSH contract / encoding)
   - `check-package` / `verify-imports` / `verify-build` / `verify-readme`
2. Run `npm pack --dry-run` on Ubuntu (the `pack` job, `needs: test`) to confirm the publish manifest is self-consistent.

### Interpreting a failure

- The `npm run test` summary lists each suite's pass/fail and exit code; it does **not** short-circuit, so you can see whether the frontend passed in the same run.
- `test:boundaries` fails → the offending file and line are printed, usually a backend script importing a frontend module; see the boundary section for fixes.
- `test:dsh-contract` fails → a tool's schema breaks DSH's subset rules, which makes the host refuse to register it (the symptom is "the tool is missing", not an error message).
- `test:encoding` fails → some file is GBK, has a BOM, or contains U+FFFD; rewrite it as UTF-8 without a BOM.
- `check:readme` fails → a number, section, command or referenced file in the README disagrees with the source; the diagnostics list each one.
- If Chinese output looks wrong in a local Windows terminal, switch the terminal's output encoding to UTF-8 first, or pass `--report <file>` so the script writes a UTF-8 file directly.

---

## Troubleshooting

### Error codes

Every subsystem funnels exceptions into `VisionNexusError` with stable codes (the frontend and the agent both branch on `code`). There are 14:

| Code | Meaning | What to do |
| --- | --- | --- |
| `VN_BACKEND_UNAVAILABLE` | No usable backend (all offline or all in cooldown) | Check the status lights on the canvas; red means cooling down. Click "Test" to probe manually, and confirm at least one backend exists |
| `VN_CREDENTIAL_MISSING` | A backend needs an API key that is not configured (or the host has no credentials service) | Enter the key in the backend editor; check that DSH credential storage is enabled |
| `VN_QUOTA_EXCEEDED` | Quota exhausted | Raise the limit under Quota & logs, or wait for the window to roll over (`day` / `hour`) |
| `VN_TIMEOUT` | Task timed out or was cancelled | Check backend responsiveness, or raise the tool timeout and `taskTimeoutMs` |
| `VN_RUNTIME_MISSING` | A local runtime (Python / Tesseract / ffmpeg) is unavailable | Run the health check under Runtime & security and initialise Python, or install Tesseract / ffmpeg |
| `VN_SANDBOX_DENIED` | Path outside the directory allowlist (or the allowlist is empty) | Add the target directory under Runtime & security → Directory allowlist |
| `VN_AGENT_FORBIDDEN` | The current agent session is not in the call allowlist | Adjust the agent allowlist, or clear it to lift the restriction |
| `VN_TOOL_DISABLED` | An administrator disabled this tool | Re-enable it in the Tools tab |
| `VN_INVALID_ARGUMENT` | Invalid input | Check the image reference, coordinate ranges, required fields and HTTP method |
| `VN_BUSY` | Concurrency queue full, queueing timed out | Retry later, or raise the per-session / global concurrency limits |
| `VN_BAD_RESPONSE` | The backend returned something unparseable | Check that the backend really supports the tool being called; local Python output overflow or non-JSON also surfaces as this code |
| `VN_UPLOAD_REJECTED` | Upload rejected (MIME / magic bytes / size) | Use PNG/JPEG/WebP/GIF/BMP/TIFF/SVG or a video format, and stay under 20 MiB |
| `VN_NETWORK_DENIED` | Egress blocked by security policy | Usually a redirect (not followed) or a response body larger than 32 MiB |
| `VN_INTERNAL` | Uncategorised internal error | Inspect the trace detail and logs (`GET /logs` or the Quota & logs tab) |

`VN_BACKEND_UNAVAILABLE`, `VN_TIMEOUT`, `VN_BAD_RESPONSE` and `VN_BUSY` are retryable by default, which is how the scheduler decides to fall back to the next backend.

### Common symptoms

**The Vision Nexus entry is missing from settings**

Check in order: ① does `dsh --profile <name> --dump-config` list `dsh-vision-nexus`; ② do `cordis.patch.yml` and `lib/client.js` exist; ③ is DSH `>= 0.2.1-rc.5`; ④ was the DSH process restarted after editing the profile; ⑤ is `Config.enabled` `true` (when off, no tools or routes are registered). If plugin startup failed, the log carries an error-level `dsh-vision-nexus 启动失败：插件将以不可用状态挂载`, and the plugin detail view shows the cause.

**A tool call reports no usable backend (`VN_BACKEND_UNAVAILABLE`)**

Two cases: no backend is configured at all, or every backend is in circuit-breaker cooldown. Watch the status lights on the canvas — red means cooling down. Click "Test" to trigger a probe, which recovers immediately on success. Common root causes: the base URL is missing `/v1`, the API key is absent or expired, the Ollama service is not running, or the model name is misspelled. The breaker opens after the threshold (default 3) and cools down for 60 seconds by default.

**Python tools report `VN_RUNTIME_MISSING`**

The Python runtime is unavailable. Under Runtime & security click "Health check" to see exactly what is missing (no interpreter / version below 3.10 / missing `numpy` or `PIL`), then click "Initialise environment". If that fails automatically, prepare a venv manually as described above and enter its interpreter path. Note that the `python-local` backend covers only the 6 pure-local tools plus the optional path of `vision_remove_bg`; every other tool uses a vision-model backend and is unaffected.

**Chinese logs or output appear as question marks or boxes**

This is a terminal encoding mismatch: scripts write UTF-8 while the terminal decodes with a different code page. The plugin's answer is `bootstrapConsole()` in `scripts/lib/utf8.mjs` — it mirrors all console output into a UTF-8 file (Node writes to disk directly, bypassing terminal decoding), and every test script accepts `--report <file>`:

```bash
node scripts/run-all-tests.mjs --report ./test-report.txt
```

`scripts/check-encoding.mjs` additionally turns source-level encoding problems (GBK files, BOMs, U+FFFD) into a failing test.

**OCR does not recognise Chinese**

Tesseract needs its Chinese language pack installed separately. Check whether `tesseract --list-langs` includes `chi_sim`; if not, download `chi_sim.traineddata` into the tessdata directory.

**Why is the second analysis of the same image much faster?**

A content-addressed cache hit. The key is "image hash + tool + normalised args", and a different argument order still hits because serialisation is stabilised. The default TTL is 24 hours and can be changed or cleared under Runtime & security.

**I changed a tool timeout but it did not take effect**

A tool's timeout is written into the DSH tool definition **at registration time**. After a change the plugin re-registers the tool, but calls already in flight are unaffected. Timeout and quota submit **on blur**, so make sure the input actually lost focus.

---

## Security

### Secrets

- **Reference names only**: a backend stores just `apiKeyRef` (e.g. `VISION_NEXUS_{BACKEND_ID}_API_KEY`); the real value is held by DSH's encrypted Credentials module
- **Never returned**: the API exposes only the `configured` and `writable` booleans, so the frontend never sees plaintext
- **Re-resolved every time**: secrets are not cached, so a change takes effect immediately
- **Redacted on export**: exported configuration replaces the secret field with the `<KEEP_EXISTING>` placeholder

### File access

The **directory-allowlist sandbox** has three layers of defence:

1. Resolve the real path with `realpath` first — otherwise a symlink pointing outside would slip through
2. Test containment with `path.relative`, not a string prefix — the latter would let `/allowed-evil` pass the `/allowed` check
3. An empty allowlist **denies all** disk reads (fail-closed) rather than opening up

Out-of-bounds access returns `VN_SANDBOX_DENIED` with the rejected path instead of failing silently. The directory-browsing endpoint is subject to the allowlist as well.

### Uploads

Three checks, with the file extension treated as entirely untrustworthy:

1. MIME allowlist (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/bmp`, `image/tiff`, `image/svg+xml`, `video/mp4`, `video/webm`, `video/quicktime`)
2. **Magic-byte comparison** (PNG / JPEG / GIF / BMP / TIFF / WebP / MP4 each have a fixed byte sequence)
3. Size cap of 20 MiB

A declared MIME that disagrees with the actual bytes logs a warning.

### Egress

Every outbound request is forced to obey:

- a **timeout** (30 seconds by default, configurable)
- **no redirect following** — a single 302 could point the request at an internal address, the classic SSRF entry point
- a **response body cap** of 32 MiB, cutting the stream immediately on overflow (rather than reading everything and checking afterwards)

### Log redaction

Logs and configuration exports **share one redaction implementation** — writing it twice is the most common source of leaked secrets. Three layers:

1. Key-name heuristics: keys whose name contains `apikey`, `api_key`, `authorization`, `bearer`, `password`, `secret`, `token` or `credential` have their whole value replaced
2. Value pattern matching: `sk-` prefixes, `Bearer xxx`, JWTs, userinfo in URLs and long random strings
3. Deep traversal: nested objects and arrays are handled recursively, with cycle detection

### Nothing is reported off-machine

`plugin.json` sets `telemetry.localOnly = true` and `uploadsToVendor = false`: metrics, traces and logs only ever land under the local `$DSH_HOME`, and the plugin reports nothing to any third party.

### Agent allowlist

When the allowlist is non-empty, only the sessions it names may call the vision tools; anything else gets `VN_AGENT_FORBIDDEN`. An empty list means no restriction.

### Reporting a vulnerability

Please **do not** report security issues through a public issue. Use GitHub's private channel: <https://github.com/Lonis89/dsh-vision-nexus/security/advisories/new>. See [SECURITY.md](SECURITY.md).

---

## Publishing to GitHub

The repository already follows GitHub conventions and works as-is after a clone or fork.

### Repository structure

```text
dsh-vision-nexus/
├── .github/
│   ├── workflows/ci.yml            # CI: test matrix + pack dry-run
│   ├── ISSUE_TEMPLATE/             # issue forms (bug / feature / contact)
│   └── PULL_REQUEST_TEMPLATE.md    # PR self-check list
├── src/
│   ├── index.ts                    # host entry: Config + apply()
│   ├── shared/                     # pure types and constants shared by both halves
│   ├── host/                       # service, scheduler, adapters, tools, routes, runtime, security
│   └── client/                     # frontend: locales / api / styles / tabs / ui
├── scripts/                        # build, test and verification scripts
├── locale/                         # dictionary artifacts (generated by gen:locales)
├── lib/                            # build output (.gitignore'd; built locally and in CI)
├── LICENSE                         # Apache-2.0
├── README.md / README.en.md        # bilingual documentation
├── CHANGELOG.md                    # changelog
├── CONTRIBUTING.md                 # contributing guide
├── CODE_OF_CONDUCT.md              # code of conduct
├── SECURITY.md                     # security policy and disclosure
├── PROJECT-STRUCTURE.md            # directory and file responsibilities
├── icon.svg                        # plugin icon
├── plugin.json                     # declarative capability manifest
├── package.json                    # npm / DSH Loader manifest
└── cordis.patch.yml                # mount patch
```

### Why `lib/` is not in the repository

`lib/` is generated from `src/` by `node scripts/build.mjs`. Committing it would mean an extra pile of artifacts on every source change, and when artifacts and source drift apart anyone who clones runs stale code. So `.gitignore` excludes `lib/`, and it is built on demand:

| Scenario | How `lib/` is produced |
| --- | --- |
| Local development | `node scripts/build.mjs` |
| Using a GitHub clone | Run `node scripts/build.mjs` once after cloning |
| CI | The workflow builds it automatically |
| Installing from npm | Already included (declared in `files`), no build needed |

### Development and contributing

- Boundaries, commit conventions and the PR flow are in [CONTRIBUTING.md](CONTRIBUTING.md)
- The code of conduct is in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Directory and file responsibilities are in [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md)
- Commit messages follow Conventional Commits; before committing make sure `npm run test` and `node scripts/check-package.mjs` both pass

### First push

```bash
git init
git add .
git commit -m "feat: initial release v0.1.0"

git remote add origin https://github.com/Lonis89/dsh-vision-nexus.git
git branch -M main
git push -u origin main
```

Run the checks locally first so CI does not go red:

```bash
node scripts/build.mjs
node scripts/run-all-tests.mjs
node scripts/check-package.mjs
```

### Publishing to npm (optional)

```bash
node scripts/build.mjs
npm publish
```

The `prepublishOnly` hook rebuilds and re-runs the manifest check automatically, so a broken manifest cannot be published.

### Suggested repository settings

In GitHub's **Settings** for the repository, enable branch protection on `main` (require CI to pass plus at least one review), Dependabot alerts, and Private vulnerability reporting (matching `SECURITY.md`).

---

## Quick start

Five minutes from zero to a first vision request.

### 1. Configure a backend

Open **Vision Nexus → Scheduling canvas** and click "Add backend". A minimal working configuration (local Ollama):

| Field | Value |
| --- | --- |
| Backend ID | `ollama-local` |
| Label | Local vision model |
| Kind | Ollama (local) |
| Base URL | `http://127.0.0.1:11434` |
| Model | `llava:13b` |

Save, then click "Test" to confirm connectivity.

### 2. Verify the tools are registered

Back in the conversation, have the agent describe an image:

```text
Use vision_insight to describe this image
```

If the agent calls the tool correctly, the chain works.

### 3. Debug with the workbench

Open the **Workbench**, drop in an image, pick `vision_insight` and click "Run". The right column shows the structured result and the trace ID. This step consumes no agent turns.

### 4. Inspect the trace

Open **Quota & logs** to see the elapsed time and result summary of that request. On failure the error code tells you exactly why (see the error-code table above).

---

## FAQ

**Q: I installed it but the Vision Nexus entry is missing from settings.**

Check in order: does `dsh --profile <name> --dump-config | grep dsh-vision-nexus` list the row; do `cordis.patch.yml` and `lib/client.js` exist; is DSH `>= 0.2.1-rc.5`; was DSH restarted after editing the profile. See "Common symptoms" above for the full order.

**Q: The tools are registered but the agent reports "no usable backend".**

`VN_BACKEND_UNAVAILABLE` has two cases: no backend configured, or all of them in circuit-breaker cooldown. Watch the status lights on the canvas — red means cooling down. Click "Test" to probe manually and it recovers immediately on success.

**Q: Why is my backend always red?**

Click "Test" to see the actual error. Common causes: the base URL is missing `/v1`, the API key is absent or expired, the Ollama service is not running, the model name is misspelled. The breaker opens after 3 consecutive failures and cools down for 60 seconds by default, growing exponentially to a 480-second cap.

**Q: Every local-algorithm tool reports `VN_RUNTIME_MISSING`.**

The Python runtime is unavailable. Under Runtime & security click "Health check" to see what is missing, then "Initialise environment". If that fails, follow the manual setup above. You can also set `pythonEnabled` (in `Config`) to `false` to disable it explicitly.

**Q: OCR does not recognise Chinese.**

Tesseract needs its Chinese language pack installed separately. Check whether `tesseract --list-langs` includes `chi_sim`; if not, download `chi_sim.traineddata` into the tessdata directory.

**Q: Why is the second analysis of the same image much faster?**

A content-addressed cache hit. The key is "image hash + tool + normalised args", and a different argument order still hits because serialisation is stabilised. The default TTL is 24 hours (`cacheTtlSec` defaults to 86400) and can be changed or cleared under Runtime & security.

**Q: I changed a tool timeout but it did not take effect.**

A tool's timeout is written into the DSH tool definition **at registration time**. After a change the plugin re-registers the tool, but calls already in flight are unaffected. Timeout and quota submit on blur, so make sure the input actually lost focus.

**Q: Can my API key show up in the logs?**

No. Everything written to the log passes through redaction first: `sk-` prefixes, Bearer headers and long random strings are all replaced, and configuration export goes through the same implementation.

**Q: Does uninstalling delete my configuration?**

No. `dsh plugin remove` only removes the plugin row; the configuration, cache, logs and snapshots under `$DSH_HOME/dsh-vision-nexus` are kept. Delete that directory manually for a full cleanup.

**Q: Which image formats are supported?**

PNG, JPEG, WebP, GIF, BMP, TIFF and SVG. Video frame sampling supports MP4, WebM and MOV. Magic bytes are checked before upload, so renaming the extension does not help.

**Q: Does the frontend use Tailwind / shadcn / react-flow / ECharts?**

**No — and they are no longer declared either.** An early draft listed reactflow / echarts / tailwindcss / class-variance-authority / `@radix-ui/*` in `devDependencies`, but the source imported none of them; the audit removed all of them. `package.json` now keeps only what is actually needed: `react`, `react-dom`, `@types/*`, `typescript`, `@deepseek-ai/schemastery`, `@deepseek-ai/cordis`.

The published `lib/client.js` keeps only `react` and `react/jsx-runtime` as external dependencies, injected by the host. Styling uses DSH theme CSS variables (light/dark automatic), the UI primitives are in-house `src/client/ui/primitives.ts`, the canvas uses Pointer Events, and the charts are plain SVG.

**Q: `node scripts/smoke.mjs` fails with `ERR_MODULE_NOT_FOUND: Cannot find package 'react'`.**

A backend test script has crossed the boundary and loaded a frontend module. There are two fixes: ① move the pure logic under test from `src/client` into `src/shared` (usable from both halves); ② move that verification into `scripts/render-check.mjs` (a frontend script). Run `node scripts/check-boundaries.mjs` to pinpoint the file and line.

---

## Version and changes

Versions follow [semantic versioning](https://semver.org/) and every notable change is recorded in [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog format).

| Version | Date | Summary |
| --- | --- | --- |
| `0.1.0` | 2026-11-05 | First releasable version: scheduling engine, circuit breaker, 5 adapters, 14 tools, runtime governance, observability, 6-tab frontend, configuration management |
| Unreleased | — | Fixed: the schema-contract issue that prevented the 14 tools from registering, plus character-encoding issues; Changed: plugin renamed to `dsh-vision-nexus`; Added: automatic migration of legacy data |

Upgrade and migration details are in [CHANGELOG.md](CHANGELOG.md) and under "Upgrade" above.

---

## License

Released under the [Apache License 2.0](LICENSE).

```text
Copyright 2026 Lonis89

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## Documentation vs source reconciliation

Every number, command, field name and tool name in this document was re-checked against the source after writing. Differences are always resolved in favour of the source.

| # | Item | Source evidence | Result |
| --- | --- | --- | --- |
| 1 | Tool count = **14** | `TOOL_CATALOG.length` in `src/shared/tool-catalog.ts`; `plugin.json` `capabilities.tools` | Consistent |
| 2 | Python-only tools = **6** | `TOOL_CATALOG.filter(e => e.backends.length === 1 && e.backends[0] === 'python-local')` → `vision_crop`, `vision_image_diff`, `vision_extract_color`, `vision_svg_trace`, `vision_video_sample`, `vision_code_scan` | Consistent (the English sentence is "Six of the 14 tools depend entirely on local algorithms") |
| 3 | Route count | `kind:` entries under `src/host/http/routes/**` = **30**; `plugin.json` `capabilities.routes` = **37** method+path; `PROJECT-STRUCTURE.md` says **35** | **Inconsistent**: the runtime registers 30 route entries (multiple methods on one path collapse into a single entry, and some method aliases are not listed separately); `plugin.json`'s 37 is the method+path count; `PROJECT-STRUCTURE.md`'s 35 is stale. This document states both 30 and 37 |
| 4 | Per-tool default timeouts | `defaults.timeoutMs` in `tool-catalog.ts` | Consistent: 120000 / 120000 / 120000 / 30000 / 60000 / 180000 / 120000 / 30000 / 90000 / 120000 / 300000 / 180000 / 120000 / 30000 |
| 5 | Per-tool daily quotas | `defaults.quotaPerDay` in `tool-catalog.ts` | Consistent: 200 / 100 / 100 / 300 / 100 / 60 / 60 / 300 / 60 / 60 / 20 / 30 / 60 / 300 |
| 6 | Per-tool backend lists | `backends` in `tool-catalog.ts` | Consistent. Note: `plugin.json` additionally lists `python-local` for `vision_long_ocr` (the catalog has `tesseract` + `openai-compat`); this document follows the catalog |
| 7 | Default global quota 2000 / day | `defaultState().quota.globalPerDay = 2_000` | Consistent |
| 8 | Default per-backend quota 1000 / day | `defaultState().quota.perBackendPerDay = 1_000` | Consistent |
| 9 | Default cache TTL 24 hours | `DEFAULT_CACHE_TTL_SEC = 24 * 60 * 60` = 86400; `Config.cacheTtlSec` default 86400 | Consistent |
| 10 | Upload cap 20 MiB | `MAX_UPLOAD_BYTES = 20 * 1024 * 1024` | Consistent |
| 11 | Response body cap 32 MiB | `MAX_RESPONSE_BYTES = 32 * 1024 * 1024` | Consistent |
| 12 | Default egress timeout 30 seconds | `DEFAULT_HTTP_TIMEOUT_MS = 30_000` | Consistent |
| 13 | `Config` has **11** fields, with defaults and ranges | `Config` in `src/index.ts` | Consistent: enabled / strategy / perSessionConcurrency(1–64) / globalConcurrency(1–256) / taskTimeoutMs(1000–3600000) / circuitThreshold(1–100) / circuitCooldownSec(1–86400) / cacheEnabled / cacheTtlSec(1–2592000) / logLevel / pythonEnabled; all `.volatile()` |
| 14 | Error codes = **14** | `ErrorCodes` in `src/shared/errors.ts` | Consistent; the troubleshooting table lists every one |
| 15 | Frontend tabs = **6** | `plugin.json` `capabilities.ui.tabs`; `TABS` in `src/client/tabs/Shell.ts`; `tab.*` in `locales.ts` | Consistent: dashboard / canvas / tools / workbench / runtime / governance |
| 16 | Backend kinds = **5** | `BackendKind` in `src/shared/types.ts`; `readBackendKind` in `store.ts` | Consistent |
| 17 | Scheduling strategies = **4** | The union in `Config.strategy` | Consistent |
| 18 | npm script existence | `scripts` in `package.json` | Consistent: every script referenced here (`test` / `test:backend` / `test:frontend` / `test:boundaries` / `test:dsh-contract` / `test:encoding` / `test:sequential` / `check` / `check:imports` / `check:build` / `check:readme` / `gen:locales`) really exists |
| 19 | Version requirements | `plugin.json` `engines.dsh = ">=0.2.1-rc.5"`; `package.json` `engines.node = "^22.19.0 \|\| >=24.0.0"`; measured DSH `0.2.2-rc.1` | Consistent |
| 20 | Install command shape | The `dsh plugin --profile <profile> add dsh-vision-nexus` and `add link:<local-path>` notes in `cordis.patch.yml` | Consistent (this document also says to treat the local `dsh --help` as authoritative) |
| 21 | Python dependency list | `defaultRequirements()` in `python-runtime.ts` = `numpy>=1.26` / `pillow>=10.0` / `opencv-python-headless>=4.9` | Consistent. **Note**: the `python/requirements.txt` mentioned by `PROJECT-STRUCTURE.md` **does not exist** on disk, so `readRequirements()` falls back to that built-in list |
| 22 | Sandbox allowlist semantics | `sandbox.ts`: `realpath` + `path.relative` + fail-closed on an empty allowlist | Consistent |
| 23 | Upload MIME allowlist | `MEDIA_TYPE_ALLOWLIST` | Consistent; all 10 entries are listed |
| 24 | Secret reference format | `plugin.json` `permissions.secrets.refPattern`; `defaultKeyRef()` in `credentials.ts` | Consistent: `VISION_NEXUS_{BACKEND_ID}_API_KEY` |
| 25 | Frontend source extension | `src/client/tabs/*.ts`, `src/client/ui/*.ts` (not `.tsx`) | Consistent (the repository structure above reflects the real paths) |

> Not verified: the exact DSH CLI subcommands and output format vary by version; the `dsh plugin ...` shape is taken from this repository's `cordis.patch.yml`, so treat the local `dsh --help` as authoritative. Build-time figures such as the size of `lib/client.js` are deliberately not quoted here.

---

## Related links

- [Chinese README](README.md)
- [Project structure and file responsibilities](PROJECT-STRUCTURE.md)
- [Changelog](CHANGELOG.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Plugin manifest](plugin.json)
- Issues: [GitHub Issues](https://github.com/Lonis89/dsh-vision-nexus/issues)
