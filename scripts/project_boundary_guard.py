#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path('/Users/billtin/Documents/cloudmail')
ACTIVE = [ROOT / 'task.md', ROOT / 'implementation_plan.md', ROOT / 'NEXORA_CURRENT_CHECKPOINT.md']
FORBIDDEN = ('fastone v24 collaborative harness', 'pass_v23_full_production', 'v12.fastonegroup.com current checkpoint')

errors = []
if (ROOT / '.git').exists():
    errors.append('unexpected nested git source root under canonical non-git NEXORA repository')
for path in ACTIVE:
    if not path.is_file():
        errors.append(f'missing active checkpoint file: {path}')
        continue
    text = path.read_text(errors='replace').lower()
    for marker in FORBIDDEN:
        if marker in text:
            errors.append(f'forbidden FASTONE checkpoint marker in {path.name}: {marker}')
if errors:
    print('PROJECT_BOUNDARY_GUARD=FAIL')
    for error in errors:
        print(f'ERROR: {error}')
    sys.exit(1)
print('PROJECT_BOUNDARY_GUARD=PASS')
print(f'project=NEXORA root={ROOT}')
