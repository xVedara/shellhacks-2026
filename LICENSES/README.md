These are the license texts that have to travel with StepSafe. The credit list is [CREDITS.md](../CREDITS.md). The app's own license is [LICENSE](../LICENSE) (AGPL-3.0-only).

| File | Applies to | Why it is here |
| --- | --- | --- |
| [react-leaflet-Hippocratic-2.1.md](react-leaflet-Hippocratic-2.1.md) | `react-leaflet` 5.0.0 | Hippocratic-2.1 says anyone who receives the software also receives this license and the copyright notice. Copyright 2020 Paul Le Cam and contributors. |
| [react-leaflet-core-Hippocratic-2.1.md](react-leaflet-core-Hippocratic-2.1.md) | `@react-leaflet/core` 3.0.0 | Same license. The copyright line names the package. |
| [leaflet-BSD-2-Clause.txt](leaflet-BSD-2-Clause.txt) | Leaflet 1.9.4 | BSD-2-Clause says a binary distribution must include the copyright notice, conditions, and disclaimer. Copyright 2010–2023 Volodymyr Agafonkin and 2010–2011 CloudMade. |
| [inter-OFL-1.1.txt](inter-OFL-1.1.txt) | Inter, loaded by `next/font` | OFL-1.1 says a copy of the font must include this copyright and license. Copyright 2016 The Inter Project Authors. The license names no Reserved Font Name. |
| [pillow-MIT-CMU.txt](pillow-MIT-CMU.txt) | Pillow, used by `brandguide/make_icons.py` | MIT-CMU says the copyright and permission notice appear in copies and in supporting docs. Pillow is not bundled. The icon PNGs are output, not a copy of Pillow. |
| [Apache-2.0.txt](Apache-2.0.txt) | `mongodb`, `@google/genai`, `sharp`, and dev-only TypeScript | Apache-2.0 says a redistribution includes this license. Those packages are not copied into git. They are installed from npm when the server or the web app is deployed. |
| [LGPL-3.0.txt](LGPL-3.0.txt) and [GPL-3.0.txt](GPL-3.0.txt) | `@img/sharp-libvips-*`, pulled in by `sharp` for `next/image` | The package license is LGPL-3.0-or-later. LGPL-3.0 incorporates GPL-3.0, so both texts are here. The shared library is not in git. Corresponding source for that library is the libvips project, https://github.com/libvips/libvips. This does not relicense StepSafe. |
| [MIT-notices.txt](MIT-notices.txt) | Direct MIT libraries named in that file | MIT says the copyright and permission notice stay with a copy. |

Production npm packages under MIT, ISC, BSD-3-Clause, BSD-2-Clause, Apache-2.0, or 0BSD keep their own license files inside the npm tarball. `server/package-lock.json` and `web/package-lock.json` name them. `lightningcss` (MPL-2.0) is a dev dependency of vitest and is not in a production install.
