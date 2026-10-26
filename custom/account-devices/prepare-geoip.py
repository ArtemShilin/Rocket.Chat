#!/usr/bin/env python3
"""Download the pinned offline GeoIP snapshot; never send user IPs to a service."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

here = Path(__file__).resolve().parent
manifest = json.loads((here / 'geoip-manifest.json').read_text())
directory = here / 'data'
directory.mkdir(exist_ok=True)
target = directory / 'city.mmdb'
if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != manifest['sha256']:
    archive = directory / 'city.mmdb.gz'
    subprocess.run(['curl', '-fL', '--retry', '3', '--connect-timeout', '20',
                    manifest['source'], '-o', str(archive)], check=True)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['compressed_sha256'], 'GeoIP archive checksum mismatch'
    unpacked = gzip.decompress(archive.read_bytes())
    assert hashlib.sha256(unpacked).hexdigest() == manifest['sha256'], 'GeoIP database checksum mismatch'
    temporary = directory / 'city.mmdb.tmp'
    temporary.write_bytes(unpacked)
    temporary.replace(target)
(directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Offline GeoIP snapshot verified: ' + manifest['edition'])
