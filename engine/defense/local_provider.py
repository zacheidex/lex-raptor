"""Local Ollama inference. Never falls back to a paid provider or a cloud model."""

import hashlib
import ipaddress
import json
import time
from urllib.parse import urlsplit

import httpx

from . import budget, db
from .settings import settings


def local_endpoint():
    url = urlsplit(settings.ollama_url)
    try:
        loopback = (
            url.hostname == "localhost"
            or ipaddress.ip_address(url.hostname).is_loopback
        )
    except ValueError:
        loopback = False
    if (
        not loopback
        or url.scheme != "http"
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path not in ("", "/")
    ):
        raise budget.GateError("local_model_requires_loopback_endpoint")
    return settings.ollama_url.rstrip("/")


def local_info():
    model = settings.local_model
    if "cloud" in model.lower():
        raise budget.GateError("cloud_model_not_allowed_in_local_mode")
    with httpx.Client(base_url=local_endpoint(), timeout=5, trust_env=False) as client:
        response = client.get("/api/tags")
        response.raise_for_status()
        match = next(
            (m for m in response.json().get("models", []) if m["name"] == model), None
        )
        if not match or match.get("remote_model") or match.get("remote_host"):
            raise budget.GateError("local_model_not_installed")
        info = client.post("/api/show", json={"model": model})
        info.raise_for_status()
        info = info.json()
        if info.get("remote_model") or info.get("remote_host"):
            raise budget.GateError("cloud_model_not_allowed_in_local_mode")
        return {"model": model, "digest": match["digest"], "size_bytes": match["size"]}


class LocalProvider:
    def __init__(self, job_id=None, model=None, reasoning=None, max_output_tokens=None):
        self.job_id = job_id
        self.model = settings.local_model
        self.max_output_tokens = min(
            max_output_tokens or settings.local_output, settings.local_output
        )
        self.last_usage = {}

    def complete(
        self,
        instructions,
        payload,
        schema_class,
        call_name,
        category="generation",
        temperature=None,
    ):
        schema = schema_class.model_json_schema()
        # Ollama's format parameter constrains decoding but does not reliably
        # teach the model the response fields. Provide the schema as context too.
        # The initial live diagnostic otherwise abstained on every supported task.
        instructions += (
            "\nRespond with a JSON object matching this schema:\n"
            + json.dumps(schema, ensure_ascii=False)
        )
        # Conservative byte bound plus framing. Oversized evidence fails visibly;
        # research retrieval publishes its selected subset separately.
        size = len(
            (instructions + payload + json.dumps(schema, ensure_ascii=False)).encode()
        )
        if size + self.max_output_tokens + 1024 > settings.local_context:
            raise budget.GateError(
                "local_context_limit_reduce_source_scope_no_truncation"
            )
        if self.job_id:
            budget.assert_active(self.job_id)
        info = local_info()
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": payload},
            ],
            "format": schema,
            "stream": False,
            "think": False,
            "keep_alive": "10m",
            "options": {
                "num_ctx": settings.local_context,
                "num_predict": self.max_output_tokens,
                "temperature": temperature if temperature is not None else 0,
                "seed": 42,
            },
        }
        request_hash = hashlib.sha256(
            json.dumps(body, sort_keys=True).encode()
        ).hexdigest()
        call_id = f"{self.job_id}:{call_name}"
        if self.job_id:
            with db.connect() as c:
                budget.validate_job(c, self.job_id)
                old = c.execute(
                    "select id from defense.local_calls where id=%s", (call_id,)
                ).fetchone()
                if old:
                    raise budget.GateError(
                        "local_call_already_attempted_submit_new_job"
                    )
                c.execute(
                    "insert into defense.local_calls(id,job_id,model,model_digest,request_hash,state) values(%s,%s,%s,%s,%s,'running')",
                    (call_id, self.job_id, self.model, info["digest"], request_hash),
                )
        start = time.monotonic()
        try:
            with httpx.Client(
                base_url=local_endpoint(), timeout=240, trust_env=False
            ) as client:
                response = client.post("/api/chat", json=body)
                response.raise_for_status()
                result = response.json()
            self.last_usage = {
                "input_tokens": result.get("prompt_eval_count", 0),
                "output_tokens": result.get("eval_count", 0),
                "duration_ms": round((time.monotonic() - start) * 1000),
                "model_digest": info["digest"],
                "request_hash": request_hash,
                "provider_cost_usd": 0,
                "service_fee_usd": 0,
            }
            if not result.get("done") or result.get("done_reason") != "stop":
                raise budget.GateError("local_model_incomplete_output")
            parsed = schema_class.model_validate_json(result["message"]["content"])
            if self.job_id:
                budget.assert_active(self.job_id)
                db.execute(
                    "update defense.local_calls set state='completed',input_tokens=%s,output_tokens=%s,duration_ms=%s where id=%s",
                    (
                        self.last_usage["input_tokens"],
                        self.last_usage["output_tokens"],
                        self.last_usage["duration_ms"],
                        call_id,
                    ),
                )
            return parsed
        except Exception as exc:
            if self.job_id:
                db.execute(
                    "update defense.local_calls set state='failed' where id=%s",
                    (call_id,),
                )
            if isinstance(exc, budget.GateError):
                raise
            raise budget.GateError(
                "local_model_unavailable_or_invalid_output_no_cloud_fallback"
            ) from None


def workspace_provider(job_id, model, reasoning="low", max_output_tokens=4096):
    if settings.auth_mode == "local" and settings.inference_mode != "local":
        raise budget.GateError("account_free_requires_local_inference")
    if settings.inference_mode == "local":
        return LocalProvider(job_id, max_output_tokens=max_output_tokens)
    if settings.inference_mode == "api":
        from .provider import PaidProvider

        return PaidProvider(job_id, model, reasoning, max_output_tokens)
    raise budget.GateError("unknown_inference_mode")
