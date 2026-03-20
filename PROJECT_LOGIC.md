# Backend Core Logic Guide (`backend/main.py`)

This document explains the **actual backend execution logic** in `main.py`, especially:

- how old prompts are split into static and dynamic parts,
- how new prompts are rebuilt,
- how requests are sent to LLM models,
- and how outputs/metrics are produced.

---

## 1) What `main.py` is responsible for

`backend/main.py` contains almost all backend behavior:

1. FastAPI app setup and static page serving.
2. Environment/config loading (`OPENAI_API_KEY`, timeout, model config).
3. Prompt transformation logic (`PromptTransformer`).
4. OpenAI calling logic (`run_openai`) with endpoint routing.
5. Batch processing route (`/run`) for Excel-driven workflow.
6. Metrics, cost, formatting, and persisted run data.

---

## 2) Startup and runtime state

At import/startup:

- `.env` is loaded via `load_dotenv()`.
- Global settings are read:
	- `OPENAI_API_KEY`
	- `OPENAI_MODEL` (default model)
	- `TIMEOUT`
- `model_config.json` is loaded into in-memory `model_config`.
- `last_output_df` is initialized (in-memory dataframe cache of latest run).

Persistent files used by backend:

- `backend/model_config.json` → selected model list + reasoning.
- `backend/outputs/*.xlsx` → generated batch result files.
- `backend/outputs/latest_run.json` → latest run metadata summary.

---

## 3) The key transformation concept

The prompt transformation depends on a **structure JSON** with 3 pieces:

1. `initial_groups`:
	 - old static blocks expected in old prompt.
	 - example keys: `static1`, `static2`, `static3`.

2. `new_groups`:
	 - replacement static blocks.
	 - same numbering style.

3. `output_sequence`:
	 - exact order for reconstruction.
	 - tokens like `dynamic1`, `newstatic1`, `dynamic2`, etc.

The backend preserves variable text (dynamic parts) from old prompt and swaps only static templates.

---

## 4) How old prompt is split (static vs dynamic)

Core function path:

- `PromptTransformer.transform(old_prompt)`
	- calls `extract_dynamics(old_prompt)`
	- then `reconstruct_prompt(dynamics)`

### 4.1 Normalization

Before splitting, `_normalize()` standardizes text:

- convert CRLF/CR to LF,
- replace tabs with spaces,
- collapse repeated spaces/newlines,
- trim edges.

This makes static matching stable even when spacing differs.

### 4.2 Extraction algorithm (`extract_dynamics`)

For each static block in `initial_groups` (ordered by `static1`, `static2`, ...):

1. Normalize `old_prompt` and current static block.
2. Verify static block exists in remaining text.
3. Split once: `before, remaining = remaining.split(static_norm, 1)`.
4. Store `before` as current `dynamicN`.
5. Continue with next static block using updated `remaining`.

After last static, final `remaining` becomes last dynamic component.

### 4.3 Example mentally

If old prompt shape is:

`dynamic1 + static1 + dynamic2 + static2 + dynamic3`

then extraction returns:

- `dynamic1`: text before first static block,
- `dynamic2`: text between static1 and static2,
- `dynamic3`: trailing text after static2.

If any expected static block is missing, backend raises an error for that row.

---

## 5) How new prompt is rebuilt

`reconstruct_prompt(dynamics)` walks `output_sequence` token-by-token:

- if token starts with `dynamic`, insert extracted dynamic value,
- if token starts with `newstatic`, map to `new_groups.staticN` and insert replacement static,
- else raise `ValueError` (invalid token).

Finally, non-empty parts are joined with double newlines.

So reconstruction is deterministic and controlled by `output_sequence`.

---

## 6) How backend sends prompt to LLM

All model calls go through `run_openai(prompt, schema, model_name, reasoning_level)`.

### 6.1 System prompt strategy

Backend builds a system instruction that says model must follow schema and output valid JSON.

Schema text is directly embedded into system context.

### 6.2 Endpoint selection

Helper `uses_responses_endpoint(model_name)` decides route:

- responses endpoint (`/v1/responses`) for:
	- `gpt-5.2-pro`
	- any model containing `codex`
- otherwise chat endpoint (`/v1/chat/completions`)

If chat endpoint fails with “not a chat model”, backend auto-retries with responses endpoint.

### 6.3 Reasoning support

Helper `supports_reasoning_effort(model)` is true for `o*` and `gpt-5*`.

If reasoning is provided and supported:

- chat payload gets `reasoning_effort`.
- responses payload gets `reasoning: { effort: ... }`.

### 6.4 Response parsing

Backend extracts output text from endpoint-specific structure, then:

1. strips markdown fences (`clean_json_response`),
2. attempts `json.loads`,
3. if parse fails, stores fallback as `{"raw_response": "..."}`.

Returned shape is normalized:

- `content`
- `usage`
- `model`

---

## 7) Full `/run` pipeline (batch core route)

Route: `POST /run`

Inputs:

- Excel file (`input_excel`)
- structure JSON file (`structure_json_file`)
- schema file (`schema_file`)
- output filename

Execution order:

1. Read Excel into dataframe.
2. Parse structure JSON.
3. Read schema text.
4. Prepare output dataframe columns:
	 - `new_prompt`
	 - per-model `new_response_i`, `usage_i`, `cost_i`, `reasoning_tokens_i`, `model_used_i`, `response_time_seconds_i`
5. For each row:
	 - transform old prompt → `new_prompt` via `PromptTransformer`
	 - for each selected model in `model_config.models`:
		 - call `run_openai`
		 - save response/cost/tokens/timing
		 - if model call fails, mark only that model as error and continue
6. Save full dataframe to `outputs/<filename>.xlsx`.
7. Compute impact metrics per model.
8. Save summary JSON to `outputs/latest_run.json`.
9. Return response payload consumed by frontend.

This design is fault-tolerant: one failing model does not kill whole batch run.

---

## 8) Token and cost logic

Two helpers standardize usage accounting:

- `extract_token_counts(usage)`
	- normalizes chat vs responses usage fields,
	- extracts prompt/completion/cached/reasoning tokens.

- `calculate_cost(usage, model_name)`
	- uses model pricing table,
	- applies cached token discount where available,
	- returns USD cost per call.

Model totals are aggregated later by `_aggregate_model_cost_tokens()`.

---

## 9) Impact metrics logic

`calculate_impact_metrics(old_responses, new_responses, row_indices)` compares old vs new response content by:

- `category` (A/B/C/D),
- `subcategory` (1..8).

It computes:

- category change rate,
- upgrade/downgrade rate,
- no-change rate,
- subcategory change rate,
- net decision bias,
- confusion matrices,
- affected row lists.

These metrics are included in `/run` response and `/impact_metrics` route.

---

## 10) Other major routes in `main.py`

- `POST /api/save-model-config`
	- persists selected models/reasoning into `model_config.json`.

- `GET /api/get-model-config`
	- returns current in-memory model config.

- `POST /api/compare-models`
	- one prompt + schema, run against selected models, return side-by-side outputs.

- `GET /row_data/{row_index}`
	- returns transformed row details from `last_output_df`.

- `POST /api/format_content` and `POST /api/save_formatting`
	- text formatting utilities for fields (string/json/pretty, optional tag-based formatting).

- `GET /api/last_run`
	- returns latest run summary and can reload dataframe from saved output file.

---

## 11) In one line: how `main.py` works

`main.py` reads files + config, splits old prompt into dynamic components using known static anchors, rebuilds new prompts with replacement static blocks, executes selected LLM models, and stores response/usage/cost/impact outputs for UI and downloads.

