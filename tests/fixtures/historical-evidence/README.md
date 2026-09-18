# Historical evidence portability

TEST_ONLY / NOT_PRODUCTION_AUTHORITY / NOT_RUNTIME_SOURCE / NOT_NEW_TRUST_SOURCE.

The manifest identifies eight complete historical files. Six are preserved here;
the byte-identical, already-versioned Beijing HTML and XLSX are reused in place.
Only explicit original files were copied. No outputs directory, execution log,
state repository, candidate material or regenerated evidence is packaged.

Every read verifies the original SHA-256 and length. Versioned Git attributes
disable text conversion for these bytes. Original Snapshot IDs, raw hashes,
timestamps, locators, headers, provenance and all 24 composition blockers remain
unchanged. Historical origin_reference values are audit metadata, never lookup
paths. Execution reports formerly used only to locate files are not duplicated.

The user approved a narrow exception for already-public official business contact
information and original document author metadata. This is not permission to retain
private candidate documents, credentials, cookies, tokens or secrets.

Only tests/helpers/historical-evidence.ts resolves logical fixture IDs. It cannot
register sources, issue evidence, seal artifacts or alter trust. Production and
read API import closures are guarded against this package and its loader. The
read guard rejects ignored outputs and external historical evidence locators; it
is a test regression guard, not an operating-system security sandbox.
