/**
 * @name AssemblyLoadContext
 * @description The isolation boundary of type loading across assemblies. 
 */
const AssemblyLoadContext = function(name, domain, defaultLoadContext, currentContexts, contexts) {
    let alcTypes = {},
        alcResources = {},
        alcRoutes = {},
        instances = {},
        asmFiles = {},
        asmNames = {},
        namespaces = {},
        isUnloaded = false,
        currentAssemblyBeingLoaded = '';

    // context
    this.name = name;
    this.domain = domain;
    this.isUnloaded = () => { return isUnloaded || domain.isUnloaded(); };
    this.unload = () => {
        if (!isUnloaded) {
            // mark unloaded
            isUnloaded = true;

            // delete from domain registry
            delete contexts[name];

            // dispose all active instances
            for(let instance in instances) {
                if (instance.hasOwnProperty(instance)) {
                    _dispose(instances[instance]);
                }
            }

            // clear registries
            alcTypes = {};
            asmFiles = {};
            asmNames = {};
            alcResources = {};
            alcRoutes = {};
            instances = {};
            namespaces = {};
        }
    };
    this.current = () => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.current); }

        if (currentContexts.length === 0) {
            return defaultLoadContext || this; // the first content created is the default context, so in first case, it will come as null, hence return this
        } else { // return last added context
            // when a context load any assembly, it pushes itself to this list, so
            // that context become current context and all loading types will attach itself to this
            // new context, and as soon as load is completed, it removes itself.
            // Now, if for some reason, an assembly load operation itself (via some code in index.js)
            // initiate another context load operation, that will push itself on top of this context and
            // it will trickle back to this context when that secondary load is done
            // so always return from here the last added context in list
            return currentContexts[currentContexts.length - 1];
        }
    };

     // types
    this.registerType = (Type) => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.registerType); }

        // certain types are built as instances, like interface and enum
        let name = '',
            type = '',
            typeMeta = Type[meta];
        if (typeMeta.Type) {
            name = typeMeta.Type[meta].name;
            type = typeMeta.Type[meta].type;
        } else {
            name = typeMeta.name;
            type = typeMeta.type;
        }

        // only valid types are allowed
        if (flairTypes.indexOf(type) === -1) { throw _Exception.InvalidArgument('Type', this.registerType); }

        // namespace name is already attached to it, and for all '(root)' 
        // marked types' no namespace is added, so it will automatically go to root
        let ns = name.substr(0, name.lastIndexOf('.')),
            onlyName = name.replace(ns + '.', '');

        // check if already registered
        if (alcTypes[name]) { throw _Exception.Duplicate(name, this.registerType); }
        if (alcResources[name]) { throw _Exception.Duplicate(`Already registered as Resource. (${name})`, this.registerType); }
        if (alcRoutes[name]) { throw _Exception.Duplicate(`Already registered as Route. (${name})`, this.registerType); }

        // register
        alcTypes[name] = Type;

        // register to namespace as well
        if (ns) {
            if (!namespaces[ns]) { namespaces[ns] = {}; }
            namespaces[ns][onlyName] = Type;
        } else { // root
            namespaces[onlyName] = Type;
        }

        // return namespace where it gets registered
        return ns;
    };
    this.getType = (qualifiedName) => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.getType); }
        if (typeof qualifiedName !== 'string') { throw _Exception.InvalidArgument('qualifiedName', this.getType); }
        return alcTypes[qualifiedName] || null;
    };
    this.ensureType = (qualifiedName) => {
        return new Promise((resolve, reject) => {
            if (this.isUnloaded()) { reject(_Exception.InvalidOperation(`Context is already unloaded. (${this.name})`)); return; }
            if (typeof qualifiedName !== 'string') { reject(_Exception.InvalidArgument('qualifiedName')); return; }
    
            let Type = this.getType(qualifiedName);
            if (!Type) {
                let asmFile = domain.resolve(qualifiedName);
                if (asmFile) { 
                    this.loadAssembly(asmFile).then(() => {
                        Type = this.getType(qualifiedName);
                        if (!Type) {
                            reject(_Exception.OperationFailed(`Assembly could not be loaded. (${asmFile})`));
                        } else {
                            resolve(Type);
                        }
                    }).catch(reject);
                } else {
                    reject(_Exception.NotFound(qualifiedName));
                }
            } else {
                resolve(Type);
            }
        });
    };
    this.allTypes = () => { 
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.allTypes); }
        return Object.keys(alcTypes); 
    };
    this.execute = (info, progressListener) => {
        // NOTE: The logic goes as:
        // 1. instance of given type is created with given constructor arguments
        // 2. if the type implements IProgressReporter and progressListener is passed,
        //    it hooks progressListener to 'progress' event of instance.
        // 3. given function is then executed with given arguments
        // 4. if keepAlive is set to true, it keeps the instance for later use, using info.type as identifier
        //    if in next run, keepAlive is found true, and instance was previously created, it uses same instance
        //    if instance was kept because of previous call of keepAlive, but now in this call keepAlive is set to false
        //    after this execution it is removed from internal stored instances list
        //    if just the instance is to be removed and no func is to be called, set funcName to '' and keepAlive to false
        //    and it will not call function but just remove stored instance

        return new Promise((_resolve, _reject) => {
            if (this.isUnloaded()) { _reject(_Exception.InvalidOperation(`Context is already unloaded. (${this.name})`)); return; }

            // execution info
            info.type = info.type || '';
            info.typeArgs = info.typeArgs || [];
            info.func = info.func || '';
            info.args = info.args || [];
            info.ctx = info.ctx || {};
            info.keepAlive = (typeof info.keepAlive !== 'undefined' ? info.keepAlive : false);
            
            const getInstance = () => {
                return new Promise((resolve, reject) => {
                    let instance = null;
                    this.ensureType(info.type).then((Type) => {
                        try {
                            instance = new Type(...info.typeArgs);

                            // listen to progress report, if need be
                            if (typeof progressListener === 'function' && _is(instance, 'IProgressReporter')) {
                                instance.progress.add(progressListener);
                            }

                            resolve(instance);
                        } catch (err) {
                            reject(err);
                        }
                    }).catch(reject);
                });
            };
            const runInstanceFunc = (instance) => {
                return new Promise((resolve, reject) => {
                    let result = null;
                    result = instance[info.func](...info.args);
                    if (result && typeof result.then === 'function') {
                        result.then(resolve).catch(reject);
                    } else {
                        resolve(result);
                    }                
                });
            };

            // process
            let instance = null;
            if (info.keepAlive) {
                if (instances[info.type]) {
                    instance = instances[info.type];
                    runInstanceFunc(instance).then(_resolve).catch(_reject);
                } else {
                    getInstance().then((obj) => {
                        instance = obj;
                        instances[info.type] = instance;
                        runInstanceFunc(instance).then(_resolve).catch(_reject);
                    }).catch(_reject);
                }
            } else {
                if (instances[info.type]) {
                    instance = instances[info.type];
                    if (info.func) {
                        runInstanceFunc(instance).then(_resolve).catch(_reject).finally(() => {
                            _dispose(instance);
                            delete instances[info.type];
                        });
                    } else { // special request of just removing the instance - by keeping func name as empty
                        _dispose(instance);
                        delete instances[info.type];
                        _resolve();
                    }
                } else {
                    getInstance().then((obj) => {
                        runInstanceFunc(obj).then(_resolve).catch(_reject).finally(() => {
                            _dispose(obj);
                        });
                    }).catch(_reject);                
                }
            }
        });
    };

    // namespace
    this.namespace = (name) => { 
        if (name && name === '(root)') { name = ''; }
        let source = null;
        if (name) {
            source = namespaces[name] || null;
        } else { // root
            source = namespaces;
        }
        if (source) {
            return Object.freeze(shallowCopy({}, source)); // return a freezed copy of the namespace segment
        } else {
            return null;
        }
    };

    // assembly
    this.currentAssemblyBeingLoaded = (value) => {
        // NOTE: called at build time, so no checking is required
        if (typeof value !== 'undefined') { 
            currentAssemblyBeingLoaded = which(value, true); // min/dev contextual pick
        }
        return currentAssemblyBeingLoaded;
    }
    const assemblyLoaded = (file, ado, alc, asmClosureVars) => {
        if (typeof file === 'string' && !asmFiles[file] && ado && alc && asmClosureVars) {
            // add to list
            asmFiles[file] = Object.freeze(new Assembly(ado, alc, asmClosureVars));
            asmNames[asmClosureVars.name] = asmFiles[file];
        }
    };
    this.getAssemblyFile = (file) => {
        let asmADO = this.domain.getAdo(file),
            file2 = file;
        if (file2.startsWith('./')) { file2 = file2.substr(2); }
        if (asmADO && asmADO.package) { // is packaged as module
            if (!isServer) { 
                // on client modules are supposed to be inside ./modules/ folder, therefore prefix it
                file2 = `./${modulesRootFolder}/${asmADO.package}/${file2}`; 
            } else {
                // on server require() finds modules automatically - just package-name needs to be prefixed
                file2 = `${asmADO.package}/${file2}`; 
            }
        } else { // in relation to start location
            file2 = this.domain.root() + file2;
        }
        return file2;
    };
    this.getAssemblyAssetsPath = (file) => {
        let file2 = this.getAssemblyFile(file);
        if (file2.indexOf('.min.js') !== -1) {
            return file2.replace('.min.js', '/');
        } else {
            return file2.replace('.js', '/');
        }
    };
    this.loadAssembly = (file) => {
        return new Promise((resolve, reject) => {
            if (this.isUnloaded()) { reject(_Exception.InvalidOperation(`Context is already unloaded. (${this.name})`)); return; }

            if (!asmFiles[file] && this.currentAssemblyBeingLoaded() !== file) { // load only when it is not already loaded (or not already being loaded) in this load context
                // set this context as current context, so all types being loaded in this assembly will get attached to this context;
                currentContexts.push(this);

                // get resolved file name of this assembly
                let asmADO = this.domain.getAdo(file),
                    file2 = this.getAssemblyFile(file);

                // uncache module, so it's types get to register again with this new context
                uncacheModule(file2);

                // load module
                loadModule(file2, asmADO.name, true).then((asmFactory) => {
                    // run asm factory to load assembly
                    asmFactory(flair, file2).then((asmClosureVars) => {
                        // current context where this was loaded
                        let loadedInContext = this.current();

                        // remove this from current context list
                        currentContexts.pop();

                        // assembly loaded
                        assemblyLoaded(file, asmADO, loadedInContext, asmClosureVars);

                        // resolve
                        resolve();
                    }).catch((err) => {
                        // remove this from current context list
                        currentContexts.pop();

                        // reject
                        reject(err);
                    });
                }).catch((err) => {
                    // remove this from current context list
                    currentContexts.pop();

                    // reject
                    reject(err);
                });
            } else {
                resolve();
            }
        });        
    };  
    this.loadBundledAssembly = (file, loadedFile, asmFactory) => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`); }

        let asmClosureVars = {};

        // set this context as current context, so all types being loaded in this assembly will get attached to this context;
        currentContexts.push(this);

        // get resolved file name of this assembly, in ths case it is loadedFile
        let file2 = loadedFile;
        try {
            // run given asm factory (sync)
            // this means embedded types built-in here in this factory does not support await 
            // type calls, as this factory's outer closure is not an async function
            asmClosureVars = asmFactory(flair, file2); // let it throw error, if any

            // current context where this was loaded
            let loadedInContext = this.current();

            // remove this from current context list
            currentContexts.pop();

            // assembly loaded
            let asmADO = this.domain.getAdo(file);
            assemblyLoaded(file, asmADO, loadedInContext, asmClosureVars);
        } finally {
            // remove this from current context list
            currentContexts.pop();
        }
            
        // return
        return asmClosureVars;
    };  
    this.getAssembly = (file) => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.getAssembly); }
        if (typeof file !== 'string') { throw _Exception.InvalidArgument('file', this.getAssembly); }
        return asmFiles[file] || null;
    };
    this.getAssemblyByName = (name) => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.getAssemblyByName); }
        if (typeof name !== 'string') { throw _Exception.InvalidArgument('name', this.getAssemblyByName); }
        return asmNames[name] || null;
    };
    this.allAssemblies = (isRaw) => { 
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.allAssemblies); }
        if (isRaw) {
            let all = [],
                keys = Object.keys(asmFiles);
            for(let r of keys) { all.push(asmFiles[r]); }
            return all;
        } else {
            return Object.keys(asmFiles);
        }
    };

    // resources
    this.registerResource = (rdo) => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.registerResource); }

        if (typeof rdo.name !== 'string' || rdo.name === '' ||
            typeof rdo.encodingType !== 'string' || rdo.encodingType === '' ||
            typeof rdo.file !== 'string' || rdo.file === '' ||
            typeof rdo.data !== 'string' || rdo.data === '') {
            throw _Exception.InvalidArgument('rdo', this.registerResource);
        }

        // namespace name is already attached to it, and for all '(root)'    
        // marked types' no namespace is added, so it will automatically go to root
        let ns = rdo.name.substr(0, rdo.name.lastIndexOf('.')),
            onlyName = rdo.name.replace(ns + '.', '');

        // check if already registered
        if (alcResources[rdo.name]) { throw _Exception.Duplicate(rdo.name, this.registerResource); }
        if (alcTypes[rdo.name]) { throw _Exception.Duplicate(`Already registered as Type. (${rdo.name})`, this.registerResource); }
        if (alcRoutes[rdo.name]) { throw _Exception.Duplicate(`Already registered as Route. (${rdo.name})`, this.registerResource); }

        // register
        alcResources[rdo.name] = Object.freeze(new Resource(rdo, ns, this));

        // register to namespace as well
        if (ns) {
            if (!namespaces[ns]) { namespaces[ns] = {}; }
            namespaces[ns][onlyName] =  alcResources[rdo.name];
        } else { // root
            namespaces[onlyName] =  alcResources[rdo.name];
        }        

        // return namespace where it gets registered
        return ns;
    };
    this.getResource = (qualifiedName) => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.getResource); }
        if (typeof qualifiedName !== 'string') { throw _Exception.InvalidArgument('qualifiedName', this.getResource); }
        return alcResources[qualifiedName] || null;
    };     
    this.allResources = (isRaw) => { 
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.allResources); }
        if (isRaw) {
            let all = [],
                keys = Object.keys(alcResources);
            for(let r of keys) { all.push(alcResources[r]); }
            return all;
        } else {
            return Object.keys(alcResources);
        }
    };

    // routes
    this.registerRoutes = (routes, asmFile) => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.registerRoutes); }

        // process each route
        for(let route of routes) {
            if (typeof route.name !== 'string' || route.name === '' ||
                typeof route.index !== 'number' ||
                (typeof route.mount === 'string' && route.mount === '') ||
                (Array.isArray(route.mount) && route.mount.length === 0) ||
                (Array.isArray(route.mount) && typeof route.mount[0] !== 'string') ||
                (typeof route.mount !== 'string' && !Array.isArray(route.mount)) ||
                typeof route.path !== 'string' || route.path === '' ||
                typeof route.handler !== 'string' || route.handler === '') {
                throw _Exception.InvalidArgument('route: ' + route.name, this.registerRoutes);
            }

            // namespace name is already attached to it, and for all '(root)'    
            // marked types' no namespace is added, so it will automatically go to root
            let ns = route.name.substr(0, route.name.lastIndexOf('.')),
                onlyName = route.name.replace(ns + '.', '');

            // check if already registered
            if (alcRoutes[route.name]) { throw _Exception.Duplicate(route.name, this.registerRoutes); }
            if (alcTypes[route.name]) { throw _Exception.Duplicate(`Already registered as Type. (${route.name})`, this.registerRoutes); }
            if (alcResources[route.name]) { throw _Exception.Duplicate(`Already registered as Resource. (${route.name})`, this.registerRoutes); }

            // register
            alcRoutes[route.name] = Object.freeze(new Route(asmFile, route, ns, this));

            // register to namespace as well
            if (ns) {
                if (!namespaces[ns]) { namespaces[ns] = {}; }
                namespaces[ns][onlyName] =  alcRoutes[route.name];
            } else { // root
                namespaces[onlyName] =  alcRoutes[route.name];
            }        
        }
    };
    this.getRoute = (qualifiedName) => {
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.getRoute); }
        if (typeof qualifiedName !== 'string') { throw _Exception.InvalidArgument('qualifiedName', this.getRoute); }
        return alcRoutes[qualifiedName] || null;
    };     
    this.allRoutes = (isRaw) => { 
        if (this.isUnloaded()) { throw _Exception.InvalidOperation(`Context is already unloaded. (${this.name})`, this.allRoutes); }
        if (isRaw) {
            let all = [],
                keys = Object.keys(alcRoutes);
            for(let r of keys) { all.push(alcRoutes[r]); }
            return all;
        } else {
            return Object.keys(alcRoutes);
        }
    };
    
    // state (just to be in sync with proxy)
    this.isBusy = () => { return false; }
    this.hasActiveInstances = () => { return Object.keys(instances).length; }
};
