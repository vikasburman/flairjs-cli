/**
 * @name AppDomain
 * @description Thread level isolation.
 * @example
 *  
 */
const AppDomain = function(name) {
    let asmFiles = {},
        asmTypes = {}, // lists all Types and Resource Types
        domains = {},
        contexts = {},
        currentContexts = [],
        allADOs = [],
        loadPaths = {},
        entryPoint = '',
        rootPath = '',
        configFileJSON = null,
        app = null,
        host = null,
        defaultLoadContext = null,
        unloadDefaultContext = null,
        isUnloaded = false,
        isBooted = false;
    
    // app domain
    domains[name] = this;
    this.name = name;
    this.isRemote = false;
    this.isUnloaded = () => { return isUnloaded; };
    this.unload = async () => {
        if (!isUnloaded) {
            // mark unloaded
            isUnloaded = true;

            // stop app 
            if (app && typeof app.stop === 'function') { await app.stop(); _dispose(app); }

            // stop host 
            if (host && typeof host.stop === 'function') { await host.stop(); _dispose(host); }

            // unload all contexts of this domain, including default one (async)
            for(let context in contexts) {
                if (contexts.hasOwnProperty(context)) {
                    if (typeof contexts[context].unload === 'function') {
                        contexts[context].unload();
                    }
                }
            }
            unloadDefaultContext();

            // unload all domains, including this one
            for(let domain in domains) {
                if (domains.hasOwnProperty(domain) && domains[domain] !== this) {
                    domains[domain].unload();
                }
            }

            // clear registries and vars
            asmFiles = {},
            asmTypes = {};
            contexts = {};
            domains = {};
            currentContexts = [];
            allADOs = [];
            loadPaths = {};
            entryPoint = '';
            rootPath = '';
            configFileJSON = null;
            app = null;
            host = null;
            defaultLoadContext = null;
            unloadDefaultContext = null;
        }
    };
    this.createDomain = (name) => {
        return new Promise((resolve, reject) => {
            if(typeof name !== 'string' || (name && name === 'default') || domains[name]) { reject(_Exception.InvalidArguments('name')); return; }
            let proxy = Object.freeze(new AppDomainProxy(name, domains, allADOs));
            domains[name] = proxy;
            resolve(proxy);
        });
    };
    this.domains = (name) => { return domains[name] || null; }
   
    // assembly load context
    const setNewDefaultContext = () => {
        defaultLoadContext = new AssemblyLoadContext('default', this, null, currentContexts, contexts),
        unloadDefaultContext = defaultLoadContext.unload;
        delete defaultLoadContext.unload; // default load context cannot be unloaded directly, unless app domain is unloaded
        defaultLoadContext = Object.freeze(defaultLoadContext);
        contexts[defaultLoadContext.name] = defaultLoadContext;
        return defaultLoadContext;
    };
    this.context = setNewDefaultContext();
    this.contexts = (name) => { return contexts[name] || null; }
    this.createContext = (name) => {
        return new Promise((resolve, reject) => {
            if(typeof name !== 'string' || (name && name === 'default') || contexts[name]) { reject(_Exception.InvalidArguments('name')); return; }
            let alc = Object.freeze(new AssemblyLoadContext(name, this, defaultLoadContext, currentContexts, contexts));
            contexts[name] = alc;
            resolve(alc);
        });
    };

    // ados
    this.registerAdo = (...ados) => {
        // when call is coming from direct assembly loading
        let isThrowOnDuplicate = true,
            isCalledFromAsmLoading = false;
        if (ados.length === 1 && typeof ados[0] === 'string') { 
            let ado = JSON.parse(ados[0]);
            if (Array.isArray(ado)) {
                ados = ado;
            } else {
                ados = [ado];
            }
            isThrowOnDuplicate = false;
            isCalledFromAsmLoading = true;
        }

        // register
        ados.forEach(ado => {
            if (_typeOf(ado.types) !== 'array' || 
                _typeOf(ado.resources) !== 'array' ||
                _typeOf(ado.routes) !== 'array' ||
                _typeOf(ado.assets) !== 'array' ||
                typeof ado.name !== 'string' ||
                typeof ado.file !== 'string' || ado.file === '') {
                throw _Exception.InvalidArgument('ado', this.registerAdo);
            }

            ado.file = which(ado.file, true); // min/dev contextual pick
            if (asmFiles[ado.file]) {
                if (isThrowOnDuplicate || isWorker) { throw _Exception.Duplicate(ado.file, this.registerAdo); } // in worker too, don't throw, because allADOs list may have same items which were loaded at worker's start time
                return;
            } else { // register
                asmFiles[ado.file] = Object.freeze(ado);

                // flatten types
                ado.types.forEach(qualifiedName => {
                    // qualified names across anywhere should be unique
                    if (asmTypes[qualifiedName]) {
                        throw _Exception.Duplicate(qualifiedName, this.registerAdo);
                    } else {
                        asmTypes[qualifiedName] = ado.file; // means this type can be loaded from this assembly 
                    }
                });

                // flatten resources
                ado.resources.forEach(qualifiedName => {
                    // qualified names across anywhere should be unique
                    if (asmTypes[qualifiedName]) {
                        throw _Exception.Duplicate(qualifiedName, this.registerAdo);
                    } else {
                        asmTypes[qualifiedName] = ado.file; // means this resource can be loaded from this assembly
                    }
                });
                
                // register routes
                if (!isCalledFromAsmLoading) { // since otherwise routes are registered with preamble loading itself
                    this.context.registerRoutes(ado.routes, ado.file);
                }
            }
        });  

        // store raw, for use when creating new app domain
        allADOs.push(...ados);
    };
    this.getAdo = (file) => {
        if (typeof file !== 'string') { throw _Exception.InvalidArgument('file', this.getAdo); }
        return asmFiles[file] || null;
    };
    this.allAdos = () => { return Object.keys(asmFiles); }

    // types
    this.resolve = (qualifiedName) => {
        if (typeof qualifiedName !== 'string') { throw _Exception.InvalidArgument('qualifiedName', this.resolve); }
        return asmTypes[qualifiedName] || null; // gives the assembly file name where this type reside     
    };
    this.allTypes = () => { return Object.keys(asmTypes); }

    // app domain start/restart
    this.boot = async () => {
        // this is a place where all basic settings are done on start time
        // and now ready to start boot engine
        // also, this is called when app wants to restart
        // in that case, it do the same operations again

        // if this is a restart scenario, these will exist
        if (isBooted) { // if already booted, unload domain first
            await this.unload();
            isUnloaded = false; // so for next unload it remains same as on first load

            // initialize new default load context (for reboot context only)
            setNewDefaultContext();
        }

        // set entry point
        let __entryPoint = (isWorker ? '' : which(settings.entryPoint)); // server/client specific file
        this.entryPoint(__entryPoint);

        // set root
        this.root(isServer ? process.cwd() : './');

        // load config
        await this.config(which(settings.config)); // server/client specific file

        // load preamble
        await _include(settings.preamble);

        // boot
        let be = await _include(settings.bootEngine);
        await be.start();
        isBooted = true;
    };

    // set onces, read many times
    this.config = (configFile) => {
        if (!configFileJSON && configFile) { // load only when not already loaded
            return new Promise((resolve, reject) => {
                _include(configFile).then((json) => {
                    configFileJSON = json;
                    resolve(Object.assign({}, configFileJSON)); // return a copy
                }).catch(reject);
            });
        } else {
            if (configFileJSON) {
                return Object.assign({}, configFileJSON); // return a copy
            }
            return null;
        }
    };
    this.entryPoint = (file) => {
        if (typeof file === 'string' && !entryPoint) { entryPoint = file; }
        return entryPoint;
    };
    this.app = (appObj) => {
        if (appObj && !app) { app = appObj; }
        return app;
    };
    this.host = (hostObj) => {
        if (hostObj) { host = hostObj; }
        return host;
    };
    this.loadPathOf = (file, path) => {
        if (typeof file !== 'string') { throw _Exception.InvalidArgument('file', this.loadPath); }
        if (path) { // set
            if (!loadPaths[file]) {
                loadPaths[file] = path;
            }
        }
        return loadPaths[file] || '';
    };
    this.root = (path) => {
        if (typeof path === 'string' && !rootPath) { 
            rootPath = path; 
            if (!rootPath.endsWith('/')) { rootPath += '/'; }
        }
        return rootPath;
    };
    this.resolvePath = (path) => {
        if (typeof path !== 'string') { throw _Exception.InvalidArgument('path', this.resolvePath); }
        return path.replace('./', this.root());
    };

    // scripts
    this.loadScripts = (...scripts) => {
        return new Promise((resolve, reject) => {
            try {
                _bring(scripts, () => {
                    resolve(); // resolve without passing anything
                });
            } catch (err) {
                reject(err);
            }
        });
    };

    // error router
    this.onError = (err) => {
        if (host) {
            host.raiseError(err);
        } else {
            throw err;
        }
    };
};

// build default app domain
let defaultAppDomain = new AppDomain('default'),
    unloadDefaultAppDomain = defaultAppDomain.unload;
delete defaultAppDomain.unload; // default app domain cannot be unloaded directly

const _AppDomain = defaultAppDomain;

// attach to flair
a2f('AppDomain', _AppDomain, () => {
    unloadDefaultAppDomain(); // unload default app domain
});
