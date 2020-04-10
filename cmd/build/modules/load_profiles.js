const path = require('path');
const chalk = require('chalk');
const fsx = require('fs-extra');
const copyDir = require('copy-dir');
const junk = require('junk');
const rrd = require('recursive-readdir-sync');
const wildcards = require('../../shared/modules/wildcard_match');
const getFolders = require('../../shared/modules/get_folders');
const pathJoin = require('../../shared/modules/path_join');
const mergeObjects = require('../../shared/modules/merge_objects');
const guid = require('../../shared/modules/guid');

// created profiles object to sort out what all needs to be done
// this is the only place where directories are scennaed and all
// operations to be done are sorted and logged to be executed in
// one go - for cleanest and fastest processing
module.exports = async function(options) {
    if (options.build.profiles.list.length === 0) {
        options.build.profiles.list.push('default'); // add default profile, if none are defined
    }

    options.logger(1, 'plan', chalk.blue(options.build.profiles.list.length) + ' profile/s');

    // profiles, groups, assemblies
    let profileConfig = null,
        profile = null,
        group = null,
        asmFunc = null;
    for(let profileName of options.build.profiles.list) {
        profileConfig = options.build.profiles[profileName]; // look for profile name key under profiles
        if (!profileConfig) {
            throw `Profile definition not found. (${p})`;
        } else {
            options.profiles = options.profiles || {};
            profile = loadProfile(options, profileName, profileConfig);
            options.profiles[profileName] = profile;
            options.logger(1, chalk.blue(profileName), profile.dest);
            for(let groupName of profile.groups.list) {
                group = profile.groups[groupName];
                options.logger(1, chalk.cyan(group.name), group.dest);
                for(let asmName of group.assemblies.list) {
                    options.logger(0, chalk.keyword('orange')(asmName));
                }
                options.logger(-1);
            }
            options.logger(-1);
        }
    }

    options.logger(-1);
};

/** 
 * Details structure of a project looks like:
 * <project>\                                                   project root folder (.\)
 * .\.vscode                                                    [fixed] vscode configuration
 * .\debug                                                      [fixed] debug support files
 * .\dist                                                       [configurable] distribution files
 * .\docs                                                       [configurable] docs distribution files
 * .\node_modules                                               [fixed] node modules
 * .\packages                                                   [configurable] package distribution files
 * .\temp                                                       [configurable] temporary build / cache files
 * .\test                                                       [configurable] test engine files
 * .\flair.json                                                 [fixed] project configuration
 * .\package.json                                               [fixed] package configuration
 * .\src                                                        [configurable] source files
 * .\src\docs\package.info                                      [fixed, optional] package level docs (just header)
 * .\src\docs\examples.info                                     [fixed, optional] package level fiddle examples catalog (header + items)
 * .\src\docs\guides.info                                       [fixed, optional] package level guides catalog (header + items)
 * .\src\docs\guides\*\*.md                                     [fixed, optional] package level guide documentation
 * .\src\docs\pages.info                                        [fixed, optional] package level pages catalog (header + items)
 * .\src\docs\pages\*\*.html                                    [fixed, optional] package level raw html pages and supporting files
 * .\src\docs\themes\*\*                                        [fixed, optional] package level theme definition
 * .\src\<profile>                                              [optional] profile root folder
 * .\src\<profile>\<group>                                      [optional] profile's group folder
 * .\src\<profile>\<group>\<asm>                                [fixed] assembly folder
 * .\src\..\<asm>\index.js                                      [fixed, optional] custom index.js for assembly binding
 * .\src\..\<asm>\routes.json                                   [fixed, optional] route handler definitions for the assembly
 * .\src\..\<asm>\config.json                                   [fixed, optional] assembly default configuration, that can be changed from appConfig/webConfig file
 * .\src\..\<asm>\settings.json                                 [fixed, optional] assembly default configuration, that can not be changed from outside
 * .\src\..\<asm>\assets\*                                      [fixed, optional] assets that are copied to <asm>_files folder on build, all localized asset files are copied to <asm>_files/<locale>/* 
 * .\src\..\<asm>\assets\l10n\*                                 [fixed, optional] localized assets can be kept here for default locale, copied to <asm_files>/<locale>/ [ for other locales, same structure can be placed in ./l10n/<localeId>/../asm/assets/l10n/* ]
 * .\src\..\<asm>\libs\*                                        [fixed, optional] 3rd party libraries that remain untouched during build processing and copied to <asm>_files/libs/
 * .\src\..\<asm>\resources\*                                   [fixed, optional] resources that gets bundled inside assembly
 * .\src\..\<asm>\tests\*\*.spec                                [fixed, optional] high level multi-item test specifications
 * .\src\..\<asm>\globals\*\*.js                                [fixed, optional] assembly global closure code elements
 * .\src\..\<asm>\globals\*\*.spec.js                           [fixed, optional] assembly global closure code elements's test specs
 * .\src\..\<asm>\components\*\*.js                             [fixed, optional] assembly components code
 * .\src\..\<asm>\components\*\*.spec.js                        [fixed, optional] assembly components test specs
 * .\src\..\<asm>\types\<ns>\*\*.js                             [fixed, optional] namespaced types code
 * .\src\..\<asm>\types\<ns>\*\*.spec.js                        [fixed, optional] namespaced types test specs
 * .\src\..\<asm>\docs\assembly.info                            [fixed, optional] assembly level docs (just header)
 * .\src\..\<asm>\docs\globals.info                             [fixed, optional] assembly globals docs (just header)
 * .\src\..\<asm>\docs\components.info                          [fixed, optional] assembly components docs (just header)
 * .\src\..\<asm>\docs\namespaces.info                          [fixed, optional] assembly namespaces docs (header + items)
 * .\src\..\<asm>\docs\types.info                               [fixed, optional] assembly types docs (just header)
 * .\src\..\<asm>\docs\assets.info                              [fixed, optional] assets's docs (header + items)
 * .\src\..\<asm>\docs\libs.info                                [fixed, optional] libs's docs (header + items)
 * .\src\..\<asm>\docs\resources.info                           [fixed, optional] resources's docs (header + items)
 * .\src\..\<asm>\docs\routes.info                              [fixed, optional] routes's docs (header + items)
 * .\src\..\<asm>\docs\config.info                              [fixed, optional] assembly configuration docs (header + items)
 * .\src\..\<asm>\docs\settings.info                            [fixed, optional] assembly settings docs (header + items)
 * .\l10n\<locale>\*                                            entire structure here is a replica of all files as in .src/
 *                                                              for each locale. 
 *                                                              All code files can exists without actual code but only with 
 *                                                              documentation blocks.
 *                                                              All locales speific asset files can be placed at the same level
 *                                                              and place as they exists in main .src/ folder
 *                                                              All corrosponding *.info, can exists for each locale
 *                                                              at the same place, as in main .src/ folder
*/ 

const getFiles = (asmName, root, exclude, changedSince) => {
    let set = {
        changed: false,
        files: [] // { folder, file, filename, basename, ext, index, isAsset, isNamespaced, nsname, nspath }
    };
    
    // get all files
    let allFiles = rrd(root).filter(file => junk.not(path.basename(file))),
        excludedFolders = [],
        cleanFolders = [],
        nsRoot = pathJoin(root, 'types'),
        ns = '',
        idx = -1;
    for(let f of allFiles) {
        // file info
        let file = {
            folder: './' + path.dirname(f),                 // ./src/path
            file: './' + f,                                 // ./src/path/(#-99).abc.js | ./src/path/(#-99).abc.min.js | ./src/path/(@).abc.json
            filename: '',                                   // ./src/path/abc.js | ./src/path/abc.min.js | ./src/path/abc.json
            basename: path.basename(f),                     // abc.js / abc.min.js / abc.json 
            ext: path.extname(f).substr(1), // remove .     // js | json
            index: 0,                                       // -99 / 0
            isAsset: false,                                 // true, if starts with '(@).' OR ($). OR if kept inside 'types' folder and ext matches as listed in options.assets.ext
            isL10n: false,                                  // true, if starts with '($).'
            isNamespaced: false,                            // true, if file is a namespaced file 
            nsName: '',                                     // empty for root namesapace, else name
            nsPath: '',                                     // namespace path
            docs: ''                                        // extracted docs symbols - loaded in code files after one pass, that helps in template generation
        };

        // extract namespace
        if(file.folder.startsWith(nsRoot)) {
            file.isNamespaced = true;
            ns = file.folder.replace(nsRoot + '/', ''); if (ns === nsRoot) { ns = ''; } 
            idx = ns.indexOf('/');
            file.nsName = (idx === -1 ? ns : ns.substring(0, idx));
            file.nsPath = pathJoin(nsRoot, file.nsName);
        }

        // exclusions
        // 1: some parent folder of this file was already skipped, so skip this
        if (excludedFolders.findIndex(a => file.folder.startsWith('./' + a)) !== -1) { continue; }

        // 2: file (path+name) matches some pattern, so skip this
        if (wildcards.isMatchAny(file.file, exclude)) { continue; }

        // 3: file name (without path) matches some pattern, so skip this
        if (wildcards.isMatchAny(file.basename, exclude)) { continue; }

        // 4: any parent folder of this file (which is not yet added in excludedFolders is to be skipped)
        // check only, if this is not identified as clean folder already
        if (cleanFolders.indexOf(file.folder) === -1) {
            let allFolders = file.folder.substr(2).split('/'), // exclude initial ./
            isExecluded = false,
            excluded = '';
            if (allFolders.length > 0) {
                excluded = '';
                for(let fld of allFolders) {
                    excluded += fld + '/';
                    if (wildcards.isMatchAny(fld, exclude)) { 
                        if (excludedFolders.indexOf(excluded) === -1) {
                            excludedFolders.push(excluded); 
                            isExecluded = true;
                            break;
                        } else {
                            isExecluded = true;
                            break;
                        }
                    }
                }
                if (isExecluded) {
                    continue; 
                } else {
                    cleanFolders.push(file.folder); // mark as clean, so all files of this folder, don't come here in above loop
                }
            }
        }

        // get index and type of file
        // any file inside assembly folder can be named as:
        // {(#n).|(@).|($).}fileName.ext
        // index can be:
        //  (#n).         <-- file to be placed at nth positon wrt other files
        //  all files are given 0 index by default
        //  n can be negative ->>  (#-23).
        //  n can be positive ->>  (#23). 
        //  sorting happens: -23, 0, 23
        if (file.basename.startsWith('(#')) { // file that will be embedded in assembly at a certain ordered position
            let idx = file.basename.indexOf(').'); // first index of ).
            if (idx !== -1) { // process only when ').' is also found (otherwise assume that (# is part of file name itself)
                try {
                    file.index = file.basename.substring(2, idx);
                    if (file.index.substr(0) === '-') {
                        file.index = parseInt(file.index) * -1;
                    } else {
                        file.index = parseInt(file.index);
                    }
                } catch (err) {
                    throw `Between '(#' and ').', there must be an integer number. (${file.file})`;
                }
                file.basename = file.basename.substr(idx + 2);
                file.filename = pathJoin(file.folder, file.basename);
            }
        } else if (file.basename.startsWith('(@).')) { // in-place namespaced asset of the assembly
            if (file.isNamespaced) {
                file.basename = file.basename.substr(4);
                file.filename = pathJoin(file.folder, file.basename);
                file.isAsset = true;
            }
        } else if (file.basename.startsWith('($).')) { // in-place namespaced localized asset of the assembly
            if (file.isNamespaced) {
                file.basename = file.basename.substr(4);
                file.filename = pathJoin(file.folder, file.basename);
                file.isAsset = true;
                file.isL10n = true;
            }
        }
        if (!file.filename) { file.filename = file.file; }

        // add to list
        set.files.push(file);
     
        // check for changed state, if needed to set and yet not found a changed
        if (changedSince && !set.changed) { if (fsx.statSync(f).mtime > changedSince) { set.changed = true; } }
    }

    // return
    return set;
};
const filterFiles = (files, root, isSort) => { 
    if (!root.endsWith('/')) { root += '/'; }
    let filteredFiles = files.filter(file => file.file.startsWith(root));

    // sort
    let sortedFiles = sortFiles(filteredFiles);

    // return 
    return isSort ? sortedFiles : filteredFiles;
};
const sortFiles = (files) => {
    return files.sort((a, b) => ((a.index === b.index) ? (a.basename > b.basename) : (a.index > b.index)) ? 1 : -1 );
};
const getPathIfExists = (rootpath, path) => {
    if (rootpath) { path = pathJoin(rootpath, path); }
    return fsx.existsSync(path) ? path : '';
};
const getMextFile = (filename) => {
    let ext = path.extname(filename);
    return filename.replace(ext, `{.min}${ext}`); // mxet = Minified-eXtension-ExisTs
};

const loadProfile = (options, profileName, profileConfig) => {
    // profile data 
    // {
    //     name: '',
    //     type: '',
    //     src: '',
    //     dest: '',
    //     lint: {
    //         perform: false,
    //         exclude: {}
    //     },
    //     minify: {
    //         perform: false,
    //         exclude: {}
    //     },
    //     gzip: {
    //         perform: false,
    //         exclude: {}
    //     },
    //     scramble: {
    //          perform: false,
    //          include: []
    //     }
    //     injections: {
    //          exclude: {}
    //     }
    //     preamble: {
    //          dest: '',
    //          list: []
    //      },
    //     groups: {
    //          list: []
    //     }
    // };
    let profile = {};

    // first pick default settings from 'default' profile's settings
    if (profileName !== 'default') {
        profile = mergeObjects(options.profiles['default'], profile);
    }

    // .name, .type
    profile.name = profileName;
    profile.type = 'profile';

    // .src
    if (profileConfig.src === '') { // ./src/
        profile.src = options.build.src;
    } else if (profileConfig.src === '@') { // ./src/<profileName>/
        profile.src = pathJoin(options.build.src, profileName);
    } else { //./src/somename/
        profile.src = pathJoin(options.build.src, profileConfig.src);
    }

    // .dest
    if (profileConfig.dest === '') { // ./dest/
        profile.dest = options.build.dest;
    } else if (profileConfig.dest === '@') { // ./dest/<profileName>/
        profile.dest = pathJoin(options.build.dest, profileName);
    } else if (profileConfig.dest.startsWith('@')) { // '@profile2': <profile2's destination path>/
        let dependentProfileName = profileConfig.dest.substr(1);
        if (!options.profiles[dependentProfileName]) { throw `Dependent profile not loaded. (${dependentProfileName})`; }
        profile.dest = options.profiles[dependentProfileName].dest;
    } else { //./dest/somename/
        profile.dest = pathJoin(options.build.dest, profileConfig.dest);
    }
    
    // .lint
    profile.lint = {};
    profile.lint.perform = (options.lint.perform && profileConfig.lint.perform);
    if (profile.lint.perform) { 
        profile.lint.exclude = profileConfig.lint.exclude;
    }

    // .minify
    profile.minify = {};
    profile.minify.perform = (options.minify.perform && profileConfig.minify.perform);
    if (profile.minify.perform) {
        profile.minify.exclude = (profileConfig.minify.exclude);
    }
    
    // .gzip
    profile.gzip = {};
    profile.gzip.perform = (options.gzip.perform && profileConfig.gzip.perform);
    if (profile.gzip.perform) {
        profile.gzip.exclude = (profileConfig.gzip.exclude);
    }

    // .scramble
    profile.scramble = {};
    profile.scramble.perform = (options.scramble.perform && profileConfig.scramble.perform);
    if (profile.scramble.perform) {
        profile.scramble.include = (profileConfig.scramble.include);
    }

    // .injections
    profile.injections = {};
    profile.injections.exclude = profileConfig.injections.exclude;

    // .preamble
    profile.preamble = {};
    if (profileConfig.preamble.oneforall) { 
        // if one for entire profile, it will create one for this profile, having assemblies of all groups
        profile.preamble.dest = pathJoin(profile.dest, options.build.files.preamble);
        profile.preamble.list = [];
    }

    // .groups
    profile.groups = {};
    profile.groups.list = profileConfig.groups;
    if (profile.groups.list.length === 0) { 
        // if no group is defined, assume profile's src as the group itself
        // before that, give a chance to 'app' named special folder
        // if 'app' folder exists - and no groups are defined, assume that 
        // this app folder is the only group where assemblies exists for this profile
        if (fsx.existsSync(pathJoin(profile.src, 'app'))) {
            profile.groups.list.push('app');
        } else {
            profile.groups.list.push('default');
        }
    }
    for(let groupName of profile.groups.list) {
        profile.groups[groupName] = loadProfileGroup(options, profile, profileConfig, groupName);
    }
    
    // done
    return profile;
};
const loadProfileGroup = (options, profile, profileConfig, groupName) => {
    // profile group data
    // {
    //     name: '',
    //     type: '',
    //     profile: null,
    //     src: '',
    //     dest: '',
    //     preamble: {
    //          dest: '',
    //          list: []
    //     }
    //     assemblies: {
    //          list: []
    //     }
    // }    
    let group = {};
    
    // .name, .type, profile
    group.name = groupName;
    group.type = 'group';
    group.profile = profile;

    // .src
    if (groupName === 'default') {
        group.src = profile.src; // use same source as of profile
    } else {
        group.src = pathJoin(profile.src, groupName);
    }

    // .dest
    if (groupName === 'default') {
        group.dest = profile.dest; // use same source as of profile
    } else {
        group.dest = pathJoin(profile.dest, groupName);
    }

    // .preamble
    group.preamble = {};
    if (!profile.preamble.dest) { // if not already defined at profile level, means to be created at group level
        group.preamble.dest = pathJoin(group.dest, options.build.files.preamble);
        group.preamble.list = [];
    }
    
    // .assemblies
    let folders = getFolders(group.src, true);
    group.assemblies = {};
    group.assemblies.list = [];
    for(let asmName of folders) {
        // exclude special folders from source root, if required
        if (group.src === options.build.src && options.build.exclude.indexOf(asmName) !== -1) { continue; } // ignore this special folder

        if (!wildcards.isMatchAny(asmName, options.build.assembly.exclude)) { // exclude files/folders which are not to be processed at all
            group.assemblies.list.push(asmName);
            group.assemblies[asmName] = () => { return loadGroupAssembly(options, profile, profileConfig, group, asmName); };
        }
    }
    
    // return
    return group;
}
const loadGroupAssembly = (options, profile, profileConfig, group, asmName) => {
    // profile group's assembly data
    // {
    //     name: '',
    //     type: '',
    //     group: null,
    //     profile: null,
    //     skipPreamble: t/f,
    //     skipBuild: t/f
    //     skipDocs: t/f,
    //     skipTests: t/f,
    //     asyncTypeLoading: t/f,
    //     src: '',
    //     skipLint: t/f
    //     skipMinify: t/f
    //     skipGzip: t/f
    //     doScramble: t/f
    //     members: 0,
    //     content: '',
    //     dest: {
    //          file: '',
    //          minFile: '',
    //          gzFile: '',
    //          files: '',
    //          lupdate: datetime
    //          adoCache: '',
    //     },
    //     files: {
    //          main: '',
    //          config: '',
    //          settings: '',
    //          routes: ''
    //     },
    //     folders: {
    //          assets: '',
    //          l10n: '',
    //          libs: '',
    //          resources: '',
    //          includes: '',
    //          globals: '',
    //          components: '',
    //          types: '',
    //          docs: '',
    //          tests: ''
    //     },
    //     ado: {
    //         n: '', t: '', d: '',
    //         i: '',
    //         v: '', u: '',
    //         f: '', p: '',
    //         b: '', c: '', l: '',
    //         ns: [],            
    //         ty: [],            
    //         as: [],            
    //         ro: []             
    //     },
    //     globals: [],            
    //     components: [],         
    //     resources: [],
    //     types: [],              
    //     assets: []
    //     includes: []
    // }
    let asm = {};
            
    // .name, .type, .group, .profile
    asm.name = asmName;
    asm.type = 'asm';
    asm.group = group;
    asm.profile = profile;

    // .src
    asm.src = pathJoin(group.src, asmName);

    // .skipLint, .skipMinify, .skipGzip
    asm.skipLint = !profile.lint.perform || wildcards.isMatchAny(asmName, profile.lint.exclude.assemblies);
    asm.skipMinify = !profile.minify.perform || wildcards.isMatchAny(asmName, profile.minify.exclude.assemblies);
    asm.skipGzip = !profile.gzip.perform || wildcards.isMatchAny(asmName, profile.gzip.exclude.assemblies);

    // .doScramble
    asm.doScramble = (!asm.skipMinify && profile.scramble.perform && wildcards.isMatchAny(asmName, profile.scramble.include));

    // .dest
    asm.dest = {};
    asm.dest.file = pathJoin(group.dest, asmName) + '.js';
    if (!asm.skipMinify) { asm.dest.minFile =  pathJoin(group.dest, asmName) + '.min.js'; }
    if (!asm.skipGzip) { asm.dest.gzFile = (asm.dest.minFile || asm.dest.file) + '.gz'; }
    asm.dest.files = pathJoin(group.dest, asmName) + '_files'; // connected files (like connected files concept of windows shell: https://docs.microsoft.com/en-us/windows/win32/shell/manage)
    asm.dest.lupdate = fsx.existsSync(asm.dest.file) ? fsx.statSync(asm.dest.file).mtime : null;
    asm.dest.adoCache = (options.build.useCache ? pathJoin(options.build.cache, profile.name, group.name, asmName) + '.json' : '');

    // .skipDocs, .skipTests
    asm.skipDocs = !options.docs.perform || wildcards.isMatchAny(asmName, options.docs.exclude);
    asm.skipTests = !options.tests.perform || wildcards.isMatchAny(asmName, options.tests.exclude);

    // .skipPreamble
    asm.skipPreamble = wildcards.isMatchAny(asmName, profileConfig.preamble.exclude);

    // .skipBuild
    // to start with assume not to be built, if already exists
    // this will be reset in any of the below calls, if any file
    // that exists there was changed, since this assembly was last built (asm.dest.lupdate)
    asm.skipBuild = (!options.session.build.full && asm.dest.adoCache && 
        fsx.existsSync(asm.dest.file) &&
        fsx.existsSync(asm.dest.adoCache));

    // .folders .assets, .l10n, .libs, .resources, .includes, .globals, .components, .types, .docs, .tests
    asm.folders = {};
    asm.folders.assets = getPathIfExists(asm.src, options.build.assembly.folders.assets);
    asm.folders.l10n = getPathIfExists(asm.src, options.build.assembly.folders.l10n);
    asm.folders.libs = getPathIfExists(asm.src, options.build.assembly.folders.libs);
    asm.folders.resources = getPathIfExists(asm.src, options.build.assembly.folders.resources);
    asm.folders.includes = getPathIfExists(asm.src, options.build.assembly.folders.includes);
    asm.folders.globals = getPathIfExists(asm.src, options.build.assembly.folders.globals);
    asm.folders.components = getPathIfExists(asm.src, options.build.assembly.folders.components);
    asm.folders.types = getPathIfExists(asm.src, options.build.assembly.folders.types);
    asm.folders.docs = getPathIfExists(asm.src, options.build.assembly.folders.docs);
    asm.folders.tests = getPathIfExists(asm.src, options.build.assembly.folders.tests);

    // .files .main, .config, .settings, .routes
    asm.files = {};
    asm.files.main = getPathIfExists(asm.src, options.build.assembly.files.main);
    asm.files.config = getPathIfExists(asm.folders.settings, options.build.assembly.files.config);
    asm.files.settings = getPathIfExists(asm.folders.config, options.build.assembly.files.settings);
    asm.files.routes = getPathIfExists(asm.src, options.build.assembly.files.routes);

    // .asyncTypeLoading
    asm.asyncTypeLoading = (asm.files.main === ''); // in case of custom main, async-loading is not allowed otherwise yes

    // get list of all files of assembly
    // also check if any file changed since last-update, if currently skipBuild = true
    let set = getFiles(asm.name, asm.src, options.build.assembly.exclude, (asm.skipBuild ? asm.dest.lupdate : null));
    asm.files.list = set.files;
    asm.skipBuild = (asm.skipBuild ? !set.changed : false); // if set was changed, set asm.skipBuild = false (means do re-build this assembly)
    
    // .ado
    // build ado or pick from cache (if skipbuild was true, and/or still true)
    if (asm.skipBuild) {
        asm.ado = fsx.readJSONSync(asm.dest.adoCache, 'utf8');
    } else {
        asm.ado = {};
        asm.ado.n = asmName;
        asm.ado.f = (asm.dest.minify ? asm.dest.file.replace('.js', '{.min}.js') : asm.dest.file);
        asm.ado.f = pathJoin('./', asm.ado.f.replace(options.build.dest, ''));
        if (profileConfig.omitRoot) { asm.ado.f = asm.ado.f.replace(config.dest, ''); }
        asm.ado.p = {
            n: options.package.name,
            t: options.package.title,
            d: options.package.description,
        };
        asm.ado.i = guid();                     // internal id
        asm.ado.v = options.package.version; 
        asm.ado.u = new Date().toUTCString();   // last update
        asm.ado.c = options.package.copyright;
        asm.ado.l = options.package.license;
        asm.ado.b = {
            n: options.buildInfo.name,
            v: options.buildInfo.version
        },
        asm.ado.ns = [];                    // { n, t }
        asm.ado.ty = [];                    // { n, t }
        asm.ado.as = [];                    // { f, t, s }
        asm.ado.ro = [];                    // { n, m, p, h, v, w, i } 

        asm.assets = [];                    // { src: '', dest: '', skipCopy: t/f, lint: t/f, minify: t/f, gzip: t/f, name: '', file: {} }
        asm.components = [];                // ordered list { file: {}, name, '', lint: t/f, content: '', type: '' }
        asm.globals = [];                   // ordered list { file: {}, name, '', lint: t/f, content: '' }
        asm.types = [];                     // ordered list { file: '', ns: '', name, '', qualifiedName: '', lint: t/f, content: '', type: ''}
        asm.resources = [];                 // { file: {}, lint: t/f, minify: t/f}
        asm.includes = [];                  // { file: {} }
       
        // .assets, .components, .config, .globals, .libs, .locales, .resources, .tests, .types
        // .docs and .tests will be processed when assembly is built
        listAssets(options, asm);               // assets, known-assets, libs, locales, ado.as
        listFiles(options, asm);                // globals, resources, includes, ado.ro, etc.
        listComponents(options, asm);           // components
        listTypes(options, asm);                // ado.ns, types, ado.ty 

        // .members
        asm.members = asm.assets.length + asm.components.length + asm.globals.length + asm.includes.length + 
                      asm.types.length + asm.resources.length + 
                      asm.ado.ns.length + asm.ado.ro.length + 
                      (asm.files.main ? 1 : 0) + (asm.files.settings ? 1 : 0) + (asm.files.config ? 1 : 0) + (asm.files.routes ? 1 : 0);
        if ((!asm.skipDocs || !asm.skipTests)) { asm.members += '+'; }

        // .content
        asm.content = ''; // will be loaded when built
    }

    // return
    return asm;
};

const listAssets = (options, asm) => {
    // duplicate-check
    let allAssets = [];

    const addToLists = (file, dest, isCheckDuplicates) => {
        // duplicate check
        if (isCheckDuplicates && allAssets.indexOf(dest) !== -1) { throw `Duplicate asset file found. (${file.file} --> ${dest})`; } // duplicte found
        allAssets.push(dest);

        // file: { folder, file, filename, basename, ext, index, isAsset, isNamespaced, nsName, nsPath }
        // build item { src: '', dest: '', skipCopy: t/f, lint: t/f, minify: t/f, gzip: t/f, gzDest: '', name: '', file: {} }
        let item = {
            file: file,
            src: file.file,
            name: './' + dest.replace(asm.dest.files + '/', ''),   // give path/name wrt asm's own connected_files folder
            dest: dest,
            gzDest: '',
            skipCopy: (!options.session.build.full && fsx.existsSync(dest) && fsx.statSync(file.file).mtime <= asm.dest.lupdate),
            lint: (!asm.skipLint && !wildcards.isMatchAny(file.file, asm.profile.lint.exclude.assets) && options.lint.types.indexOf(file.ext) !== -1 && !file.basename.endsWith('.min.' + file.ext)),           // no need to run lint on a minified file
            minify: (!asm.skipMinify && !wildcards.isMatchAny(file.file, asm.profile.minify.exclude.assets) && options.minify.types.indexOf(file.ext) !== -1 && !file.basename.endsWith('.min.' + file.ext)),   // no need to run minify on a minified file
            gzip: (!asm.skipGzip && !wildcards.isMatchAny(file.file, asm.profile.gzip.exclude.assets) && options.gzip.types.indexOf(file.ext) !== -1)
        };
        if (item.gzip) { 
            if (item.minify) {
                item.gzDest = item.dest.replace(`.${item.file.ext}`, `.${item.file.ext}.gz`);
            } else {
                item.gzDest = item.dest + '.gz';
            }
        }

        // for processing
        asm.assets.push(item);

        // for preamble
        let adoItem = { // { f, t, s }
            f: item.name.replace(file.basename, (item.minify ? getMextFile(file.basename) : file.basename)),    // file: ensure name is mxet name, if need be
            t: item.file.ext,                                                                                   // type: extension of file
            s: Math.round(fsx.statSync(item.src).size / 1024)                                                   // size: file-size in KBs
        };
        asm.ado.as.push(adoItem);
    };

    if (asm.files.list.length > 0) {
        // since assets have variety of conditions to check, 
        // therefore instead of filtering the list, process entire list and
        // take decisions in one go itself
        let root = '',
            dest = '';
        for (let file of asm.files.list) { // { folder, file, filename, basename, ext, index, isAsset, isNamespaced, nsName, nsPath }
            // process files in assets folder
            root = asm.folders.assets; if (!root.endsWith('/')) { root += '/'; }
            if (file.file.startsWith(root)) {
                dest = file.filename.replace(asm.folders.assets, asm.dest.files); // move as is from assets folder's root to <asmName>_files folder's root
                addToLists(file, dest, false);
            } else {
                // process files in libs folder
                root = asm.folders.libs; if (!root.endsWith('/')) { root += '/'; }
                if (file.file.startsWith(root)) {
                    dest = file.filename.replace(asm.folders.libs, pathJoin(asm.dest.files, options.build.assembly.folders.libs)); // move as is from libs folder's root to <asmName>_files/libs folder's root
                    addToLists(file, dest, false);
                } else {
                    // process namespaced, inplace and known assets (excluding localized assets)
                    //  where names started with (@). as an indicator of random asset
                    //  or ext is listed in known assets list
                    if ((file.isAsset || (file.isNamespaced && options.assets.ext.indexOf(file.ext) !== -1)) && !file.isL10n) {
                        dest = file.filename.replace(file.nsPath, pathJoin(asm.dest.files, file.nsName)); // move as is from namespace folder's root to <asmName>_files/<nsName> folder's root
                        addToLists(file, dest, true);
                    } else {
                        // process all localized assets
                        // files that are in l10n folder or placed elsewhere 
                        // either inside namespace or outside namnespace
                        root = asm.folders.l10n; if (!root.endsWith('/')) { root += '/'; }
                        if (((file.isAsset || (file.isNamespaced && options.assets.ext.indexOf(file.ext) !== -1)) && file.isL10n) || 
                            file.file.startsWith(root)) {
                            let l10nFile = '',
                                l10nSrc = '',
                                destTemplate = '';
                            if (file.file.startsWith(root)) {
                                destTemplate = file.filename.replace(asm.folders.l10n, pathJoin(asm.dest.files, options.build.assembly.folders.l10n, '<<locale>>')); // move as is from locales folder's root to <asmName>_files/l10n/<localeId> folder's root
                            } else {
                                destTemplate = file.filename.replace(file.nsPath, pathJoin(asm.dest.files, options.build.assembly.folders.l10n, '<<locale>>', file.nsName)); // move as is from namespace folder's root to <asmName>_files/l10n/<localeId>/<nsName> folder's root
                            }

                            // default locale copy
                            dest = destTemplate.replace('<<locale>>', options.l10n.default);
                            addToLists(file, dest, true);
                

                            // pick localized copies (of the files, for all configured locales)
                            if (options.l10n.perform) { // only when localization for build is to be performed
                                for(let locale of options.l10n.current) {
                                    if (locale !== options.l10n.default) { // default is already processed above
                                        //. change source, to pick it from ./l10n/<localeId>/... insead of .src/
                                        l10nSrc = pathJoin(options.l10n.src, locale);
                                        l10nFile = Object.assign({}, file);
                                        l10nFile.file = l10nFile.file.replace(options.build.src, l10nSrc);
                                        if (!fsx.existsSync(l10nFile.file)) {
                                            if (options.l10n.copyDefault) { // if default locale's copy is to be used
                                                l10nFile = file;
                                            } else {
                                                throw `Localized version (${l10nFile.file}) missing for '${locale}' locale. (${file.file})`;
                                            }
                                        } else {
                                            // fix rest paths as well
                                            l10nFile.folder = l10nFile.folder.replace(options.build.src, l10nSrc);
                                            l10nFile.filename = l10nFile.filename.replace(options.build.src, l10nSrc);
                                        }

                                        // locale specific copy
                                        dest = destTemplate.replace('<<locale>>', locale);
                                        addToLists(l10nFile, dest, true);
                                    }
                                }
                            }
                        } // else some other file, not an asset
                    }
                }
            }
        }
    }
};
const listFiles = (options, asm) => {
    if (asm.files.list.length > 0) {
        // globals
        if (asm.folders.globals) {
            // get all files which are in globals folder
            let files = filterFiles(asm.files.list, asm.folders.globals, true),
                allNames = [],
                item = null;
            for(let file of files) { // { folder, file, filename, basename, ext, index, isAsset, isNamespaced, nsName, nsPath }
                // duplicate check
                name = file.basename.replace('.' + file.ext, ''); // remove ext
                if (name.indexOf('.') !== -1) { throw `Global name (${name}) cannot have dots. (${file.file})`; }
                if (allNames.indexOf(name) !== -1) { throw `Duplicate global name (${name}) found. (${file.file})`; }
                allNames.push(name);

                // build item { file: {}, name: '', lint: t/f, content: '', filename: '' }
                item = {
                    file: file,
                    name: name,
                    filename: file.filename.replace(asm.folders.globals, '.'),
                    content: '',    // will be loaded when assembly is build
                    lint: (!asm.skipLint && options.build.assembly.lint.members && !wildcards.isMatchAny(file.file, asm.profile.lint.exclude.globals) && fsx.statSync(file.file).mtime > asm.dest.lupdate)
                };
                asm.globals.push(item);
            }
        }

        // includes
        if (asm.folders.includes) {
            // get all files which are in includes folder
            let files = filterFiles(asm.files.list, asm.folders.includes),
                item = null;
            for(let file of files) { // { folder, file, filename, basename, ext, index, isAsset, isNamespaced, nsName, nsPath }
                if (file.ext !== 'js') { throw `Only javascript files can be included. (${file.file})`;  }
                // build item { file: {}, name: '', filename }
                item = {
                    file: file,
                    filename: file.filename.replace(asm.folders.includes, '.'),
                    name: file.filename.replace(asm.folders.includes, '').substr(1)       // './includes/a/b/c.txt' --> 'a/b/c.txt'
                };
                asm.includes.push(item);
            }
        }

        // resources
        if (asm.folders.resources) {
            // get all files which are in resources folder
            let files = filterFiles(asm.files.list, asm.folders.resources),
                item = null;
            for(let file of files) { // { folder, file, filename, basename, ext, index, isAsset, isNamespaced, nsName, nsPath }
                // build item { file: {}, name: '', encoding: '', lint: t/f, minify: t/f, filename: '' }
                item = {
                    file: file,
                    name: file.filename.replace(asm.folders.resources, '').substr(1),       // './resources/a/b/c.txt' --> 'a/b/c.txt'
                    filename: file.filename.replace(asm.folders.resources, '.'),            // './resources/a/b/c.txt' --> './a/b/c.txt'
                    encoding: (options.resources.encodings.utf8.indexOf(file.ext) !== -1 ? 'utf8' : ''),
                    lint: (!asm.skipLint && !wildcards.isMatchAny(file.file, asm.profile.lint.exclude.resources) && options.lint.types.indexOf(file.ext) !== -1 && !file.basename.endsWith('.min.' + file.ext)),           // no need to run lint on a minified file,
                    minify: (!asm.skipMinify && !wildcards.isMatchAny(file.file, asm.profile.minify.exclude.resources) && options.minify.types.indexOf(file.ext) !== -1 && !file.basename.endsWith('.min.' + file.ext))    // no need to run minify on a minified file
                };
                asm.resources.push(item);
            }
        }
        
        // routes
        if (asm.files.routes) {
            // read file's content, check for duplicates, add to ADO and finally sort by m + i
            // Each route Definition can be: { name, mount, path, handler, verbs[], mw[], index } 
            // {
            //   n - name:  route name, to access route programmatically, all names across files must be unique 
            //              these can be anything: a.b.c or a/b/c style -- generally a simplified version of the path itself can be name
            //              e.g., if path is: 'order/edit/:id?' -- name can be: 'order/edit' OR 'order.edit'
            //   m - mount: route root mount name - by default it is 'main', as per config.json setting, it can be any other mount also 
            //              each mount is a different express/page app for server/client
            //   p - path:  route path in relation to the mount
            //   h - handler:   qualified type name (generally a class) that handles this route
            //   v - verbs: name of the verbs supported on this route, like get, post, etc. - handler must have the same 
            //              name methods to handle this verb - methods can be sync or async
            //              can be defined as comma delimited string
            //   w - middleware:    standard server (express middlewares)/client (custom types) middleware definitions 
            //                      as per usage context -> { name: '', func: '', args: [] } OR { name: '', args: [] }
            //   i - index: any + or - number to move routes up or down wrt other routes in current assembly, as well as
            //              across assemblies. All routes from all assemblies are sorted by index before being activated
            //              routes are indexed first and then applied in context of their individual mount
            //              mount's order in config ultimately defines the overall order first than the index of the route 
            //              itself inside the mount
            //  }            
            let allNames = [],
                items = fsx.readJsonSync(asm.files.routes, 'utf8');
            for(let item of items) {
                // validate
                if (!item.name || !item.path || !item.handler) {throw `Invalid route definition found. (${item.name})`; } // mandatory fields
                if (allNames.indexOf(item.name) !== -1) { throw `Duplicate route name found. (${item.name})`; }
                allNames.push(item.name);

                // add item { n, m, p, h, v, w, i }
                asm.ado.ro.push({
                    n: item.name,
                    m: item.m || '',        // empty means 'main'
                    p: item.path,
                    h: item.handler,
                    v: item.verbs || '',    // empty means 'get' (on server) and 'view' (on client)
                    w: item.mw || [],
                    i: item.index || 0
                });
            }

            // sort all routes by mount + index (index is padded to a 4 place leading zeros, so 'main1' comes first than 'main11')
            asm.ado.ro = asm.ado.ro.sort((a, b) => a.m + String(a.i).padStart(4, '0') > b.m + String(b.i).padStart(4, '0') ? 1 : -1);
        }
    }
};
const listComponents = (options, asm) => {
    if (asm.files.list.length > 0) {    
        if (asm.folders.components) {
            // get all files which are in components folder
            let files = filterFiles(asm.files.list, asm.folders.components, true),
                allNames = [],
                name = '',
                item = null;
            for(let file of files) { // { folder, file, filename, basename, ext, index, isAsset, isNamespaced, nsName, nsPath }
                // duplicate check
                name = file.basename.replace('.' + file.ext, ''); // remove ext
                if (name.indexOf('.') !== -1) { throw `Component name (${name}) cannot have dots. (${file.file})`; }
                if (allNames.indexOf(name) !== -1) { throw `Duplicate component name (${name}) found. (${file.file})`; }
                allNames.push(name);

                // build item { file: {}, name, '', lint: t/f, content: '', type: '', filename: '' }
                item = {
                    file: file,
                    name: name,
                    filename: file.filename.replace(asm.folders.components, '.'),
                    content: '',        // will be loaded when assembly is built
                    type: '', // will be loaded when assembly is built
                    lint: (!asm.skipLint && options.build.assembly.lint.members && !wildcards.isMatchAny(name, asm.profile.lint.exclude.components) && fsx.statSync(file.file).mtime > asm.dest.lupdate)
                };
                asm.components.push(item);
            }
        }
    }
};
const listTypes = (options, asm) => {
    const addTypes = (ns, files) => {
        let item = null,
            allNames = [],
            qualifiedName = '',
            name = '',
            adoItem = null;
        for(let file of files) { // { folder, file, filename, basename, ext, index, isAsset, isNamespaced, nsName, nsPath }
            // types are always .js files, any other extension could be known assets, so process only .js files here
            if (file.ext !== 'js') { continue; }

            // duplicate check
            name = file.basename.replace('.' + file.ext, ''); // remove ext
            if (name.indexOf('.') !== -1) { throw `Type name (${name}) cannot have dots. (${file.file})`; }
            qualifiedName = (ns !== '' ? ns + '.' + name : name); // add namespace to name, except for root ns
            if (allNames.indexOf(qualifiedName) !== -1) { throw `Duplicate type name (${qualifiedName}) found. (${file.file})`; }
            allNames.push(qualifiedName);

            // build item { file: '', ns: '', name, '', qualifiedName: '', lint: t/f, content: '', type: '', filename: '' }
            item = {
                file: file,
                ns: ns,
                name: name,
                filename: file.filename.replace(asm.folders.types, '.'),
                qualifiedName: qualifiedName,
                content: '',    // will be loaded when assembly is built
                type: '',       // will be loaded when assembly is built
                lint: (!asm.skipLint && options.build.assembly.lint.members && !wildcards.isMatchAny(name, asm.profile.lint.exclude.types) && fsx.statSync(file.file).mtime > asm.dest.lupdate)
            };
            asm.types.push(item);

            // ado.ty
            // build item { n: '', t: '' }
            adoItem = {
                n: item.qualifiedName,
                t: ''              // will be defined when actual file content is read during build time
            };
            asm.ado.ty.push(adoItem);
        }
    };
    const addNS = (ns) => {
        // get files under this namespace
        let nsPath = pathJoin(asm.folders.types, ns),
            filteredFiles = asm.files.list.filter(file => file.nsPath === nsPath && !file.isAsset),
            files = sortFiles(filteredFiles);
        if (files.length > 0) { // if files found under this namespace
            // add types of this namespace
            addTypes(ns, files);

            // ado.ns
            // build item { n: '', t: 0 }
            let item = {
                n: ns,                  // name of the namespace
                t: files.length         // types count under this namespace
            };
            asm.ado.ns.push(item);
        }
    };

    if (asm.files.list.length > 0) {  
        if (asm.folders.types) {
            // add root namespace
            addNS('');

            // iterate on all namesapces
            // every folder under ./types folder is a namespace
            // ./types itself is for root namespace
            let nsList = getFolders(asm.folders.types, true);
            for (let ns of nsList) {
                addNS(ns);
            }
        }
    }
};
