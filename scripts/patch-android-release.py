#!/usr/bin/env python3
"""
Idempotent post-prebuild patcher for android/app/build.gradle.

Run AFTER `npx expo prebuild --platform android` and BEFORE `./gradlew assembleRelease`.

Applies three changes:
  (a) Injects a `release` signingConfig block that reads keystore path/passwords
      from env vars (RELEASE_KEYSTORE_PATH, RELEASE_KEYSTORE_PASSWORD,
      RELEASE_KEY_ALIAS, RELEASE_KEY_PASSWORD).
  (b) Rewires buildTypes.release.signingConfig from signingConfigs.debug to
      signingConfigs.release.
  (c) Injects a top-level `splits { abi { ... } }` block enabling per-ABI APKs
      for arm64-v8a and armeabi-v7a (no universal APK).

Idempotent: re-running after a successful patch is a no-op (prints
"already patched, skipping" and exits 0 for each already-applied change).
Fails loud (sys.exit(1)) if an expected anchor section can't be found —
Groovy build.gradle structure is fragile enough that silent no-ops on a
genuine miss would be worse than a hard failure.
"""
import sys
from pathlib import Path

GRADLE_PATH = Path(__file__).resolve().parent.parent / "android" / "app" / "build.gradle"

RELEASE_SIGNING_BLOCK = """        release {
            storeFile file(System.getenv("RELEASE_KEYSTORE_PATH") ?: "release.keystore")
            storePassword System.getenv("RELEASE_KEYSTORE_PASSWORD")
            keyAlias System.getenv("RELEASE_KEY_ALIAS")
            keyPassword System.getenv("RELEASE_KEY_PASSWORD")
        }
"""

SPLITS_BLOCK = """    splits {
        abi {
            enable true
            reset()
            include 'arm64-v8a', 'armeabi-v7a'
            universalApk false
        }
    }
"""


def find_block(lines, header_needle):
    """Find the line index of a block opener containing header_needle, and the
    line index of its matching closing brace (brace-depth counter, since
    Groovy nests freely and regex alone is unreliable for this)."""
    start = None
    for i, line in enumerate(lines):
        if header_needle in line and "{" in line:
            start = i
            break
    if start is None:
        return None, None

    depth = 0
    for i in range(start, len(lines)):
        depth += lines[i].count("{")
        depth -= lines[i].count("}")
        if depth == 0:
            return start, i
    return start, None


def patch_signing_config(lines):
    sc_start, sc_end = find_block(lines, "signingConfigs")
    if sc_start is None or sc_end is None:
        print("ERROR: could not find signingConfigs { } block in build.gradle", file=sys.stderr)
        sys.exit(1)

    block_text = "\n".join(lines[sc_start:sc_end + 1])
    if "release {" in block_text:
        print("signingConfigs.release: already patched, skipping")
        return lines, False

    # Insert the release block just before the closing brace of signingConfigs.
    indent_line = RELEASE_SIGNING_BLOCK.rstrip("\n").split("\n")
    new_lines = lines[:sc_end] + indent_line + lines[sc_end:]
    print("signingConfigs.release: injected")
    return new_lines, True


def patch_build_type_signing(lines):
    bt_start, bt_end = find_block(lines, "buildTypes")
    if bt_start is None or bt_end is None:
        print("ERROR: could not find buildTypes { } block in build.gradle", file=sys.stderr)
        sys.exit(1)

    rel_start, rel_end = find_block(lines[bt_start:bt_end + 1], "release")
    if rel_start is None:
        print("ERROR: could not find buildTypes.release { } block in build.gradle", file=sys.stderr)
        sys.exit(1)
    rel_start += bt_start
    rel_end = (rel_end + bt_start) if rel_end is not None else bt_end

    changed = False
    for i in range(rel_start, rel_end + 1):
        if "signingConfig signingConfigs.debug" in lines[i]:
            lines[i] = lines[i].replace(
                "signingConfig signingConfigs.debug", "signingConfig signingConfigs.release"
            )
            changed = True
        elif "signingConfig signingConfigs.release" in lines[i]:
            print("buildTypes.release.signingConfig: already patched, skipping")
            return lines, False

    if changed:
        print("buildTypes.release.signingConfig: rewired debug -> release")
        return lines, True

    print(
        "ERROR: buildTypes.release block found but no "
        "'signingConfig signingConfigs.debug' line to rewire",
        file=sys.stderr,
    )
    sys.exit(1)


def patch_splits(lines):
    text = "\n".join(lines)
    if "splits {" in text:
        print("splits (ABI): already patched, skipping")
        return lines, False

    android_start, android_end = find_block(lines, "android {")
    if android_start is None:
        # fall back: some generated files use "android{" without space, or the
        # top-level block just says "android {" preceded by other tokens.
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped == "android {" or stripped.startswith("android {"):
                android_start = i
                break
    if android_start is None:
        print("ERROR: could not find top-level android { } block in build.gradle", file=sys.stderr)
        sys.exit(1)

    depth = 0
    android_end = None
    for i in range(android_start, len(lines)):
        depth += lines[i].count("{")
        depth -= lines[i].count("}")
        if depth == 0:
            android_end = i
            break
    if android_end is None:
        print("ERROR: could not find closing brace of android { } block", file=sys.stderr)
        sys.exit(1)

    splits_lines = SPLITS_BLOCK.rstrip("\n").split("\n")
    new_lines = lines[:android_end] + splits_lines + lines[android_end:]
    print("splits (ABI): injected (arm64-v8a, armeabi-v7a)")
    return new_lines, True


def main():
    if not GRADLE_PATH.exists():
        print(
            f"ERROR: {GRADLE_PATH} not found. Run `npx expo prebuild --platform android` first.",
            file=sys.stderr,
        )
        sys.exit(1)

    original = GRADLE_PATH.read_text()
    lines = original.split("\n")

    lines, changed1 = patch_signing_config(lines)
    lines, changed2 = patch_build_type_signing(lines)
    lines, changed3 = patch_splits(lines)

    if not (changed1 or changed2 or changed3):
        print("android/app/build.gradle: already patched, skipping")
        sys.exit(0)

    GRADLE_PATH.write_text("\n".join(lines))
    print(f"android/app/build.gradle: patched successfully ({GRADLE_PATH})")


if __name__ == "__main__":
    main()
