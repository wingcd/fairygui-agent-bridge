# Standalone Node service

Run `npm ci` in this directory, then start one local service for any number of
projects with `node http-server.mjs --port 7532`. JSON-RPC is available at
`http://127.0.0.1:7532/rpc`; MCP Streamable HTTP is at `/mcp`. Each tool call
must include `project`, either a project directory or its `.fairy` file. The
server accepts loopback requests only. `node mcp-server.mjs` provides MCP over
stdio instead.

The CLI accepts a tool name and a JSON object, or `@path` to a UTF-8 JSON file:
`node fgui.mjs list_packages @args.json`. Discover MCP input schemas with
`tools/list`; MCP calls are checked against those schemas before execution.
For edits, read the component first and pass its `sha256` as
`expected_sha256`; stale writes fail. Component and package XML reads accept
UTF-8 and UTF-16; edits write UTF-8 and update the XML encoding declaration.
`set_component_properties` supports component dimensions, opacity, masks, hit
tests, overflow, margins and scroll configuration; pass null to clear masks,
hit tests or scroll-specific properties.
`read_component` also returns malformed source XML so it can be repaired with
`write_component`; the replacement must pass structural and reference checks.
`create_controller` and
`set_controller_pages` edit controller pages while rejecting newly broken
page references. `set_controller_actions` replaces supported play-transition
actions and checks their page and transition references.
`list_transitions` returns transition and item attributes together with the
component SHA-256 needed for optimistic writes. `upsert_transition` creates or replaces a supported transition from XML;
`remove_transition` rejects detected local or cross-package nested-transition
references and refuses removal if the reference scan is incomplete. Dynamic
runtime references are outside the scan. Transition edits hold the shared
project write lock during scanning and writing; unrelated external writers do
not participate in that lock.
`set_relation`, `remove_relation`, `set_display_gear`, `set_display2_gear` and
`remove_gear` edit child layout and visibility behavior.
`set_button_options` edits Button component mode, sound and down effect.
`set_button_instance_options` and `set_label_instance_options` update supported
Button and Label overrides, including cross-package icons.
`set_progress_instance_options` and `set_slider_instance_options` set the
integer value, minimum and maximum on referenced ProgressBar and Slider instances.
`set_progress_options` and `set_slider_options` edit the title display mode and
reverse direction on the component itself.
`set_combobox_options` sets a ComboBox dropdown to a registered component URL,
including one in another package, or clears it with an empty string.
`set_combobox_instance_options` sets the visible item count and replaces the
instance's items, including optional cross-package icon URLs; omitted fields
are retained.
`set_properties` and `set_properties_batch` also edit image fill and flip,
loader URL and fill, MovieClip frame and playing state, and graph shapes,
colors and geometry. Changing graph type removes incompatible shape attributes.
For same-package images at the origin, `forHitTest` enables or disables pixel
hit testing; conflicting hit tests and unsupported transforms are rejected.
List settings include layout, selection mode, row and column spacing and item counts,
automatic item sizing and clearing, render order, click scrolling and folding
invisible items, overflow and scrolling direction, scroll bar settings, margins,
clip softness, default item URL and page/selection controllers.
Scroll bar and pull-to-refresh resource pairs use `scrollBarRes` and `ptrRes`.
Pass null for scroll-specific fields when clearing them, including when changing
overflow away from `scroll`.
`set_list_items` replaces list or tree items, checks referenced resources and
validates tree levels; other list behaviors are retained.
Text properties include stroke and shadow, which can be cleared with null;
input-text properties include prompt, character restrictions, length, keyboard
type and password mode.
Text, icon, color, position, size, look, font-size and animation gears also
have `set_*_gear` tools with per-page values. `insert_resource` accepts a resource
name or ID, optional `ref_pkg`, `object_name`, `x`, `y`, and zero-based `index`.
`insert_object`, `move_object`, and `remove_object` edit the display list;
removal rejects objects referenced elsewhere in the component. New display
objects must include a valid `xy` position, which the editor requires.
Group members must be sibling display-list objects with a `group` attribute;
nesting display objects inside a `<group>` is reported as invalid.
`find_references` scans registered component references, supported UI URLs,
project settings and same-package bitmap fonts; its `complete` flag reports
scan errors, while dynamic references remain outside its scope.
`unregister_resource` requires a current package SHA-256, rejects detected or
incompletely scanned references, and keeps the original resource file.
`import_image`, `import_sound` and `import_movieclip` validate and register
PNG/JPEG, WAV/MP3/OGG and JTA files respectively. `import_font` registers
supported bitmap fonts after checking their image or texture references.

This is an incomplete port. Read operations, selected component edits,
validation, atlas planning, and experimental publication are available.
`publish_basic_experimental` additionally accepts plain components with basic
same-package image, movieclip, nested component, graph, text, rich-text and
input-text, list and tree children, including supported child transforms, basic controllers,
display/display2, text/font-size, position/size/look, color and movieclip
animation gears, component/child relations, controller transition actions, supported gear tween settings,
and transition actions including tween paths.
Default-layout groups and editor-only groups are supported.
Component pivot, margin, scrolling overflow, opacity, masks, child hit tests
and supported image pixel hit tests are also supported.
Image tint, flip and fill settings and movieclip tint are supported.
List layout, scrolling, selection controllers and item data are supported with
resource URLs. Set `lineItemCount` and `lineItemCount2` for list item counts;
the editor ignores `lineCount` and `colCount` source attributes.
Basic loaders and bitmap font, loader and instance icon URLs are supported.
Cross-package child and URL references are recorded as package dependencies;
publish and load those dependency packages as well. A cross-package target must
be exported by its own package or reachable from one of its exported resources;
otherwise publication fails rather than emitting an unresolved reference.
Basic Label, Button, ComboBox, ProgressBar, Slider and ScrollBar extension
records and selected Label, Button, ComboBox, ProgressBar and Slider instance overrides
are supported, including cross-package dropdowns and same-package button sounds.
Preview selection is not used as the published home page.
Unsupported component features and cyclic component references are rejected.
Publication warns when it retains unknown gear pages or omits transition items
with missing targets, matching the editor output; fix those source references.
For Cocos Creator projects, `compressDesc: true` produces uncompressed output
with a warning, matching the observed editor behavior. XML publication supports
images, including tiled and nine-slice images, WAV sounds, and simple components
containing same-package image, basic text and rectangle children. It rejects other component features, resource types
and `compressDesc`. The referenced FairyGUI Cocos Creator runtime explicitly
rejects the legacy XML package format; use `binaryFormat: true` for that runtime.
Compatibility with other XML-capable runtimes has not been verified.
Compressed binary output for other targets remains unsupported.
Pass `binary_format: true` to a publish or preflight tool to generate binary
output for that call without changing the project's `Publish.json`; pass
`binary_format: false` to select the supported XML subset. Omitting the option
uses the project's setting. This override also applies to project publication.
Do not treat experimental output as equivalent to the editor's complete
publisher. The Python implementation remains in
`../standalone`.

`publish_project_experimental` stages all nonempty packages and a dependency
manifest in a new output directory, then renames the directory into place only
after every package and dependency succeeds. Existing output is never replaced.
Project publication and preflight default to exported resources and their
transitive cross-package dependencies. Set `exported_only: false` to include
all registered resources, including unused ones.

`inspect_published` inspects the supported binary format and editor XML ZIP
packages; `validate_published`
checks atlas and sound files, sprite and media references, pixel mask
dimensions and optional sprite overlap, with optional source image metadata
and pixel comparison, plus source sound byte comparison. Pixel comparison ignores
embedded ICC profiles and RGB values where alpha is zero. XML inspection checks resource metadata, component XML
well-formedness and sprite manifests; it does not inspect component, font or movieclip
behavior. Use `exported_only: true` for filtered publications. It does not validate component
behavior or establish editor compatibility.

For binary packages, `validate_published` also accepts `compare_components: true`
to compare source component names, sizes, pivot, margins, opacity, masks, hit
tests, overflow and scroll settings, child counts, types, IDs, names,
source references, positions, sizes, transforms and visibility, image fill and
color, graph geometry and colors, movieclip playback, text styles and supported input text settings,
component extension types, Button and ComboBox options, Button, Label and
ComboBox instance options, and ProgressBar and Slider options and instance values,
list layout, selection, spacing, scrolling, controllers, item data and tree settings,
controller names, pages and supported
play-transition actions, and transition settings plus item types, times,
targets, labels, supported values, tween settings and paths. It does not compare
other controller actions or all child properties; XML component
comparison is not yet supported.

`preflight_publish` tries the experimental publisher on every package and
reports individual failures in one response, including failed dependencies. Temporary output is removed; this
does not perform editor or runtime compatibility validation. It detects changes
to project metadata, settings and source files read during the scan and fails
the scan if they change before it finishes.

`validate` checks all registered resources by default, including the syntax and
integer range of component sizes when specified. Pass
`exported_only: true` to check exported resources and their transitive
dependencies while still checking package structure and resource IDs. A
broken dependency closure is reported as an error, and validation falls back
to checking all registered resources.

The Cocos demo's source project contains pre-existing reference issues: its
PullToRefresh `Footer.xml` has an unknown gear page and Transition `BOSS.xml`
has transition targets that no longer exist. Full-resource validation also
finds an unresolved reference in HitTest `component1.xml`. A successful sample
publication therefore does not imply that source validation returns `valid: true`;
publication warns for the supported cases that match editor behavior.

Run `npm test`. The test suite uses the official MCP SDK to exercise both
stdio and Streamable HTTP across multiple projects. Set `FGUI_SAMPLE_PROJECT` to the sample project's directory to
also run the sample-based parity checks. Those checks do not establish full
editor or runtime compatibility. Sample package tests exercise the compiled
Cocos package and component readers with stubbed engine objects; set
`FGUI_COCOS_BUILD` if the build directory is not at `../../source/build`
relative to the sample project.

For an opt-in real editor interoperability check, run
`python standalone-node/test_editor_roundtrip.py PROJECT EDITOR_EXE`. It copies
the project to a temporary directory, creates Node-authored components with a
controller, visibility gear and polygon graphs, edits one existing component per package, and
asks the editor bridge to open them. It also compares each edited package
with fresh editor-published data and visible atlas pixels. When the sibling
Cocos source build is present, it also checks polygon data through its compiled
reader; interactive behavior and final rendering are not checked.

For semantic comparison with a previously published editor build, run
`python standalone-node/test_editor_reference.py PROJECT REFERENCE_DIR`.
For fresh editor output and pixel hit masks, run
`python standalone-node/test_editor_pixel_outputs.py PROJECT EDITOR_EXE --pattern`.
Both comparisons cover parsed data; neither proves graphical rendering parity.

To compare against fresh editor output for all packages, run
`python standalone-node/test_editor_fresh.py PROJECT EDITOR_EXE`. The check
compares parsed data and visible image, animation-frame, and bitmap-font atlas
pixels, and validates editor output against the project source. It does not test
interactive behavior or final rendering. Set `FGUI_EDITOR_PACKAGES` to a
comma-separated package list to run a subset.

For a real editor cross-package authoring and publication comparison, run
`python standalone-node/test_editor_cross_package.py PROJECT EDITOR_EXE`.
It also checks cross-package MovieClip, loader, ComboBox, ProgressBar and Slider properties
using the compiled Cocos reader when the sibling Cocos source build is available.

For the opt-in real Cocos web-runtime test (requires Cocos Creator 3.8,
Chrome, Python Playwright, Pillow and a built `fairygui-cc` distribution):

```powershell
python standalone-node/cocos_runtime_probe.py --demo E:/game_dev/FairyGUI-cocoscreator/demo --distribution E:/game_dev/FairyGUI-cocoscreator/source --creator C:/ProgramData/Cocos/editors/Creator/3.8.4/CocosCreator.exe --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe' --compare-reference --compare-controller-states --settle-ms 0
```

The probe builds a temporary demo, checks rendered components and compares
initial screenshots and controller state trees against the demo's historical
editor-published data. It does not exercise every interaction or animation.
The report includes the Creator exit code and build diagnostics. Exit code 36
is accepted only when the build reports success, produces the web entry point,
and every logged error is the known Babel large-file deoptimization note.

## Experimental component screenshot

The `screenshot` CLI/MCP tool builds a temporary copy of a Cocos Creator 3.8
web demo and renders an exported component with the real `fairygui-cc` runtime.
It requires a Cocos demo template matching the repository demo, a built
`fairygui-cc` distribution (`package.json` and `dist/`), Creator and Chrome.
This first version rebuilds the web application on each call and is slow; it
is not a persistent web viewer. The experimental publisher must support every
exported resource in the project, and the requested component must appear in
the published package. Unsupported content fails instead of being silently
approximated. The PNG contains the full viewport with the component at the
runtime's default position, including the demo scene background. It captures
one running state, not every controller or animation state.

Example JSON for `node fgui.mjs screenshot @screenshot.json` (the output file
must not exist):

```json
{"project":"E:/game_dev/FairyGUI-cocoscreator/demo/UIProject","pkg":"MainMenu","name":"Main","output":"C:/temp/main.png","demo":"E:/game_dev/FairyGUI-cocoscreator/demo","distribution":"E:/game_dev/FairyGUI-cocoscreator/source","creator":"C:/ProgramData/Cocos/editors/Creator/3.8.4/CocosCreator.exe","chrome":"C:/Program Files/Google/Chrome/Application/chrome.exe","width":1000,"height":700,"settle_ms":1000}
```

The same arguments work through `tools/call` on either MCP transport. Building
and rendering do not modify the source project or the demo template.
