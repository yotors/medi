#!/usr/bin/env python3
"""Repeatable container checks. Run only against owned local/staging systems."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
IMAGES = json.loads((ROOT / 'tooling/images.json').read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tool', choices=IMAGES)
    parser.add_argument('--version', action='store_true', help='Check tool installation without scanning')
    args = parser.parse_args()
    reports = ROOT / 'artifacts' / args.tool
    reports.mkdir(parents=True, exist_ok=True)
    image = IMAGES[args.tool]
    if args.version:
        flag = {'semgrep': '--version', 'trivy': '--version', 'k6': 'version', 'zap': '-version'}[args.tool]
        if args.tool == 'zap':
            extra = ['zap.sh', '-cmd', flag]
        elif args.tool == 'semgrep':
            extra = ['semgrep', flag]
        else:
            extra = [flag]
        return subprocess.run(['docker', 'run', '--rm', image, *extra]).returncode

    command = ['docker', 'run', '--rm', '--user', f'{os.getuid()}:{os.getgid()}', '-e', 'HOME=/tmp']
    if args.tool in ('zap', 'k6'):
        target = os.environ.get('BASE_URL', '')
        url = urlparse(target)
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
            parser.error('Set BASE_URL to an owned HTTP(S) test endpoint without URL credentials.')
        # Host networking allows these Linux containers to reach local dev servers.
        command += ['--network', 'host']

    if args.tool == 'semgrep':
        command += ['-v', f'{ROOT}:/src:ro', '-v', f'{reports}:/reports', '-w', '/src',
                    image, 'semgrep', 'scan', '--config', 'p/ci', '--metrics=off',
                    '--disable-version-check', '--error', '--strict', '--json',
                    '--output', '/reports/results.json',
                    '--exclude', '.agents', '--exclude', '_bmad', '--exclude', '.venv',
                    '--exclude', '.cache', '--exclude', '.local', '--exclude', '.env', '--exclude', 'node_modules', '--exclude', 'artifacts', '.']
    elif args.tool == 'trivy':
        cache = ROOT / '.cache/trivy'
        cache.mkdir(parents=True, exist_ok=True)
        command += ['-v', f'{ROOT}:/src:ro', '-v', f'{reports}:/reports', '-v', f'{cache}:/cache',
                    image, 'fs', '--cache-dir', '/cache', '--scanners', 'vuln,secret,misconfig',
                    '--severity', 'HIGH,CRITICAL', '--exit-code', '1', '--format', 'json',
                    '--output', '/reports/results.json']
        for directory in ['.git', '.cache', '.venv', 'node_modules', 'artifacts', '.agents', '_bmad', '.local']:
            command += ['--skip-dirs', f'/src/{directory}']
        command += ['--skip-files', '/src/.env', '/src']
    elif args.tool == 'zap':
        command += ['-v', f'{reports}:/zap/wrk:rw', image, 'zap-baseline.py',
                    '-t', target, '-m', '1', '-J', 'results.json', '-r', 'report.html']
    else:
        command += ['-v', f'{ROOT / "tooling"}:/scripts:ro', '-v', f'{reports}:/reports', '-e', 'BASE_URL']
        for name in ['VUS', 'DURATION', 'P95_MS']:
            if name in os.environ:
                command += ['-e', name]
        command += [image, 'run', '--summary-export=/reports/summary.json', '/scripts/load-smoke.js']
    # Propagate scanner findings and tool errors instead of reporting false success.
    return subprocess.run(command, cwd=ROOT).returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except FileNotFoundError:
        sys.exit('Docker is required and must be accessible to the current user.')
