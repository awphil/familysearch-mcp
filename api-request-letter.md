# Request for FamilySearch API Access

Dear FamilySearch Developer Support Team,

I am requesting a FamilySearch API app key for a personal, non-commercial,
local genealogy research tool.

The application is a Model Context Protocol (MCP) server that lets a user ask a
local AI client to perform a small set of read-only FamilySearch operations:

- Read a minimal current-user profile
- Search Family Tree persons
- Read one Family Tree person
- Read bounded ancestry and descendancy results

## Authentication and security

The application uses OAuth 2.0 Authorization Code flow with PKCE. Users sign in
only on the FamilySearch authorization page; the application never asks for or
stores a FamilySearch username or password.

The requested callback URI is:

```text
http://127.0.0.1:57938/familysearch-auth
```

The listener binds only to the loopback interface, validates a random `state`
value, uses an S256 PKCE challenge, and closes after authentication or a
five-minute timeout.

Access tokens remain in process memory and are not persisted. The application
does not request or store refresh tokens. On-disk configuration contains only
the app key, callback URI, and selected FamilySearch environment.

All genealogy tools are read-only. Living people are redacted by default before
data is returned to the AI client. Historical Records data is not displayed.

I will respect FamilySearch rate limits, compatibility requirements, privacy
requirements, and API terms. I am happy to provide source code or additional
technical details for review.

Sincerely,

[Your Name]
[Your Email]
[Your Phone Number]
