# Python LDAP login

Set `GROCY_AUTH_MODE=ldap`. The release uses the pure Python `ldap3` client.
It does not run PHP or require a PHP LDAP module.

Set these values in the environment or `.env`:

```dotenv
GROCY_AUTH_MODE=ldap
GROCY_LDAP_ADDRESS=ldaps://directory.example.com:636
GROCY_LDAP_BASE_DN=dc=example,dc=com
GROCY_LDAP_BIND_DN=cn=grocy,ou=services,dc=example,dc=com
GROCY_LDAP_BIND_PW=replace-with-service-password
GROCY_LDAP_UID_ATTR=uid
GROCY_LDAP_USER_FILTER=(objectClass=person)
GROCY_DEFAULT_PERMISSIONS=["TASKS_MARK_COMPLETED"]
```

Login binds with the service account and searches below the base DN. It then binds
with the returned user DN and the supplied password. A successful login uses the
directory value of `GROCY_LDAP_UID_ATTR` as the local username. New users receive
the directory `givenName`, `sn`, and the configured default permissions. An
existing local user is reused. Local passwords do not replace LDAP authentication.

The web login endpoint returns an application key and a session cookie. Logout
removes that key and session. API keys and existing sessions also work in LDAP mode.

Use an `ldaps://` address for implicit TLS. For StartTLS, use an `ldap://` address
and set `GROCY_LDAP_START_TLS=true`. The client checks the certificate chain and
the server name or IP address. Set `GROCY_LDAP_CA_CERTS_FILE` to a CA file when the
directory uses a private CA. Otherwise, the client uses the system CA certificates.
These checks use [Python's SSL context](https://docs.python.org/3.13/library/ssl.html#ssl.create_default_context).

`GROCY_LDAP_CONNECT_TIMEOUT` defaults to 5 seconds. `GROCY_LDAP_RECEIVE_TIMEOUT`
defaults to 10 seconds. Both values must be positive.

The protocol tests start a disposable OpenLDAP server. Install `slapd`, `ldap-utils`,
and `openssl` to run them. The PHP reference job also installs `php-ldap` for the
separate legacy server. These server packages are test tools, not release dependencies.
