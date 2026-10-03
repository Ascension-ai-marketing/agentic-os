"""Install the optional, pinned DeepSeek SDK into this workspace only."""
from pathlib import Path
import os
import subprocess
import sys
import venv

if sys.version_info < (3, 10):
    raise SystemExit("Python 3.10 or newer is required. Run this script with a newer Python.")

root = Path(__file__).resolve().parents[1]
target = root / ".operator-data" / "dsh-venv"
python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if not python.exists():
    venv.EnvBuilder(with_pip=True).create(target)
subprocess.run([
    str(python), "-m", "pip", "install", "--disable-pip-version-check",
    "-r", str(root / "scripts" / "requirements-assistant.txt"),
], check=True)
subprocess.run([str(python), "-c", "from deepseek_harness import DeepSeekHarness; print('DeepSeek Harness SDK ready.')"], check=True)
print("Configure your own OpenRouter key as described in docs/ASSISTANT-SETUP.md, then restart the OS.")
