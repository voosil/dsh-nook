"""Installer failure/retry tests; all filesystem and host effects are isolated."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import socket
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('assistant', Path(__file__).resolve().parents[2] / 'scripts/sync-server/assistant.py')
assistant = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assistant)


class AssistantTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'install'
        self.root.mkdir()
        self.calls = []
        self.host = '100.101.102.103'
        self.source = {'format': 'nook-sync-connection', 'version': 1, 'url': f'https://{self.host}:8443/nook/',
                       'username': 'nook', 'password': 'test-only-secret', 'caCert': ''}
        self.patches = [patch.object(assistant, 'ROOT', self.root), patch.object(assistant, 'VERSION', '0.1.0'),
                        patch.object(assistant, 'UNIT', Path(self.temp.name) / 'unit'),
                        patch.object(assistant, 'LAUNCHER', Path(self.temp.name) / 'launcher'),
                        patch.object(assistant, 'system_info', return_value=('debian', 'bookworm', 'arm64')),
                        patch.object(assistant, 'dependencies'), patch.object(assistant, 'stage'),
                        patch.object(assistant, 'tail_address', side_effect=lambda **kw: self.host),
                        patch.object(assistant, 'choose_port', return_value=8443),
                        patch.object(assistant, 'run', side_effect=self.mock_run),
                        patch.object(assistant.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 10**12})())]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def mock_run(self, args, **kwargs):
        self.calls.append(args)
        if 'export' in args:
            return json.dumps(self.source)
        return ''

    def install(self):
        with contextlib.redirect_stdout(io.StringIO()):
            assistant.install(yes=True)

    def test_repeated_install_preserves_identity_and_selected_port(self):
        self.install()
        first = assistant.read_state()
        self.install()
        self.assertEqual(assistant.read_state(), first)
        self.assertEqual(first['port'], 8443)
        self.assertEqual((self.root / 'state.json').stat().st_mode & 0o777, 0o600)
        self.assertIn('restart: on-failure', (self.root / 'assistant.yaml').read_text())
        self.assertIn('After=network-online.target tailscaled.service docker.service', assistant.UNIT.read_text())

    def test_target_change_stops_before_writing_configuration(self):
        self.install()
        before = (self.root / '.env').read_bytes()
        self.host = '100.101.102.104'
        with self.assertRaisesRegex(RuntimeError, '地址与原部署不同'):
            self.install()
        self.assertEqual(before, (self.root / '.env').read_bytes())

    def test_download_failure_leaves_receipt_and_can_resume(self):
        with patch.object(assistant, 'stage', side_effect=RuntimeError('network offline')):
            with self.assertRaisesRegex(RuntimeError, 'network offline'):
                self.install()
        self.assertFalse(assistant.read_state()['complete'])
        self.install()
        self.assertTrue(assistant.read_state()['complete'])

    def test_failed_first_start_can_resume_without_reselecting_target(self):
        with patch.object(assistant, 'compose', side_effect=RuntimeError('start failed')):
            with self.assertRaisesRegex(RuntimeError, 'start failed'):
                self.install()
        self.assertEqual(assistant.read_state()['port'], 8443)
        self.install()
        self.assertTrue(assistant.read_state()['complete'])

    def test_unknown_nonempty_root_or_volume_is_not_adopted(self):
        (self.root / 'user-data').write_text('keep')
        with self.assertRaisesRegex(RuntimeError, '拒绝接管'):
            self.install()
        self.assertEqual((self.root / 'user-data').read_text(), 'keep')
        (self.root / 'user-data').unlink()  # disposable test fixture
        with patch.object(assistant, 'run', return_value=assistant.VOLUME + '\n'):
            with self.assertRaisesRegex(RuntimeError, '同名数据卷'):
                self.install()

    def test_upgrade_requires_verified_backup_and_downgrade_is_refused(self):
        self.install()
        state = assistant.read_state()
        before = (self.root / '.env').read_bytes()
        with patch.object(assistant, 'VERSION', '0.2.0'), patch.object(assistant, 'backup', side_effect=RuntimeError('backup failed')):
            with self.assertRaisesRegex(RuntimeError, 'backup failed'):
                self.install()
        self.assertEqual(assistant.read_state(), state)
        self.assertEqual((self.root / '.env').read_bytes(), before)
        with patch.object(assistant, 'VERSION', '0.0.9'):
            with self.assertRaisesRegex(RuntimeError, '早于现有'):
                self.install()

    def test_boot_waits_for_original_tailscale_identity(self):
        self.install()
        self.calls.clear()
        self.host = '100.101.102.104'
        with self.assertRaisesRegex(RuntimeError, '地址已变化'):
            assistant.boot(assistant.read_state())
        self.assertFalse(self.calls)

    def test_backup_reads_each_file_and_rejects_corruption_and_links(self):
        path = Path(self.temp.name) / 'backup.tar.gz'
        payload = b'precious user data'
        with tarfile.open(path, 'w:gz') as archive:
            member = tarfile.TarInfo('./data/note')
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))
        assistant.verify_backup(path, {'data/note': hashlib.sha256(payload).hexdigest()})
        with self.assertRaisesRegex(RuntimeError, '不一致'):
            assistant.verify_backup(path, {'data/note': hashlib.sha256(b'other').hexdigest()})
        with tarfile.open(path, 'w:gz') as archive:
            member = tarfile.TarInfo('../../escape')
            archive.addfile(member)
        with self.assertRaisesRegex(RuntimeError, '不支持'):
            assistant.verify_backup(path, {})

    def test_checksum_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, '校验失败'):
            assistant.checked(b'changed', hashlib.sha256(b'original').hexdigest())

    def test_failed_upgrade_restores_previous_program_and_state(self):
        self.install()
        previous = assistant.read_state()
        source = (self.root / 'assistant.py').read_bytes()
        def fail_new(args, **kwargs):
            if 'up' in args and str(self.root / 'releases/0.2.0/compose.yaml') in args:
                raise RuntimeError('new service failed')
            return self.mock_run(args, **kwargs)
        with patch.object(assistant, 'VERSION', '0.2.0'), patch.object(assistant, 'backup') as backup, \
             patch.object(assistant, 'run', side_effect=fail_new):
            with self.assertRaisesRegex(RuntimeError, 'new service failed'):
                self.install()
            backup.assert_called_once()
        self.assertEqual(assistant.read_state(), previous)
        self.assertEqual((self.root / 'assistant.py').read_bytes(), source)

    def test_backup_failure_still_restarts_the_original_service(self):
        self.install()
        state = assistant.read_state()
        with patch.object(assistant, 'compose') as compose, \
             patch.object(assistant, 'run', return_value='{}'), \
             patch.object(assistant.subprocess, 'run', return_value=type('Result', (), {'returncode': 1})()):
            with self.assertRaisesRegex(RuntimeError, '归档失败'):
                assistant.backup(state)
        self.assertEqual(compose.call_args_list[0].args, (state, 'stop', 'sync'))
        self.assertEqual(compose.call_args_list[-1].args, (state, 'up', '-d', '--wait', '--wait-timeout', '180'))

    def test_port_selection_skips_busy_port(self):
        # Restore the real selector for a loopback-only socket check.
        with socket.socket() as listener:
            try:
                listener.bind(('127.0.0.1', 8443))
            except OSError:
                pass
            selector = spec.loader.get_code('assistant')
            namespace = {'__name__': 'isolated'}
            exec(selector, namespace)
            self.assertNotEqual(namespace['choose_port']('127.0.0.1'), 8443)


class TailnetTests(unittest.TestCase):
    def test_existing_login_does_not_change_tailscale_preferences(self):
        with patch.object(assistant, 'run', side_effect=[json.dumps({'BackendState': 'Running'}), '100.64.0.10\n']) as run:
            self.assertEqual(assistant.tail_address(login=True), '100.64.0.10')
        self.assertEqual([call.args[0] for call in run.call_args_list], [['tailscale', 'status', '--json'], ['tailscale', 'ip', '-4']])

    def test_boot_does_not_attempt_interactive_authorization(self):
        with patch.object(assistant, 'run', return_value=json.dumps({'BackendState': 'NeedsLogin'})) as run:
            with self.assertRaisesRegex(RuntimeError, '尚未连接'):
                assistant.tail_address()
        self.assertEqual(run.call_count, 1)


if __name__ == '__main__':
    unittest.main()
