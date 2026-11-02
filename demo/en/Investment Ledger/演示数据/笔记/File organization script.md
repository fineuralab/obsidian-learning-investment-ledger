<!-- learning-investment-ledger-demo:v1 -->

# File organization script

A demo outcome explicitly confirmed by the user.

```python
from pathlib import Path

for file in Path("Downloads").iterdir():
    if file.is_file():
        print(file.suffix, file.name)
```