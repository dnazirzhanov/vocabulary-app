"""Storage abstraction for Speaking audio.

Two implementations live here:
- FileSystemStorage: writes under a configurable local directory. Default in dev + tests.
- SupabaseStorage: uploads to a Supabase Storage private bucket via REST. Used in production
  when SUPABASE_URL + SUPABASE_SECRET_KEY are both set.

The interface stays the same so Chunk 2's upload-through-FastAPI flow can be swapped to
signed-URL direct uploads later without touching the API or orchestration layers.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from app.core.config import Settings
from app.core.errors import ApiError


class StorageClient(Protocol):
    """A tiny storage interface. upload/delete are async (called from FastAPI handlers);
    download_sync is synchronous (called from the worker's event loop via asyncio.to_thread
    or directly from tests)."""

    mode: str

    async def upload(self, path: str, content: bytes, content_type: str) -> None:
        """Write `content` under `path`. Overwrites if the key exists."""
        ...

    async def delete(self, path: str) -> None:
        """Remove `path`. Idempotent: deleting a missing key must not raise."""
        ...

    def download_sync(self, path: str) -> bytes:
        """Return the bytes at `path`. Raises if the key does not exist."""
        ...


class FileSystemStorage:
    """Writes audio under `settings.speaking_audio_dir`. Paths are relative; parents are created."""

    mode = "filesystem"

    def __init__(self, root: str | Path):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    async def upload(self, path: str, content: bytes, content_type: str) -> None:
        # content_type is accepted for interface parity but filesystem doesn't persist it.
        _ = content_type
        target = self._resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    async def delete(self, path: str) -> None:
        target = self._resolve(path)
        target.unlink(missing_ok=True)

    def download_sync(self, path: str) -> bytes:
        target = self._resolve(path)
        if not target.exists():
            raise ApiError(404, "audio_not_found", f"Audio file not found: {path}")
        return target.read_bytes()

    def _resolve(self, path: str) -> Path:
        # Path traversal defence: reject absolute or ".." containing keys.
        if path.startswith("/") or ".." in Path(path).parts:
            raise ApiError(400, "invalid_storage_path", "Invalid storage path.")
        return self.root / path


class SupabaseStorage:
    """Uploads to a private Supabase Storage bucket via its REST API."""

    mode = "supabase"

    def __init__(self, base_url: str, service_key: str, bucket: str):
        self.base_url = base_url.rstrip("/")
        self.service_key = service_key
        self.bucket = bucket

    async def upload(self, path: str, content: bytes, content_type: str) -> None:
        import httpx2 as httpx

        url = f"{self.base_url}/storage/v1/object/{self.bucket}/{path}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                content=content,
                headers={
                    "Authorization": f"Bearer {self.service_key}",
                    "Content-Type": content_type,
                    # Overwrite instead of erroring if the key exists.
                    "x-upsert": "true",
                },
            )
        if response.status_code >= 400:
            raise ApiError(
                502,
                "storage_upload_failed",
                f"Audio storage upload failed: {response.status_code}",
            )

    async def delete(self, path: str) -> None:
        import httpx2 as httpx

        url = f"{self.base_url}/storage/v1/object/{self.bucket}/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.delete(
                url, headers={"Authorization": f"Bearer {self.service_key}"}
            )
        # 404 = already gone, which is fine.
        if response.status_code >= 400 and response.status_code != 404:
            raise ApiError(
                502,
                "storage_delete_failed",
                f"Audio storage delete failed: {response.status_code}",
            )

    def download_sync(self, path: str) -> bytes:
        import httpx2 as httpx

        url = f"{self.base_url}/storage/v1/object/authenticated/{self.bucket}/{path}"
        response = httpx.get(
            url,
            headers={"Authorization": f"Bearer {self.service_key}"},
            timeout=30.0,
        )
        if response.status_code == 404:
            raise ApiError(404, "audio_not_found", f"Audio not found in storage: {path}")
        if response.status_code >= 400:
            raise ApiError(
                502,
                "storage_download_failed",
                f"Audio storage download failed: {response.status_code}",
            )
        return response.content


def get_storage(settings: Settings) -> StorageClient:
    """Factory: pick the storage backend based on settings. Called at request time so tests
    can swap `speaking_storage_mode` via monkeypatch."""
    if settings.speaking_storage_mode == "supabase":
        if not settings.supabase_url or settings.supabase_secret_key is None:
            raise ApiError(
                503,
                "storage_misconfigured",
                "Supabase storage is selected but SUPABASE_URL / SUPABASE_SECRET_KEY are not set.",
            )
        return SupabaseStorage(
            settings.supabase_url,
            settings.supabase_secret_key.get_secret_value(),
            settings.speaking_audio_bucket,
        )
    return FileSystemStorage(settings.speaking_audio_dir)
