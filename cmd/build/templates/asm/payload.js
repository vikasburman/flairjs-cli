// ----------------- //
// I N I T I L I Z E //
// ----------------- //

/* eslint-disable no-unused-vars */

// flair components
const { 
    ComponentRegistry, env, info, 
    Class, Interface, Mixin, Struct, Enum,
    AppDomain, Aspects, Reflector, Serializer, Tasks, Container, Port,
    $$, Args, noop, nip, nim, nie, 
    InjectedArg, TaskInfo, Exception, Event,
    using, ns, bring, include, on, post, telemetry, as, is, typeOf, dispose, 
    isDefined, isComplies, isDerivedFrom, isAbstract, isSealed, isStatic, isSingleton, isDeprecated, isImplements, isInstanceOf, isMixed, 
    getAssembly, getAttr, getContext, getResource, getRoute, getType, getTypeOf, getTypeName, getComponent
} = flair;
const { 
    globalSetting,
    guid, which, 
    stuff, replaceAll, splitAndTrim, 
    sieve, lens, 
    findIndexByProp, findItemByProp, 
    isArrow, isASync, 
    deepMerge, 
    getLoadedScript, 
    b64EncodeUnicode, b64DecodeUnicode 
} = flair;

// local (assembly level) component registry
const Component = new ComponentRegistry('<<asm>>');

// current for this assembly
const __currentContextName = AppDomain.context.current().name;
const __currentFile = __asmFile;
const __currentPath = __currentFile.substr(0, __currentFile.lastIndexOf('/') + 1);
AppDomain.loadPathOf('<<asm>>', __currentPath);

// settings of this assembly
let settings = JSON.parse('<<settings>>');
let settingsReader = Port('settingsReader');
if (typeof settingsReader === 'function') {
    let externalSettings = settingsReader('<<asm>>');
    if (externalSettings) { settings = deepMerge([settings, externalSettings], false); }
}
settings = Object.freeze(settings);

// config of this assembly
let config = JSON.parse('<<config>>');
config = Object.freeze(config);

// set assembly being loaded
AppDomain.context.current().currentAssemblyBeingLoaded('<<which_file>>');

/* eslint-enable no-unused-vars */

// ------------------- //
// C O M P O N E N T S //
// ------------------- //

<<asm_components>>

// freeze registry, so no more components can be registered
Component.freeze();

// ----------------- //
// F U N C T I O N S //
// ----------------- //

<<asm_functions>>

// --------- //
// T Y P E S //
// --------- //

<<asm_types>>

// ----------------- //
// R E S O U R C E S //
// ----------------- //

<<asm_resources>>

// ----------------------- //
// H O U S E K E E P I N G //
// ----------------------- //

// register assembly definition object
AppDomain.registerADO('<<ado>>');

// clear assembly being loaded
AppDomain.context.current().currentAssemblyBeingLoaded('', (typeof onLoadComplete === 'function' ? onLoadComplete : null)); // eslint-disable-line no-undef

// return settings, config and Component
return Object.freeze({
    name: '<<asm>>',
    Component: Component,
    settings: settings,
    config: config
});