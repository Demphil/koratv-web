$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pending = git -C $root status --porcelain -- manual-match-selection.json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read repository status.' }
if ($pending) { throw 'Commit and push manual-match-selection.json to main before applying it.' }
gh workflow run manual-matches.yml --repo Demphil/koratv-web --ref main
if ($LASTEXITCODE -ne 0) { throw 'Could not start the shared manual selection workflow. Check gh authentication.' }
