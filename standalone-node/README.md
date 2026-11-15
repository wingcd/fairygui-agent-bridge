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
`set_properties` also edits group advanced mode, layout, gaps, visibility exclusion, auto-size and main-grid index. Disabling advanced mode makes the group editor-only.
Use `set_properties` with `group` set to a sibling group ID to assign membership, or null to clear it. Group members must be sibling display-list objects;
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
Advanced groups support none, horizontal and vertical layouts, gaps, visibility exclusion, auto-size and main-grid settings. Editor-only groups are also supported.
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
well-formedness, sprite manifests, movieclip frame references and image-glyph font
references; it does not inspect their runtime behavior. Use `exported_only: true` for filtered publications. It does not validate component
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

To audit all registered components with the Pixi screenshot path, run
`node audit-screenshots.mjs PROJECT`. It emits one JSON record per component and
a final count; any failed screenshot produces a nonzero exit status. This checks
whether an image can be produced, not pixel equivalence with the editor.

## Experimental component screenshot

The `screenshot` CLI/MCP tool defaults to the experimental PIXI renderer described
below. Set `renderer: "cocos"` to build a temporary copy of a Cocos Creator 3.8
web demo and render a component with the real `fairygui-cc` runtime.
It requires a Cocos demo template matching the repository demo, a built
`fairygui-cc` distribution (`package.json` and `dist/`), Creator and Chrome.
Fresh renders rebuild the web application and are slow; optional same-frame reuse is described below. The experimental publisher must support exported resources in the target package
and the packages it depends on. The requested component is included even
if the component is not exported; the source project is not modified. Cross-package
dependencies must still be exported or reachable from an exported resource in
their own package. Unsupported content fails instead of being silently
approximated. The PNG contains the full viewport with the component at the
runtime's default position, including the demo scene background. It captures
one running state, not every controller or animation state.

Example JSON for `node fgui.mjs screenshot @screenshot.json` (the output file
must not exist):

```json
{"project":"E:/game_dev/FairyGUI-cocoscreator/demo/UIProject","pkg":"MainMenu","name":"Main","renderer":"cocos","output":"C:/temp/main.png","demo":"E:/game_dev/FairyGUI-cocoscreator/demo","distribution":"E:/game_dev/FairyGUI-cocoscreator/source","creator":"C:/ProgramData/Cocos/editors/Creator/3.8.4/CocosCreator.exe","chrome":"C:/Program Files/Google/Chrome/Application/chrome.exe","width":1000,"height":700,"settle_ms":1000}
```

The same arguments work through `tools/call` on either MCP transport. Building
and rendering do not modify the source project or the demo template.

MCP screenshot responses include an `image/png` image content block as well as
JSON metadata. If an output path is supplied, the PNG is saved there as well.
CLI output remains JSON metadata and requires an output path.

To run the end-to-end MCP screenshot test, set `FGUI_SCREENSHOT_CONFIG` to a
UTF-8 JSON file containing the screenshot arguments above except `output`, then
run `node --test screenshot.test.mjs`. The test compares the MCP image bytes to
the saved PNG and requires the real Creator and Chrome dependencies.

The local HTTP service also provides an experimental screenshot viewer at
`http://127.0.0.1:7532/viewer`. It defaults to PIXI and can also select the
Cocos renderer. A fresh Cocos render triggers a new build; optional same-frame
reuse can avoid that build.
The page shows the resulting image, but does not yet provide live editing.

For repeated calls, set `FGUI_COCOS_DEMO`, `FGUI_COCOS_DISTRIBUTION`,
`FGUI_COCOS_CREATOR`, and `FGUI_CHROME` in the service environment. Screenshot
calls can then omit `demo`, `distribution`, `creator`, and `chrome`; explicit
arguments take precedence. The viewer accepts empty fields for these defaults.

Set `reuse_screenshot: true` (or check reuse in the viewer) to reuse an exact
previous PNG in the same server process. Up to four images of 8 MiB each are
kept in memory; publication still runs and the source assets, demo, runtime,
Creator and browser executables are fingerprinted. `cached` in the result
identifies a hit. The cache intentionally returns the previous frame: animations,
external fonts, system settings and other external runtime state are not
refreshed. Leave it disabled to render a new frame. Symbolic links in cache
inputs are rejected. Restarting the service clears the cache.

For MCP, `output` can be omitted to return the PNG as image content without
creating a file; the CLI still requires an output path. The viewer likewise
accepts an empty output and offers a download link.
Before a fresh capture, the Cocos renderer waits for network activity to settle.
Both renderers wait for package resources, browser fonts, the configured delay, and two animation
frames. A resource or font loading timeout is reported instead of returning a
potentially incomplete image. Runtime-specific asynchronous work is not
necessarily represented by browser network or font state.

The stdio MCP service can process independent requests while a screenshot is
building. Responses are correlated by JSON-RPC ID and may arrive out of order.
The opt-in screenshot tests also verify that stdio and Streamable HTTP can
serve another project while a real Cocos screenshot is in progress.

`lint` runs the repository standards checker and returns its report and valid
status. `publish_simple_experimental` is a compatibility name for the Node
basic publisher; it has the same scope and limitations as
`publish_basic_experimental` rather than promising identical implementation
coverage to Python.

`node benchmark-service.mjs PROJECT [PROJECT ...]` runs 100 read-only
`list_packages` requests through one local service with four workers and reports
throughput and latency. Add `--tool=project_info` to measure project metadata instead. Results depend on machine load and filesystem caching;
they do not measure writes, publication, or screenshot builds.

The default `screenshot` renderer (`renderer: "pixi"`) uses the community
FairyGUI PixiJS runtime and Chrome directly, without Cocos Creator. It currently
detects Chrome in common installation locations; `chrome` or `FGUI_CHROME`
can select a different executable. It currently
uses a restricted legacy XML preview subset, including simple nested Button and Label
components and styled text including outline and shadows; unsupported features are rejected. Only the requested component and
its same-package dependencies are selected; referenced external packages still
include their exported resources. The Cocos sample
`MainMenu/Main` renders, but pixel comparison found differences from Cocos
(mainly rendering and text); the two are not pixel-identical. The PIXI preview
uses the controller `selected` page stored for the editor; binary runtime
publication currently starts controllers on their published home page instead. The Cocos renderer
is available explicitly for projects outside the PIXI preview subset. PIXI
mode supports `reuse_screenshot` with content-based invalidation and coalesces
concurrent requests for the same inputs; the viewer has a renderer selector.

For the Cocos demo's 16 `Main` components, automated screenshot checks cover
MainMenu, Joystick, ModalWaiting, HitTest, Basics, ListEffect, LoopList,
ScrollPane, VirtualList, Transition, Chat, Bag, Guide, Cooldown, PullToRefresh and
TreeView. All 16 sample `Main` components now have initial screenshot checks.
These checks establish that initial content renders, not pixel parity with the
editor or full support for every component in each sample.
Input text is rendered in its unfocused state, including password masking,
plain-text prompts and the tested color-marked prompt forms; other styled input
prompts are not yet supported.
Rich-text fields support plain text and the tested UBB subset (bold, italic,
underline, color, size, font face, links and inline package images). Styled runs and images
are laid out by the preview and may differ from Cocos or the editor. A limited
HTML subset (bold, italic, underline, font face/color/size, links, line breaks and
package images) is supported. Other HTML, UBB with bitmap fonts, and nonempty
size-constrained rich text are rejected.
JTA movieclip frames are packed into preview atlases and can be played or selected.
Static grayed objects use the PIXI runtime's grayscale filter.
Bitmap fonts backed by individual image glyphs or a single texture are supported
for the tested glyph and tint settings.
Automatic linear rotation transitions and pull-to-refresh header/footer resources
are supported for the shapes exercised by the preview tests; other autoplay
transitions remain unsupported.
Tree previews initialize the expanded nodes, indentation, leaf controllers and
icons; interactive tree expansion is not implemented in this screenshot viewer.
Lists also support an explicitly supplied vertical scrollbar in automatic
mode and tested project-default scrollbars from Common.json; other visible
scrollbar configurations remain unsupported.

PIXI preview packs temporary atlases without trimming or rotation because the
legacy runtime does not preserve trimmed sprite offsets. This does not alter
the project settings or the normal publication output.
PIXI preview respects portrait and landscape viewport orientations.
PIXI captures also fail when the browser reports a resource HTTP error or an
uncaught runtime error, and wait for browser fonts and two render frames before
capturing.
PIXI preview supports cross-package image and component references when the
source `pkg` attribute uses the package name or ID; external resources must be exported.
Package names are normalized in temporary preview data without changing project files. Only the selected component and its transitive dependencies are
included, including across packages; unrelated exported resources are excluded.
PIXI supports object scale, opacity, visibility and fractional rotation. Image tint and
horizontal, vertical and combined flips are supported by the Pixi preview. Nested
component pivot and pivot-as-anchor positioning are supported. Nine-slice and
tiled images, including flipped instances, are covered by screenshot tests. The
selected controller page also applies position, size, look, plain-text, font-size,
and image and text color/outline gears in previews. Loader icon gears support image and component URLs
and empty values. Basic groups propagate visibility and position;
components support hidden overflow clipping and scroll overflow with hidden scrollbars. Progress bars support instance values, default values and nonzero minima.
Images support horizontal, vertical, 90-, 180- and 360-degree radial fills,
including use as a progress bar, for the default fill origin. Ellipses, polygons, regular polygons and rectangles
with an integer uniform corner radius are supported. Graph masks are supported;
reversed masks currently cover static rectangles and ellipses with no border or
transform. Movieclip tint and controller-selected animation frames are supported,
as are combined display gears and initial ComboBox item titles. Preview packages
may contain MP3 and Ogg sound assets; audio playback has not been verified.
Hit-test metadata does not
affect captured pixels; interactive hit-testing is not provided by the preview. Package image and component loaders support local and cross-package UI URLs,
alignment and scaling; image loaders also support tint and tested horizontal, vertical and radial fills. Component loader tint,
external URLs are not supported by this preview; local movieclip loaders and movieclip icons in tree items are supported. Static
row, column, flow and tested paginated lists with component items and spacing are supported.
Hidden and scroll overflow are supported; automatic vertical scrollbars and
pull-to-refresh resources are supported in the tested configurations. Interactive
scrolling is not provided by the screenshot viewer. List clip softness is
ignored to match the Cocos runtime. Non-autoplay transitions are omitted from
the temporary preview; the supported autoplay rotation shape is described above. List
Button items support nonempty title and icon overrides; empty overrides and
overrides on other item types are rejected.
