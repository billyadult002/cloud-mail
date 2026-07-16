#!/usr/bin/env python3
import os
import sys
import subprocess
from datetime import datetime

def get_git_info():
    git_root = ""
    branch = ""
    try:
        git_root = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        pass
    try:
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        pass
    return git_root, branch

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 repository_check.py <expected_repo_name> [--task <task_name>] [--write-check <file_path>]")
        sys.exit(1)

    expected_repo = sys.argv[1]
    
    # Parse arguments
    task_name = "N/A"
    write_check_path = None
    
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--task" and i + 1 < len(sys.argv):
            task_name = sys.argv[i+1]
            i += 2
        elif sys.argv[i] == "--write-check" and i + 1 < len(sys.argv):
            write_check_path = sys.argv[i+1]
            i += 2
        else:
            i += 1

    cwd = os.path.abspath(os.getcwd())
    git_root, branch = get_git_info()
    
    # Normalize paths for case-insensitivity comparison
    normalized_cwd = cwd.lower()
    normalized_git_root = git_root.lower() if git_root else ""
    
    # Check target write protection (Phase 5)
    write_violation = False
    if write_check_path:
        abs_write_path = os.path.abspath(write_check_path)
        normalized_write = abs_write_path.lower()
        if expected_repo == "finance-workbench":
            allowed = "/Users/billtin/Documents/finance-workbench".lower()
        else:
            allowed = "/Users/billtin/Documents/cloudmail".lower()
            
        if not normalized_write.startswith(allowed):
            write_violation = True

    # Check mirror / snapshot patterns (Phase 4)
    has_mirror = False
    path_to_check = cwd + "/" + (git_root if git_root else "")
    for pat in ["/.hermes/", "/.gemini/", "/Codex/"]:
        if pat in path_to_check:
            has_mirror = True
            break
    if cwd.endswith("/.hermes") or cwd.endswith("/.gemini"):
        has_mirror = True

    # Determine source_of_truth flag & overall validity
    source_of_truth = "false"
    is_valid = False
    
    if expected_repo == "finance-workbench":
        canonical_path = "/Users/billtin/Documents/finance-workbench"
        if normalized_cwd.startswith(canonical_path.lower()) and not has_mirror:
            if git_root and normalized_git_root == canonical_path.lower():
                source_of_truth = "true"
                is_valid = True
    elif expected_repo in ["cloudmail", "CloudMail"]:
        canonical_path = "/Users/billtin/Documents/cloudmail"
        if normalized_cwd.startswith(canonical_path.lower()) and not has_mirror:
            source_of_truth = "true"
            is_valid = True

    # Standard pretask output (Phase 1)
    print("REPOSITORY_CHECK")
    print(f"repository={expected_repo}")
    print(f"cwd={cwd}")
    print(f"git_root={git_root if git_root else 'N/A'}")
    print(f"branch={branch if branch else 'N/A'}")
    print(f"source_of_truth={source_of_truth}")
    
    # Print Mirror Warning if detected
    if has_mirror:
        print("MIRROR_OR_SNAPSHOT_DETECTED")
        is_valid = False
        
    if write_violation:
        print(f"WRITE_PROTECTION_VIOLATION: Target file is outside allowed path bounds!")
        is_valid = False

    # Audit Trail (Phase 6)
    log_dir = canonical_path if is_valid else cwd
    log_file_path = os.path.join(log_dir, "repository_check.log")
    timestamp_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    validation_status = "PASS" if is_valid else "FAIL"
    log_line = f"[{timestamp_str}] Repo: {expected_repo} | Branch: {branch if branch else 'N/A'} | Task: {task_name} | Result: {validation_status}\n"
    
    try:
        with open(log_file_path, "a") as f:
            f.write(log_line)
    except Exception:
        pass

    # Halt task if mismatch (Fail Hard)
    if not is_valid:
        print("FATAL ERROR: REPOSITORY BOUNDARY MISMATCH!")
        print("STOPPING TASK IMMEDIATELY.")
        sys.exit(99)
        
    print("SUCCESS: Repository check passed.")
    sys.exit(0)

if __name__ == "__main__":
    main()
