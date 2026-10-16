#!/usr/bin/env python3
"""Build a reproducible, source-only ESPN extension ZIP for the connection page."""
from pathlib import Path
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / 'extensions' / 'espn-connector'
shared = ROOT / 'trade-analyzer' / 'lib' / 'espn.mjs'
shutil.copyfile(shared, EXTENSION / 'espn.mjs')
shutil.copyfile(shared, ROOT / 'supabase' / 'functions' / 'espn-sync' / 'espn.mjs')
version = json.loads((EXTENSION / 'manifest.json').read_text())['version']
output = ROOT / 'trade-analyzer' / 'downloads' / f'espn-connector-v{version}.zip'
output.parent.mkdir(parents=True, exist_ok=True)
allowed = {'manifest.json', 'worker.mjs', 'espn.mjs', 'bridge.js', 'connect.html', 'connect.css', 'connect.mjs'}
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(allowed):
        info = zipfile.ZipInfo(name, (2026, 10, 16, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (EXTENSION / name).read_bytes())
print(f'Built {output.relative_to(ROOT)} ({output.stat().st_size:,} bytes)')
