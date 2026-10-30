"""A disposable OpenLDAP directory for real authentication checks."""

import shutil
import socket
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def directory(root: Path, protocol: str = "ldap"):
    import pytest

    slapd, slapadd = shutil.which("slapd"), shutil.which("slapadd")
    if slapd is None or slapadd is None:
        pytest.skip("Install slapd to run the LDAP protocol checks")
    root.mkdir()
    database = root / "database"
    database.mkdir()
    certificate = root / "directory.crt"
    private_key = root / "directory.key"
    tls = ""
    if protocol != "ldap":
        executable = shutil.which("openssl")
        if executable is None:
            pytest.skip("Install openssl to run the LDAP TLS checks")
        subprocess.run(
            [
                executable,
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=localhost",
                "-addext",
                "subjectAltName=DNS:localhost,IP:127.0.0.1",
                "-keyout",
                str(private_key),
                "-out",
                str(certificate),
            ],
            check=True,
            capture_output=True,
        )
        tls = f"TLSCertificateFile {certificate}\nTLSCertificateKeyFile {private_key}\n"
    configuration = root / "slapd.conf"
    configuration.write_text(f"""include /etc/ldap/schema/core.schema
include /etc/ldap/schema/cosine.schema
include /etc/ldap/schema/inetorgperson.schema
pidfile {root / "slapd.pid"}
argsfile {root / "slapd.args"}
modulepath /usr/lib/ldap
moduleload back_mdb
{tls}
database mdb
maxsize 10485760
suffix "dc=example,dc=test"
rootdn "cn=admin,dc=example,dc=test"
rootpw directory-test-password
directory {database}
""")
    records = root / "directory.ldif"
    records.write_text("""dn: dc=example,dc=test
objectClass: domain
dc: example

dn: uid=alice,dc=example,dc=test
objectClass: inetOrgPerson
uid: alice
cn: Alice Grocer
givenName: Alice
sn: Grocer
description: allowed
userPassword: correct horse

dn: uid=blocked,dc=example,dc=test
objectClass: inetOrgPerson
uid: blocked
cn: Blocked User
sn: User
description: blocked
userPassword: secret
""")
    subprocess.run(
        [slapadd, "-f", str(configuration), "-l", str(records)], check=True, capture_output=True
    )
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    url = f"{'ldaps' if protocol == 'ldaps' else 'ldap'}://127.0.0.1:{port}"
    with (root / "slapd.log").open("wb") as log:
        process = subprocess.Popen(
            [slapd, "-f", str(configuration), "-h", url, "-d", "0"],
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 10
            while True:
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                        break
                except OSError:
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError((root / "slapd.log").read_text()) from None
                    time.sleep(0.05)
            settings = {
                "LDAP_ADDRESS": url,
                "LDAP_BASE_DN": "dc=example,dc=test",
                "LDAP_BIND_DN": "cn=admin,dc=example,dc=test",
                "LDAP_BIND_PW": "directory-test-password",
                "LDAP_UID_ATTR": "uid",
                "LDAP_USER_FILTER": "(description=allowed)",
            }
            if protocol != "ldap":
                settings.update(
                    {"LDAP_CA_CERTS_FILE": certificate, "LDAP_START_TLS": protocol == "starttls"}
                )
            yield settings
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
