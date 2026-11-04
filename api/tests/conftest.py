import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
_tmp = tempfile.mkdtemp(prefix="inspectagent-test-")
os.environ["DATA_DIR"] = _tmp
os.environ["PROVIDER"] = "mock"
os.environ["MODEL_API_KEY"] = ""
