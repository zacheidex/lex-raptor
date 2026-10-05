"""The only paid network boundary. No tools, arbitrary endpoints, or SDK retries."""

import hashlib
import json
import os

from . import budget
from .settings import settings


def input_bound(instructions, payload, schema):
    # UTF-8 bytes upper-bound byte-level text tokens; include the output schema and
    # a deliberately large allowance for protocol framing. All input is plain text.
    encoded = json.dumps(
        {"instructions": instructions, "input": payload, "schema": schema},
        ensure_ascii=False,
    ).encode()
    if len(encoded) > settings.max_prompt_bytes:
        raise budget.GateError("prompt_size_limit_no_truncation")
    return len(encoded) + 4096


class PaidProvider:
    def __init__(
        self,
        job_id,
        model,
        reasoning="low",
        max_output_tokens=16000,
        benchmark_scope=None,
    ):
        self.job_id, self.model, self.reasoning = job_id, model, reasoning
        self.max_output_tokens, self.benchmark_scope = (
            max_output_tokens,
            benchmark_scope,
        )

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
        bound = input_bound(instructions, payload, schema)
        body = {
            "model": self.model,
            "instructions": instructions,
            "input": payload,
            "schema": schema,
            "reasoning": self.reasoning,
            "max_output_tokens": self.max_output_tokens,
            "temperature": temperature,
        }
        request_hash = hashlib.sha256(
            json.dumps(body, sort_keys=True).encode()
        ).hexdigest()
        price = budget.price_for(self.model)
        key_name = (
            "OPENAI_API_KEY" if price["provider"] == "openai" else "ANTHROPIC_API_KEY"
        )
        if not os.getenv(key_name):
            raise budget.GateError("provider_credentials_missing:" + key_name)
        call_id = f"{self.job_id}:{call_name}"
        reservation = budget.reserve(
            call_id,
            self.job_id,
            self.model,
            request_hash,
            bound,
            self.max_output_tokens,
            category,
            self.benchmark_scope,
        )
        if reservation["state"] == "settled":
            return schema_class.model_validate(reservation["response"]["parsed"])
        try:
            if price["provider"] == "openai":
                from openai import OpenAI

                client = OpenAI(
                    api_key=os.environ[key_name],
                    base_url="https://api.openai.com/v1",
                    max_retries=0,
                    timeout=180,
                )
                kwargs = dict(
                    model=self.model,
                    instructions=instructions,
                    input=payload,
                    max_output_tokens=self.max_output_tokens,
                    store=False,
                    service_tier="default",
                    extra_headers={"X-Client-Request-Id": call_id},
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": schema_class.__name__,
                            "schema": schema,
                            "strict": True,
                        }
                    },
                )
                if self.reasoning != "default":
                    kwargs["reasoning"] = {"effort": self.reasoning}
                if temperature is not None:
                    kwargs["temperature"] = temperature
                r = client.responses.create(**kwargs)
                usage = r.usage.model_dump() if r.usage else {}
                raw = r.output_text
                rid = getattr(r, "_request_id", None) or r.id
                completed = r.status == "completed"
            else:
                from anthropic import Anthropic

                client = Anthropic(
                    api_key=os.environ[key_name],
                    base_url="https://api.anthropic.com",
                    max_retries=0,
                    timeout=180,
                )
                kwargs = dict(
                    model=self.model,
                    system=instructions,
                    messages=[{"role": "user", "content": payload}],
                    max_tokens=self.max_output_tokens,
                    output_config={"format": {"type": "json_schema", "schema": schema}},
                )
                if temperature is not None:
                    kwargs["temperature"] = temperature
                r = client.messages.create(**kwargs)
                usage = r.usage.model_dump()
                usage["input_tokens"] += usage.get(
                    "cache_creation_input_tokens", 0
                ) + usage.get("cache_read_input_tokens", 0)
                raw = "".join(b.text for b in r.content if b.type == "text")
                rid, completed = (
                    getattr(r, "_request_id", None) or r.id,
                    r.stop_reason == "end_turn",
                )
        except Exception:
            budget.uncertain(call_id)
            raise budget.GateError(
                "provider_failure_usage_uncertain_no_retry"
            ) from None
        # Persist usage even if structured validation or the provider's output fails.
        try:
            parsed = schema_class.model_validate_json(raw) if completed else None
        except Exception:
            parsed = None
        budget.settle(
            call_id,
            usage,
            {
                "parsed": parsed.model_dump() if parsed else None,
                "raw": raw,
                "complete": completed,
            },
            rid,
        )
        budget.assert_active(self.job_id)
        if parsed is None:
            raise budget.GateError("provider_incomplete_or_invalid_output")
        return parsed
