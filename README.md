# FamilySearch MCP Secure

A local, read-only Model Context Protocol server for FamilySearch genealogy
research.

This fork replaces the original password-based authentication with FamilySearch's
current OAuth 2.0 Authorization Code flow and PKCE. The server never accepts,
handles, or stores a FamilySearch username or password.

## Security properties

- Browser-based FamilySearch login with OAuth Authorization Code and PKCE
- Random `state` value validated with a timing-safe comparison
- Loopback-only callback listener with a five-minute timeout
- Access token held in process memory only
- No refresh-token persistence
- On-disk config contains only the app key, redirect URI, and environment
- Read-only FamilySearch API methods
- Living people redacted by default
- Bounded inputs and result counts
- Control-character removal and an untrusted-data notice on API results
- Dependencies pinned exactly in `package-lock.json`

See [SECURITY.md](SECURITY.md) for the threat model and remaining limitations.

## Requirements

- Node.js 20 or later
- A FamilySearch developer app key
- A FamilySearch-approved OAuth callback URI
- A local MCP client that supports stdio servers

Do not deploy this server to a hosted MCP provider. Its loopback callback and
in-memory token model are intentionally designed for local use.

## FamilySearch application setup

1. Apply for FamilySearch API access through the
   [FamilySearch Developer Portal](https://developers.familysearch.org/).
2. Register this exact callback URI for your app key:

   ```text
   http://127.0.0.1:57938/familysearch-auth
   ```

3. Start with the `beta` environment. FamilySearch manages beta and production
   app keys separately; production access may require approval.
4. Keep the app key available. It identifies the application but is not a user
   password or OAuth access token.

FamilySearch requires callback URIs to be pre-registered. If port `57938` is
unavailable, choose another high port and register that exact URI before using
it.

## Install and build

```powershell
git clone https://github.com/YOUR-ACCOUNT/familysearch-mcp.git
Set-Location familysearch-mcp
npm ci
npm run check
```

Start the server with:

```powershell
npm start
```

For an MCP client, configure a local stdio server whose command is `node` and
whose single argument is the absolute path to `build/index.js`. For example:

```json
{
  "mcpServers": {
    "familysearch": {
      "command": "node",
      "args": [
        "C:\\absolute\\path\\to\\familysearch-mcp\\build\\index.js"
      ]
    }
  }
}
```

## First login

Use the MCP tools in this order:

1. `configure`

   ```json
   {
     "clientId": "YOUR_FAMILYSEARCH_APP_KEY",
     "environment": "beta",
     "redirectUri": "http://127.0.0.1:57938/familysearch-auth"
   }
   ```

2. `begin-auth`
3. Open the returned `familysearch.org` URL in your browser.
4. Verify the domain in the browser, log in directly to FamilySearch, and
   approve access.
5. Call `auth-status`.

The access token exists only in server memory. Restarting the MCP server requires
another browser login.

## Tools

### Session

- `configure` — save the non-secret app configuration
- `begin-auth` — start browser OAuth with PKCE
- `auth-status` — check the in-memory session
- `logout` — invalidate and clear the active token
- `get-current-user` — read a minimal profile without returning email

### Read-only genealogy

- `search-persons` — search by given name, surname, dates, places, or gender
- `get-person` — read a person by FamilySearch ID
- `get-ancestors` — read up to eight ancestor generations
- `get-descendants` — read up to three descendant generations

The original `search-records` tool was removed. The old endpoint was not present
in the current public API reference, and FamilySearch places legal and
certification restrictions on displaying Historical Records data through
third-party applications. Use FamilySearch's website for unrestricted record
research unless FamilySearch explicitly approves your application for that API.

## Living people

Living-person data is redacted by default, even when the authenticated account
can see it. This prevents private-tree data from automatically entering an AI
conversation.

An informed local user can opt in before starting the MCP server:

```powershell
$env:FAMILYSEARCH_INCLUDE_LIVING = "true"
npm start
```

Do not enable this for a hosted model or shared task unless every affected living
person has consented and you accept the model provider's retention terms.

## Configuration file

The server writes:

```text
~/.familysearch-mcp/config.json
```

The file contains only:

```json
{
  "clientId": "...",
  "redirectUri": "http://127.0.0.1:57938/familysearch-auth",
  "environment": "beta"
}
```

If an old config contains `username`, `password`, `accessToken`,
`refreshToken`, or `clientSecret`, the server strips those fields when loading
it.

## Development

```powershell
npm ci
npm run check
npm audit --omit=dev
```

The test suite covers OAuth URL construction, PKCE, redirect validation,
legacy-secret removal, authorization headers, input encoding, privacy
redaction, and cycle handling.

## License

ISC
