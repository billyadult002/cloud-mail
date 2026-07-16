#!/usr/bin/env python3
import os
import shutil
import subprocess
import time
import sys

LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"

def unregister_app(app_path):
    if os.path.exists(LSREGISTER):
        try:
            print(f"Unregistering from Launch Services: {app_path}")
            subprocess.run([LSREGISTER, "-u", app_path], check=True)
        except Exception as e:
            print(f"Warning: Failed to unregister {app_path}: {e}")
    else:
        print(f"Warning: lsregister not found at {LSREGISTER}")

def main():
    build_dir = "/Users/billtin/Documents/cloudmail/build"
    artifacts_dir = "/Users/billtin/Documents/cloudmail/artifacts"
    derived_data_dir = os.path.expanduser("~/Library/Developer/Xcode/DerivedData")

    search_dirs = [build_dir, artifacts_dir, derived_data_dir]
    
    # We will scan all search directories for app bundles
    app_bundles = []
    
    for sdir in search_dirs:
        if not os.path.exists(sdir):
            continue
        for root, dirs, _ in os.walk(sdir):
            for d in list(dirs):
                if d.endswith(".app") and any(name in d for name in ["CloudMail", "GlassMail", "AcceptanceHost"]):
                    app_path = os.path.join(root, d)
                    mtime = os.path.getmtime(app_path)
                    
                    # Determine category (macOS vs iOS)
                    is_macos = os.path.exists(os.path.join(app_path, "Contents", "Info.plist"))
                    
                    # Group by app name and platform
                    if "AcceptanceHost" in d:
                        category = "iOS_AcceptanceHost"
                    elif "CloudMailDeviceAcceptanceTests-Runner" in d:
                        category = "iOS_TestRunner"
                    elif "GlassMail" in d:
                        category = "macOS_GlassMail" if is_macos else "iOS_GlassMail"
                    else: # CloudMail
                        category = "macOS_CloudMail" if is_macos else "iOS_CloudMail"
                        
                    app_bundles.append({
                        "path": app_path,
                        "name": d,
                        "category": category,
                        "mtime": mtime,
                    })
                    
                    # Don't walk inside the app bundle
                    dirs.remove(d)

    # Group apps by category
    by_category = {}
    for app in app_bundles:
        by_category.setdefault(app["category"], []).append(app)
        
    print("Found application bundles on the system:")
    for cat, apps in by_category.items():
        apps.sort(key=lambda x: x["mtime"], reverse=True)
        print(f"\nCategory: {cat}")
        for i, app in enumerate(apps):
            status = "LATEST (Will Keep)" if i == 0 else "OLD (To Delete)"
            mtime_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(app["mtime"]))
            print(f"  [{status}] {app['path']} (Modified: {mtime_str})")

    print("\nStarting cleanup...")
    deleted_count = 0
    freed_space = 0
    
    for cat, apps in by_category.items():
        if not apps:
            continue
        # Keep the first one (latest), delete all others
        latest_app = apps[0]
        old_apps = apps[1:]
        
        for app in old_apps:
            path_to_delete = app["path"]
            
            # Unregister first
            unregister_app(path_to_delete)
            
            # Determine if we can delete the whole build folder to reclaim disk space
            # e.g., if it is inside build/DerivedData-loop* or build/loop*derived
            # We want to make sure we don't delete the root build directory or artifacts directory!
            containing_dir = os.path.dirname(path_to_delete)
            # Find the top-level folder inside build/ or DerivedData/
            target_to_remove = path_to_delete
            
            if path_to_delete.startswith(build_dir):
                # e.g. path_to_delete = build/DerivedData-loop6c5-macos/Build/Products/Debug/CloudMail.app
                # relative path to build_dir
                rel = os.path.relpath(path_to_delete, build_dir)
                parts = rel.split(os.sep)
                if len(parts) > 1:
                    # The first part is the build subfolder, e.g. DerivedData-loop6c5-macos
                    candidate = os.path.join(build_dir, parts[0])
                    # Make sure it's not containing the latest app of another category!
                    contains_latest = False
                    for other_cat, other_apps in by_category.items():
                        if other_apps and other_apps[0]["path"].startswith(candidate):
                            contains_latest = True
                            break
                    if not contains_latest:
                        target_to_remove = candidate

            elif path_to_delete.startswith(derived_data_dir):
                # e.g. path_to_delete = derived_data_dir/CloudMailDeviceAcceptance-dlmqjmkbtwfzmscfvxgbdcnrxpwi/...
                rel = os.path.relpath(path_to_delete, derived_data_dir)
                parts = rel.split(os.sep)
                if len(parts) > 1:
                    candidate = os.path.join(derived_data_dir, parts[0])
                    contains_latest = False
                    for other_cat, other_apps in by_category.items():
                        if other_apps and other_apps[0]["path"].startswith(candidate):
                            contains_latest = True
                            break
                    if not contains_latest:
                        target_to_remove = candidate

            # Perform deletion
            if os.path.exists(target_to_remove):
                try:
                    # Calculate size
                    total_size = 0
                    if os.path.isdir(target_to_remove):
                        for root, _, files in os.walk(target_to_remove):
                            for f in files:
                                fp = os.path.join(root, f)
                                if os.path.exists(fp):
                                    total_size += os.path.getsize(fp)
                    else:
                        total_size = os.path.getsize(target_to_remove)
                        
                    print(f"Deleting: {target_to_remove} ({total_size / (1024*1024):.2f} MB)")
                    if os.path.isdir(target_to_remove):
                        shutil.rmtree(target_to_remove)
                    else:
                        os.remove(target_to_remove)
                        
                    freed_space += total_size
                    deleted_count += 1
                except Exception as e:
                    print(f"Error deleting {target_to_remove}: {e}")

    # Finally, let's also query Launch Services for any dead registrations that don't exist on disk
    # and unregister them.
    print("\nScanning Launch Services database for dead CloudMail registrations...")
    try:
        output = subprocess.run([LSREGISTER, "-dump"], capture_output=True, text=True, check=True).stdout
        path_lines = [line.strip() for line in output.split("\n") if line.strip().startswith("path:")]
        for line in path_lines:
            # Format is "path:                       /path/to/app (0x...)"
            p = line.split("path:", 1)[1].strip()
            # Remove hex code if present at the end
            if " (" in p:
                p = p.rsplit(" (", 1)[0].strip()
            
            if any(name in p for name in ["CloudMail", "GlassMail", "AcceptanceHost"]):
                if not os.path.exists(p):
                    print(f"Found dead registration: {p}")
                    unregister_app(p)
    except Exception as e:
        print(f"Warning: Failed to scan Launch Services database: {e}")

    print(f"\nCleanup complete. Deleted {deleted_count} items. Freed {freed_space / (1024*1024):.2f} MB of space.")

if __name__ == "__main__":
    main()
