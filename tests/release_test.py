"""Release-boundary checks using disposable files, never a real vault."""
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo
from io import BytesIO
import importlib.util
import json
import os
import struct
import sys
import unittest
import zlib

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from release_audit import AuditError, audit_payload, audit_zip, audit_directory, audit_runtime_assets

spec = importlib.util.spec_from_file_location('release_zip', SCRIPTS / 'zip.py')
release_zip = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_zip)


def png_chunk(kind, value):
    return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value) & 0xffffffff)


def fixture_png(extra=b''):
    return b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + extra + png_chunk(b'IDAT', zlib.compress(b'\0\0\0\0')) + png_chunk(b'IEND', b'')


class ReleaseBoundaryTests(unittest.TestCase):
    def test_archives_do_not_reveal_original_times_permissions_or_unicode_paths(self):
        with TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'source'; source.mkdir()
            text = source / '示例.md'; text.write_text('# Demo\n', encoding='utf-8')
            first = root / 'first.zip'; second = root / 'second.zip'
            os.chmod(text, 0o600); os.utime(text, (1000000000, 1000000000))
            release_zip.create_zip(first, source)
            os.chmod(text, 0o755); os.utime(text, (1700000000, 1700000000))
            release_zip.create_zip(second, source)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with ZipFile(first) as archive:
                self.assertEqual(archive.read('source/示例.md'), b'# Demo\n')
            audit_zip('first.zip', first.read_bytes(), markers=[])

    def test_hidden_files_and_symbolic_links_are_rejected(self):
        with TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'source'; source.mkdir()
            hidden = source / '.env'; hidden.write_text('fixture')
            with self.assertRaises(ValueError): release_zip.create_zip(root / 'out.zip', source)
            hidden.unlink(); target = root / 'private.txt'; target.write_text('fixture')
            (source / 'shortcut.txt').symlink_to(target)
            with self.assertRaises(ValueError): release_zip.create_zip(root / 'out.zip', source)

    def test_tokens_private_keys_home_paths_and_local_identity_are_rejected(self):
        fixtures = ['gh' + 'p_' + 'a' * 40, '-----BEGIN ' + 'PRIVATE KEY-----', '/' + 'Users' + '/fixture-user/private.md']
        for value in fixtures:
            with self.assertRaises(AuditError): audit_payload('fixture.txt', value.encode(), markers=[])
        with self.assertRaises(AuditError): audit_payload('fixture.txt', b'private-hostname', markers=['private-hostname'])

    def test_required_public_license_attribution_is_preserved(self):
        audit_payload('THIRD-PARTY-NOTICES.txt', b'Copyright Eemeli Aro <eemeli' + b'@gmail.com>', markers=[])
        with self.assertRaises(AuditError): audit_payload('notes.md', b'private-contact' + b'@personal.invalid-domain.com', markers=[])

    def test_image_metadata_and_trailing_hidden_data_are_rejected(self):
        audit_payload('screen.png', fixture_png(), markers=[])
        for kind in (b'tEXt', b'eXIf', b'tIME', b'iCCP'):
            with self.assertRaises(AuditError): audit_payload('screen.png', fixture_png(png_chunk(kind, b'fixture')), markers=[])
        with self.assertRaises(AuditError): audit_payload('screen.png', fixture_png() + b'private', markers=[])

    def test_archive_path_traversal_and_metadata_are_rejected(self):
        for name in ('../outside.txt', 'bundle/.env', 'bundle/normal.txt'):
            data = BytesIO()
            with ZipFile(data, 'w') as archive: archive.writestr(ZipInfo(name), b'fixture')
            with self.assertRaises(AuditError): audit_zip('fixture.zip', data.getvalue(), markers=[])

    def test_nested_archives_are_audited(self):
        with TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'source'; source.mkdir()
            inner = BytesIO()
            with ZipFile(inner, 'w') as archive: archive.writestr('.env', b'fixture')
            (source / 'nested.zip').write_bytes(inner.getvalue())
            outer = root / 'outer.zip'; release_zip.create_zip(outer, source)
            with self.assertRaises(AuditError): audit_zip('outer.zip', outer.read_bytes(), markers=[])

    def test_checksums_detect_missing_and_modified_assets(self):
        with TemporaryDirectory() as directory:
            root = Path(directory); value = root / 'main.js'; value.write_bytes(b'fixture')
            (root / 'SHA256SUMS.txt').write_text(sha256(value.read_bytes()).hexdigest() + '  main.js\n')
            audit_directory(root)
            value.write_bytes(b'changed')
            with self.assertRaises(AuditError): audit_directory(root)

    def test_loose_runtime_files_must_match_both_archives(self):
        with TemporaryDirectory() as directory:
            root = Path(directory); install = root / 'fixture'; source = root / 'fixture-source'
            install.mkdir(); (source / 'scripts').mkdir(parents=True)
            manifest = {'id': 'fixture', 'version': '0.1.0'}
            values = {'main.js': 'fixture', 'styles.css': 'fixture', 'manifest.json': json.dumps(manifest)}
            allowed = {'install': list(values), 'source': ['manifest.json', 'styles.css', 'scripts/release-files.json']}
            for name, value in values.items():
                (root / name).write_text(value); (install / name).write_text(value)
                if name != 'main.js': (source / name).write_text(value)
            (source / 'scripts/release-files.json').write_text(json.dumps(allowed))
            release_zip.create_zip(root / 'fixture-0.1.0.zip', install)
            release_zip.create_zip(root / 'fixture-0.1.0-source.zip', source)
            audit_runtime_assets(root, manifest)
            (root / 'main.js').write_text('changed')
            with self.assertRaises(AuditError): audit_runtime_assets(root, manifest)


if __name__ == '__main__':
    unittest.main()
