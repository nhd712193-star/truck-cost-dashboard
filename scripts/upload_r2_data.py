#!/usr/bin/env python3
import argparse
import datetime as dt
import hashlib
import hmac
import mimetypes
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote


APP_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = APP_DIR / ".env.r2"
REQUIRED_FILES = [
    "manifest.json",
    "rollups/daily.csv.gz",
    "rollups/province.csv.gz",
    "rollups/ward.csv.gz",
    "rollups/order_index.csv.gz",
]


def load_env(path):
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    values.update({k: v for k, v in os.environ.items() if k.startswith(("R2_", "CF_"))})
    return values


def signing_key(secret_key, date_stamp, region="auto", service="s3"):
    key = ("AWS4" + secret_key).encode("utf-8")
    key = hmac.new(key, date_stamp.encode("utf-8"), hashlib.sha256).digest()
    key = hmac.new(key, region.encode("utf-8"), hashlib.sha256).digest()
    key = hmac.new(key, service.encode("utf-8"), hashlib.sha256).digest()
    return hmac.new(key, b"aws4_request", hashlib.sha256).digest()


def upload_file(cfg, source_path, object_key):
    body = source_path.read_bytes()
    payload_hash = hashlib.sha256(body).hexdigest()
    now = dt.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    account_id = cfg["R2_ACCOUNT_ID"]
    bucket = cfg["R2_BUCKET"]
    access_key = cfg["R2_ACCESS_KEY_ID"]
    secret_key = cfg["R2_SECRET_ACCESS_KEY"]
    host = f"{account_id}.r2.cloudflarestorage.com"
    encoded_key = "/".join(quote(part, safe="") for part in object_key.split("/"))
    canonical_uri = f"/{bucket}/{encoded_key}"
    url = f"https://{host}{canonical_uri}"
    content_type = mimetypes.guess_type(source_path.name)[0] or "application/octet-stream"
    if source_path.suffix == ".gz":
      content_type = "application/gzip"

    headers = {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Type": content_type,
        "Host": host,
        "X-Amz-Content-Sha256": payload_hash,
        "X-Amz-Date": amz_date,
    }
    signed_header_names = sorted(k.lower() for k in headers)
    canonical_headers = "".join(f"{name}:{headers[next(k for k in headers if k.lower() == name)].strip()}\n" for name in signed_header_names)
    signed_headers = ";".join(signed_header_names)
    canonical_request = "\n".join([
        "PUT",
        canonical_uri,
        "",
        canonical_headers,
        signed_headers,
        payload_hash,
    ])
    credential_scope = f"{date_stamp}/auto/s3/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    signature = hmac.new(
        signing_key(secret_key, date_stamp),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    headers["Authorization"] = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )

    request = urllib.request.Request(url, data=body, headers=headers, method="PUT")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Upload failed for {object_key}: HTTP {error.code} {detail}") from error


def main():
    parser = argparse.ArgumentParser(description="Upload truck cost dashboard data to Cloudflare R2.")
    parser.add_argument("--skip-prepare", action="store_true", help="Do not regenerate the local data snapshot before uploading.")
    args = parser.parse_args()

    if not args.skip_prepare:
        subprocess.run(["node", "scripts/prepare_static_data.mjs"], cwd=APP_DIR, check=True)

    cfg = load_env(ENV_PATH)
    required = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]
    missing = [key for key in required if not cfg.get(key)]
    if missing:
        print(f"Missing required config: {', '.join(missing)}", file=sys.stderr)
        print(f"Expected config file: {ENV_PATH}", file=sys.stderr)
        return 1

    prefix = cfg.get("R2_PREFIX", "prod").strip("/")
    data_dir = APP_DIR / "data"
    uploaded = []
    for relative in REQUIRED_FILES:
        source = data_dir / relative
        if not source.exists():
            raise FileNotFoundError(source)
        key = f"{prefix}/{relative}" if prefix else relative
        status = upload_file(cfg, source, key)
        uploaded.append((key, source.stat().st_size, status))
        print(f"Uploaded {key} ({source.stat().st_size:,} bytes)")

    public_base = (cfg.get("R2_PUBLIC_BASE") or "").rstrip("/")
    if public_base:
        print(f"Manifest URL: {public_base}/{prefix}/manifest.json")
    print(f"Uploaded {len(uploaded)} files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
