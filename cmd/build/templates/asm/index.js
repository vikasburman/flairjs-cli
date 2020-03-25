/**
 * @ignore
 * @preserve
 * <<title>>
 * <<desc>>
 * 
 * Assembly: <<asm>>
 *     File: <<file>>
 *  Version: <<version>>
 *  <<lupdate>>
 * 
 * <<copyright>>
 * <<license>>
 */
flair(async function() {
'use strict';

/* eslint-disable no-unused-vars */

// #region --------------- 1 : KEYWORDS : START --------------------- //
const { // TODO: revisit and update
    _,
    Class, Interface, Mixin, Struct, Enum,
    AppDomain, Aspects, Reflector, Serializer, Tasks, Container, Port,
    Args, noop, nip, nim, nie, 
    InjectedArg, TaskInfo, Exception, Event,
    using, ns, bring, include, on, post, telemetry, as, is, typeOf, dispose,
    isDefined, isComplies, isDerivedFrom, isAbstract, isSealed, isStatic, isSingleton, isDeprecated, isImplements, isInstanceOf, isMixed, 
    getAssembly, getAttr, getContext, getResource, getRoute, getType, getTypeOf, getTypeName, getComponent,
} = flair;
const settings = _.gs('<<settings>>');
const config = _.gc('<<asm>>', '<<config>>');
const __internal = '<<internal_id>>';
const Component = _.gr('<<asm>>');
// #endregion ------------ 1 : KEYWORDS : END ----------------------- //

// #region --------------- 2 : INJECTIONS : START ----------------------- //
(()=> {
/* eslint-disable */
<<injections>>
/* eslint-enable */
})();
// #endregion ------------ 2 : INJECTIONS : END ------------------------- //

// #region --------------- 3 : GLOBALS : START ---------------------- //
<<globals>>
// #endregion ------------ 3 : GLOBALS : END ------------------------ //

// #region --------------- 4 : LOAD : START ------------------------- //
_.bl('<<asm>>', (env.isServer ? (env.isWorker ? __filename : __fileName) : (env.isWorker ? globalThis.location.href : env.DOC.currentScript.src)), typeof beforeLoad === 'function' ? beforeLoad : null); // eslint-disable-line no-undef

// #region --------------- 4.1 : COMPONENTS : START ----------------- //
<<components>>
// #endregion ------------ 4.1 : COMPONENTS : END ------------------- //

// #region --------------- 4.2 : RESOURCES : START ------------------ //
<<resources>>
// #endregion ------------ 4.2 : RESOURCES : END -------------------- //    

// #region --------------- 4.3 : TYPES : START ---------------------- //
<<types>>
// #endregion ------------ 4.3 : TYPES : END ------------------------ //

const asm = _.al('<<asm>>', {settings: settings, config: config, Component: Component, ADO: '<<ado>>'}, typeof afterLoad === 'function' ? afterLoad : null); // eslint-disable-line no-undef
// #endregion ------------ 4 : LOAD : END --------------------------- //

/* eslint-enable no-unused-vars */

// return assembly
return asm;
});
