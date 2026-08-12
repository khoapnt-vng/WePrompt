# BUG-017 — runtime loss of local data access

Status: **investigated, partially closed.** The safety envelope's destructive half is
proven; detection and recovery UX remain open and are scoped at the end.

## The bug

> **[BUG-017][P1][Needs reproduction] Recover safely when AionCore loses SQLite access**
>
> - Actual: a real incident returned SQLite code 14 across providers, assistants,
>   conversations, App Operations, and Health Check; integrity passed and restart
>   restored service, but the durable cause is unconfirmed.
> - Expected: identify local-data access failure accurately, preserve the database,
>   offer safe restart/retry and bounded diagnostics, and never delete or rebuild data
>   without confirmed corruption and explicit consent.

## Reproduction

SQLite 3.50.4, macOS, unprivileged (euid 501), driven through Python's `sqlite3`.
The engine's behaviour is binding-independent, so it applies to AionCore's Rust
binding; the script is `repro14.py`, reproduced in full at the end of this document.

Each scenario opens a database in its own directory, then removes access in a
different way.

| #   | Scenario                                                    | Result                                |
| --- | ----------------------------------------------------------- | ------------------------------------- |
| A   | Cold open, directory mode `000`                             | **code 14 `SQLITE_CANTOPEN`**         |
| B   | Cold open, database file mode `000`                         | **code 14 `SQLITE_CANTOPEN`**         |
| C   | Open handle, write after directory made read-only           | code 1544 `SQLITE_READONLY_DIRECTORY` |
| D   | Open handle, read after directory sealed                    | **no error** — read succeeded         |
| E   | Open handle, write after the file is unlinked               | code 1032 `SQLITE_READONLY_DBMOVED`   |
| F   | Open handle, `PRAGMA integrity_check` with directory sealed | **no error** — returned `ok`          |
| G   | New connection while the directory is sealed                | **code 14 `SQLITE_CANTOPEN`**         |

### What this establishes

**Code 14 is an open-time error only.** Every scenario that produced it (A, B, G) was
opening a connection. No scenario reached code 14 through an already-open handle:
writes degraded to the `SQLITE_READONLY_*` family (C, E) and reads kept working
outright (D).

That is the load-bearing finding, because it constrains the incident. Code 14
appearing across providers, assistants, conversations, App Operations and Health
Check _simultaneously_ means each of those surfaces was **opening its own connection**
— a per-request or pooled connection re-open — rather than sharing one long-lived
handle. A single shared handle would have kept serving reads (D) and would have
reported the readonly family on writes (C), not 14.

**"Integrity passed" is consistent with the database being unreachable, and is not
evidence about reachability.** F shows `integrity_check` answering `ok` on an
already-open handle inside a directory with no permissions at all. The check reads
pages through the open descriptor; it never re-opens, so it cannot observe the access
loss. The incident's integrity result therefore neither contradicts nor explains the
code 14 — but it _is_ positive evidence **against** corruption.

**Restart restoring service is expected** and does not imply the data was repaired.
Restart re-opens; if the underlying permission, path or mount condition has cleared,
opens succeed again. Nothing was fixed — the condition passed.

### What it does not establish

The **durable cause** is still unconfirmed, exactly as the register says. This
reproduction shows what _class_ of condition produces the observed signature; it does
not show which one occurred on the user's machine. Candidates consistent with the
evidence — a sleeping or detached volume, a permissions change, a path that moved,
descriptor exhaustion — are not distinguished by anything in the incident report.

The **wire shape at the WePrompt boundary is unverified.** No AionCore build reachable
from this checkout emits a runtime access-loss boundary, so whether a runtime code 14
arrives with a structured `backendBoundaryCode`/`backendBoundaryStage` or as an
unstructured transport error is unknown. That question gates classification, and it is
the first thing to answer before building detection. It needs AionCore.

## Where WePrompt stands today

**All local-data classification is startup-only.** `classifyBackendStartupFailure`
(`packages/desktop/src/process/startup/backendStartupFailure.ts`) is the single
classifier, and it runs on the backend spawn path, reading structured boundary codes
AionCore emits at bootstrap. Nothing classifies, surfaces or bounds a runtime loss —
which is precisely the window the incident occurred in.

**The runtime database is entirely AionCore's.** WePrompt's own `better-sqlite3`
handle is opened and closed inside `runLegacyDatabaseMigrations`, a one-shot pass
before the backend starts (`runLegacyDatabaseMigrations.ts:50-93`), so it is not a
runtime access-loss surface and is out of scope for this bug.

**The destructive path is consent-gated and correctly scoped.**
`recoverCorruptedDatabaseAfterUserConfirmation` backs up and rebuilds the database. It
is reachable only via the `backend:recover-corrupted-database` IPC handler, and only
when the active failure's reason is `backend_recoverable_database_corruption`. Access
loss has no classifier rung, so it falls through to `backend_startup_failed` and the
guard already refuses it.

That last point is the answer to the register's hardest clause — _never delete or
rebuild without confirmed corruption_ — and it held without modification. The
correct deliverable was therefore proof, not a change.

## What was added

Tests only. No production code was modified; the guard was already sufficient.

- `tests/unit/bootstrap/recoverCorruptedDatabase.test.ts` — the rebuild is refused for
  every non-corruption reason, including the `backend_startup_failed` bucket that
  access loss lands in, and for a failure carrying SQLITE_CANTOPEN evidence.
- `tests/unit/bootstrap/backendStartupFailure.test.ts` — three constructed access-loss
  payloads (structured data-init, structured service-init, and unstructured transport)
  must not classify as recoverable corruption.

Both files pin the invariant rather than the current bucket, so adding a proper
classifier rung for code 14 later keeps them green — as long as it does not route to
the rebuild.

### Revert-proofing

Negative assertions pass vacuously when the thing they guard is gone, so both were
mutated and confirmed red:

| Mutation                                                                   | Result                  |
| -------------------------------------------------------------------------- | ----------------------- |
| Guard condition in `recoverCorruptedDatabase.ts` made unsatisfiable        | **11 failed**, 3 passed |
| Corruption rung in `backendStartupFailure.ts` keyed to a nonexistent stage | **2 failed**, 29 passed |

Each suite also carries a positive case asserting the genuine corruption path still
works, so a guard that refused everything, or a classifier that recognised nothing,
would fail rather than satisfy the negatives.

Both mutations were reverted; production code is byte-identical to `sprint3`.

## What remains

Ordered by dependency. The first item gates the rest.

1. **Confirm the wire shape** of a runtime access-loss failure at the WePrompt
   boundary — structured or unstructured. **Needs AionCore**, and determines whether
   classification is possible at all.
2. **Runtime classification.** A local-data-access-lost signal distinct from
   `backend_recoverable_database_corruption`. Depends on 1.
3. **Safe restart/retry and bounded diagnostics.** Retry first — the reproduction shows
   a re-open is exactly what recovers when the condition has cleared — with restart as
   escalation. Requires i18n across 12 locales.
4. **Durable cause.** AionCore's, not ours.

## Appendix — reproduction script

```python
import os, sqlite3, tempfile

root = tempfile.mkdtemp(prefix="bug017-")
print(f"sqlite {sqlite3.sqlite_version}  euid={os.geteuid()}\n")

def shape(e):
    return (f"{type(e).__name__} code={getattr(e, 'sqlite_errorcode', '?')} "
            f"name={getattr(e, 'sqlite_errorname', '?')} msg={e}")

def scenario(label, fn):
    d = os.path.join(root, label)
    os.makedirs(d, exist_ok=True)
    db = os.path.join(d, "app.db")
    try:
        print(f"{label}: NO ERROR -- {fn(d, db)}")
    except sqlite3.Error as e:
        print(f"{label}: {shape(e)}")
    finally:
        try:
            os.chmod(d, 0o700)
        except OSError:
            pass

def seed(db):
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)")
    c.execute("INSERT INTO t (v) VALUES ('before')")
    c.commit()
    return c

def a(d, db):                       # cold open, sealed directory
    os.chmod(d, 0o000)
    sqlite3.connect(db).execute("SELECT 1")
    return "opened"

def b(d, db):                       # cold open, sealed file
    seed(db).close()
    os.chmod(db, 0o000)
    sqlite3.connect(db).execute("SELECT 1")
    return "opened"

def c(d, db):                       # open handle, write, directory read-only
    conn = seed(db)
    os.chmod(d, 0o500)
    conn.execute("INSERT INTO t (v) VALUES ('after')")
    conn.commit()
    return "write succeeded"

def dd(d, db):                      # open handle, read, directory sealed
    conn = seed(db)
    os.chmod(d, 0o000)
    return f"read succeeded: {conn.execute('SELECT COUNT(*) FROM t').fetchone()}"

def e(d, db):                       # open handle, write after unlink
    conn = seed(db)
    os.remove(db)
    conn.execute("INSERT INTO t (v) VALUES ('after-unlink')")
    conn.commit()
    return "write succeeded after unlink"

def f(d, db):                       # integrity_check, directory sealed
    conn = seed(db)
    os.chmod(d, 0o000)
    return f"integrity={conn.execute('PRAGMA integrity_check').fetchone()}"

def g(d, db):                       # new connection, directory sealed
    seed(db).close()
    os.chmod(d, 0o000)
    sqlite3.connect(db).execute("SELECT COUNT(*) FROM t")
    return "second connection opened"

for label, fn in [
    ("A-cold-open-sealed-dir", a),
    ("B-cold-open-sealed-file", b),
    ("C-runtime-write-dir-readonly", c),
    ("D-runtime-read-dir-sealed", dd),
    ("E-runtime-write-after-unlink", e),
    ("F-integrity-dir-sealed", f),
    ("G-new-conn-dir-sealed", g),
]:
    scenario(label, fn)
```

Output:

```text
sqlite 3.50.4  euid=501

A-cold-open-sealed-dir: OperationalError code=14 name=SQLITE_CANTOPEN msg=unable to open database file
B-cold-open-sealed-file: OperationalError code=14 name=SQLITE_CANTOPEN msg=unable to open database file
C-runtime-write-dir-readonly: OperationalError code=1544 name=SQLITE_READONLY_DIRECTORY msg=attempt to write a readonly database
D-runtime-read-dir-sealed: NO ERROR -- read succeeded: (1,)
E-runtime-write-after-unlink: OperationalError code=1032 name=SQLITE_READONLY_DBMOVED msg=attempt to write a readonly database
F-integrity-dir-sealed: NO ERROR -- integrity=('ok',)
G-new-conn-dir-sealed: OperationalError code=14 name=SQLITE_CANTOPEN msg=unable to open database file
```
