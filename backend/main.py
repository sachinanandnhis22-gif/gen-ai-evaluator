import os
import json
import io
import ast
import re
import time
from typing import Optional, Dict, List, Tuple
from pathlib import Path

import httpx
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, File, UploadFile, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def clean_json_response(content: str) -> str:
    """Strip markdown code-fence wrappers from a JSON response string."""
    content = content.strip()
    if content.startswith("```"):
        parts = content.split("\n", 1)
        content = parts[1] if len(parts) > 1 else content[3:]
    if content.endswith("```"):
        content = content[:-3]
    return content.strip()


# ---------------------------------------------------------------------------
# Config / Environment
# ---------------------------------------------------------------------------

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL   = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
TIMEOUT        = float(os.getenv("TIMEOUT", "30"))

OPENAI_CHAT_URL      = "https://api.openai.com/v1/chat/completions"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"

# Models that need a longer timeout due to heavy reasoning
_SLOW_MODEL_PATTERNS = ("gpt-5.2-pro", "gpt-5.1", "gpt-5.2", "gpt-5", "o3", "o1")

def get_timeout(model_name: str) -> float:
    """Return appropriate timeout. Heavy reasoning models can take several minutes."""
    if any(p in model_name.lower() for p in _SLOW_MODEL_PATTERNS):
        return 300.0  # 5 minutes
    return TIMEOUT

app = FastAPI(title="Prompt Runner - OpenAI")

frontend_dir = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

# In-memory store for the last computed DataFrame
last_output_df: Optional[pd.DataFrame] = None

# ---------------------------------------------------------------------------
# Model configuration (persisted to model_config.json)
# ---------------------------------------------------------------------------

model_config: Dict = {"models": [], "timestamp": None}
_config_file = "model_config.json"

if os.path.exists(_config_file):
    try:
        with open(_config_file) as f:
            saved = json.load(f)
        # Migrate legacy single-model format
        if "model" in saved and "models" not in saved:
            model_config["models"] = [{"model": saved["model"], "reasoning": saved.get("reasoning")}]
            model_config["timestamp"] = saved.get("timestamp")
        else:
            model_config.update(saved)
        if model_config["models"]:
            os.environ["OPENAI_MODEL"] = model_config["models"][0]["model"]
    except Exception as exc:
        print(f"Warning: could not load saved model config: {exc}")

# ---------------------------------------------------------------------------
# Pricing table  (USD per 1 M tokens)
# ---------------------------------------------------------------------------

PRICING: Dict[str, Dict[str, float]] = {
    # GPT-5 Series
    "gpt-5.2":        {"input": 1.75,  "output": 14.00,  "cached": 0.175},
    "gpt-5.1":        {"input": 1.25,  "output": 10.00,  "cached": 0.125},
    "gpt-5":          {"input": 1.25,  "output": 10.00,  "cached": 0.125},
    "gpt-5-mini":     {"input": 0.25,  "output":  2.00,  "cached": 0.025},
    "gpt-5-nano":     {"input": 0.05,  "output":  0.40,  "cached": 0.005},
    "gpt-5.2-codex":  {"input": 1.75,  "output": 14.00,  "cached": 0.175},
    "gpt-5.1-codex":  {"input": 1.25,  "output": 10.00,  "cached": 0.125},
    "gpt-5.2-pro":    {"input": 21.00, "output": 168.00, "cached": 0.0},
    # GPT-4 Series
    "gpt-4.1":        {"input": 2.00,  "output":  8.00,  "cached": 0.50},
    "gpt-4.1-mini":   {"input": 0.40,  "output":  1.60,  "cached": 0.10},
    "gpt-4.1-nano":   {"input": 0.10,  "output":  0.40,  "cached": 0.025},
    "gpt-4o":         {"input": 2.50,  "output": 10.00,  "cached": 1.25},
    "gpt-4o-mini":    {"input": 0.15,  "output":  0.60,  "cached": 0.075},
    # O Series
    "o3":             {"input": 2.00,  "output":  8.00,  "cached": 0.50},
    "o4-mini":        {"input": 1.10,  "output":  4.40,  "cached": 0.275},
}

# ---------------------------------------------------------------------------
# Model-capability helpers  (module-level — defined ONCE)
# ---------------------------------------------------------------------------

def supports_reasoning_effort(model_name: str) -> bool:
    """True for o-series and gpt-5* models that accept reasoning_effort."""
    lower = model_name.lower()
    return lower.startswith("o") or lower.startswith("gpt-5")


def uses_responses_endpoint(model_name: str) -> bool:
    """
    True for models that require the /v1/responses endpoint.

    - gpt-5.2-pro: confirmed responses-only model
    - codex variants (any name containing 'codex'): use /v1/responses,
      NOT /v1/chat/completions
    """
    lower = model_name.lower()
    return lower == "gpt-5.2-pro" or "codex" in lower


def get_model_price(model_name: str) -> Optional[Dict[str, float]]:
    """Return the pricing entry for *model_name*, matching by longest prefix."""
    if model_name in PRICING:
        return PRICING[model_name]
    best_key, best_price = "", None
    for key, price in PRICING.items():
        if model_name.startswith(key) and len(key) > len(best_key):
            best_key, best_price = key, price
    return best_price


# ---------------------------------------------------------------------------
# Token / cost extraction helpers  (defined ONCE, reused everywhere)
# ---------------------------------------------------------------------------

def extract_token_counts(usage: Dict) -> Dict[str, int]:
    """
    Normalise token counts from either chat-completions or responses API format.

    Returns a dict with keys:
        prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens
    """
    prompt_tokens     = usage.get("prompt_tokens",     usage.get("input_tokens",      0))
    completion_tokens = usage.get("completion_tokens", usage.get("output_tokens",     0))

    # Reasoning tokens
    reasoning_tokens = 0
    if "output_tokens_details" in usage:
        reasoning_tokens = usage["output_tokens_details"].get("reasoning_tokens", 0)
    elif "completion_tokens_details" in usage:
        reasoning_tokens = usage["completion_tokens_details"].get("reasoning_tokens", 0)

    # Cached tokens
    cached_tokens = 0
    if "prompt_tokens_details" in usage:
        cached_tokens = usage["prompt_tokens_details"].get("cached_tokens", 0)
    elif "input_tokens_details" in usage:
        cached_tokens = usage["input_tokens_details"].get("cached_tokens", 0)
    else:
        cached_tokens = usage.get("cached_tokens", 0)

    return {
        "prompt_tokens":     prompt_tokens,
        "completion_tokens": completion_tokens,
        "cached_tokens":     cached_tokens,
        "reasoning_tokens":  reasoning_tokens,
    }


def calculate_cost(usage: Dict, model_name: str) -> float:
    """Return total cost in USD for one API call, or 0.0 if model not in PRICING."""
    price = get_model_price(model_name)
    if not price:
        return 0.0
    t = extract_token_counts(usage)
    regular_input = max(0, t["prompt_tokens"] - t["cached_tokens"])
    cost = (
        regular_input            * price["input"]
        + t["cached_tokens"]     * price.get("cached", 0)
        + t["completion_tokens"] * price["output"]
    ) / 1_000_000
    return cost


# ---------------------------------------------------------------------------
# Core OpenAI call
# ---------------------------------------------------------------------------

async def run_openai(
    prompt: str,
    schema: str,
    model_name: str,
    reasoning_level: Optional[str] = None,
) -> Dict:
    """
    Call the appropriate OpenAI endpoint and return
    {"content": dict, "usage": dict, "model": str}.

    Routing logic:
      - uses_responses_endpoint()  → /v1/responses
      - everything else            → /v1/chat/completions
      - if chat returns "not a chat model" 400/404, auto-retry via /v1/responses
    """
    if not OPENAI_API_KEY:
        raise HTTPException(500, "OPENAI_API_KEY not configured")

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    system_content = (
        "You must strictly follow this JSON schema "
        "and respond ONLY with valid JSON:\n"
        f"{schema}"
    )

    use_responses = uses_responses_endpoint(model_name)

    def _responses_payload() -> Dict:
        pl: Dict = {"model": model_name, "input": f"{system_content}\n\nUser: {prompt}"}
        if reasoning_level and supports_reasoning_effort(model_name):
            pl["reasoning"] = {"effort": reasoning_level.lower()}
        return pl

    def _chat_payload() -> Dict:
        sc = system_content
        if reasoning_level and not supports_reasoning_effort(model_name):
            sc += f"\n\n[Reasoning level requested: {reasoning_level}]"
        pl: Dict = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": sc},
                {"role": "user",   "content": prompt},
            ],
        }
        if reasoning_level and supports_reasoning_effort(model_name):
            pl["reasoning_effort"] = reasoning_level.lower()
        return pl

    api_url = OPENAI_RESPONSES_URL if use_responses else OPENAI_CHAT_URL
    payload = _responses_payload() if use_responses else _chat_payload()

    print(f"[run_openai] model={model_name} endpoint={api_url} use_responses={use_responses} reasoning={reasoning_level}")

    async with httpx.AsyncClient(timeout=get_timeout(model_name)) as client:
        resp = await client.post(api_url, json=payload, headers=headers)

        # Auto-fallback: if chat endpoint rejects with "not a chat model", retry
        if resp.status_code in (400, 404) and not use_responses:
            try:
                err_msg = resp.json().get("error", {}).get("message", "")
            except Exception:
                err_msg = resp.text
            if "not a chat model" in err_msg.lower() or "v1/completions" in err_msg:
                print(f"[run_openai] '{model_name}' rejected by chat endpoint — retrying /v1/responses")
                use_responses = True
                payload = _responses_payload()
                resp = await client.post(OPENAI_RESPONSES_URL, json=payload, headers=headers)

    if resp.status_code != 200:
        body = resp.text or "(empty response body)"
        print(f"[run_openai] FAILED model={model_name} status={resp.status_code} body={body}")
        raise RuntimeError(f"OpenAI error {resp.status_code}: {body}")

    result = resp.json()
    usage  = result.get("usage", {})
    reported_model = result.get("model", model_name)

    # ---- Extract text content ----
    raw_text = ""
    if use_responses:
        for out_item in result.get("output", []):
            if out_item.get("type") == "message":
                for c in out_item.get("content", []):
                    if c.get("type") == "output_text":
                        raw_text = c.get("text", "")
                        break
            if raw_text:
                break
    else:
        choices = result.get("choices", [])
        if choices:
            raw_text = choices[0].get("message", {}).get("content", "")

    try:
        content = json.loads(clean_json_response(raw_text))
    except json.JSONDecodeError:
        content = {"raw_response": raw_text}

    return {"content": content, "usage": usage, "model": reported_model}


# ---------------------------------------------------------------------------
# PromptTransformer
# ---------------------------------------------------------------------------

class PromptTransformer:
    def __init__(self, structure: Dict):
        self.structure       = structure
        self.initial_statics = self._get_initial_statics()
        self.new_groups      = structure.get("new_groups", {})
        self.output_sequence = structure.get("output_sequence", [])

    def _get_initial_statics(self) -> List[str]:
        statics = self.structure.get("initial_groups", {})
        return [statics[k] for k in sorted(statics, key=lambda x: int(x.replace("static", "")))]

    @staticmethod
    def _normalize(text: str) -> str:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = text.replace("\t", " ")
        while "  " in text:
            text = text.replace("  ", " ")
        while "\n\n\n" in text:
            text = text.replace("\n\n\n", "\n\n")
        return text.strip()

    def extract_dynamics(self, old_prompt: str) -> Dict[str, str]:
        dynamics  = {}
        remaining = self._normalize(old_prompt)
        for i, static_block in enumerate(self.initial_statics):
            static_norm = self._normalize(static_block)
            if static_norm not in remaining:
                raise ValueError(f"Static block static{i+1} not found in old prompt")
            before, remaining = remaining.split(static_norm, 1)
            dynamics[f"dynamic{i+1}"] = before
        dynamics[f"dynamic{len(self.initial_statics) + 1}"] = remaining
        return dynamics

    def reconstruct_prompt(self, dynamics: Dict[str, str]) -> str:
        parts = []
        for token in self.output_sequence:
            if token.startswith("dynamic"):
                parts.append(dynamics.get(token, ""))
            elif token.startswith("newstatic"):
                static_key = token.replace("newstatic", "static")
                parts.append(self.new_groups.get(static_key, ""))
            else:
                raise ValueError(f"Unknown token in output_sequence: {token}")
        return "\n\n".join(p.strip() for p in parts if p.strip())

    def transform(self, old_prompt: str) -> str:
        return self.reconstruct_prompt(self.extract_dynamics(old_prompt))


# ---------------------------------------------------------------------------
# File / parsing utilities
# ---------------------------------------------------------------------------

def read_schema_from_content(content: str) -> str:
    return content.strip()


def read_excel_from_bytes(file_bytes: bytes) -> pd.DataFrame:
    return pd.read_excel(io.BytesIO(file_bytes))


def parse_structure_json(structure_content: str) -> dict:
    try:
        return json.loads(structure_content)
    except Exception:
        try:
            return ast.literal_eval(structure_content)
        except (ValueError, SyntaxError) as exc:
            raise ValueError(f"Invalid structure file: {exc}")


def merge_structures(existing: dict, incoming: dict) -> dict:
    out = existing.copy() if isinstance(existing, dict) else {}
    for group in ("initial_groups", "new_groups"):
        merged = {}
        if isinstance(existing.get(group), dict):
            merged.update(existing[group])
        if isinstance(incoming.get(group), dict):
            merged.update(incoming[group])
        out[group] = merged
    if isinstance(incoming, dict) and incoming.get("output_sequence"):
        out["output_sequence"] = incoming["output_sequence"]
    elif not out.get("output_sequence"):
        n = len(out.get("initial_groups", {}))
        seq = ["dynamic1"]
        for i in range(1, n + 1):
            seq += [f"newstatic{i}", f"dynamic{i+1}"]
        out["output_sequence"] = seq
    for k, v in (incoming or {}).items():
        if k not in ("initial_groups", "new_groups", "output_sequence"):
            out[k] = v
    return out


# ---------------------------------------------------------------------------
# Impact metrics
# ---------------------------------------------------------------------------

def extract_category_subcategory(response_str: str) -> Tuple[str, str]:
    try:
        data = json.loads(response_str)
        return data.get("category", "").upper(), str(data.get("subcategory", 0))
    except (json.JSONDecodeError, TypeError):
        return "", "0"


def calculate_impact_metrics(
    old_responses: List[str],
    new_responses: List[str],
    row_indices: Optional[List[int]] = None,
) -> dict:
    if len(old_responses) != len(new_responses):
        return {"error": "Response count mismatch"}

    total = len(old_responses)
    cat_changes = sub_changes = upgrades = downgrades = 0
    cat_order = {"A": 4, "B": 3, "C": 2, "D": 1}

    cats = ["A", "B", "C", "D"]
    subs = [str(i) for i in range(1, 9)]

    confusion    = {c: {d: 0 for d in cats} for c in cats}
    sub_confusion = {s: {t: 0 for t in subs} for s in subs}

    affected_rows = {
        "category_changes": [],
        "upgrades": [],
        "downgrades": [],
        "subcategory_changes": [],
    }

    for pos, (old_r, new_r) in enumerate(zip(old_responses, new_responses)):
        actual_row_index = row_indices[pos] if row_indices and pos < len(row_indices) else pos
        old_cat, old_sub = extract_category_subcategory(old_r)
        new_cat, new_sub = extract_category_subcategory(new_r)
        if not old_cat or not new_cat:
            continue
        if old_cat in confusion and new_cat in confusion[old_cat]:
            confusion[old_cat][new_cat] += 1
        sub_confusion.setdefault(old_sub, {}).setdefault(new_sub, 0)
        sub_confusion[old_sub][new_sub] += 1
        if old_cat != new_cat:
            cat_changes += 1
            affected_rows["category_changes"].append(actual_row_index)
            old_rank, new_rank = cat_order.get(old_cat, 0), cat_order.get(new_cat, 0)
            if new_rank > old_rank:
                upgrades += 1
                affected_rows["upgrades"].append(actual_row_index)
            elif new_rank < old_rank:
                downgrades += 1
                affected_rows["downgrades"].append(actual_row_index)
        if old_sub != new_sub:
            sub_changes += 1
            affected_rows["subcategory_changes"].append(actual_row_index)

    def pct(n): return round(n / total * 100, 1) if total else 0.0

    return {
        "total_candidates":       total,
        "category_change_rate":   pct(cat_changes),
        "upgrade_rate":           pct(upgrades),
        "downgrade_rate":         pct(downgrades),
        "no_change_rate":         pct(total - cat_changes),
        "subcategory_change_rate": pct(sub_changes),
        "net_decision_bias":      round(pct(upgrades) - pct(downgrades), 1),
        "confusion_matrix":       confusion,
        "subcategory_confusion_matrix": sub_confusion,
        "raw_counts": {
            "category_changes":    cat_changes,
            "upgrades":            upgrades,
            "downgrades":          downgrades,
            "subcategory_changes": sub_changes,
        },
        "affected_rows": affected_rows,
    }


def _aggregate_model_cost_tokens(df: pd.DataFrame, model_idx: int) -> Dict:
    """Aggregate cost + token totals for a given model index from the output DataFrame."""
    total_cost = total_in = total_out = total_cached = total_reasoning = total_response_time = 0.0
    timed_rows = 0

    cost_col  = f"cost_{model_idx}"
    usage_col = f"usage_{model_idx}"
    rt_col    = f"reasoning_tokens_{model_idx}"
    time_col  = f"response_time_seconds_{model_idx}"

    if cost_col in df.columns:
        total_cost = float(pd.to_numeric(df[cost_col], errors="coerce").fillna(0).sum())

    if usage_col in df.columns:
        for val in df[usage_col]:
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except Exception:
                    val = {}
            if isinstance(val, dict):
                t = extract_token_counts(val)
                total_in      += t["prompt_tokens"]
                total_out     += t["completion_tokens"]
                total_cached  += t["cached_tokens"]

    if rt_col in df.columns:
        total_reasoning = float(pd.to_numeric(df[rt_col], errors="coerce").fillna(0).sum())

    if time_col in df.columns:
        times = pd.to_numeric(df[time_col], errors="coerce")
        valid_times = times[times.notna()]
        total_response_time = float(valid_times.sum())
        timed_rows = int(valid_times.count())

    n = len(df)
    return {
        "total_cost":             round(total_cost, 4),
        "total_input_tokens":     int(total_in),
        "total_output_tokens":    int(total_out),
        "total_cached_tokens":    int(total_cached),
        "total_reasoning_tokens": int(total_reasoning),
        "total_response_time_seconds": round(total_response_time, 3),
        "avg_response_time_seconds":   round(total_response_time / timed_rows, 3) if timed_rows else 0.0,
        "timed_rows_count":           timed_rows,
        "avg_cost_per_row":       round(total_cost / n, 4) if n else 0.0,
    }


# ---------------------------------------------------------------------------
# Text-formatting helpers
# ---------------------------------------------------------------------------

def detect_tag_in_text(text: str, tag_pattern: Optional[str] = None) -> Optional[str]:
    if tag_pattern:
        return tag_pattern if re.search(f"<{tag_pattern}>(.*?)</{tag_pattern}>", text, re.DOTALL | re.IGNORECASE) else None
    m = re.search(r"<([A-Z_][A-Z0-9_]*)>(.*?)</\1>", text, re.DOTALL)
    return m.group(1) if m else None


def extract_tag_content(text: str, tag_name: str) -> str:
    m = re.search(f"<{tag_name}>(.*?)</{tag_name}>", text, re.DOTALL | re.IGNORECASE)
    return m.group(1).strip() if m else text


def apply_text_formatting(text: str, format_type: str) -> str:
    if format_type == "string":
        return " ".join(line.strip() for line in text.split("\n") if line.strip())
    if format_type == "json":
        try:
            return json.dumps(json.loads(text), indent=2)
        except json.JSONDecodeError:
            return text.strip()
    if format_type == "pretty":
        return "\n".join(line.strip() for line in text.split("\n") if line.strip())
    return text


def apply_formatting_to_field(
    df: pd.DataFrame,
    idx: int,
    field: str,
    format_type: str,
    has_tags: bool,
    tag_pattern: Optional[str],
) -> bool:
    content = str(df.at[idx, field]) if field in df.columns else ""
    if not content:
        return False
    if has_tags and tag_pattern:
        if not detect_tag_in_text(content, tag_pattern):
            return False
        inner     = extract_tag_content(content, tag_pattern)
        formatted = apply_text_formatting(inner, format_type)
        new_val   = re.sub(
            f"<{tag_pattern}>(.*?)</{tag_pattern}>",
            f"<{tag_pattern}>{formatted}</{tag_pattern}>",
            content, flags=re.DOTALL | re.IGNORECASE,
        )
    else:
        new_val = apply_text_formatting(content, format_type)
    df.at[idx, field] = new_val
    return True


# ---------------------------------------------------------------------------
# Routes – static pages
# ---------------------------------------------------------------------------

@app.get("/")
def get_home():
    return FileResponse(frontend_dir / "index.html", media_type="text/html")

@app.get("/index.html")
def get_index():
    return FileResponse(frontend_dir / "index.html", media_type="text/html")

@app.get("/model-config.html")
def get_model_config_page():
    return FileResponse(frontend_dir / "model-config.html", media_type="text/html")

@app.get("/outputs/{filename}")
def download_output(filename: str):
    file_path = f"outputs/{filename}"
    if os.path.exists(file_path):
        return FileResponse(
            file_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=filename,
        )
    raise HTTPException(404, "File not found")


# ---------------------------------------------------------------------------
# Routes – data
# ---------------------------------------------------------------------------

@app.get("/row_data/{row_index}")
def get_row_data(row_index: int):
    global last_output_df
    if last_output_df is None:
        raise HTTPException(404, "No computed results available.")
    if not (0 <= row_index < len(last_output_df)):
        raise HTTPException(400, "Invalid row index")

    row = last_output_df.iloc[row_index]
    model_responses, i = [], 0
    while f"new_response_{i}" in last_output_df.columns:
        model_responses.append({
            "model_index": i,
            "response":    str(row.get(f"new_response_{i}", "")),
            "model_used":  str(row.get(f"model_used_{i}", "")),
        })
        i += 1

    # Legacy single-model fallback
    if not model_responses and "new_response" in last_output_df.columns:
        model_responses.append({
            "model_index": 0,
            "response":    str(row.get("new_response", "")),
            "model_used":  str(row.get("model_used_new", "")),
        })

    return {
        "row_index":    row_index,
        "old_prompt":   str(row.get("prompt", "")),
        "new_prompt":   str(row.get("new_prompt", "")),
        "old_response": str(row.get("response", "")),
        "model_responses": model_responses,
    }


@app.get("/impact_metrics")
def get_impact_metrics():
    global last_output_df
    if last_output_df is None:
        raise HTTPException(404, "No computed results available.")

    old_responses = [str(r) for r in last_output_df.get("response", pd.Series(dtype=str))]
    row_indices = list(range(len(last_output_df)))
    all_metrics, i = [], 0

    while f"new_response_{i}" in last_output_df.columns:
        new_responses = [str(v) for v in last_output_df[f"new_response_{i}"]]
        metrics = calculate_impact_metrics(old_responses, new_responses, row_indices)
        metrics["model_index"] = i
        metrics["model_used"]  = str(last_output_df.iloc[0].get(f"model_used_{i}", f"Model {i}")) if len(last_output_df) else f"Model {i}"
        metrics.update(_aggregate_model_cost_tokens(last_output_df, i))
        all_metrics.append(metrics)
        i += 1

    # Legacy fallback
    if not all_metrics and "new_response" in last_output_df.columns:
        new_responses = [str(v) for v in last_output_df["new_response"]]
        metrics = calculate_impact_metrics(old_responses, new_responses, row_indices)
        metrics.update({"model_index": 0, "model_used": "Default Model",
                        "total_cost": 0, "total_input_tokens": 0,
                        "total_output_tokens": 0, "total_cached_tokens": 0,
                        "total_reasoning_tokens": 0, "avg_cost_per_row": 0,
                        "total_response_time_seconds": 0,
                        "avg_response_time_seconds": 0,
                        "timed_rows_count": 0})
        all_metrics.append(metrics)

    return {"metrics": all_metrics}


# ---------------------------------------------------------------------------
# Routes – run
# ---------------------------------------------------------------------------

@app.post("/run")
async def run_prompts(
    input_excel:        UploadFile = File(...),
    structure_json_file: UploadFile = File(...),
    schema_file:        UploadFile = File(...),
    output_filename:    str        = Form(default="output_results.xlsx"),
):
    """
    Process Excel file with prompts and generate responses for all selected models.
    Columns expected: [prompt, schema, response, model_used]
    """
    global last_output_df

    if not OPENAI_API_KEY:
        raise HTTPException(500, "OPENAI_API_KEY not configured")

    # ---- Read uploads ----
    try:
        df = read_excel_from_bytes(await input_excel.read())
    except Exception as exc:
        raise HTTPException(400, f"Failed to read Excel file: {exc}")

    try:
        structure = parse_structure_json((await structure_json_file.read()).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(400, f"Failed to parse structure JSON: {exc}")

    try:
        schema_str = read_schema_from_content((await schema_file.read()).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(400, f"Failed to read schema file: {exc}")

    if len(df.columns) < 4:
        raise HTTPException(400, "Excel file must have at least 4 columns")

    col_prompt, col_old_schema, col_old_response, col_model_used = df.columns[:4]

    # ---- Prepare output DataFrame ----
    output_df = df.copy()
    output_df["new_prompt"] = ""
    output_df["new_schema"] = schema_str

    models_to_run: List[Dict] = model_config.get("models", [])
    for i in range(len(models_to_run)):
        output_df[f"new_response_{i}"]     = ""
        output_df[f"model_used_{i}"]       = ""
        output_df[f"cost_{i}"]             = 0.0
        output_df[f"usage_{i}"]            = "{}"
        output_df[f"reasoning_tokens_{i}"] = 0

    results: List[Dict] = []
    first_old_prompt = first_new_prompt = ""

    for idx, row in df.iterrows():
        try:
            old_prompt = str(row[col_prompt])
            if idx == 0:
                first_old_prompt = old_prompt

            new_prompt = PromptTransformer(structure).transform(old_prompt)
            if idx == 0:
                first_new_prompt = new_prompt
            output_df.at[idx, "new_prompt"] = new_prompt

            row_errors: List[str] = []

            for i, m_info in enumerate(models_to_run):
                started_at = time.perf_counter()
                try:
                    res = await run_openai(
                        new_prompt, schema_str,
                        m_info["model"], m_info.get("reasoning"),
                    )
                    response_content = res["content"]
                    usage            = res["usage"]
                    tokens           = extract_token_counts(usage)

                    output_df.at[idx, f"new_response_{i}"]     = json.dumps(response_content, indent=2)
                    output_df.at[idx, f"usage_{i}"]            = json.dumps(usage)
                    output_df.at[idx, f"reasoning_tokens_{i}"] = tokens["reasoning_tokens"]
                    output_df.at[idx, f"cost_{i}"]             = round(calculate_cost(usage, m_info["model"]), 6)

                    label = m_info["model"]
                    if m_info.get("reasoning"):
                        label += f" ({m_info['reasoning']})"
                    output_df.at[idx, f"model_used_{i}"] = label

                    print(json.dumps({"model": m_info["model"], "reasoning": m_info.get("reasoning"), "result": res}, indent=2))

                except Exception as exc:
                    error_msg = str(exc) or repr(exc)
                    print(f"[run] Model {i} ({m_info['model']}) exception: {error_msg}")
                    row_errors.append(f"Model {i}: {error_msg}")
                    output_df.at[idx, f"new_response_{i}"] = f"Error: {error_msg}"
                    output_df.at[idx, f"model_used_{i}"]   = "Error"
                finally:
                    output_df.at[idx, f"response_time_seconds_{i}"] = round(time.perf_counter() - started_at, 3)

            results.append({
                "row_index": idx,
                "status": "error" if len(row_errors) == len(models_to_run) else ("partial_error" if row_errors else "success"),
                "error": "; ".join(row_errors) or None,
            })

        except Exception as exc:
            output_df.at[idx, "new_prompt"] = f"Error: {exc}"
            results.append({"row_index": idx, "status": "error", "error": str(exc)})

    last_output_df = output_df

    # ---- Save Excel output ----
    os.makedirs("outputs", exist_ok=True)
    output_path = f"outputs/{output_filename}"
    try:
        output_df.to_excel(output_path, index=False, engine="openpyxl")
    except Exception as exc:
        raise HTTPException(500, f"Failed to write output Excel: {exc}")

    # ---- Build impact metrics for response ----
    old_responses = [str(row[col_old_response]) for _, row in df.iterrows()]
    row_indices = list(range(len(df)))
    all_impact_metrics = []
    for i, m_info in enumerate(models_to_run):
        new_responses = [str(v) for v in output_df[f"new_response_{i}"]]
        metrics = calculate_impact_metrics(old_responses, new_responses, row_indices)
        label = m_info["model"] + (f" ({m_info['reasoning']})" if m_info.get("reasoning") else "")
        metrics.update({"model_index": i, "model_used": label})
        metrics.update(_aggregate_model_cost_tokens(output_df, i))
        all_impact_metrics.append(metrics)

    models_summary = ", ".join(
        m["model"] + (f" ({m['reasoning']})" if m.get("reasoning") else "")
        for m in models_to_run
    )

    result_payload = {
        "status":         "completed",
        "total_rows":     len(df),
        "successful_rows": sum(1 for r in results if r["status"] == "success"),
        "failed_rows":    sum(1 for r in results if r["status"] == "error"),
        "partial_rows":   sum(1 for r in results if r["status"] == "partial_error"),
        "output_file":    output_path,
        "old_schema":     str(df.iloc[0][col_old_schema]) if len(df) else "",
        "new_schema":     schema_str,
        "old_prompt":     first_old_prompt,
        "new_prompt":     first_new_prompt,
        "old_model_used": str(df.iloc[0][col_model_used]) if len(df) else "",
        "new_model_used": models_summary,
        "impact_metrics": all_impact_metrics,
        "details":        results,
    }

    try:
        with open("outputs/latest_run.json", "w") as f:
            json.dump(result_payload, f, indent=2)
    except Exception as exc:
        print(f"Warning: could not save latest_run.json: {exc}")

    return result_payload


@app.post("/run_custom_prompt")
async def run_custom_prompt(prompt: str = Form(...), schema: str = Form(...)):
    """Run a custom prompt using the first configured model."""
    if not OPENAI_API_KEY:
        raise HTTPException(500, "OPENAI_API_KEY not configured")

    models = model_config.get("models", [])
    if not models:
        raise HTTPException(400, "No model configured. Please save a model via /api/save-model-config first.")

    m = models[0]
    try:
        response = await run_openai(prompt, schema, m["model"], m.get("reasoning"))
        return {"response": response}
    except Exception as exc:
        raise HTTPException(500, f"Failed to run custom prompt: {exc}")


# ---------------------------------------------------------------------------
# Routes – model config
# ---------------------------------------------------------------------------

@app.post("/api/save-model-config")
async def save_model_config(request: Request):
    global model_config
    data = await request.json()
    new_config = {"models": data.get("models", []), "timestamp": data.get("timestamp")}
    # Legacy single-model compat
    if not new_config["models"] and data.get("model"):
        new_config["models"] = [{"model": data["model"], "reasoning": data.get("reasoning")}]
    model_config = new_config
    if model_config["models"]:
        os.environ["OPENAI_MODEL"] = model_config["models"][0]["model"]
    with open(_config_file, "w") as f:
        json.dump(model_config, f, indent=2)
    return {"success": True, "message": "Model configuration saved", "config": model_config}


@app.get("/api/get-model-config")
async def get_model_config():
    return {"config": model_config}


# ---------------------------------------------------------------------------
# Routes – formatting
# ---------------------------------------------------------------------------

@app.post("/api/format_content")
async def format_content(request: Request):
    global last_output_df
    if last_output_df is None:
        raise HTTPException(404, "No computed results available.")

    data        = await request.json()
    row_index   = data.get("row_index")
    field       = data.get("field")
    format_type = data.get("format_type")
    has_tags    = data.get("has_tags", False)
    tag_pattern = data.get("tag_pattern")

    if row_index is None or field is None or format_type is None:
        raise HTTPException(400, "row_index, field, and format_type are required")
    if not (0 <= row_index < len(last_output_df)):
        raise HTTPException(400, "Invalid row index")

    field_content = str(last_output_df.iloc[row_index].get(field, ""))
    if not field_content:
        raise HTTPException(400, f"Field '{field}' is empty or not found")

    if has_tags and tag_pattern:
        formatted = apply_text_formatting(extract_tag_content(field_content, tag_pattern), format_type)
    else:
        formatted = apply_text_formatting(field_content, format_type)

    return {"success": True, "formatted_text": formatted, "tag_pattern": tag_pattern if has_tags else None}


@app.post("/api/save_formatting")
async def save_formatting(request: Request):
    global last_output_df

    # Try to reload from disk if not in memory
    if last_output_df is None and os.path.exists("outputs/latest_run.json"):
        try:
            with open("outputs/latest_run.json") as f:
                meta = json.load(f)
            out_file = meta.get("output_file")
            if out_file and os.path.exists(out_file):
                last_output_df = pd.read_excel(out_file)
        except Exception:
            pass

    if last_output_df is None:
        raise HTTPException(404, "No computed results available.")

    data        = await request.json()
    row_index   = data.get("row_index")
    field       = data.get("field")
    format_type = data.get("format_type")
    has_tags    = data.get("has_tags", False)
    tag_pattern = data.get("tag_pattern")
    apply_all   = data.get("apply_to_all", False)

    if row_index is None or field is None or format_type is None:
        raise HTTPException(400, "row_index, field, and format_type are required")

    paired = {"prompt": "new_prompt", "response": "new_response"}.get(field)

    affected = 0
    indices  = range(len(last_output_df)) if apply_all else [row_index]

    if not apply_all and not (0 <= row_index < len(last_output_df)):
        raise HTTPException(400, "Invalid row index")

    for idx in indices:
        try:
            if apply_formatting_to_field(last_output_df, idx, field, format_type, has_tags, tag_pattern):
                affected += 1
            if paired:
                apply_formatting_to_field(last_output_df, idx, paired, format_type, has_tags, tag_pattern)
        except Exception as exc:
            print(f"Error formatting row {idx}: {exc}")

    return {"success": True, "affected_rows": affected, "message": f"Formatting applied to {affected} row(s)"}


# ---------------------------------------------------------------------------
# Routes – last run
# ---------------------------------------------------------------------------

@app.get("/api/last_run")
def get_last_run():
    global last_output_df
    if not os.path.exists("outputs/latest_run.json"):
        return {"status": "none", "message": "No previous run found"}
    try:
        with open("outputs/latest_run.json") as f:
            data = json.load(f)
        if last_output_df is None:
            out_file = data.get("output_file")
            if out_file and os.path.exists(out_file):
                try:
                    last_output_df = pd.read_excel(out_file)
                except Exception as exc:
                    print(f"Failed to reload DataFrame: {exc}")
        return data
    except Exception as exc:
        raise HTTPException(500, f"Failed to retrieve last run: {exc}")