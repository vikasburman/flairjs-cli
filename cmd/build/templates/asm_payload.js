// assembly closure: init (start)
/* eslint-disable no-unused-vars */

// flair types, variables and functions
const { Class, Struct, Enum, Interface, Mixin, Aspects, AppDomain, $$, attr, bring, Container, include, Port, on, post, telemetry,
        Reflector, Serializer, Tasks, as, is, isDefined, isComplies, isDerivedFrom, isAbstract, isSealed, isStatic, isSingleton, isDeprecated,
        isImplements, isInstanceOf, isMixed, getAssembly, getAttr, getContext, getResource, getRoute, getType, ns, getTypeOf,
        getTypeName, typeOf, dispose, using, Args, Exception, noop, nip, nim, nie, event } = flair;
const { TaskInfo } = flair.Tasks;
const { env } = flair.options;
const { guid, stuff, replaceAll, splitAndTrim, findIndexByProp, findItemByProp, which, isArrowFunc, isASyncFunc, sieve,
        deepMerge, getLoadedScript, b64EncodeUnicode, b64DecodeUnicode, lens, globalSetting } = flair.utils;

// access to DOC
const DOC = ((env.isServer || env.isWorker) ? null : window.document);

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

/* eslint-enable no-unused-vars */
// assembly closure: init (end)

// assembly closure: global functions (start)
<<asm_functions>>
// assembly closure: global functions (end)

// set assembly being loaded
AppDomain.context.current().currentAssemblyBeingLoaded('<<which_file>>');

// assembly closure: types (start)
<<asm_types>>
// assembly closure: types (end)

// assembly closure: embedded resources (start)
<<asm_resources>>
// assembly closure: embedded resources (end)        

// clear assembly being loaded
AppDomain.context.current().currentAssemblyBeingLoaded('', onLoadComplete);

// register assembly definition object
AppDomain.registerAdo('<<ado>>');

// return settings and config
return Object.freeze({
    name: '<<asm>>',
    settings: settings,
    config: config
});