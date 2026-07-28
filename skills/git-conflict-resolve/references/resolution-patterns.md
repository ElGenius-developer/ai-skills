# Conflict Resolution Patterns

Concrete worked examples for the most common conflict shapes. Each pattern shows the conflict, the recommended resolution heuristic, and the reasoning to surface to the user.

## 1. Import / Use Block Conflicts

Both branches added different imports to the same import block.

```
<<<<<<< HEAD
import { Foo } from './foo';
import { Bar } from './bar';
=======
import { Foo } from './foo';
import { Baz } from './baz';
>>>>>>> feature/x
```

**Resolution:** Combine — keep both new imports, sort alphabetically.

```
import { Bar } from './bar';
import { Baz } from './baz';
import { Foo } from './foo';
```

**Reasoning to surface:** "Both sides added independent imports. Safe to combine; no semantic conflict."

## 2. Route Registration Conflicts

Two branches added different routes near each other.

```
<<<<<<< HEAD
Route::post('/orders', [OrderController::class, 'store']);
Route::get('/orders/{id}', [OrderController::class, 'show']);
=======
Route::post('/orders', [OrderController::class, 'store']);
Route::patch('/orders/{id}/cancel', [OrderController::class, 'cancel']);
>>>>>>> feature/cancel
```

**Resolution:** Combine — keep the shared line once, then both new routes.

**Reasoning:** "Both sides added different verb/path combinations on the same resource. No collision; combining is safe."

**Watch for:** Two branches registering the **same** verb+path with different controllers. That's a real conflict — escalate to the user.

## 3. Lockfile Conflicts (`package-lock.json`, `composer.lock`, `yarn.lock`)

Almost always non-trivial. Hand-editing produces a lockfile that doesn't match `package.json` / `composer.json`.

**Resolution:** Do **not** hand-edit. Pick one side, then regenerate.

```bash
# Pick the target branch's manifest, then regenerate
git checkout --theirs package.json
git checkout --ours  package-lock.json   # placeholder
rm package-lock.json
npm install                              # regenerates lockfile
git add package.json package-lock.json
```

**Reasoning:** "Lockfiles are derived artifacts. The only correct resolution is to regenerate from the merged manifest."

## 4. Translation / Locale Conflicts (`ar.json`, `en.json`)

```
<<<<<<< HEAD
"orders": {
  "title": "Orders",
  "cancel": "Cancel"
}
=======
"orders": {
  "title": "Orders",
  "confirm": "Confirm"
}
>>>>>>> feature/confirm
```

**Resolution:** Combine — merge the inner keys.

```
"orders": {
  "title": "Orders",
  "cancel": "Cancel",
  "confirm": "Confirm"
}
```

**Reasoning:** "Both sides added different keys under the same namespace. Safe to combine."

**Watch for:** Same key with different values — that's a real semantic conflict, escalate.

## 5. Migration Conflicts

Two migrations with timestamps that overlap.

```
database/migrations/2026_05_15_add_index.php   (ours)
database/migrations/2026_05_15_add_column.php  (theirs)
```

**Resolution:** Rarely a content conflict. If both files exist independently, just keep both. If they edit the same migration file → escalate; migrations are append-only in spirit. Never edit a migration that has already run in production.

**Reasoning to surface:** "Migrations should never be retro-edited after running in any environment. If both sides edited the same migration, one of them likely needs to become a new migration."

## 6. Schema Reference / Doc Conflicts (`schema-reference.md`, `*.sql`)

CRITICAL. Both sides documented different changes to the same table.

**Resolution:** Read the database via `INFORMATION_SCHEMA` if available, take the authoritative current shape, then update the doc to match. The doc is downstream of the DB.

**Reasoning:** "Schema docs are a projection of the database. The DB is the source of truth; the doc must match reality, not the other way around."

## 7. Generated API Docs (OpenAPI / Swagger specs)

Generated artifacts. Never hand-merge — pick either side, then regenerate from source.

```bash
# Whatever produces the spec in this project, e.g.:
php artisan l5-swagger:generate        # Laravel + l5-swagger
npm run generate:openapi               # Node toolchains
go run ./cmd/gen-openapi               # Go

git add openapi.json
```

## 8. Pure Whitespace / Formatting Conflicts

```
<<<<<<< HEAD
    if (foo) {
        bar();
    }
=======
	if (foo) {
		bar();
	}
>>>>>>> feature/x
```

**Resolution:** Pick whichever side matches the project's formatter config (`.editorconfig`, `.prettierrc`, `phpcs.xml`, `rustfmt.toml`). Then optionally run the formatter on the whole file.

**Reasoning:** "Whitespace conflicts should always defer to the project formatter, never to either side's style preference."

## 9. Conflict Markers Inside Strings

```
<<<<<<< HEAD
echo "version 1";
=======
echo "version 2";
>>>>>>> feature/x
```

If a string literal looks like a conflict marker (e.g. a doc that talks about merge conflicts!), the user must inspect manually. Don't trust the marker grep blindly — read the file.

## 10. Delete-Modify

One side deleted the file, the other modified it. Always ask the user:

> "`<file>` was deleted on `<target>` but modified on `<source>`. Keep the file (with `<source>`'s changes) or honor the deletion?"

Apply via:
```bash
# Keep the file
git add <file>

# Honor the deletion
git rm <file>
```

## Heuristics Summary

| Pattern | Default action | Always ask the user? |
|---------|---------------|----------------------|
| Independent imports / keys | Combine | No (low-risk) |
| Same key, different value | Escalate | Yes |
| Lockfile | Regenerate | No (deterministic) |
| Migration on same file | Escalate | Yes |
| Schema docs | Read DB, match reality | No |
| Whitespace only | Defer to formatter | No |
| Binary | Pick a side | Yes |
| Delete-modify | — | Yes |
| Generated API docs | Regenerate | No |

Even for "low-risk" patterns, this skill still shows the proposed result and asks for approval before staging. The table above just describes the **proposed** action; user approval gate stays.
