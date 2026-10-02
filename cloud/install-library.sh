#!/bin/bash
# Run as root on the server after copying the files below into /tmp.
set -euo pipefail
install -d -o wordflow -g wordflow -m 755 /srv/wordflow/library /srv/wordflow/library/images
for file in wordflow_cloud.py library_store.py library_pipeline.py; do
  install -o wordflow -g wordflow -m 755 "/tmp/$file" "/srv/wordflow/$file"
done
install -o wordflow -g wordflow -m 644 /tmp/library-wordlist.txt /srv/wordflow/library-wordlist.txt
install -o root -g root -m 644 /tmp/wordflow-library.service /etc/systemd/system/wordflow-library.service
install -o root -g root -m 644 /tmp/wordflow-library.timer /etc/systemd/system/wordflow-library.timer
# The key file is created by the owner, never by this script: LIBRARY_AI_KEY=...
install -d -o root -g root -m 700 /etc/wordflow
systemctl daemon-reload
systemctl restart wordflow-cloud.service
systemctl enable --now wordflow-library.timer
sleep 1
systemctl is-active wordflow-cloud.service
curl -fsS "http://172.29.0.1:8120/v1/library?limit=1" | head -c 200
echo
systemctl list-timers wordflow-library.timer --no-pager
[ -f /etc/wordflow/library.env ] && echo "AI key file present" || echo "AI key file missing: articles will be collected but not published"
