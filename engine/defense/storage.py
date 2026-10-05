from urllib.parse import quote

import httpx

from .settings import settings


class Storage:
    def _headers(self):
        if not settings.supabase_service_key or not settings.supabase_url:
            raise RuntimeError("private_storage_not_configured")
        return {
            "apikey": settings.supabase_service_key,
            "Authorization": "Bearer " + settings.supabase_service_key,
        }

    def _url(self, key):
        return (
            settings.supabase_url
            + "/storage/v1/object/"
            + settings.bucket
            + "/"
            + quote(key, safe="/")
        )

    def put(self, key, raw):
        r = httpx.post(
            self._url(key),
            headers={
                **self._headers(),
                "Content-Type": "application/octet-stream",
                "x-upsert": "false",
            },
            content=raw,
            timeout=45,
        )
        r.raise_for_status()

    def get(self, key):
        with httpx.stream(
            "GET", self._url(key), headers=self._headers(), timeout=45
        ) as r:
            r.raise_for_status()
            result = bytearray()
            for chunk in r.iter_bytes():
                result.extend(chunk)
                if len(result) > settings.max_file_bytes:
                    raise ValueError("file_size_limit")
            return bytes(result)

    def delete(self, keys):
        if not keys:
            return
        r = httpx.request(
            "DELETE",
            settings.supabase_url + "/storage/v1/object/" + settings.bucket,
            headers=self._headers(),
            json={"prefixes": keys},
            timeout=45,
        )
        r.raise_for_status()


storage = Storage()
