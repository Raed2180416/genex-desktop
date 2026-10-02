# Submit a plugin release

1. Scaffold using Studio's `plugin:new`, implement your plugin, and test it locally in the same chat.
2. Run `plugin:doctor` in your own development environment. It runs your backend; do not run
   unreviewed submissions with maintainer credentials.
3. Pack the prebuilt directory with `plugin:pack`. Use stable `x.y.z` versions and an immutable
   SHA-256 artifact URL on an approved origin. Do not include node_modules, private profiles,
   credentials, generated acceptance assets or unrelated files.
4. Submit a PR adding `records/<id>/<version>.json` and updating the matching index entry.
   Include source commit, license, maintainer identity/contact, documentation, purpose,
   compatibility, requested access and test evidence. Explain each new capability on updates.
5. Maintainers check ownership and actual package/source contents, static findings, account
   behavior and install/update evidence. Passing automation alone does not approve a release.

Do not change existing release records, reuse another publisher's ID or modify the validation
policy with a plugin submission. A correction needs a higher version, even when reverting bad
code. New hosting origins and ownership transfers are separate maintainer decisions.

Required manual evidence: fresh install, real harmless tool execution, same-chat activation,
settings retained after update, disable/remove behavior and account flow when applicable.
No paid generation is required to demonstrate plugin plumbing.
