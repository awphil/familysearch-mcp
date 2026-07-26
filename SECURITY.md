# Security Policy

## Intended deployment

This MCP server is for one user on a trusted local computer. It communicates
with the MCP client over stdio and listens on a loopback address only during a
five-minute OAuth callback window.

Do not expose it over HTTP, run it as a shared service, or deploy it through a
hosted MCP proxy.

## Secrets

The server must never receive a FamilySearch password, client secret, manually
copied access token, or refresh token through an MCP tool.

OAuth access tokens are kept in memory and cleared on logout or process exit.
Only non-secret application configuration is saved to disk. The server attempts
to use restrictive file modes, but Windows users should also rely on normal
per-user NTFS permissions and device encryption.

If upgrading from the original server, inspect and remove the old
`~/.familysearch-mcp/config.json`. This fork automatically strips known legacy
secret fields, but changing a password and invalidating old sessions is prudent
if the file was copied, backed up, or shared.

## Privacy

FamilySearch data can include private information about living people. The
server redacts records explicitly marked `living` unless the local
`FAMILYSEARCH_INCLUDE_LIVING=true` environment variable is set before startup.

API data is user-controlled and therefore untrusted. Output is sanitized and
labelled as data, but no text-only mitigation can fully eliminate indirect
prompt injection. Keep unrelated write-capable MCP servers disabled or require
confirmation while doing genealogy research.

## Read-only boundary

The registered genealogy tools make GET requests only. `logout` makes the sole
POST request, to `/platform/logout`, for token invalidation. No Family Tree
create, update, merge, delete, source, memory, or messaging operations are
implemented.

An OAuth token may still have broader server-side authority than these tools.
A compromised local process or dependency could steal and misuse it until it
expires. Run only reviewed commits, use `npm ci`, and keep Node.js and
dependencies patched.

## Reporting

Do not open a public issue containing credentials, FamilySearch IDs for living
people, private family data, access tokens, or callback URLs containing live
OAuth parameters. Report vulnerabilities privately to the fork maintainer.
