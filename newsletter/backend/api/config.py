from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # models served via the shared LLM router gateway (aliases as configured there)
    gen_model: str = "chat-default"
    layout_model: str = "chat-default"
    image_model: str = "image-default"
    pose_model: str = "image-edit-default"
    bg_removal_model: str = "image-background-removal-default"

    # RAG chunking (tiktoken-based, see chunk.py)
    chunk_tokens: int = 1024
    chunk_overlap: int = 200

    # ctx.vector namespace for dataroom document chunks
    vector_index: str = "newsletter_documents"

    # Direct-GCS tier — LOCAL DEV ONLY. Consulted only when ctx.storage is
    # unavailable/unusable (see storage.py) AND app_media_gcs_enabled is true.
    # This flag is deliberately NOT declared as a plugin secret in
    # palette-plugin.json, so it can never be set on the hosted server: the
    # server always uses platform storage (ctx.storage, provided by the
    # SDK/platform) and never touches these local credentials.
    app_media_gcs_enabled: bool = False
    gcs_bucket_name: str = ""
    gcs_credentials_path: str = ""
    gcs_object_prefix: str = "newsletter"


settings = Settings()
