"""Disposable test locations resolved on the operator's machine at runtime."""
from pathlib import Path
from tempfile import gettempdir

TEST_ROOT = (Path(gettempdir()) / 'investment-ledger-tests').resolve()
TEST_VAULT = TEST_ROOT / 'vault'
ATTACHMENT_FIXTURES = TEST_ROOT / 'attachment-fixtures'
