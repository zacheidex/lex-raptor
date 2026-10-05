import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "")
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_anon_key: str = os.getenv("SUPABASE_ANON_KEY", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    origin: str = os.getenv("APP_ORIGIN", "http://localhost:3000")
    bucket: str = "matter-files"
    max_file_bytes: int = 20 * 1024 * 1024
    max_expanded_bytes: int = 80 * 1024 * 1024
    max_files: int = 150
    max_pages: int = 500
    max_cells: int = 100_000
    max_chars: int = 2_000_000
    max_prompt_bytes: int = 1_000_000
    job_seconds: int = 600
    inference_mode: str = os.getenv("LEX_RAPTOR_INFERENCE", "local")
    auth_mode: str = os.getenv("LEX_RAPTOR_AUTH", "account")
    ollama_url: str = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
    local_model: str = os.getenv("OLLAMA_MODEL", "qwen3:14b")
    local_context: int = int(os.getenv("OLLAMA_CONTEXT", "32768"))
    local_output: int = int(os.getenv("OLLAMA_MAX_OUTPUT", "4096"))


settings = Settings()
