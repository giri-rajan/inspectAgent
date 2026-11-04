from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT / ".env", ROOT / "api" / ".env"), extra="ignore")

    provider: str = "auto"  # auto | meta | mock  (auto = meta when a key is present)
    model_api_key: str = ""
    meta_api_base: str = "https://api.meta.ai/v1"
    muse_spark_model: str = "muse-spark-1.3"
    sam_model: str = "sam-3.1"
    transcribe_model: str = "muse-voice-transcribe-1.0"
    request_timeout: float = 60.0

    data_dir: Path = ROOT / "data"
    database_url: str = ""
    cors_origins: str = "*"

    @property
    def use_meta(self) -> bool:
        if self.provider == "meta":
            return True
        return self.provider == "auto" and bool(self.model_api_key)

    @property
    def db_url(self) -> str:
        return self.database_url or f"sqlite:///{self.data_dir / 'inspect.db'}"


settings = Settings()
for sub in ("uploads", "samples", "reports"):
    (settings.data_dir / sub).mkdir(parents=True, exist_ok=True)
