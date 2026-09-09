import argparse
import importlib.util
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('setup',Path(__file__).parents[2]/'scripts/sync-server/setup.py')
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)

class InstallerTests(unittest.TestCase):
    def test_modes_and_injection_rejection(self):
        def options(mode,host,port=443):
            return argparse.Namespace(mode=mode,host=host,port=port,email='test@example.com',accept_acme_terms=True)
        self.assertEqual(setup.validate(options('vpn','10.0.0.1',8443)).host,'10.0.0.1')
        setup.validate(options('ip','8.8.8.8'))
        setup.validate(options('domain','sync.example.com'))
        for host in ['a;whoami','a\nInclude /evil','https://server/a','a:123','../etc','a_b','-example.com']:
            with self.assertRaises(ValueError):setup.validate(options('vpn',host))
        for mode,host in [('ip','10.0.0.1'),('domain','8.8.8.8'),('domain','test.local')]:
            with self.assertRaises(ValueError):setup.validate(options(mode,host))
        with self.assertRaises(ValueError):setup.validate(options('vpn','127.0.0.1',0))

    def test_atomic_permissions_and_verified_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);file=root/'passwords'
            previous=os.umask(0o077)
            try:setup.atomic(file,'secret',0o640)
            finally:os.umask(previous)
            self.assertEqual(file.stat().st_mode&0o777,0o640)
            saved=setup.backup([file],root)
            self.assertEqual((saved/'passwords').read_text(),'secret')
            self.assertTrue((saved/'manifest.json').exists())
            link=root/'alias';link.symlink_to(file)
            with self.assertRaises(RuntimeError):setup.atomic(link,'changed')
            self.assertEqual(file.read_text(),'secret')

    def test_port_conflict_aborts(self):
        with patch.object(setup.socket,'socket') as factory:
            factory.return_value.__enter__.return_value.bind.side_effect=OSError('in use')
            with self.assertRaisesRegex(RuntimeError,'已被占用'):setup.check_ports([443])

    def test_backup_failure_aborts_leaf_replacement(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'certs').mkdir()
            for name in ['ca.pem','ca.key','server.key','server.pem']:(root/'certs'/name).write_text('original')
            with patch.object(setup,'run',return_value=''),patch.object(setup,'backup',side_effect=RuntimeError('backup failed')):
                with self.assertRaisesRegex(RuntimeError,'backup failed'):setup.leaf_certificate(root,{'host':'127.0.0.1'})
            self.assertEqual((root/'certs/server.key').read_text(),'original')
            self.assertEqual((root/'certs/server.pem').read_text(),'original')

    def test_ipv6_url_and_serial_worker(self):
        state={'mode':'vpn','host':'fd00::1','port':8443}
        self.assertEqual(setup.url_for(state),'https://[fd00::1]:8443/nook/')
        config=setup.apache_config(Path('/opt/nook-sync'),state)
        self.assertIn('MaxRequestWorkers 1',config)
        self.assertIn('Require valid-user',config)
        self.assertLess(config.index('LoadModule mpm_prefork'),config.index('User nook-sync'))
        self.assertNotIn('ExecReload',setup.units(Path('/opt/nook-sync'))['nook-sync.service'])

if __name__=='__main__':unittest.main()
