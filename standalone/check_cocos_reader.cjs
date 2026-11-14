// Execute the actual compiled Cocos ByteBuffer and UIPackage.loadPackage
// against a generated package, with minimal Cocos types stubbed for metadata.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const [build, file, ...dependencyFiles] = process.argv.slice(2);
if (!build || !file) throw new Error('usage: node check_cocos_reader.cjs <cocos-source/build> <package.bin>');
const bufferSource = fs.readFileSync(path.join(build, 'utils/ByteBuffer.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace('export class ByteBuffer', 'class ByteBuffer');
const packageSource = fs.readFileSync(path.join(build, 'UIPackage.js'), 'utf8');
const start = packageSource.indexOf('    loadPackage(buffer, path) {');
const end = packageSource.indexOf('    dispose(', start);
if (start < 0 || end < 0) throw new Error('Cannot locate Cocos UIPackage.loadPackage');
const method = packageSource.slice(start, end);
const context = {
    PackageItem: class {getBranch(){return this;} load(){this.asset={};}}, BitmapFont: class {onLoaded(){}}, SpriteFrame: class {}, Rect: class {set(value){Object.assign(this,value);}}, Vec2: class { constructor(x=0,y=0){this.x=x;this.y=y;} }, Color: class { constructor(r,g,b,a){Object.assign(this,{r,g,b,a});} },
    Size: class { constructor(width=0,height=0){this.width=width;this.height=height;} },
    PackageItemType: {Image:0, MovieClip:1, Sound:2, Component:3, Atlas:4, Font:5, Swf:6, Misc:7, Spine:9, DragonBones:10},
    ObjectType: {Image:0, MovieClip:1, Component:9},
    PathUtils: {mainFileName: s => s.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')},
    _branch: '', Decls: {UIObjectFactory: {resolveExtension() {}}},
    EaseType: {QuadOut:5}, ChildHitArea: class {constructor(child){this.child=child;}}, PixelHitTestData: class {}, GearTweenConfig: class {}, ObjectPropID: {Color:2, OutlineColor:3, Playing:4, Frame:5, FontSize:8}, TranslationHelper: {translateComponent(){}}, OverflowType: {Scroll:2}, GButton:{UP:'up'}, ButtonMode:{Common:0}, FUIEvent:{TOUCH_BEGIN:'begin',TOUCH_END:'end',ROLL_OVER:'over',ROLL_OUT:'out',CLICK:'click'}, console,
};
const hitTestSource = fs.readFileSync(path.join(build, 'event/HitTest.js'), 'utf8').replace(/^import .*;\s*$/gm, '').replace(/export class /g, 'class ');
vm.createContext(context);
vm.runInContext(hitTestSource + '\nthis.PixelHitTestData=PixelHitTestData; this.PixelHitTest=PixelHitTest;', context);
vm.runInContext(bufferSource + '\nthis.ByteBuffer=ByteBuffer; class Package { constructor(){this._items=[];this._itemsById={};this._itemsByName={};this._sprites={};this._dependencies=[];this._branches=[];this._branchIndex=-1;} getItemById(id){return this._itemsById[id];}\n' + method + '\n}; this.Package=Package;', context);
const bytes = fs.readFileSync(file);
const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const pkg = new context.Package();
pkg.loadPackage(new context.ByteBuffer(array), 'test/Demo');
const loadedPackages = new Map([[pkg._id, pkg]]);
for (const dependencyFile of dependencyFiles) {
    const bytes = fs.readFileSync(dependencyFile);
    const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const dependency = new context.Package();
    dependency.loadPackage(new context.ByteBuffer(array), 'test/' + path.parse(dependencyFile).name);
    dependency.getItemAsset = () => ({});
    loadedPackages.set(dependency._id, dependency);
}
const componentSource = fs.readFileSync(path.join(build, 'GComponent.js'), 'utf8');
const buttonSource = fs.readFileSync(path.join(build, 'GButton.js'), 'utf8');
const progressSource = fs.readFileSync(path.join(build, 'GProgressBar.js'), 'utf8');
const sliderSource = fs.readFileSync(path.join(build, 'GSlider.js'), 'utf8');
const labelSource = fs.readFileSync(path.join(build, 'GLabel.js'), 'utf8');
const labelAfter = labelSource.indexOf('    setup_afterAdd(buffer, beginPos) {');
const labelAfterEnd = labelSource.indexOf('    onClick_1(', labelAfter);
const labelStart = labelSource.indexOf('    constructExtension(buffer) {');
if (labelStart < 0 || labelAfter < 0) throw new Error('Cannot locate GLabel.constructExtension');
vm.runInContext('class Label { ' + labelSource.slice(labelStart, labelAfter) + ' }; this.Label=Label;', context);
const sliderStart = sliderSource.indexOf('    constructExtension(buffer) {');
const sliderEnd = sliderSource.indexOf('    handleSizeChanged()', sliderStart);
const sliderAfter = sliderSource.indexOf('    setup_afterAdd(buffer, beginPos) {', sliderEnd);
const sliderAfterEnd = sliderSource.indexOf('    onGripTouchBegin(', sliderAfter);
if (sliderStart < 0 || sliderEnd < 0) throw new Error('Cannot locate GSlider.constructExtension');
vm.runInContext('class Slider { ' + sliderSource.slice(sliderStart,sliderEnd) + ' }; this.Slider=Slider;', context);
const progressStart = progressSource.indexOf('    constructExtension(buffer) {');
const progressEnd = progressSource.indexOf('    handleSizeChanged()', progressStart);
const progressAfter = progressSource.indexOf('    setup_afterAdd(buffer, beginPos) {', progressEnd);
const progressClassEnd = progressSource.lastIndexOf('\n}');
if (progressStart < 0 || progressEnd < 0) throw new Error('Cannot locate GProgressBar.constructExtension');
vm.runInContext('class ProgressBar { ' + progressSource.slice(progressStart,progressEnd) + ' }; this.ProgressBar=ProgressBar;', context);
const buttonStart = buttonSource.indexOf('    constructExtension(buffer) {');
const buttonEnd = buttonSource.indexOf('    setup_afterAdd(', buttonStart);
if (buttonStart < 0 || buttonEnd < 0) throw new Error('Cannot locate GButton.constructExtension');
vm.runInContext('class Button { ' + buttonSource.slice(buttonStart,buttonEnd) + ' }; this.Button=Button;', context);
const pathPointSource = fs.readFileSync(path.join(build, 'tween/GPathPoint.js'), 'utf8').replace(/^import .*;\s*$/gm, '').replace('export var CurveType', 'var CurveType').replace('export class GPathPoint', 'class GPathPoint');
const pathSource = fs.readFileSync(path.join(build, 'tween/GPath.js'), 'utf8').replace(/^import .*;\s*$/gm, '').replace('export class GPath', 'class GPath');
vm.runInContext(pathPointSource + '\n' + pathSource, context);
const transitionSource = fs.readFileSync(path.join(build, 'Transition.js'), 'utf8').replace(/^import .*;\s*$/gm, '').replace('export class Transition', 'class Transition');
vm.runInContext(transitionSource + '\nthis.Transition=Transition;', context);
const baseAction = fs.readFileSync(path.join(build, 'action/ControllerAction.js'), 'utf8').replace('export class ControllerAction', 'class ControllerAction');
const playAction = fs.readFileSync(path.join(build, 'action/PlayTransitionAction.js'), 'utf8').replace(/^import .*;\s*$/gm, '').replace('export class PlayTransitionAction', 'class PlayTransitionAction');
vm.runInContext(baseAction + '\n' + playAction + '\nfunction createAction(type){if(type===0)return new PlayTransitionAction();throw Error("unsupported controller action");}', context);
const comboSource = fs.readFileSync(path.join(build, 'GComboBox.js'), 'utf8');
const comboStart = comboSource.indexOf('    constructExtension(buffer) {');
const comboEnd = comboSource.indexOf('    handleControllerChanged(', comboStart);
if (comboStart < 0 || comboEnd < 0) throw new Error('Cannot locate combobox extension reader');
vm.runInContext('class ComboBox { ' + comboSource.slice(comboStart,comboEnd) + ' }; this.ComboBox=ComboBox;', context);
const scrollBarSource = fs.readFileSync(path.join(build, 'GScrollBar.js'), 'utf8');
const scrollBarStart = scrollBarSource.indexOf('    constructExtension(buffer) {');
const scrollBarEnd = scrollBarSource.indexOf('    onGripTouchDown(', scrollBarStart);
if (scrollBarStart < 0 || scrollBarEnd < 0) throw new Error('Cannot locate scrollbar reader');
vm.runInContext('class ScrollBar { ' + scrollBarSource.slice(scrollBarStart, scrollBarEnd) + ' }; this.ScrollBar=ScrollBar;', context);
const controllerSource = fs.readFileSync(path.join(build, 'Controller.js'), 'utf8');
const relationSource = fs.readFileSync(path.join(build, 'Relations.js'), 'utf8');
const relationStart = relationSource.indexOf('    setup(buffer, parentToChild) {');
const relationEnd = relationSource.lastIndexOf('\n}');
if (relationStart < 0 || relationEnd < 0) throw new Error('Cannot locate Relations.setup');
context.RelationItem = class {constructor(){this.definitions=[];} internalAdd(type,percent){this.definitions.push({type,percent});}};
vm.runInContext('class Relations { constructor(owner){this._owner=owner;this._items=[];} ' + relationSource.slice(relationStart,relationEnd) + ' }; this.Relations=Relations;', context);
const controllerBegin = controllerSource.indexOf('    setup(buffer) {');
const controllerEnd = controllerSource.indexOf('    addAction(', controllerBegin);
if (controllerBegin < 0 || controllerEnd < 0) throw new Error('Cannot locate Controller.setup');
vm.runInContext('class Controller { constructor(){this._pageIds=[];this._pageNames=[];this._selectedIndex=-1;} get selectedPageId(){return this._pageIds[this._selectedIndex];} ' + controllerSource.slice(controllerBegin,controllerEnd) + ' }; this.Controller=Controller;', context);
const gearBase = fs.readFileSync(path.join(build, 'gears/GearBase.js'), 'utf8');
const gearDisplay2 = fs.readFileSync(path.join(build, 'gears/GearDisplay2.js'), 'utf8');
const gearFontSize = fs.readFileSync(path.join(build, 'gears/GearFontSize.js'), 'utf8');
const gearDisplay = fs.readFileSync(path.join(build, 'gears/GearDisplay.js'), 'utf8');
const gearText = fs.readFileSync(path.join(build, 'gears/GearText.js'), 'utf8');
const gearAnimation = fs.readFileSync(path.join(build, 'gears/GearAnimation.js'), 'utf8');
const gearIcon = fs.readFileSync(path.join(build, 'gears/GearIcon.js'), 'utf8');
const gearXY = fs.readFileSync(path.join(build, 'gears/GearXY.js'), 'utf8');
const gearSize = fs.readFileSync(path.join(build, 'gears/GearSize.js'), 'utf8');
const gearLook = fs.readFileSync(path.join(build, 'gears/GearLook.js'), 'utf8');
const gearColor = fs.readFileSync(path.join(build, 'gears/GearColor.js'), 'utf8');
const gearStart = gearBase.indexOf('    setup(buffer) {');
const gearEnd = gearBase.indexOf('    updateFromRelations(', gearStart);
const displayStart = gearDisplay.indexOf('    init() {');
const displayEnd = gearDisplay.lastIndexOf('\n}');
if ([gearStart, gearEnd, displayStart, displayEnd].some(n => n < 0)) throw new Error('Cannot locate gear readers');
vm.runInContext('class GearBase { constructor(owner){this._owner=owner;} ' + gearBase.slice(gearStart,gearEnd) + ' }; class GearDisplay extends GearBase { constructor(owner){super(owner);this.pages=null;this._visible=0;this._displayLockToken=1;} ' + gearDisplay.slice(displayStart,displayEnd) + ' }; ' + gearDisplay2.replace(/^import .*;\s*$/gm,'').replace('export class GearDisplay2', 'class GearDisplay2') + '; ' + gearFontSize.replace(/^import .*;\s*$/gm,'').replace('export class GearFontSize', 'class GearFontSize') + '; ' + gearText.replace(/^import .*;\s*$/gm,'').replace('export class GearText', 'class GearText') + '; ' + gearAnimation.replace(/^import .*;\s*$/gm,'').replace('export class GearAnimation', 'class GearAnimation') + '; ' + gearIcon.replace(/^import .*;\s*$/gm,'').replace('export class GearIcon', 'class GearIcon') + '; ' + gearXY.replace(/^import .*;\s*$/gm,'').replace('export class GearXY', 'class GearXY') + '; ' + gearSize.replace(/^import .*;\s*$/gm,'').replace('export class GearSize', 'class GearSize') + '; ' + gearLook.replace(/^import .*;\s*$/gm,'').replace('export class GearLook', 'class GearLook') + '; ' + gearColor.replace(/^import .*;\s*$/gm,'').replace('export class GearColor', 'class GearColor') + '; this.GearDisplay=GearDisplay; this.GearDisplay2=GearDisplay2; this.GearFontSize=GearFontSize; this.GearText=GearText; this.GearIcon=GearIcon; this.GearAnimation=GearAnimation; this.GearXY=GearXY; this.GearSize=GearSize; this.GearLook=GearLook; this.GearColor=GearColor;', context);
const cstart = componentSource.indexOf('    constructFromResource2(objectPool, poolIndex) {');
const cend = componentSource.indexOf('    constructExtension(', cstart);
if (cstart < 0 || cend < 0) throw new Error('Cannot locate Cocos GComponent.constructFromResource2');
vm.runInContext('class Component { ' + componentSource.slice(cstart,cend) + ' }; this.Component=Component;', context);
const objectSource = fs.readFileSync(path.join(build, 'GObject.js'), 'utf8');
const ob = objectSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const oe = objectSource.indexOf('    onRollOver()', ob);
const imageSource = fs.readFileSync(path.join(build, 'GImage.js'), 'utf8');
const ib = imageSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const ie = imageSource.indexOf('\n}', ib);
const textSource = fs.readFileSync(path.join(build, 'GTextField.js'), 'utf8');
const tb = textSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const te = textSource.indexOf('\n}', tb);
const graphSource = fs.readFileSync(path.join(build, 'GGraph.js'), 'utf8');
const gb = graphSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const ge = graphSource.indexOf('\n}', gb);
const cab = componentSource.indexOf('    setup_afterAdd(buffer, beginPos) {', cend);
const cae = componentSource.indexOf('    onEnable()', cab);
if (ob < 0 || oe < 0 || ib < 0 || ie < 0 || tb < 0 || te < 0 || gb < 0 || ge < 0 || cab < 0 || cae < 0) throw new Error('Cannot locate child readers');
vm.runInContext('class Base { constructor(){this.node={};this._content={};this.visible=true;this.touchable=true;this.relations=new Relations(this);} on(){} get parent(){return this._parent;} get id(){return this._id;} getGear(index){if(index===0)return this.gear=new GearDisplay(this);if(index===1)return this.xyGear=new GearXY(this);if(index===2)return this.sizeGear=new GearSize(this);if(index===3)return this.lookGear=new GearLook(this);if(index===4)return this.colorGear=new GearColor(this);if(index===5)return this.animationGear=new GearAnimation(this);if(index===6)return this.textGear=new GearText(this);if(index===7)return this.iconGear=new GearIcon(this);if(index===8)return this.display2Gear=new GearDisplay2(this);if(index===9)return this.fontSizeGear=new GearFontSize(this);throw Error("gear");} getProp(id){return (this.props||{})[id];} setProp(id,value){(this.props||(this.props={}))[id]=value;} checkGearController(){return false;} setPosition(x,y){this.x=x;this.y=y;} setSize(w,h){this.width=w;this.height=h;} setScale(x,y){this.scaleX=x;this.scaleY=y;} setPivot(x,y,a){this.pivot=[x,y,a];} constructFromResource(){} ' + objectSource.slice(ob,oe) + ' }; class Child extends Base { ' + imageSource.slice(ib,ie) + ' }; class TextChild extends Base { ' + textSource.slice(tb,te) + ' }; class GraphChild extends Base { constructor(){super();this._lineColor={set(v){Object.assign(this,v);}};this._fillColor={set(v){Object.assign(this,v);}};} updateGraph(){} ' + graphSource.slice(gb,ge) + ' }; class NestedChild extends Base { ' + componentSource.slice(cab,cae) + ' }; this.Base=Base; this.Child=Child; this.TextChild=TextChild; this.GraphChild=GraphChild; this.NestedChild=NestedChild;', context);
const loaderSource = fs.readFileSync(path.join(build, 'GLoader.js'), 'utf8');
const lb = loaderSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const le = loaderSource.indexOf('\n}', lb);
if (lb < 0 || le < 0) throw new Error('Cannot locate loader reader');
vm.runInContext('class LoaderChild extends Base { loadContent(){this.loadedUrl=this._url;} ' + loaderSource.slice(lb, le) + ' }; this.LoaderChild=LoaderChild;', context);
const textInputSource = fs.readFileSync(path.join(build, 'GTextInput.js'), 'utf8');
const inputBegin = textInputSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const inputEnd = textInputSource.indexOf('\n}', inputBegin);
if (inputBegin < 0 || inputEnd < 0) throw new Error('Cannot locate text input reader');
vm.runInContext('class InputChild extends TextChild { constructor(){super();this._editBox={placeholderLabel:null};} ' + textInputSource.slice(inputBegin,inputEnd) + ' }; this.InputChild=InputChild;', context);
const movieChildSource = fs.readFileSync(path.join(build, 'GMovieClip.js'), 'utf8');
const movieChildBegin = movieChildSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const movieChildEnd = movieChildSource.indexOf('\n}', movieChildBegin);
if (movieChildBegin < 0 || movieChildEnd < 0) throw new Error('Cannot locate movieclip child reader');
vm.runInContext('class MovieChild extends Base { ' + movieChildSource.slice(movieChildBegin, movieChildEnd) + ' }; this.MovieChild=MovieChild;', context);
const groupSource = fs.readFileSync(path.join(build, 'GGroup.js'), 'utf8');
const grpBegin = groupSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const grpEnd = groupSource.indexOf('    setup_afterAdd(buffer, beginPos) {', grpBegin);
if (grpBegin < 0 || grpEnd < 0) throw new Error('Cannot locate group reader');
vm.runInContext('class GroupChild extends Base { ' + groupSource.slice(grpBegin, grpEnd) + ' }; this.GroupChild=GroupChild;', context);
const listSource = fs.readFileSync(path.join(build, 'GList.js'), 'utf8');
const listBegin = listSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const listEnd = listSource.indexOf('    readItems(buffer) {', listBegin);
const listAfter = listSource.indexOf('    setup_afterAdd(buffer, beginPos) {', listEnd);
const listAfterEnd = listSource.indexOf('\n}', listAfter);
if ([listBegin,listEnd,listAfter,listAfterEnd].some(x=>x<0)) throw new Error('Cannot locate list reader');
vm.runInContext('class ListChild extends NestedChild { constructor(){super();this._margin={};} setupOverflow(v){this.overflow=v;} setupScroll(b){this.scroll={type:b.readByte(),barDisplay:b.readByte(),flags:b.readInt()};if(b.readBool())this.scroll.margin=[b.readInt(),b.readInt(),b.readInt(),b.readInt()];this.scroll.resources=[b.readS(),b.readS(),b.readS(),b.readS()];} readItems(b){this.items=[];let n=b.readShort();for(let i=0;i<n;i++){let end=b.position+b.readShort();end+=2;this.items.push([b.readS(),b.readS(),b.readS(),b.readS(),b.readS(),b.readS()]);b.position=end;}} ' + listSource.slice(listBegin,listEnd) + listSource.slice(listAfter,listAfterEnd) + ' }; this.ListChild=ListChild;', context);
const treeSource = fs.readFileSync(path.join(build, 'GTree.js'), 'utf8');
const treeBegin = treeSource.indexOf('    setup_beforeAdd(buffer, beginPos) {');
const treeEnd = treeSource.indexOf('\n}', treeBegin);
if (treeBegin < 0 || treeEnd < 0) throw new Error('Cannot locate tree reader');
context.GTreeNode = class {constructor(folder,url){this.folder=folder;this.url=url;this.cell={};this.children=[];} addChild(child){child.parent=this;this.children.push(child);}};
vm.runInContext('class TreeChild extends ListChild { constructor(){super();this._rootNode=new GTreeNode(true,null);} get defaultItem(){return this._defaultItem;} setupItem(b,obj){obj.title=b.readS();obj.selectedTitle=b.readS();obj.icon=b.readS();obj.selectedIcon=b.readS();obj.name=b.readS();let n=b.readShort();for(let i=0;i<n;i++){b.readS();b.readS();}if(b.version>=2){n=b.readShort();for(let i=0;i<n;i++){b.readS();b.readShort();b.readS();}}} ' + treeSource.slice(treeBegin,treeEnd) + ' }; this.TreeChild=TreeChild;', context);
const comboAfter = comboSource.indexOf('    setup_afterAdd(buffer, beginPos) {', comboEnd);
const comboAfterEnd = comboSource.indexOf('    showDropdown()', comboAfter);
if (comboAfter < 0 || comboAfterEnd < 0) throw new Error('Cannot locate combobox instance reader');
vm.runInContext('class NestedCombo extends NestedChild { constructor(){super();this._items=[];this._values=[];} ' + comboSource.slice(comboAfter,comboAfterEnd) + ' }; this.NestedCombo=NestedCombo;', context);
const buttonAfter = buttonSource.indexOf('    setup_afterAdd(buffer, beginPos) {', buttonEnd);
const buttonAfterEnd = buttonSource.indexOf('    onRollOver_1(', buttonAfter);
if (buttonAfter < 0 || buttonAfterEnd < 0) throw new Error('Cannot locate button instance reader');
vm.runInContext('class NestedButton extends NestedChild { ' + buttonSource.slice(buttonAfter, buttonAfterEnd) + ' }; this.NestedButton=NestedButton;', context);
if (progressAfter < 0 || progressClassEnd < 0) throw new Error('Cannot locate GProgressBar.setup_afterAdd');
vm.runInContext('class NestedProgress extends NestedChild { update(value){this.updated=value;} ' + progressSource.slice(progressAfter, progressClassEnd) + ' }; this.NestedProgress=NestedProgress;', context);
if (labelAfter < 0 || labelAfterEnd < 0) throw new Error('Cannot locate GLabel.setup_afterAdd');
vm.runInContext('class NestedLabel extends NestedChild { ' + labelSource.slice(labelAfter, labelAfterEnd) + ' }; this.NestedLabel=NestedLabel;', context);
if (sliderAfter < 0 || sliderAfterEnd < 0) throw new Error('Cannot locate GSlider.setup_afterAdd');
vm.runInContext('class NestedSlider extends NestedChild { update(){this.updated=this._value;} ' + sliderSource.slice(sliderAfter, sliderAfterEnd) + ' }; this.NestedSlider=NestedSlider;', context);
context.Decls.UIObjectFactory.newObject = arg => {
    if (arg === 6 || arg === 7) return new context.TextChild();
    if (arg === 8) return new context.InputChild();
    if (arg === 4) return new context.LoaderChild();
    if (arg === 5) return new context.GroupChild();
    if (arg === 10) return new context.ListChild();
    if (arg === 17) return new context.TreeChild();
    if (arg === 3) return new context.GraphChild();
    if (arg && arg.type === 1) {const c = new context.MovieChild(); c.packageItem = arg; return c;}
    if (arg && arg.type === 3) {
        const child = arg.objectType === 13 ? new context.NestedCombo() : arg.objectType === 12 ? new context.NestedButton() : arg.objectType === 11 ? new context.NestedLabel() : arg.objectType === 14 ? new context.NestedProgress() : arg.objectType === 15 ? new context.NestedSlider() : new context.NestedChild();
        Object.assign(child, {packageItem:arg, _margin:{}, _controllers:[], _children:[], _transitions:[],
            setupOverflow(v){this.overflow=v;}, setMask(child,reversed){this.maskInfo=[child.name,reversed];}, setupScroll(b){this.scroll={type:b.readByte(),barDisplay:b.readByte(),flags:b.readInt()};if(b.readBool())this.scroll.barMargin=[b.readInt(),b.readInt(),b.readInt(),b.readInt()];this.scroll.resources=[b.readS(),b.readS(),b.readS(),b.readS()];}, setPivot(x,y,anchor){this.pivot=[x,y,anchor];}, getControllerAt(i){return this._controllers[i];}, getChildAt(i){return this._children[i];}, applyAllControllers(){}, buildNativeDisplayList(){}, setBoundsChangedFlag(){}, onConstruct(){}, constructExtension(){},
            constructFromResource(){context.Component.prototype.constructFromResource2.call(this,null,0);}});
        return child;
    }
    return new context.Child();
};
const movieStart = packageSource.indexOf('    loadMovieClip(item) {');
const movieEnd = packageSource.indexOf('    loadFont(item) {', movieStart);
if (movieStart < 0 || movieEnd < 0) throw new Error('Cannot locate movieclip reader');
vm.runInContext('class MovieClipDecoder { ' + packageSource.slice(movieStart, movieEnd) + ' }; this.MovieClipDecoder=MovieClipDecoder;', context);
pkg.getItemAsset = () => ({});
for (const item of pkg._items.filter(i => i.type === 1)) context.MovieClipDecoder.prototype.loadMovieClip.call(pkg, item);
context.GComponent = context.Component;
context.GList = class {on(){} addRelation(){} removeRelation(){}};
context.RelationType = {Width:14,Height:15};
context.UIPackage = {getById(id){return loadedPackages.get(id);},createObjectFromURL(url){const item=new context.Component();Object.assign(item,{url,on(){},addRelation(){},removeRelation(){},getChild(){return new context.GList();}});return item;}};
const fontStart = packageSource.indexOf('    loadFont(item) {');
const fontEnd = packageSource.indexOf('    loadFontAsync(', fontStart);
if (fontStart < 0 || fontEnd < 0) throw new Error('Cannot locate font reader');
vm.runInContext('class FontDecoder { ' + packageSource.slice(fontStart,fontEnd) + ' }; this.FontDecoder=FontDecoder;', context);
for (const item of pkg._items.filter(i => i.type === 5)) context.FontDecoder.prototype.loadFont.call(pkg, item);
const constructed = [];
for (const item of pkg._items.filter(i => i.type === 3)) {
    const comp = new context.Component();
    Object.assign(comp, {packageItem:item, _margin:{}, _controllers:[], _children:[], _transitions:[],
        relations:{setup(buffer){if(buffer.readByte() !== 0) throw new Error('nonempty relations unsupported by harness');}},
        _node:{on(){}}, on(){}, setState(s){this.initialState=s;}, getController(n){return this._controllers.find(c=>c.name===n);}, getChild(n){return this._children.find(c=>c.name===n);},
        setSize(w,h){this.width=w;this.height=h;}, setupOverflow(v){this.overflow=v;}, setMask(child,reversed){this.maskInfo=[child.name,reversed];}, setupScroll(b){this.scroll={type:b.readByte(),barDisplay:b.readByte(),flags:b.readInt()};if(b.readBool())this.scroll.barMargin=[b.readInt(),b.readInt(),b.readInt(),b.readInt()];this.scroll.resources=[b.readS(),b.readS(),b.readS(),b.readS()];}, setPivot(x,y,anchor){this.pivot=[x,y,anchor];}, getControllerAt(i){return this._controllers[i];}, getChildAt(i){return this._children[i];}, applyAllControllers(){},
        buildNativeDisplayList(){}, setBoundsChangedFlag(){}, onConstruct(){}, constructExtension(buffer){(item.objectType===13 ? context.ComboBox : item.objectType===16 ? context.ScrollBar : item.objectType===11 ? context.Label : item.objectType===14 ? context.ProgressBar : item.objectType===15 ? context.Slider : context.Button).prototype.constructExtension.call(this,buffer);}});
    comp.relations = new context.Relations(comp);
    comp.constructFromResource2(null,0);
    for (const c of comp._controllers) if(c._actions) { c.actionRuns=[]; for(const a of c._actions) a.run({parent:{getTransition(name){return {play(_callback,times,delay){c.actionRuns.push({name,times,delay});}};}}}, a.fromPage[0], a.toPage[0]); }
    for (const child of comp._children) {
        if (child.gear) {child.gear._controller._selectedIndex=0; child.gear.apply(); child.gearVisibleInitial=child.gear.connected; child.gear._controller._selectedIndex=1; child.gear.apply(); child.gearVisibleSecond=child.gear.connected;}
        if (child.display2Gear) {child.display2Gear._controller._selectedIndex=0;child.display2Gear.apply();child.display2Initial=[child.display2Gear.evaluate(true),child.display2Gear.evaluate(false)];child.display2Gear._controller._selectedIndex=1;child.display2Gear.apply();child.display2Second=[child.display2Gear.evaluate(true),child.display2Gear.evaluate(false)];}
        if (child.fontSizeGear) {child.fontSizeGear._controller._selectedIndex=0;child.fontSizeGear.apply();child.fontSizeInitial=child.getProp(8);child.fontSizeGear._controller._selectedIndex=1;child.fontSizeGear.apply();child.fontSizeSecond=child.getProp(8);}
        if (child.animationGear) {child.animationGear._controller._selectedIndex=0;child.animationGear.apply();child.animationInitial=[child.getProp(4),child.getProp(5)];child.animationGear._controller._selectedIndex=1;child.animationGear.apply();child.animationSecond=[child.getProp(4),child.getProp(5)];}
        if (child.iconGear) {child.iconGear._controller._selectedIndex=0; child.iconGear.apply(); child.iconInitial=child.icon; child.iconGear._controller._selectedIndex=1; child.iconGear.apply(); child.iconSecond=child.icon;}
        if (child.textGear) {child.textGear._controller._selectedIndex=0; child.textGear.apply(); child.textInitial=child.text; child.textGear._controller._selectedIndex=1; child.textGear.apply(); child.textSecond=child.text;}
        if (child.xyGear) {child.xyGear._controller._selectedIndex=0; child.xyGear.apply(); child.xyInitial=[child.x,child.y]; child.xyGear._controller._selectedIndex=1; child.xyGear.apply(); child.xySecond=[child.x,child.y];}
        if (child.sizeGear) {child.sizeGear._controller._selectedIndex=0; child.sizeGear.apply(); child.sizeInitial=[child.width,child.height,child.scaleX,child.scaleY]; child.sizeGear._controller._selectedIndex=1; child.sizeGear.apply(); child.sizeSecond=[child.width,child.height,child.scaleX,child.scaleY];}
        if (child.colorGear) {child.colorGear._controller._selectedIndex=0; child.colorGear.apply(); child.colorInitial=child.props[2]; child.colorGear._controller._selectedIndex=1; child.colorGear.apply(); child.colorSecond=child.props[2];}
        if (child.lookGear) {child.lookGear._controller._selectedIndex=0; child.lookGear.apply(); child.lookInitial=[child.alpha,child.rotation,child.grayed,child.touchable]; child.lookGear._controller._selectedIndex=1; child.lookGear.apply(); child.lookSecond=[child.alpha,child.rotation,child.grayed,child.touchable];}
        child.relationSummary = child.relations._items.map(r=>({target: r.target===comp ? 'parent' : r.target?._id, definitions:r.definitions}));
    }
    constructed.push({id:item.id,width:comp.width,height:comp.height,pivot:comp.pivot,overflow:comp.overflow,opaque:comp.opaque,maskInfo:comp.maskInfo,hitChild:(comp.hitArea?.child||comp.hitArea?._child)?.name,hitSamples:comp.hitArea?.constructor?.name==="PixelHitTest"?[comp.hitArea.hitTest({x:0,y:0}),comp.hitArea.hitTest({x:1,y:0})]:undefined,scroll:comp.scroll,margin:comp._margin,buttonMode:comp._mode,buttonSound:comp._sound,buttonVolume:comp._soundVolumeScale,buttonEffect:comp._downEffect,buttonEffectValue:comp._downEffectValue,comboDropdown:comp.dropdown?.url,scrollBarFixedGrip:comp._fixedGripSize,scrollBarGrip:comp._grip?.name,scrollBarBar:comp._bar?.name,progressTitle:comp._titleType,progressReverse:comp._reverse,relations:comp.relations._items.map(r=>({target:r.target?._id,definitions:r.definitions})),transitions:comp._transitions.map(t=>({name:t.name,options:t._options,autoPlay:t._autoPlay,autoPlayTimes:t._autoPlayTimes,items:t._items.map(i=>({type:i.type,time:i.time,target:i.targetId,value:i.value,tween:i.tweenConfig}))})),controllers:comp._controllers.map(c=>({name:c.name,ids:c._pageIds,names:c._pageNames,selected:c._selectedIndex,...(c._actions?{actions:c._actions.map(a=>({from:a.fromPage,to:a.toPage,transition:a.transitionName,times:a.playTimes,delay:a.delay,stopOnExit:a.stopOnExit})),actionRuns:c.actionRuns}:{})})),children:comp._children.map(c=>({id:c._id,name:c.name,resolvedItemId:c.packageItem?.id,resolvedPackageId:c.packageItem?.owner?._id,x:c.x,y:c.y,pivot:c.pivot,grayed:c.grayed,comboItems:c._items,comboValues:c._values,comboIcons:c._icons,comboVisibleCount:c._visibleItemCount,comboSelectedIndex:c._selectedIndex,labelTitle:c.title,labelIcon:c.icon,buttonSelectedTitle:c.selectedTitle,buttonSelectedIcon:c.selectedIcon,buttonChecked:c.selected,buttonRelatedController:c._relatedController?.name,buttonRelatedPage:c._relatedPageId,labelColor:c.titleColor,labelFontSize:c.titleFontSize,progressValue:c._value,progressMax:c._max,progressMin:c._min,width:c.width,height:c.height,scaleX:c.scaleX,scaleY:c.scaleY,alpha:c.alpha,rotation:c.rotation,visible:c.visible,touchable:c.touchable,text:c.text,fontSize:c.fontSize,color:c.color,font:c.font,align:c.align,verticalAlign:c.verticalAlign,leading:c.leading,letterSpacing:c.letterSpacing,autoSize:c.autoSize,underline:c.underline,italic:c.italic,bold:c.bold,singleLine:c.singleLine,inputPrompt:c.promptText,inputRestrict:c.restrict,inputMaxLength:c.maxLength,inputPassword:c.password,treeIndent:c._indent,treeClick:c._clickToExpand,treeNodes:c._rootNode?.children.map(n=>({title:n.cell.title,folder:n.folder,children:n.children.map(x=>({title:x.cell.title,folder:x.folder}))})),listLayout:c._layout,listDefaultItem:c._defaultItem,listItems:c.items,listScroll:c.scroll,listSelection:c._selectionController?.name,group:c.group?._id,groupLayout:c._layout,groupLineGap:c._lineGap,groupColumnGap:c._columnGap,ubb:c._ubbEnabled,minWidth:c.minWidth,maxWidth:c.maxWidth,minHeight:c.minHeight,maxHeight:c.maxHeight,loaderUrl:c._url,loaderAlign:c._align,loaderVerticalAlign:c._verticalAlign,loaderFill:c._fill,loaderPlaying:c._playing,loaderFrame:c._frame,loadedUrl:c.loadedUrl,stroke:c.stroke,strokeColor:c.strokeColor,shadowColor:c.shadowColor,shadowOffset:c.shadowOffset,graphType:c._type,graphCorners:c._cornerRadius,graphPoints:c._polygonPoints,graphSides:c._sides,graphStartAngle:c._startAngle,graphDistances:c._distances,lineSize:c._lineSize,lineColor:c._lineColor,fillColor:c._fillColor,flip:c._content?.flip,fillMethod:c._content?.fillMethod,fillOrigin:c._content?.fillOrigin,fillClockwise:c._content?.fillClockwise,fillAmount:c._content?.fillAmount,movieFrame:c._content?.frame,moviePlaying:c._content?.playing,gearPages:c.gear?.pages,gearVisibleInitial:c.gearVisibleInitial,gearVisibleSecond:c.gearVisibleSecond,textInitial:c.textInitial,textSecond:c.textSecond,iconInitial:c.iconInitial,iconSecond:c.iconSecond,animationInitial:c.animationInitial,animationSecond:c.animationSecond,display2Initial:c.display2Initial,display2Second:c.display2Second,fontSizeInitial:c.fontSizeInitial,fontSizeSecond:c.fontSizeSecond,xyInitial:c.xyInitial,xySecond:c.xySecond,xyTween:c.xyGear?._tweenConfig,sizeInitial:c.sizeInitial,sizeSecond:c.sizeSecond,lookInitial:c.lookInitial,lookSecond:c.lookSecond,colorInitial:c.colorInitial,colorSecond:c.colorSecond,relations:c.relationSummary}))});
}
const sprites = Object.fromEntries(Object.entries(pkg._sprites).map(([id,s]) => [id, {atlas:s.atlas?.id, rect:s.rect, rotated:s.rotated, offset:s.offset, originalSize:s.originalSize}]));
console.log(JSON.stringify({id:pkg._id, name:pkg._name, dependencies:pkg._dependencies, items:pkg._items.map(i=>({id:i.id,name:i.name,type:i.type,width:i.width,height:i.height,file:i.file,interval:i.interval,swing:i.swing,repeatDelay:i.repeatDelay,fontSize:i.asset?.fontSize,fontConfig:i.asset?.fntConfig,frames:i.frames?.map(f=>({rect:f.rect,delay:f.addDelay,textureRect:f.texture?.rect})),scale9Grid:i.scale9Grid,scaleByTile:i.scaleByTile})), sprites, constructed}));
