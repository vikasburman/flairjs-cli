/**
 * <<title>>
 *  Version <<version>>
 *  <<lupdate>>
 * 
 * <<copyright>>
 * <<license>>
 */
(async () => {
'use strict';

// #region --------------- KEYWORDS : START --------------------- //
// const { // TODO: revisit and update
//     _,
//     Class, Interface, Mixin, Struct, Enum,
//     AppDomain, Aspects, Reflector, Serializer, Tasks, Container, Port,
//     Args, noop, nip, nim, nie, 
//     InjectedArg, TaskInfo, Exception, Event,
//     using, ns, bring, include, on, post, telemetry, as, is, typeOf, dispose,
//     isDefined, isComplies, isDerivedFrom, isAbstract, isSealed, isStatic, isSingleton, isDeprecated, isImplements, isInstanceOf, isMixed, 
//     getAssembly, getAttr, getContext, getResource, getRoute, getType, getTypeOf, getTypeName, getComponent,
// } = flair;

// data sharing across helpers/tests
let _isServer = new Function("try {return this===global;}catch(e){return false;}")();
const context = (_isServer ? global : window).flairTest;
// #endregion ------------ KEYWORDS : END ----------------------- //

<<specs>>
})();
