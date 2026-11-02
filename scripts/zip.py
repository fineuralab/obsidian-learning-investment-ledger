"""Reproducible UTF-8 ZIPs without filesystem timestamps or host attributes."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import sys

ZIP_DATE = (1980, 1, 1, 0, 0, 0)


def create_zip(destination, source):
    destination, source = Path(destination), Path(source)
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Archive source must be a regular directory')
    files = []
    for file in sorted(source.rglob('*')):
        relative = file.relative_to(source.parent)
        if file.is_symlink():
            raise ValueError('Symbolic links cannot be published')
        if any(part.startswith('.') or part == '__MACOSX' for part in relative.parts):
            raise ValueError('Hidden files cannot be published')
        if file.is_file():
            files.append((file, relative.as_posix()))
    with ZipFile(destination, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        archive.comment = b''
        for file, name in files:
            info = ZipInfo(name, date_time=ZIP_DATE)
            info.create_system = 0
            info.external_attr = 0x20
            info.extra = b''
            info.comment = b''
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, file.read_bytes(), compresslevel=9)


if __name__ == '__main__':
    create_zip(*sys.argv[1:3])
