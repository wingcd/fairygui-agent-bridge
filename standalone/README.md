# Offline project tools (experimental)

Requires Python 3.9+ and Pillow (`python -m pip install -r standalone/requirements.txt`);
`lint` also requires Node.js. Each operation takes a
project directory or `.fairy` file. The service uses MCP over stdio and does
not require an editor process:

```json
{"mcpServers":{"fgui-offline":{"command":"python","args":["C:/path/to/fgui-agent-bridge/standalone/mcp_server.py"]}}}
```

For clients that need a long-running HTTP endpoint, start one local gateway:

```sh
python standalone/http_server.py --port 7532
```

It binds only to `127.0.0.1`; each request supplies its own project path. POST
JSON-RPC to `/rpc`, for example:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_packages","arguments":{"project":"D:/work/my-ui"}}}
```

To run the optional official Python MCP SDK HTTP and stdio interoperability
tests, set
`FGUI_MCP_CLIENT_PYTHON` to a Python executable with `mcp` installed before
running `python -m unittest discover -s standalone -p test_http_server.py`.

For an optional real-engine integration probe, install Python Playwright and
use Cocos Creator 3.8, Chrome, the Cocos demo and a built `fairygui-cc` dist:

```powershell
python standalone/cocos_runtime_probe.py --demo E:/game_dev/FairyGUI-cocoscreator/demo --distribution E:/game_dev/FairyGUI-cocoscreator/source --creator C:/ProgramData/Cocos/editors/Creator/3.8.4/CocosCreator.exe --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe' --screenshot fgui-runtime.png
```

The probe publishes into a temporary copy of the demo, builds it and runs the
real Cocos web runtime in headless Chrome. It preloads all selected sample
packages and attaches each component for two animation frames. It does not
test every interaction. Add `--compare-reference` to compare initial-state
screenshots with matching components in the demo's historical published assets;
the screenshot probe pauses movieclips, loader animation and transitions to
avoid comparing different animation frames. It does not compare animation playback.
the report lists differences above one RGB level and components present in only
one version. Historical assets may not match the current project source, and
animated or timing-dependent components can differ between screenshots.
Add `--compare-controller-states` together with `--compare-reference` to
construct each shared component independently for every page of its root and
nested controllers and compare its property tree, including effective visibility,
against the historical package. Gear tweens are disabled for this check. It
does not simulate user input or compare animation playback and rendered frames.
Add `--comparison-output NEW_DIRECTORY` with that option to retain screenshot
pairs for reported differences; the directory must not already exist.
The probe hides Cocos's live performance counters before each screenshot and
waits 750 ms for deferred content. `--settle-ms` changes that delay; asynchronous
resources may still need separate investigation. The report
also identifies screenshots taken while browser fonts were still loading.

`GET /health` checks availability. A stateless MCP 2025-03-26 Streamable HTTP
endpoint is available at `http://127.0.0.1:7532/mcp`; it returns JSON responses,
does not assign sessions, and does not offer server-initiated SSE streams.
`/rpc` remains available as the lightweight JSON-RPC gateway. Both endpoints
reject browser Origin headers and non-loopback Host values and have no remote
authentication; they are intended for trusted local clients only.
Tool arguments are checked against the published schema, including nested array
items, required fields and enumerated values, before an operation is invoked.
The child, component, Button and image property schemas enumerate supported
keys and value types so MCP clients can construct valid calls.
The stdio server rejects malformed JSON, invalid Unicode and invalid request IDs
without terminating the service. For bounded HTTP requests rejected from their
headers, the gateway consumes the request body before closing the connection so
clients can receive the error response reliably.

`benchmark_service.py` measures read-only requests through one temporary local
HTTP server, including JSON and connection overhead. For example:

```powershell
python standalone/benchmark_service.py D:/ui/project1 D:/ui/project2 --tool list_children --pkg Basics --component Demo_Text --requests 100 --workers 4
```

The named component must exist in each project. The report includes throughput
and median, p95 and maximum latency; it measures warm-cache reads on the current
machine, not publication speed or a guaranteed service capacity.

Tools: `project_info`, `list_packages`, `list_items`, `read_component`,
`write_component`, `read_package`, `set_image_options`, `create_package`, `list_children`, `list_controllers`, `set_properties`, `set_properties_batch`,
`insert_object`, `insert_resource`, `create_controller`, `set_controller_pages`, `set_display_gear`, `set_display2_gear`, `set_text_gear`, `set_icon_gear`, `set_color_gear`, `set_position_gear`, `set_size_gear`, `set_look_gear`, `set_font_size_gear`, `set_animation_gear`, `set_relation`, `remove_gear`, `remove_relation`, `remove_object`, `import_image`, `validate`, and `lint`. `set_properties`
edits a display-list child's supported XML attributes by id or unique name,
preserving the surrounding XML. Values receive basic format checks; support
for type-specific properties remains limited. Supported properties include
position, size, pivot, visibility, text formatting and alignment. `list_children` returns child attributes
and the current component hash. `set_properties_batch` takes a `changes` array
of `{target, props}` entries and commits all edits together using one hash check;
if any edit fails, no component change is written. `set_component_properties`
edits the component root's `size`, `pivot`, `opaque`, `overflow` and `margin`
with the same hash check. For writes, first read the
component and supply the returned `sha256` as `expected_sha256` along with
the complete replacement XML. Writes reject newly introduced errors in the
selected reference checks listed below; pre-existing errors can be retained so
that an otherwise damaged project remains editable. Do not edit the same project concurrently in
the editor: offline writers, publication, atlas layout and export, and source validation use a shared
per-project advisory lock, but the editor and unrelated programs do not
participate. Concurrent operations on the same project that need the lock
return a conflict; operations on different projects remain independent. The hash check is not an
atomic compare-and-swap against those external writers. Experimental publication and atlas
layout/export also hash their source files and check them again before returning or committing
output, rejecting persistent changes observed during the operation. This does not prevent external edits, transient changes that are
reverted, or a change between the final check and the output commit.

`create_package` creates an empty package under the project’s assets directory.

`set_button_instance_options` edits an existing Button child instance by ID or
unique name, including title, selected title, checked state, title color and
font size. Icons accept registered `ui://` image, movieclip or component URLs;
an empty string clears the icon. The referenced Button may be in another
package. Read the containing component first and pass its SHA-256.
`set_label_instance_options` provides the corresponding title, icon, title
color and font size edits for Label child instances.

`create_component` accepts an optional package-relative `path` for the new
component and creates missing directories. Its optional `extention` accepts
`Label`, `Button`, `ComboBox`, `ProgressBar`, `Slider`, or `ScrollBar`. These
are starter components: configure their visuals, controllers, dropdowns and
other behavior before use. ScrollBar starts with placeholder `bar` and `grip`
graphs required by the runtime.

`read_package` supplies the package hash for `set_image_options`, which edits
nine-slice or tiling mode, duplicate padding and the exported flag.

`find_references` lists registered components that directly reference a
resource or use it in supported UI URL fields, project settings JSON references,
static rich-text UBB `[img]` and HTML `<img src>` references, and bitmap font
textures and glyphs that use a same-package image. Rich-text image URLs in
supported text gears are also scanned.
`complete: false` means a relevant source file could not be inspected. Even a
complete scan excludes dynamic references and other reference forms; it is not
proof that deletion is safe. `unregister_resource` requires the package hash and
refuses an incomplete scan or detected references. It removes only the package
registration and retains the underlying file; dynamic callers must be checked
separately before using it.

`import_image` verifies and copies a PNG or JPEG into a package directory (optional `path`) and
registers it in package.xml; name collisions are rejected.
`import_sound` imports nonempty PCM WAV, MPEG Layer III MP3, or Ogg Vorbis;
`import_movieclip` imports the supported JTA v102 format. These validate the
source before writing, return metadata, and roll back files if registration
fails. MP3 validation checks frame structure and Ogg validation checks page
checksums and Vorbis headers; neither decodes audio or guarantees that every
codec payload is valid. Unsupported audio or movieclip variants are rejected.
`import_font` imports supported single-page BMFont or image-glyph `.fnt` files.
Register the needed images first; provide `texture` as an image ID or unique
name for BMFont, while image-glyph fonts use the registered IDs in the file.
The tool checks image existence and BMFont glyph bounds before registration.

`create_controller` and `set_controller_pages` edit controller pages with a
component hash and reject removal of detected page references. `selected` is
the editor preview page; the publisher uses the default home page.

`set_button_options` edits a Button component's mode (`Common`, `Check` or
`Radio`), sound and down effect. It resolves a supplied nonempty sound URL to
a registered sound resource before writing.

`list_controllers` reads controller pages and actions. `list_children` also
returns child relation and gear attributes. `set_relation` and
`remove_relation` edit a child’s relations to its parent or a sibling;
`remove_gear` removes a text, icon, color, position, size, look, font size, animation or visibility gear, including `display2`.

`set_display_gear` binds a child’s visibility to selected controller pages.
`set_display2_gear` configures the secondary visibility gear: `condition` is
`0` to combine with the primary visibility gear using AND, or `1` for OR.
`set_text_gear` assigns text values to controller pages; values containing
the XML format’s pipe separator are rejected.
`set_icon_gear` assigns per-page icon strings to loaders and Button, Label or
ComboBox instances. Pipes and commas are rejected. Nonempty `ui://` values
must identify an existing image, component or movieclip; publication also
checks that package URL dependencies are included in the output.
`set_color_gear` assigns a `#RRGGBB` color, optional comma-separated outline
color, or `-` for an unset value on each controller page. It supports color-capable
objects and Button, Label or ComboBox component instances.
`set_position_gear` and `set_size_gear` edit page-specific positions or sizes;
size values may also include scale. Both accept `-` for an unset page and an
optional tween object, for example `{"enabled":true,"ease":"Linear",
"duration":0.4,"delay":0.1}`. Omitting `tween` preserves an existing tween;
`{"enabled":false}` removes it.
`set_look_gear` uses the same page and tween options for values formatted as
`alpha,rotation,grayed[,touchable]`; the boolean fields are `0` or `1`, and
omitting touchable defaults it to `1`.
`set_font_size_gear` sets a text object's per-page font sizes as nonnegative
integer strings, or `-` for an unset page; `font_size` selects this gear for removal.
`set_animation_gear` sets a loader or movieclip's per-page frame and playing
state as `frame,p` (playing), `frame,s` (stopped), or `-` for an unset page.

`insert_resource` creates a child from a registered image, component or
movieclip in the same or another package, using its ID or name. It and
`insert_object` accept an optional zero-based `index`; `move_object` moves an
existing child to a zero-based final index. All three require the current
component hash.

`insert_object` appends one XML element with a unique `id` to an existing
display list. It checks an explicit `src` reference and common geometry and
visibility attributes, but does not validate every object-specific attribute
or nested behavior against the editor.

`atlas_layout` requires Pillow and computes a deterministic, padded,
multi-page image layout. Its MaxRects implementation avoids redundant
containment comparisons while preserving the previous deterministic layout.
`shrink_atlas: true` optionally reduces each output page to the next
power-of-two bounds containing its padded sprites (capped at the configured
maximum), without moving them; the same option is available for atlas export
and experimental publication.
`optimize_atlas: true` tries up to 16 smaller single-page layouts and uses
the first one that fits; it implies shrinking, can move sprites, and leaves
multi-page layouts at the compact baseline. It is best effort, not an optimal
packing guarantee.
During experimental publication, if the ordinary layout splits movieclip frames
or image-glyph font sprites across pages, a grouped fallback places each related
set on one atlas (overlapping sets are merged). Grouping is conservative and may
use more space; it can still reject a set that its heuristic cannot fit.
`atlas_layout` is only a planning primitive: it does not use all editor publish
settings, generate images, or write descriptors.
`atlas_export` uses the same layout to write PNG pages and a JSON manifest
to a new `output` directory. This manifest is specific to this tool and is
not a FairyGUI runtime package; no trimming or extrusion is applied.
`validate_published` checks atlas files, IDs, image-to-sprite registrations,
and sprite bounds and trim geometry. `check_overlaps: true` additionally
reports partially overlapping sprite rectangles while allowing identical
rectangles as aliases. Some external packages can intentionally share regions,
so this stricter check is optional for them; offline-generated packages are
always checked before commit. Its optional source comparison checks
image pixels and basic settings; the component comparison covers only the
fields described in its result. A skipped source makes validation fail.
`publish_images_experimental` writes a binary package and PNG atlases for a
nonempty package containing images, including basic nine-slice and tile settings
(the editor can preserve nine-slice rectangles extending beyond an image)
and edge duplication for images with `duplicatePadding`. It
rejects components and unsupported image settings rather than silently omitting them. This is an
experimental Cocos-oriented subset, not a complete editor publisher.
Both experimental publishers use `fileExtension` from the project's
`settings/Publish.json` (default `bin`), and reject XML or compressed-description
publication settings that they cannot produce. For a CocosCreator project with
`compressDesc: true`, they produce an uncompressed binary and return a warning;
this matches the observed local editor output for that target. Compressed output
for other targets is unsupported. Publication reads project atlas `maxSize`,
`paging`, `sizeOption: pot`, `forceSquare`, `allowRotation` and `trimImage`;
explicit tool options override the corresponding size, trimming and rotation
defaults. Unrecognized atlas settings and configured code generation produce
warnings. The packing is not identical to the editor and trimming and rotation
exclude the resource types listed below. The settings file is included in the source
change check during publication. Package name/ID lookups use a per-publication
catalog rather than reparsing every package for every cross-package child. All
package metadata and the package list are rechecked before output is committed.
They also accept `trim_images: true` to remove fully transparent borders from
ordinary images and image-based bitmap font glyphs, and write their original size
and offsets into version 2 sprite metadata. Nine-slice, tiled and bitmap-font
texture images are kept untrimmed, as are movieclip frames. If omitted, it follows `atlasSetting.trimImage`, or defaults to
false when that setting is absent.
`rotate_images: true` allows the packer to rotate ordinary images clockwise
when beneficial and emits the rotation flag in the binary. The layout and atlas
export tools also accept it. Nine-slice, tiled, bitmap-font images and movieclip
frames remain unrotated in publication. If omitted for publication, rotation
follows `atlasSetting.allowRotation`, or defaults to false when absent; for the
layout and atlas export tools it defaults to false. The heuristic is not
guaranteed to match the editor's exact placement.
`publish_simple_experimental` accepts `exported_only: true` to publish exported
resources and their detected same-package dependencies. Use the same option
with `validate_published` when comparing source for that publication mode. The
dependency resolver covers explicit child resource IDs, UI URLs, and bitmap
font references; it also follows static images embedded in rich text. This can
include an unexported image that the editor's own publisher omits when the image
is referenced only inside rich text. Unsupported or missing reachable resources
still fail.
`publish_project_experimental` publishes all project packages into separate
subdirectories of a new output directory and writes `publication.json` with
their relative filenames, dependencies and warnings. It defaults to
`exported_only: true`, reports empty selections as skipped, and commits the
directory only after all selected packages and dependencies succeed. The same
experimental feature limitations apply to every package; applications should
load referenced packages before creating components that use them.
The project manifest includes cross-package dependencies found in child resource
references and selected UI URL fields (such as loader URLs, fonts, icons, lists,
scrollbars, transition sounds and static rich-text images). URL targets must be present in the selected
output; missing targets fail publication. Cross-package UI URL dependencies are
also included in each published binary package's dependency table.
`url_dependencies` identifies the URL-derived subset in the manifest. Other
forms of dynamic references are not resolved.
`preflight_publish` runs the experimental publisher and supported source/atlas
comparisons for each package in a temporary directory, reporting passed, failed
and skipped packages together. It also checks supported cross-package URL and
child dependencies and propagates failed dependencies. It defaults to exported
resources and does not retain output. Passing preflight does not prove complete
editor compatibility or graphical runtime behavior.
Cross-package child references require the referenced resource to be included
in the other package’s exported dependency closure. Load dependencies before
creating the referencing component. A test runs the Cocos component reader
with stubbed engine objects to resolve a loaded cross-package component and its
Button instance settings; this is not a graphical runtime rendering test. External pixel-hit-test images are not yet supported.
`publish_simple_experimental` additionally supports WAV, MP3 and OGG sound file
copying, observed JTA v102 movieclips, single-page BMFont and image-glyph fonts,
and default components with
simple same-package image, basic text, rich text and input text (including UBB,
default-width outlines and shadows), basic loaders,
rounded rectangles, ellipses, polygons, default-layout groups, basic lists and trees with item overrides, nested component
children (including basic cross-package references to published resources), basic Label, Button, ComboBox, ProgressBar, Slider and ScrollBar extensions and instance overrides, component and child relations, controllers
with default home pages, basic scrolling, scrollbar and pull-to-refresh resource URLs,
margins, and display, secondary display, text, font size, icon, animation, position, size, look and color gears.
Component opacity, child masks and child hit-test references are published.
An untransformed image marked `forHitTest` generates a half-resolution pixel
mask using alpha greater than 10. Three demo images and synthetic alpha patterns
match fresh output from the locally installed editor. One mask differs from the
older published demo asset; exact compatibility with other editor versions and
image sizes remains unverified.
It supports a subset of transitions with 24-frame-per-second source timing,
including static and tweened Color actions, non-tweened Text and Icon actions,
cubic Bezier XY paths, the `options` bitmask and
controller actions that play them. Other path formats
and unsupported action types are rejected.
Publishing returns `warnings` when it retains unknown gear page IDs or omits
transition actions targeting missing children, matching observed editor output.
Such source references remain validation errors and should be repaired.
The XML `selected` value is the editor preview state, not the published home
page. The publisher rejects unsupported
child types, unsupported controller actions and other settings.

The CLI accepts a JSON object or `@file.json`:

```sh
python standalone/fgui.py list_packages @args.json
python standalone/fgui.py validate @args.json
python -m unittest discover -s standalone -v
python standalone/test_samples.py E:/game_dev/FairyGUI-cocoscreator/demo/UIProject
python standalone/test_full_packages.py E:/game_dev/FairyGUI-cocoscreator/demo/UIProject --exported-only
python standalone/test_full_reference.py E:/game_dev/FairyGUI-cocoscreator/demo/UIProject E:/game_dev/FairyGUI-cocoscreator/demo/assets/resources/UI
python standalone/test_cocos_samples.py E:/game_dev/FairyGUI-cocoscreator/demo/UIProject E:/game_dev/FairyGUI-cocoscreator/source/build
python standalone/test_publish_samples.py E:/game_dev/FairyGUI-cocoscreator/demo/UIProject E:/game_dev/FairyGUI-cocoscreator/demo/assets/resources/UI
python standalone/test_editor_pixel_outputs.py E:/game_dev/FairyGUI-cocoscreator/demo/UIProject D:/Applications/FairyGUI-Editor/FairyGUI-Editor.exe --pattern
python standalone/test_editor_roundtrip.py E:/game_dev/FairyGUI-cocoscreator/demo/UIProject D:/Applications/FairyGUI-Editor/FairyGUI-Editor.exe --all
python standalone/test_editor_cross_package.py E:/game_dev/FairyGUI-cocoscreator/demo/UIProject D:/Applications/FairyGUI-Editor/FairyGUI-Editor.exe
```

Example `args.json`: `{"project":"D:/work/my-ui"}`.
The sample test copies the project to a temporary directory and checks a
position edit and XML semantic round-trip for each nonempty component. It
does not open the editor or test published output.
The Cocos sample test executes the compiled FairyGUI package and component
readers with stubbed engine objects across exported packages. It is not a
graphical Cocos application or visual rendering test.
`validate` checks project descriptor and package XML structure, resource IDs, registered files, PNG/JPEG image
decoding, and selected
component resource, controller, gear, group, relation and transition references,
including static UI URLs in supported resource fields, list controller bindings, Button controller/pages and controller action
pages and transitions; `lint`
runs the repository's broader static checker. Neither proves that the editor
will open the project or that a runtime can load a published package. Offline
publishing and general editor operations support only the subsets described above.
Image filename/content format mismatches are warnings: the official sample itself
contains PNG files with `.jpg` names that the editor can load.
Malformed project descriptors and package files are reported individually so
validation can continue checking other packages.
`check_media: true` additionally checks the supported WAV/MP3/Ogg structures,
JTA v102 frames, bitmap-font records and their image references and bounds.
Unsupported media variants are reported as issues in this opt-in check; MP3 and
Ogg audio payloads are not decoded. `media_checked` gives counts by type.
