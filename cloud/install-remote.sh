#!/bin/bash
set -euo pipefail
ip -4 addr show | grep -q '172.29.0.1/'
id wordflow >/dev/null 2>&1 || useradd --system --home /srv/wordflow --shell /usr/sbin/nologin wordflow
mkdir -p /srv/wordflow/releases
install -o wordflow -g wordflow -m 755 /tmp/wordflow_cloud.py /srv/wordflow/wordflow_cloud.py
install -o root -g root -m 644 /tmp/wordflow-cloud.service /etc/systemd/system/wordflow-cloud.service
chown wordflow:wordflow /srv/wordflow /srv/wordflow/releases
systemctl daemon-reload
systemctl enable --now wordflow-cloud.service
sleep 1
systemctl is-active wordflow-cloud.service
curl -fsS http://172.29.0.1:8120/healthz
echo
python3 - << 'PY'
from pathlib import Path
path = Path('/srv/cablelab/config/Caddyfile')
text = path.read_text()
marker = 'wordflow.43.134.190.112.sslip.io'
block = '''
wordflow.43.134.190.112.sslip.io {
  encode zstd gzip
  reverse_proxy 172.29.0.1:8120
  header {
    -Server
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
  }
  log {
    output stdout
    format json
  }
}
'''
if marker not in text:
    backup = path.with_name('Caddyfile.bak-wordflow-20260926')
    if not backup.exists():
        backup.write_text(text)
    path.write_text(text.rstrip() + '\n' + block)
    print('caddyfile-updated')
else:
    print('caddyfile-already')
PY
docker exec cablelab-caddy caddy reload --config /etc/caddy/Caddyfile
echo RELOAD_OK
