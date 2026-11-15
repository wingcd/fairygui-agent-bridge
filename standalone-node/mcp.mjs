import { execute } from './project.mjs';
import { atlasLayout, atlasExport } from './atlas-project.mjs';
import { validate } from './validate.mjs';
import { writeComponent, setComponentProperties, setProperties, setPropertiesBatch, createPackage, createComponent, insertResource, setImageOptions, editController, setControllerActions, editTransition, editBehavior, importResource, editObject, unregisterResource, setButtonOptions, setProgressOptions, setComboBoxOptions } from './write.mjs';
import { publishImages } from './publish-images.mjs';
import { preflightPublish } from './preflight.mjs';
import { publishProject } from './publish-project.mjs';
import { inspectPublished, validatePublished } from './published.mjs';
import { findReferences } from './find-references.mjs';
import Ajv from 'ajv';
import {lint} from './lint.mjs';
import { screenshot, screenshotBytes } from './screenshot.mjs';

const definitions = {
  screenshot: ['Render a component with the PIXI or Cocos web runtime and return PNG image content; optionally save it', ['pkg','name']],
  lint: ['Run project standards and reference checks', []],
  publish_simple_experimental: ['Compatibility alias for experimental basic component publication', ['pkg','output']],
  project_info: ['Read project descriptors and package count', []],
  list_packages: ['List packages in the project', []],
  list_items: ['List resources in a package', ['pkg']],
  unregister_resource: ['Remove an unreferenced resource registration while retaining its file', ['pkg','item','expected_sha256']],
  find_references: ['Find supported project references to a registered resource', ['pkg','item']],
  read_package: ['Read package XML and SHA-256', ['pkg']],
  set_button_options: ['Update Button component publication options', ['pkg','name','expected_sha256']],
  set_progress_options: ['Update ProgressBar component options', ['pkg','name','expected_sha256']],
  set_slider_options: ['Update Slider component options', ['pkg','name','expected_sha256']],
  set_combobox_options: ['Update ComboBox dropdown resource', ['pkg','name','expected_sha256']],
  set_button_instance_options: ['Update a Button child instance', ['pkg','name','target','expected_sha256']],
  set_label_instance_options: ['Update a Label child instance', ['pkg','name','target','expected_sha256']],
  set_combobox_instance_options: ['Update ComboBox instance items and visible count', ['pkg','name','target','expected_sha256']],
  set_progress_instance_options: ['Update a ProgressBar child instance', ['pkg','name','target','expected_sha256']],
  set_slider_instance_options: ['Update a Slider child instance', ['pkg','name','target','expected_sha256']],
  set_list_items: ['Replace list or tree items', ['pkg','name','target','expected_sha256']],
  set_relation: ['Create or replace a relation to a parent or sibling', ['pkg','name','target','related_to','expected_sha256']],
  remove_relation: ['Remove a relation', ['pkg','name','target','related_to','expected_sha256']],
  set_text_gear: ['Set controller gear values for a child object', ['pkg','name','target','controller','expected_sha256']],
  set_color_gear: ['Set controller gear values for a child object', ['pkg','name','target','controller','expected_sha256']],
  set_position_gear: ['Set controller gear values for a child object', ['pkg','name','target','controller','expected_sha256']],
  set_size_gear: ['Set controller gear values for a child object', ['pkg','name','target','controller','expected_sha256']],
  set_look_gear: ['Set controller gear values for a child object', ['pkg','name','target','controller','expected_sha256']],
  set_font_size_gear: ['Set controller gear values for a child object', ['pkg','name','target','controller','expected_sha256']],
  set_animation_gear: ['Set controller gear values for a child object', ['pkg','name','target','controller','expected_sha256']],
  set_icon_gear: ['Set controller gear values for a child object', ['pkg','name','target','controller','expected_sha256']],
  set_display_gear: ['Bind object visibility to controller pages', ['pkg','name','target','controller','expected_sha256']],
  set_display2_gear: ['Set secondary visibility gear', ['pkg','name','target','controller','expected_sha256']],
  remove_gear: ['Remove an object gear', ['pkg','name','target','gear','expected_sha256']],
  create_controller: ['Create a component controller with pages', ['pkg','name','controller','expected_sha256']],
  set_controller_pages: ['Change controller pages with a revision check', ['pkg','name','controller','expected_sha256']],
  set_controller_actions: ['Replace controller play-transition actions', ['pkg','name','controller','expected_sha256']],
  upsert_transition: ['Create or replace a transition from XML', ['pkg','name','transition_xml','expected_sha256']],
  remove_transition: ['Remove a transition if not referenced', ['pkg','name','transition','expected_sha256']],
  set_image_options: ['Update image publication options using package SHA-256', ['pkg','item','expected_sha256']],
  read_component: ['Read component XML and SHA-256', ['pkg', 'name']],
  list_children: ['List component children and their behaviors', ['pkg', 'name']],
  list_controllers: ['List component controllers and pages', ['pkg', 'name']],
  list_transitions: ['List component transitions and their source items', ['pkg', 'name']],
  atlas_layout: ['Plan atlas placement for project images', ['pkg']],
  atlas_export: ['Export atlas PNG images and layout manifest', ['pkg','output']],
  inspect_published: ['Inspect a supported published FairyGUI package', ['file']],
  validate_published: ['Validate published binary and atlas images', ['file']],
  validate: ['Validate project structure and selected references', []],
  preflight_publish: ['Try experimental publication for each package and report errors', []],
  write_component: ['Replace component XML after validation and revision check', ['pkg','name','xml','expected_sha256']],
  set_component_properties: ['Update component properties with a revision check', ['pkg','name','expected_sha256']],
  set_properties: ['Update supported child properties with a revision check', ['pkg','name','target','expected_sha256']],
  set_properties_batch: ['Atomically update multiple children with a revision check', ['pkg','name','expected_sha256']],
  publish_images_experimental: ['Publish an image-only FairyGUI package', ['pkg','output']],
  publish_media_experimental: ['Publish a FairyGUI package containing images, sounds, JTA movieclips and bitmap fonts', ['pkg','output']],
  publish_project_experimental: ['Publish all project packages atomically with dependency manifest', ['output']],
  publish_basic_experimental: ['Publish media and basic components containing image children; rejects unsupported features', ['pkg','output']],
  import_font: ['Import and register a bitmap font', ['pkg','source']],
  import_image: ['Import and register a PNG or JPEG image', ['pkg','source']],
  import_sound: ['Import and register a sound file', ['pkg','source']],
  import_movieclip: ['Import and register a JTA movieclip', ['pkg','source']],
  create_package: ['Create a new empty package', ['name']],
  create_component: ['Create and register a component in a package', ['pkg','name']],
  insert_object: ['Insert an XML display object into a component', ['pkg','name','object_xml','expected_sha256']],
  move_object: ['Move a display object to a new index', ['pkg','name','target','expected_sha256']],
  remove_object: ['Remove an unreferenced display object', ['pkg','name','target','expected_sha256']],
  insert_resource: ['Insert a registered image, component or movieclip into a component', ['pkg','name','ref_name','expected_sha256']],
};
const atlasProperties = {width:{type:'integer',minimum:1},height:{type:'integer',minimum:1},padding:{type:'integer',minimum:0},shrink_atlas:{type:'boolean'},optimize_atlas:{type:'boolean'},rotate_images:{type:'boolean'}};
const publicationProperties = {...atlasProperties,trim_images:{type:'boolean'},exported_only:{type:'boolean'},binary_format:{type:'boolean',description:'Override project binaryFormat for this publication without modifying project settings'}};
const childProperties = Object.fromEntries([
  ['group',{anyOf:[{type:'string',minLength:1},{type:'null'}]}],
  ...['name','xy','size','scale','pivot','text','font','url','lineColor','fillColor','corner','points','distances','prompt','restrict','margin','clipSoftness','defaultItem','selectionController'].map(k=>[k,{type:'string'}]),
  ...['rotation','alpha','fontSize','leading','letterSpacing','fillAmount','frame','lineSize','sides','startAngle','maxLength','keyboardType','lineGap','colGap','lineItemCount','lineItemCount2','mainGridIndex'].map(k=>[k,{anyOf:[{type:'number'},{type:'string'}]}]),
  ...['scrollBarMargin','scrollBarRes','ptrRes','pageController'].map(k=>[k,{anyOf:[{type:'string'},{type:'null'}]}]),
  ['scrollBarFlags',{anyOf:[{type:'number'},{type:'string'},{type:'null'}]}],
  ...['anchor','visible','touchable','grayed','bold','italic','underline','singleLine','ubb','fillClockwise','playing','password','forHitTest','advanced','excludeInvisibles','autoSizeDisabled','autoItemSize','autoClearItems','scrollItemToViewOnClick','foldInvisibleItems'].map(k=>[k,{anyOf:[{type:'boolean'},{type:'string',enum:['true','false']}]}]),
  ['scroll',{enum:['horizontal','vertical','both',null]}],['scrollBar',{enum:['default','visible','auto','hidden',null]}],['renderOrder',{type:'string',enum:['ascent','descent','arch']}],['layout',{type:'string',enum:['column','row','flow_hz','flow_vt','pagination','none','hz','vt']}],['selectionMode',{type:'string',enum:['single','multiple','multipleSingleClick','none']}],['overflow',{type:'string',enum:['visible','hidden','scroll']}],
  ...['strokeColor','shadowColor','shadowOffset'].map(k=>[k,{anyOf:[{type:'string'},{type:'null'}]}]),
  ['color',{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}],
  ['type',{type:'string',enum:['rect','eclipse','polygon','regular_polygon']}],
  ['fill',{type:'string',enum:['none','scale','scaleMatchHeight','scaleMatchWidth','scaleFree','scaleNoBorder']}],['fillMethod',{type:'string',enum:['none','hz','vt','radial90','radial180','radial360']}],['flip',{type:'string',enum:['none','hz','vt','both']}],
  ['align',{type:'string',enum:['left','center','right']}],['vAlign',{type:'string',enum:['top','middle','bottom']}],['autoSize',{type:'string',enum:['none','both','height','shrink']}],
]);
const argumentDescriptions={project:'FairyGUI project directory or .fairy file; required on each tool call',pkg:'Package name or ID',expected_sha256:'SHA-256 from the most recent read; stale edits are rejected',target:'Display object ID or unique name',output:'Destination path; publication output directories must not already exist'};
export const tools = Object.entries(definitions).map(([name, [description, fields]]) => ({
  name, description, inputSchema: { type:'object', properties:{...Object.fromEntries(['project', ...fields].map(key => [key,{type:'string',...(argumentDescriptions[key]?{description:argumentDescriptions[key]}:{})}])),...(name==='screenshot'?{renderer:{type:'string',enum:['cocos','pixi'],description:'pixi (default) uses an experimental legacy XML runtime; cocos uses the Cocos Creator runtime'},controller_pages:{type:'object',description:'PIXI only: root controller names mapped to page IDs',additionalProperties:{type:'string',minLength:1}},controller_overrides:{type:'array',description:'PIXI only: controller pages in nested component instances, addressed by child IDs',maxItems:128,items:{type:'object',properties:{path:{type:'array',maxItems:32,items:{type:'string',minLength:1}},controller:{type:'string',minLength:1},page:{type:'string',minLength:1}},required:['path','controller','page'],additionalProperties:false}},output:{type:'string',minLength:1,description:'Optional new PNG file path; if omitted the image is returned through MCP only'},reuse_screenshot:{type:'boolean',description:'Reuse a matching previous frame from this service process; animations and external state are not refreshed'},demo:{type:'string',description:'Cocos demo template path, or FGUI_COCOS_DEMO environment variable'},distribution:{type:'string',description:'Built fairygui-cc path, or FGUI_COCOS_DISTRIBUTION'},creator:{type:'string',description:'Cocos Creator executable, or FGUI_COCOS_CREATOR'},chrome:{type:'string',description:'Chrome executable, or FGUI_CHROME'},width:{type:'integer',minimum:1,maximum:4096},height:{type:'integer',minimum:1,maximum:4096},settle_ms:{type:'integer',minimum:0,maximum:10000}}:{}),...(name.startsWith('atlas_') ? atlasProperties : (name.startsWith('publish_') || name==='preflight_publish') ? publicationProperties : {}),...(name==='set_list_items'?{items:{type:'array',maxItems:32767,items:{type:'object',properties:{url:{type:'string'},title:{type:'string'},selectedTitle:{type:'string'},icon:{type:'string'},selectedIcon:{type:'string'},name:{type:'string'},level:{type:'integer',minimum:0,maximum:255}},additionalProperties:false}}}:{}),...(name==='set_controller_actions'?{actions:{type:'array',maxItems:32767,items:{type:'object',properties:{transition:{type:'string'},from_pages:{type:'array',items:{type:'string'}},to_pages:{type:'array',items:{type:'string'}}},required:['transition'],additionalProperties:false}}}:{}),...(name==='set_relation'?{side_pairs:{type:'array',minItems:1,maxItems:255,items:{type:'string'}}}:{}),...(['set_display_gear','set_display2_gear','set_text_gear','set_color_gear','set_position_gear','set_size_gear','set_look_gear','set_font_size_gear','set_animation_gear','set_icon_gear'].includes(name)?{pages:{type:'array',items:{type:'string'}},...(name==='set_display2_gear'?{condition:{type:'integer',enum:[0,1]}}:{}),...(!['set_display_gear','set_display2_gear'].includes(name)?{values:{type:'array',items:{type:'string'}},default:{type:'string'},...(['set_position_gear','set_size_gear','set_look_gear'].includes(name)?{tween:{type:'object',properties:{enabled:{type:'boolean'},ease:{type:'string'},duration:{type:'number'},delay:{type:'number'}},required:['enabled'],additionalProperties:false}}:{})}:{})}:{}),...(['create_controller','set_controller_pages'].includes(name)?{pages:{type:'array',maxItems:256,items:{type:'object',properties:{id:{type:'string'},name:{type:'string'}},required:['id','name'],additionalProperties:false}},selected:{type:'integer',minimum:0}}:{}),...(['import_image','import_sound','import_movieclip','import_font'].includes(name)?{name:{type:'string'},path:{type:'string'},exported:{type:'boolean'},...(name==='import_font'?{texture:{type:'string'}}:{})}:{}),...(name==='insert_object'||name==='move_object'?{index:{type:'integer',minimum:0}}:{}),...(name==='insert_resource'?{ref_pkg:{type:'string'},object_name:{type:'string'},x:{type:'integer'},y:{type:'integer'},index:{type:'integer',minimum:0}}:{}),...(name==='set_combobox_options'?{props:{type:'object',properties:{dropdown:{type:'string'}},required:['dropdown'],additionalProperties:false}}:{}),...(['set_progress_options','set_slider_options'].includes(name)?{props:{type:'object',properties:{titleType:{type:'string',enum:['percent','valueAndmax','value','max']},reverse:{type:'boolean'}},minProperties:1,additionalProperties:false}}:{}),...(name==='set_button_options'?{props:{type:'object',properties:{mode:{type:'string',enum:['Common','Check','Radio']},sound:{type:'string'},downEffect:{type:'string',enum:['none','dark','scale']},downEffectValue:{type:'number',minimum:0,maximum:10}},minProperties:1,additionalProperties:false}}:{}),...(['set_button_instance_options','set_label_instance_options'].includes(name)?{props:{type:'object',properties:{title:{type:'string'},icon:{type:'string'},titleColor:{type:'string'},titleFontSize:{type:'integer',minimum:0},...(name==='set_button_instance_options'?{selectedTitle:{type:'string'},selectedIcon:{type:'string'},checked:{type:'boolean'}}:{})},minProperties:1,additionalProperties:false}}:{}),...(name==='set_combobox_instance_options'?{props:{type:'object',properties:{visibleItemCount:{type:'integer',minimum:0,maximum:2147483647},items:{type:'array',maxItems:32767,items:{type:'object',properties:{title:{type:'string'},value:{type:'string'},icon:{type:'string'}},additionalProperties:false}}},minProperties:1,additionalProperties:false}}:{}),...(['set_progress_instance_options','set_slider_instance_options'].includes(name)?{props:{type:'object',properties:Object.fromEntries(['value','min','max'].map(key=>[key,{type:'integer',minimum:-2147483648,maximum:2147483647}])),minProperties:1,additionalProperties:false}}:{}),...(name==='set_image_options'?{props:{type:'object',properties:{scale:{type:'string',enum:['none','9grid','tile']},scale9grid:{type:'string'},duplicatePadding:{type:'boolean'},exported:{type:'boolean'}},minProperties:1,additionalProperties:false}}:{}),...(name==='validate'?{check_media:{type:'boolean'},exported_only:{type:'boolean'}}:{}),...(name==='validate_published'?{compare_source:{type:'boolean'},compare_components:{type:'boolean'},check_overlaps:{type:'boolean'},exported_only:{type:'boolean'}}:{}),...(name==='create_component'?{width:{type:'integer',minimum:1,maximum:100000},height:{type:'integer',minimum:1,maximum:100000},path:{type:'string'},exported:{type:'boolean'},extention:{type:'string',enum:['Label','Button','ComboBox','ProgressBar','Slider','ScrollBar']}}:{}),...(name==='set_component_properties'?{props:{type:'object',properties:{size:{type:'string'},pivot:{type:'string'},opaque:{type:'boolean'},mask:{anyOf:[{type:'string'},{type:'null'}]},hitTest:{anyOf:[{type:'string'},{type:'null'}]},reversedMask:{anyOf:[{type:'boolean'},{type:'null'}]},overflow:{type:'string',enum:['visible','hidden','scroll']},margin:{type:'string'},scroll:{enum:['horizontal','vertical','both',null]},scrollBar:{enum:['default','visible','auto','hidden',null]},scrollBarFlags:{anyOf:[{type:'integer'},{type:'string'},{type:'null'}]},scrollBarMargin:{anyOf:[{type:'string'},{type:'null'}]},scrollBarRes:{anyOf:[{type:'string'},{type:'null'}]},ptrRes:{anyOf:[{type:'string'},{type:'null'}]}},minProperties:1,additionalProperties:false}}:{}),...(name==='set_properties'?{props:{type:'object',properties:childProperties,minProperties:1,additionalProperties:false}}:{}),...(name==='set_properties_batch'?{changes:{type:'array',minItems:1,maxItems:1000,items:{type:'object',properties:{target:{type:'string'},props:{type:'object',properties:childProperties,minProperties:1,additionalProperties:false}},required:['target','props'],additionalProperties:false}}}:{})}, required:['project',...fields,...(name==='move_object'?['index']:name==='set_list_items'?['items']:name==='set_controller_actions'?['actions']:name==='set_relation'?['side_pairs']:['set_display_gear','set_display2_gear','set_text_gear','set_color_gear','set_position_gear','set_size_gear','set_look_gear','set_font_size_gear','set_animation_gear','set_icon_gear'].includes(name)?['pages',...(name==='set_display2_gear'?['condition']:[]),...(!['set_display_gear','set_display2_gear'].includes(name)?['values']:[])]:['create_controller','set_controller_pages'].includes(name)?['pages']:[]),...(name==='create_component'?['width','height']:['set_component_properties','set_properties','set_image_options','set_button_options','set_progress_options','set_slider_options','set_combobox_options','set_button_instance_options','set_label_instance_options','set_combobox_instance_options','set_progress_instance_options','set_slider_instance_options'].includes(name)?['props']:name==='set_properties_batch'?['changes']:[])], additionalProperties:false },
}));
const ajv = new Ajv({allErrors:true});
const validators = new Map();
const schemas = new Map(tools.map(tool => [tool.name, tool.inputSchema]));
const err = (id, code, message) => ({jsonrpc:'2.0',id,error:{code,message}});
export function toolContent(name,data) {
  const content=[{type:'text',text:JSON.stringify(data)}];
  if (name === 'screenshot' && data.ok && data.data[screenshotBytes]) content.push({type:'image',mimeType:'image/png',data:data.data[screenshotBytes].toString('base64')});
  return content;
}
function validUnicode(value) {
  const pending=[value],seen=new Set();
  while(pending.length){const item=pending.pop();if(typeof item==='string'){for(let i=0;i<item.length;i++){const unit=item.charCodeAt(i);if(unit>=0xd800&&unit<=0xdbff){if(++i>=item.length||item.charCodeAt(i)<0xdc00||item.charCodeAt(i)>0xdfff)return false;}else if(unit>=0xdc00&&unit<=0xdfff)return false;}}else if(item&&typeof item==='object'){if(seen.has(item))return false;seen.add(item);if(Array.isArray(item)){for(const entry of item)pending.push(entry);}else for(const [key,val] of Object.entries(item))pending.push(key,val);}}
  return true;
}
export async function message(request, version = '2024-11-05') {
  if (!validUnicode(request)) return err(null,-32600,'Invalid Unicode');
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || ('id' in request && request.id !== null && typeof request.id !== 'string' && !Number.isSafeInteger(request.id))) return err(null,-32600,'Invalid Request');
  if (!('id' in request)) return null;
  const {id, method} = request;
  if (method === 'initialize') return {jsonrpc:'2.0',id,result:{protocolVersion:version,capabilities:{tools:{}},serverInfo:{name:'fgui-standalone-node',version:'0.1.0'}}};
  if (method === 'ping') return {jsonrpc:'2.0',id,result:{}};
  if (method === 'tools/list') return {jsonrpc:'2.0',id,result:{tools}};
  if (method !== 'tools/call') return err(id,-32601,'unknown method');
  const params = request.params;
  if (!params || typeof params !== 'object' || Array.isArray(params) || typeof params.name !== 'string' || !Object.hasOwn(definitions,params.name)) return err(id,-32602,'invalid tool parameters');
  const args = params.arguments ?? {};
  let data;
  try {
    let validateArgs = validators.get(params.name);
    if (!validateArgs) { validateArgs = ajv.compile(schemas.get(params.name)); validators.set(params.name, validateArgs); }
    if (!validateArgs(args)) throw new Error('invalid tool arguments: ' + ajv.errorsText(validateArgs.errors, {separator:'; '}));
    data = {ok:true,data:params.name === 'lint' ? await lint(args) : params.name === 'screenshot' ? await screenshot(args) : params.name === 'atlas_layout' ? await atlasLayout(args) : params.name === 'atlas_export' ? await atlasExport(args) : params.name==='publish_project_experimental' ? await publishProject(args) : params.name==='publish_images_experimental' ? await publishImages(args) : ['publish_basic_experimental','publish_simple_experimental'].includes(params.name) ? await publishImages(args,{allowSounds:true,allowComponents:true}) : params.name==='publish_media_experimental' ? await publishImages(args,{allowSounds:true}) : params.name === 'preflight_publish' ? await preflightPublish(args) : params.name === 'inspect_published' ? await inspectPublished(args) : params.name === 'validate_published' ? await validatePublished(args) : params.name === 'find_references' ? findReferences(args) : params.name === 'validate' ? await validate(args) : ['insert_object','move_object','remove_object'].includes(params.name) ? editObject(args,params.name) : ['set_list_items','set_button_instance_options','set_label_instance_options','set_combobox_instance_options','set_progress_instance_options','set_slider_instance_options','set_relation','remove_relation','set_display_gear','set_display2_gear','set_text_gear','set_color_gear','set_position_gear','set_size_gear','set_look_gear','set_font_size_gear','set_animation_gear','set_icon_gear','remove_gear'].includes(params.name) ? editBehavior(args,params.name) : ['upsert_transition','remove_transition'].includes(params.name) ? editTransition(args,params.name==='remove_transition') : params.name==='set_controller_actions' ? setControllerActions(args) : ['create_controller','set_controller_pages'].includes(params.name) ? editController(args,params.name==='create_controller') : params.name === 'write_component' ? writeComponent(args) : params.name==='unregister_resource' ? unregisterResource(args) : params.name==='set_combobox_options' ? setComboBoxOptions(args) : ['set_progress_options','set_slider_options'].includes(params.name) ? setProgressOptions(args,params.name==='set_progress_options'?'ProgressBar':'Slider') : params.name==='set_button_options' ? setButtonOptions(args) : params.name==='set_image_options' ? await setImageOptions(args) : ['import_image','import_sound','import_movieclip','import_font'].includes(params.name) ? await importResource(args,{import_image:'image',import_sound:'sound',import_movieclip:'movieclip',import_font:'font'}[params.name]) : params.name==='create_package' ? createPackage(args) : params.name==='insert_resource' ? insertResource(args) : params.name==='create_component' ? createComponent(args) : params.name==='set_component_properties' ? setComponentProperties(args) : params.name==='set_properties' ? setProperties(args) : params.name==='set_properties_batch' ? setPropertiesBatch(args) : execute(params.name,args)};
  } catch (error) { data = {ok:false,error:error.message}; }
  return {jsonrpc:'2.0',id,result:{content:toolContent(params.name,data),isError:!data.ok}};
}
