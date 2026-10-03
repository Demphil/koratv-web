# Public Source Security

Browser-delivered HTML, CSS, JavaScript, and API responses are public by design.
Minification does not encrypt them. DevTools detection, disabled context menus,
and reload loops cannot enforce confidentiality or grant a single AI exclusive
access. Authorization remains server-side.

## Changes

- Both website publication workflows now use an explicit public-file allowlist
  instead of copying the repository into GitHub Pages.
- Backend code, PHP source, operational scripts, logs, private configuration,
  manual selection files, dependency manifests, and source maps are not shipped.
- Only the shared lifecycle module required by the frontend is included.
- Browser scripts are minified without source maps; original working files stay
  in the project. Classic-script global names remain compatible across files.
- Builds reject detectable Supabase service-role JWTs, secret keys, and private
  key material in textual public assets without logging credential values.
- The player build excludes Markdown/source maps and no longer publishes its
  deployment-header instructions. Existing embed paths and security are retained.

## Confirmed Exposure Before Deployment

On 2026-10-03, both frontend domains returned HTTP 200 for backend JavaScript
and an old PHP integration file. The PHP file was served as source, not executed,
and contained an advertising integration key. Excluding the file prevents future
publication but cannot revoke downloaded copies. Rotate that key through its
provider. No claim is made that historical exposure has been erased.

Both GitHub repositories were also confirmed PUBLIC. Website packaging does
not protect files obtainable from GitHub history. Repository visibility remains
unchanged pending confirmation of Pages support for private repositories or a
replacement hosting path; changing it blindly could take the frontends offline.

## Boundaries

Public endpoint addresses, advertising zone IDs, public Supabase publishable
keys, rendered match data, and browser logic remain inspectable. Never place
provider credentials, service-role keys, signing secrets, or account passwords
in these assets. Keep private originals and credentials on authenticated servers.

References:
- https://cheatsheetseries.owasp.org/Web_Frontend_Security_Cheat_Sheet.html
- https://developer.chrome.com/docs/devtools/javascript/source-maps
- https://terser.org/docs/api-reference/
