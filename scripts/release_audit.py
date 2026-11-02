"""Check public release payloads without printing matched private values."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import json
import re
import socket
import struct
import sys
import zlib

ZIP_DATE = (1980, 1, 1, 0, 0, 0)
PNG_PRIVATE_CHUNKS = {b'tEXt', b'iTXt', b'zTXt', b'eXIf', b'tIME', b'iCCP'}
PATTERNS = {
    'home directory': re.compile(r'(?:/(?:Users|home)/[\w.-]+/|[A-Za-z]:[\\/](?:Users)[\\/][\w.-]+[\\/])'),
    'local test directory': re.compile(r'/private/(?:tmp|var)/[\w.-]+'),
    'private key': re.compile(r'-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'access token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b'),
    'network interface address': re.compile(r'(?i)(?<![\w:])[0-9a-f]{2}(?::[0-9a-f]{2}){5}(?![\w:])'),
    'private network address': re.compile(r'\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b'),
    'location timezone': re.compile(r'Asia' + r'/Shanghai'),
    'source map': re.compile(r'[#@]\s*sourceMappingURL\s*='),
}
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
PUBLIC_ATTRIBUTION = {'eemeli' + '@gmail.com'}


class AuditError(ValueError):
    pass


def fail(name, reason):
    raise AuditError(f'{name}: {reason}')


def validate_name(name):
    parts = name.split('/')
    if not name or '\\' in name or ':' in name or any(not part or part in ('.', '..') for part in parts):
        fail('archive entry', 'unsafe relative path')
    if any(part.startswith('.') or part == '__MACOSX' for part in parts):
        fail('archive entry', 'hidden file or host resource folder')
    if PurePosixPath(name).is_absolute():
        fail('archive entry', 'absolute path')


def private_markers():
    values = [Path.home().name]
    try:
        values.append(socket.gethostname())
    except OSError:
        pass
    return [value for value in values if len(value) >= 5 and value.lower() not in {'admin', 'administrator', 'runner', 'fineuralab'}]


def audit_text(name, data, markers=None):
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        fail(name, 'unexpected binary file')
    for label, pattern in PATTERNS.items():
        if pattern.search(text):
            fail(name, label)
    for marker in private_markers() if markers is None else markers:
        if re.search(r'(?<![\w.-])' + re.escape(marker) + r'(?![\w.-])', text, re.IGNORECASE):
            fail(name, 'local identity marker')
    for email in EMAIL.findall(text):
        domain = email.rsplit('@', 1)[1].lower()
        fixture = domain in {'example.com', 'example.org', 'example.net'} or domain.endswith(('.test', '.invalid'))
        attribution = name.endswith('THIRD-PARTY-NOTICES.txt') and email in PUBLIC_ATTRIBUTION
        if not fixture and not attribution:
            fail(name, 'unapproved email address')


def audit_png(name, data):
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        fail(name, 'invalid PNG signature')
    offset = 8
    while offset + 12 <= len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        end = offset + size + 12
        if end > len(data):
            fail(name, 'truncated PNG')
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:end - 4]
        checksum = struct.unpack('>I', data[end - 4:end])[0]
        if zlib.crc32(kind + payload) & 0xffffffff != checksum:
            fail(name, 'PNG checksum mismatch')
        if kind in PNG_PRIVATE_CHUNKS:
            fail(name, 'image text, profile, timestamp or EXIF metadata')
        offset = end
        if kind == b'IEND':
            if offset != len(data):
                fail(name, 'hidden data after image')
            return
    fail(name, 'missing PNG end marker')


def audit_zip(name, data, markers=None, depth=0):
    if depth > 3:
        fail(name, 'excessive nested archives')
    with ZipFile(BytesIO(data)) as archive:
        if archive.comment:
            fail(name, 'archive comment')
        seen = set()
        for entry in archive.infolist():
            validate_name(entry.filename)
            if entry.filename in seen:
                fail(name, 'duplicate archive entry')
            seen.add(entry.filename)
            if entry.date_time != ZIP_DATE or entry.create_system != 0 or entry.external_attr != 0x20:
                fail(name, 'filesystem timestamp or host attributes')
            if entry.extra or entry.comment or entry.flag_bits & 1:
                fail(name, 'extra metadata, comments or encryption')
            if entry.file_size > 64 * 1024 * 1024:
                fail(name, 'unexpected large entry')
            audit_payload(entry.filename, archive.read(entry), markers, depth + 1)
        if not seen:
            fail(name, 'empty archive')


def audit_payload(name, data, markers=None, depth=0):
    validate_name(name)
    if name.endswith('.zip'):
        audit_zip(name, data, markers, depth)
    elif name.endswith('.png'):
        audit_png(name, data)
    else:
        audit_text(name, data, markers)


def audit_runtime_assets(directory, manifest):
    directory = Path(directory)
    identity, version = manifest['id'], manifest['version']
    with ZipFile(directory / f'{identity}-{version}.zip') as install, ZipFile(directory / f'{identity}-{version}-source.zip') as source:
        allowed = json.loads(source.read(f'{identity}-source/scripts/release-files.json'))
        for archive, prefix, section in ((install, identity, 'install'), (source, identity + '-source', 'source')):
            expected = {prefix + '/' + name for name in allowed[section]}
            if set(archive.namelist()) != expected:
                fail('release archives', 'allowed-file coverage mismatch')
        for name in ('main.js', 'manifest.json', 'styles.css'):
            if install.read(identity + '/' + name) != (directory / name).read_bytes():
                fail(name, 'loose asset differs from installation archive')
        for name in ('manifest.json', 'styles.css'):
            if source.read(identity + '-source/' + name) != (directory / name).read_bytes():
                fail(name, 'source differs from installation archive')


def audit_directory(directory):
    directory = Path(directory)
    files = []
    for file in sorted(directory.rglob('*')):
        name = file.relative_to(directory).as_posix()
        validate_name(name)
        if file.is_symlink():
            fail(name, 'symbolic link')
        if file.is_file():
            files.append(name)
            audit_payload(name, file.read_bytes())
    sums = directory / 'SHA256SUMS.txt'
    listed = set()
    for line in sums.read_text().splitlines():
        digest, name = line.split('  ', 1)
        validate_name(name)
        if name in listed or sha256((directory / name).read_bytes()).hexdigest() != digest:
            fail('SHA256SUMS.txt', 'missing, duplicate or mismatched checksum')
        listed.add(name)
    if listed != set(files) - {'SHA256SUMS.txt'}:
        fail('SHA256SUMS.txt', 'asset coverage mismatch')
    if 'manifest.json' in files:
        audit_runtime_assets(directory, json.loads((directory / 'manifest.json').read_text()))
    print(f'Release audit passed: {len(files)} assets; nested archives, images and checksums verified.')


def audit_file_list(root, section):
    root = Path(root)
    manifest = json.loads((root / 'scripts/release-files.json').read_text())
    names = manifest[section]
    if len(names) != len(set(names)):
        fail('release file list', 'duplicate allowed file')
    for name in names:
        validate_name(name)
        current = root
        for part in PurePosixPath(name).parts:
            current = current / part
            if current.is_symlink():
                fail(name, 'symbolic link')
        audit_payload(name, current.read_bytes())
    print(f'Release audit passed: {section}, {len(names)} explicitly allowed files.')


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'directory':
            audit_directory(sys.argv[2])
        elif sys.argv[1] == 'files':
            audit_file_list(sys.argv[2], sys.argv[3])
        elif sys.argv[1] == 'zip':
            target = Path(sys.argv[2])
            audit_zip(target.name, target.read_bytes())
            print('Release material archive audit passed.')
        else:
            raise AuditError('Unknown audit mode')
    except (ValueError, OSError) as error:
        print(f'Release audit failed: {error}', file=sys.stderr)
        raise SystemExit(1)
