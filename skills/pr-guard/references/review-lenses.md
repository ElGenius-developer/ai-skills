# Review Lens Checklists

Fallback checklists for when a dedicated guard skill is not installed. Each lens
reports findings in the standard format: severity, `file:line`, defect statement,
failure scenario.

## Contents

- [Security](#security)
- [Code review](#code-review)
- [Clean code](#clean-code)
- [Test quality](#test-quality)
- [Secrets](#secrets)

## Security

OWASP-aligned pass over the changed code and its call paths:

- **Injection** — SQL/NoSQL/command/LDAP built by string concatenation with external
  input; missing parameterized queries; ORM raw-query escapes.
- **Broken auth/authz** — endpoints missing auth middleware; object references not
  checked against the caller's ownership (IDOR); privilege checks done client-side
  only; session/token issuance or invalidation gaps.
- **Sensitive data exposure** — secrets/PII in logs, error messages, API responses;
  internal exception details reaching production responses; verbose stack traces.
- **XSS / unsafe output** — unsanitized HTML injection (`innerHTML`,
  `dangerouslySetInnerHTML`, template raw-echo); user input reflected into scripts.
- **Path traversal / file handling** — user-controlled paths, uploads without
  type/size validation, files served without authorization.
- **SSRF** — user-controlled URLs fetched server-side without allowlisting.
- **CSRF** — state-changing endpoints reachable without CSRF protection where the
  auth model requires it (cookie-based sessions).
- **Crypto** — home-rolled crypto, weak hashes for passwords, static IVs, keys in
  code, HMAC keys reused across purposes.
- **Rate limiting / abuse** — new public or auth endpoints without throttling;
  enumeration oracles (different errors for "exists" vs "wrong password").
- **Dependency changes** — new/updated packages: known CVEs, typosquatting,
  unexpected scope of access.

## Code review

Correctness and contract review of the production diff:

- Does the change do what the PR claims? Trace at least one full path from entry
  point to persistence/output.
- Boundary conditions: empty, null, zero, negative, max-size, unicode/RTL,
  concurrent access, duplicate submission.
- Error paths: what happens when the DB call, network call, or filesystem op fails
  mid-way? Partial-write and transaction integrity.
- Contract drift: response shapes, status codes, event payloads, function
  signatures — do existing callers still hold?
- State scoping: is per-request/per-tenant/per-user state properly isolated
  (no leakage through statics, caches, singletons)?
- Ordering/race hazards introduced by the change (check-then-act, read-modify-write).
- Performance regressions: N+1 queries, unbounded result sets, missing pagination,
  work moved into hot loops.
- Migration/rollback safety when schema or data shape changes.

## Clean code

- Functions ≤ ~50 lines and single-purpose; files cohesive; no >4-level nesting.
- Names say what things are; no comment doing a name's job.
- Comments only where the code cannot speak (business rule, gotcha, workaround);
  no narration, no commented-out dead code.
- No speculative abstraction, config, or flexibility beyond the PR's need (YAGNI).
- No duplicated logic that an existing helper in the repo already provides.
- Diff hygiene: every changed line traces to the PR's purpose; no drive-by
  reformatting or unrelated "improvements".
- Error handling explicit — no silently swallowed exceptions.

## Test quality

- Tests assert **behavior**, not implementation internals (no asserting that a mock
  was called as the sole assertion).
- Mocks only at system boundaries (network, clock, filesystem, third-party SDKs);
  domain/state objects are real instances.
- One scenario per test; value-variants are data-driven, not copy-pasted tests.
- Every new test can answer "what bug does this catch?" — delete tests that can't.
- Names describe the scenario, not the method signature.
- No tests of framework guarantees (routing, ORM defaults, validation plumbing).
- Deleted or weakened assertions in existing tests are a red flag — treat a removed
  regression test as HIGH unless justified.
- Infrastructure-under-test uses real infrastructure (real test DB over fakes when
  the project provides one).

## Secrets

Grep the diff (added lines) for likely credential material:

```
(?i)(api[_-]?key|secret|passw(or)?d|token|private[_-]?key|client[_-]?secret)\s*[:=]\s*['"][^'"]{8,}
-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----
(?i)aws_?(access|secret)_?(key|access)
AKIA[0-9A-Z]{16}
ghp_[A-Za-z0-9]{36}
sk-[A-Za-z0-9]{20,}
eyJ[A-Za-z0-9_-]{20,}\.eyJ            # unexpected hardcoded JWTs
(?i)(mongodb|postgres(ql)?|mysql|redis|amqp)://[^\s'"]*:[^\s'"]*@
```

Also check: `.env`-like files added to the diff, config files with real-looking
hostnames/credentials, connection strings, and any weakening of `.gitignore`
coverage for secret files. A confirmed live secret in the diff is CRITICAL and also
means the secret is compromised → flag for rotation, not just removal.
