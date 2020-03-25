const fsx = require('fs-extra');

// build configuration options
// any custom settings are merged-overwritten on this object
// as defined in flair.json
module.exports = {
    // runtime session settings set at command line
    session: {
        // if logging is to be supressed for the session
        // --nolog
        suppressLogging: false,

        // build mode
        build: {
            // if runs full-build
            // --full
            full: false,

            // if runs quick-build
            // if both --full and --quick is given, this one is ignored
            // --quick
            quick: false,

            // identifier flag: dev, prod, etc.
            flag: ''
        }
    },

    // lint configuration
    lint: {
        // master switch for lint operation
        perform: true,

        // run lint on these types of files
        types: ['js', 'css', 'html'],

        // https://eslint.org/docs/user-guide/configuring AND https://eslint.org/docs/developer-guide/nodejs-api#cliengine
        js: require('./build/options/lint-js.json'),

        // https://github.com/stylelint/stylelint/blob/0e378a7d31dcda0932f20ebfe61ff919ed1ddc42/docs/user-guide/configuration.md
        css: require('./build/options/lint-css.json'),

        // https://www.npmjs.com/package/htmllint AND https://github.com/htmllint/htmllint/wiki/Options
        html: require('./build/options/lint-html.json')
    },

    // minify configuration
    minify: {
        // master switch for minify operation
        perform: true,

        // minify these types of files
        types: ['js', 'css', 'html'],

        // generate source maps
        maps: false,

        // https://github.com/mishoo/UglifyJS2/tree/harmony
        js: require('./build/options/minify-js.json'),

        // https://www.npmjs.com/package/clean-css
        css: require('./build/options/minify-css.json'),

        // https://www.npmjs.com/package/html-minifier
        html: require('./build/options/minify-html.json')
    },

    // gzip configuration
    // if a specific options are required for specific file type
    // options can be defined here under with corrosponding file-type-named-property
    // e.g., gzip.svg: {...} can have svg specific gzip options.
    // if a specific found, it will pick options from gzip.common for that file type  
    gzip: {
        // master switch for gzip operation
        perform: true,

        // gizp these types of files
        types: ['js', 'css', 'html', 'txt', 'xml', 'md', 'json', 'svg', 'jpg', 'jpeg', 'gif', 'png'],

        // https://nodejs.org/api/zlib.html#zlib_class_options AND https://www.zlib.net/manual.html
        common: require('./build/options/gzip-common.json')
    },

    // scramble configuration
    scramble: {
        // master switch for scramble operation
        perform: false
    },

    // resource configuration
    resources: {
        // specified type of encoding can be defined based on file extensions
        // all utf8 encoded resources will also be encoded as base64 before being
        // bundled
        // any file type not defined in the list will be base64 encoded
        encodings: {
            // perform utf8 encoding for these types
            utf8: ['txt', 'xml', 'js', 'md', 'json', 'css', 'html', 'svg']
        },

        // perform lint on resource files of supported types
        lint: true,

        // perform minification of resource files of supported types, before bundeling
        minify: true
    },

    // assets configuration
    assets: {
        // perform lint on asset files of supported types
        lint: true, 

        // perform minification of asset files of supported types
        minify: true,
        
        // perform gzip for minidifed asset files of supported types
        gzip: true
    },    

    // build opetation configuration
    build: {
        // source files
        src: './src',

        // exclude these special folders at source root
        // if assemmblies are being picked from source root
        exclude: ['guides', 'tests', 'examples', 'docs'],

        // destination, where generated files will be placed
        dest: './dist',

        // files across build sessions are cached here and also any temp operations are performed here
        cache: './temp',
        
        // master switch to stop using cache (and eventually build always)
        useCache: false,

        // clean destination folder before each new build
        clean: true,

        // upgrade version on every build
        version: true,

        // special files used for various processings
        files: {
            // package json file to update version and pick project information from
            package: './package.json',

            // one or more meta information files that gets generated for each profile
            // as per profile configuration
            // this file contains the meta data about the assembly, so not all code is loaded
            // and just meta information is loaded - till the time, actual code is needed in execution
            preamble: 'preamble.js',

            // environmental vars and flags are written in this file
            // as per profile configuration
            flags: 'flags.json'
        },

        // assembly identifiers
        assembly: {
            lint: {
                // perform lint on individual assembly members, if false, it will run on bundled assembly only
                // this runs for only those members which are changed since last build
                members: true
            },

            // all these files (when present) are processed/bundled during assembly generation
            files: {
                // assembly's custom initializer file name,
                // when not present (recommended not to include) it picks the default template
                main: 'index.js',

                // assembly's file injections list
                // if any files need to be injected inside assembly in a seperate closure, these can be defined
                // in this file at assembly root folder, where each injection can be defined as:
                // <!-- inject: ./relative/file/path/from/asm/root/fileName.js -->
                // any number of such injections can be defined
                // injections are done, even before globals are added, so anything that these injected files load
                // can be referred in globals as well
                // no lint is executed on these injected files, however minification do happen, as min is 
                // done on whole assembly file
                injections: 'injections.js',

                // a json file which gets embedded in assembly and
                // all of the content is available in assembly closure as 'settings' object
                // values of this object cannot be changed at runtime
                settings: 'settings.json',

                // a json file which gets embedded in assembly and
                // all of the content is available in assembly closure as 'config' object
                // values of this object are merged with values defined in './appConfig.json' or './webConfig.json'
                // file at runtime once at assembly load, and thereafter this object cannot be changed
                config: 'config.json',

                // info file for every member type (where documentation does not exists in code)
                docsinfo: 'docs.info',

                // info file for every namespace (must exists at root folder of the namespace)
                nsinfo: 'ns.info'
            },

            // all special purpose folders
            folders: {
                // assets folder can exists at the root of the assembly
                // files places in this special folder are copied to assembly's connected files folder after doing asset specfic processing like minify, gzip etc.
                // ./src/asm/assets/* -> ./dest/asm/*
                assets: 'assets',

                // libs folder can exists at the assembly root folder only
                // files places in this special folder are copied to assembly's connected files folder as is, without any processing
                // this is suited for 3rd-party files, which are to be accoompained by the assembly
                // ./src/asm/libs/* -> ./dest/asm/libs/*
                libs: 'libs',

                // locales folder can exists at the assembly root folder only
                // files places in this special folder are copied to assembly's connected files folder as is, without any processing
                // underneath this folder should exists locale specific folder to keep same name files under all supported locales
                // the name of these sub-folders should match to codes define at: https://www.metamodpro.com/browser-language-codes
                // under each of these locale folders any number of json files can ke placed with { key: value } structure to have
                // string-key with localized-value translsation for the corrosponding locale where this file is placed
                // ./src/asm/locales/* -> ./dest/asm/locales/*
                locales: 'locales',

                // resources folder can exists at the assembly root folder only
                // files places in this special folder are bundled as embedded resources in the assembly and resources are available
                // as text/object/binary content inside assembly using getResource() using the file and path of the resource
                // files can be arranged in any structure here, and the path/filename.ext becomes the id of the file to pass to getResource
                // ./src/asm/resources/* -> getResource(*)
                // ./src/asm/resources/a/b/c/d.json -> getResource('a/b/c/d.json');
                resources: 'resources',

                // routes folder can exists at the assembly root folder only
                // routes.json format files places in this special folder are read, flatten as one list, order by index and 
                // added in preamble for routes definition ahead of loading of actual assembly
                // any number of json files in any folder structure can exists, however all should be in a specific 
                // format: [{ name, mount, handler, verbs, mw, index, desc }, ...]
                routes: 'routes',

                // globals folder can exists at the assembly root folder only
                // .js files placed in this special folder are bundled as is, in assembly's main closure and these constructs
                // will be available to all components and types that gets bundled in assembly
                // note: these globals are assembly level globals and not generic globals
                globals: 'globals',
                
                // config folder can exists at the assembly root folder only
                // this is a place where various types of known configuration files are placed
                // e.g., config.json,           server-config.json,         client-config.json, 
                //       worker-config.json,    server-worker-config.json,  client-worker-config.json
                config: 'config',

                // settings folder can exists at the assembly root folder only
                // this is a place where settings.json file is kept.
                // settings are design-time configuration that does not change at runtime
                settings: 'settings',                

                // components folder can exists at the assembly root folder only
                // files placed in this special folder are bundled as components inside the
                // assembly. 
                // there can be any folder structure underneath, but all files in any folder
                // are processed as one single list
                // ./src/asm/components/* -> ./dest/asm.js
                components: 'components',

                // types folder can exists at the assembly root folder only
                // folders directly under this folder are all treated as namespaces 
                // files placed directly under this root folder are pladced in root nameapce
                // namespace folders can have dots in their name to have hierarchy of namespaces (e.g., a.b.c, a.b.c.d, etc.)
                // under the namespace folder name, there can be any structure of folders, and they all will be treated 
                // under same namespace
                // this way, the published structure (namespaces) can be different that local structure (the folders inside namesapce)
                types: 'types',                

                // tests folder can exists at the assembly root folder only
                // this is a place where all multi-member test specs for this assembly can be placed
                // only those tests which are in docs.info file here, will go into documentation
                // while all specs will still be run by test engine irrespective of its link in docs.info
                // all other member-specific tests should be written in same name .spec.js file
                tests: 'tests',

                // examples folder can exists at the assembly root folder only
                // this is a place where all multi-member example links for this assembly can be placed in docs.info file here
                // all other member-specific examples should be written in @fiddle 
                examples: 'examples', 

                // guides folder can exists at the assembly root folder only
                // this is a place where all assembly specifc guides can be placed in .md files with their links in docs.info file here
                guides: 'guides'                 
            },

            // these folders, files and extension are skipped from normal iteration process
            // and may be handled specifically on a case to case basis
            // use standard wildcards
            exclude: ['_*', '*.spec.js', '*.mjs'],

            // assembly file generation helper template
            main: require.resolve('./build/templates/asm/index.js')
        },
        
        profiles: {
            // name of the profiles to build in this order
            // each profile must be defined here under 'profiles' as a key
            // if none is defined, it will look for 'default' named entry
            // some typical profile names are: server, client, etc.
            // default is special name, and is used where its not a typical app
            // or only server/client app
            // there can be multiple profiles created for same scenario, e.g.,
            // having two copies of server-code as: server-something1 and server-something2
            // and then just build may-be only 1 of these using only required names in
            // this list here
            list: [],
            
            // default profile is used for simple projects with no complex file groups 
            default: {
                // this path is joined with main source path to get root source path of the profile
                // this can take following values:
                //          '': empty                   -> ./src/
                //         '@': takes the profile name  -> ./src/default/
                //  'somename': takes given name        -> ./src/somename/
                src: '',                                

                // this path is joined with main dest path to get root dest path of the profile
                // this can take following values:
                //          '': empty                   -> ./dist/
                //         '@': takes the profile name  -> ./dist/default/       
                //  'somename': takes given name        -> ./dist/somename/
                // '@profile2': takes dest of profile2  -> <profile2's destination path>/
                dest: '',
                
                preamble: {
                    // true: if single preamble.js to created at the profile dest folder having all assembly registrations of all grpups
                    // false: individual preamble.js will be created at the root dest folder of each group
                    oneforall: true,
    
                    // no registration code will be included for these assemblies
                    // name of the assemblies
                    // use wildcard patterns for assemble names
                    exclude: []
                },

                // if true, it will replace root folder name with '' when building assembly file path and name for preamble
                // this is generally set to true for client installation, if client files are being served from inside 
                // server files (e.g., www/ is placed inside server profile's dest folder via @<server-profile> dest)
                omitRoot: false,

                // group of assemblies 
                // every entry under here is treated as one group of assemblies
                // first level folders under each of these folders are treated as one assembly
                // if no groups are given in this, the root src folder of this profile is treated
                // as one group itself
                // ability to group multiple assemblies together in a seperate folder
                // under same profile, brings decent modularity and these groups of asseblies
                // can be treated as feature-set / modules / packages / whatever we call them
                // and since these are individual assemblies, their load is still controlled and on-demand
                // each of these group folder here under is created as is under destination where-in all
                // the generated assemblies are kept
                // some typical group names are: app, api, www, etc.
                groups: [],

                lint: {    
                    // optionally can be turned off/on for the profile
                    // this works only if main lint perform is turned on
                    perform: true,

                    // exclude run lint on these files of this profile  
                    // define wildcard patterns for all entries
                    // for assemblies, use assembly names for wildcard
                    // for resources, use resource name for wildcard
                    // for assets and globals, use file names for wildcards
                    // for components, and types use component/type names for wildcards
                    exclude: {
                        assemblies: [],
                        resources: [],
                        assets: [],
                        components: [],
                        globals: [],
                        types: []
                    }
                },

                minify: { 
                    // optionally can be turned off/on for the profile
                    // this works only if main minify perform is turned on
                    perform: true,

                    // exclude run minify on these files of this profile   
                    // define wildcard patterns for all entries
                    // for assemblies, use assembly names for wildcard
                    // for resources, use resource name for wildcard
                    // for assets, use file names for wildcards
                    exclude: { 
                        assemblies: [],
                        resources: [],
                        assets: []
                    }
                },
                
                gzip: {
                    // optionally can be turned off/on for the profile
                    // this works only if main gzip perform is turned on
                    perform: true,

                    // exclude run gzip on these files of this profile 
                    // define wildcard patterns for all entries
                    // for assemblies, use assembly names for wildcard
                    // for assets, use file names for wildcards
                    exclude: {
                        assemblies: [],
                        assets: []
                    }
                },

                scramble: {
                    // if assembly scramble needs to be perormed
                    perform: true,

                    // define wildcard patterns for all assembly names of this profile
                    // for which code needs to be scrambled
                    include: []
                },

                // this can exclude annotation injections for special cases
                // for flair's own usage
                // normally does not need to be set
                injections: {
                    // use wiledards for component/type (qualified name) names
                    exclude: {
                        components: [],
                        types: []
                    }
                }
            }
        }
    },

    // custom tasks
    // these custom tasks can be performed 
    // at various level of build processing
    custom: {
        // master switch to perform custom tasks (at any level)
        perform: true,

        // every task definition here represents an individual task (a node module function)
        // each item defines:
        // <task_name>: {
        //      module: '', <-- if no path, it is assumed to be a flairBuild built-in task, else resolved in context of the package's root
        //      config: { } <-- any default config that task may need
        // } 
        // each pre/post node can define an array having:
        // { task: <task_name>, config: {... config overwrides for this level instance } }   <-- any changes to default config, for this level/instance of execution
        // each task module is executed with 'taskConfig'
        //  1. taskConfig will have merged overwritten values of default config with level/instance specific changes applied
        //  2. additionally taskConfig will get one additional property: current
        //     { mode: 'pre'/'post', level: '(empty)/profile/group/asm', options, profile, group, asm}
        //     
        tasks: {

            // copy files from src to dest
            copy: {
                module: 'copy',
                config: {
                    src: '',
                    dest: '',
                    exclude: [],
                    clean: false,
                    skipOnQuick: false,
                    skipOnFull: false
                }
            },

            // delete files in dest folder
            del: {
                module: 'del',
                config: {
                    path: '',
                    exclude: [],
                    skipOnQuick: false,
                    skipOnFull: false                    
                }
            }
        },

        // further nodes below here can define which tasks need to be executed at which point-in-time:
        // multiple instances of same task can be executed at same or different levels
        // {                                    
        //      pre: []                         <-- before anything else
        //      post: []                        <-- after all is done
        // }
        // assemblies: {                    
        //      pre: []                         <-- before assembly (for all assemblies), even before assembly's own pre
        //      post: []                        <-- after assembly (for all assemblies), but after assemblie's own post
        // }
        // profiles: {
        //      <profileName>: {
        //          pre: []                     <-- before any assembly of any group of the profile
        //          post: []                    <-- after all assemblies of all groups of the profile
        //          groups: {
        //              <groupName>: {
        //                  pre: []             <-- before any assemblies of the group
        //                  post: []            <-- after all assemblies of the group
        //                  assemblies: {
        //                      <assemblyName>: {
        //                          pre: []     <-- before assembly, but after all /assemblies/pre
        //                          post: []    <-- after assembly, but before all /assemblies/post
        //                      }
        //                  }
        //              }
        //          }
        //      }
        //  }
    },

        // // extended operations plugins
        // plugins: {
        //     // execution sequence as well as list
        //     // if settings for a plugin are defined
        //     // corrosponding plugin will execute
        //     // else not
        //     // if no settings are required, still
        //     // an empty object must be defined for that 
        //     // plugin to kick-in
        //     list: [ 
        //         'copy_files',
        //         'copy_modules',
        //         'install_modules',
        //         'minify_files',
        //         'create_bundles',
        //         'write_flags'
        //     ],
          


        //     // copy modules
        //     // for cases where any node module is good for both
        //     // server and client usage without any change, this plugin
        //     // copies defined node_modules folder (from already installed source location) as is on client's module
        //     // folder path as condigured
        //     // plugin config:
        //     //  src: name and path of the source node_modules folder, in context of the project root folder
        //     //  dest: name and path of the folder, in context of dest root of the profile where modules are copied
        //     //  exclude: exclude these matching glob pattern files, when copying the files of a module
        //     copy_modules: { src: './node_modules', dest: './modules', exclude: ['package.json'] },

        //     // install modules
        //     // this is executed on the dest after files are built
        //     // to install node_modules in dest folder as defined in
        //     // package.json of that dest folder
        //     // the actuall install command can be defined here while 'flags'
        //     // for various profile can be different and are defined in profile
        //     // config
        //     // plugin config:
        //     //  cmd: define the command to use
        //     //  flags: define the flags for the command
        //     install_modules: { cmd: 'yarn install <<flags>>', 'flags': '--prod' },

        //     // minify files
        //     // minify specified files for special cases
        //     // this is not needed for regular assembly files which are
        //     // taken care of separately 
        //     // this plugin will work only when master minify switch is true
        //     // plugin config:
        //     //  gzip: true/false        <-- this works only if master gzip switch is true
        //     minify_files: { gzip: true },

        //     // create bundle
        //     // this bundle all files under specified source path and
        //     // generate a bundled destination file
        //     // this is not needed for regular assembly files which are
        //     // taken care of separately 
        //     // plugin config:
        //     //  minify: true/false          <-- if bundled file is to be minified. This works only when master minity switch is true
        //     //  gzip: true/false            <-- if bundled file is to be gzipped. This works only when above minify and master minity switches are true
        //     create_bundles: { minify: true, gzip: true },

        //     // write flags
        //     // this generates the environment flags json file
        //     // flags help in identifying the build type 
        //     // plugin config:
        //     //  file: flags file name
        //     //  mode: build mode env var/flag
        //     //  env: env variables
        //     write_flags: { file: 'flags.json', mode: 'dev', env: {} }
        // },

                // // all extended operations to be executed for this profile
                // // after profile's source is processed for key operations (assembly, docs, etc.)
                // // each operation is executed by a plugin and the engine
                // // knows the relative sequence of plugin execution
                // // plugin names are same as propery names under operations
                // // so these settings are picked as is and passed to the plugin
                // // to run in current context
                // plugins: {
                //     // copy files from source folder of this profile to 
                //     // given destination folder as is
                //     copy_files: {
                //         // this joins with the root dest folder of the profile
                //         dest: '',

                //         // wildcard patterns of files to copy (from this profile's source) 
                //         // as is with the same relative path on given destination
                //         list: []                                    
                //     },

                //     // copy all specified "node_modules" to defined destination folder as is
                //     // this is generally helpful in transferring npm modules to client-side
                //     // NOTE: unlike browserify, it does not check dependencies, therefore only 
                //     // those modules which work independently, are suited for this
                //     copy_modules: {
                //         // node_module name, ...
                //         list: []                                    
                //     },

                //     // install specified package dependencies under node modules folder
                //     // of this profile
                //     install_modules: {
                //         // defines the command line flags for the 'yarn install' command
                //         flags: '--prod'                             
                //     },           

                //     // generate minify files for a file already at destination
                //     // this is generally helpful when a file was downloaded or a file was copied from a node_module to
                //     // destination, but needs to be minified later
                //     minify_files: {
                //         // this joins with the root 'dest' folder (not src folder) of the profile
                //         src: '',

                //         // wildcard patterns of files to minify (from this profile's source) 
                //         // as is at the same place where file exists
                //         list: []                                    
                //     },

                //     // create bundles of some random js files
                //     // this is generally helpful in bundeling external frameworks
                //     // and libraries in one file for easy inclusion
                //     // { src, dest }
                //     //  src: '', // this joins with the root src folder of the profile, where-in all js files are picked and bundled as one file
                //     //  dest: '' // this joins with the root dest folder of the profile, this should also have the file name of the created bundle
                //     create_bundles: {
                //         list: []                              
                //     }
                // }




    //     // both pre and post arrays have enties like: 
    //     //  {src, dest, exclude}
    //     // src:
    //     //  source paths are resolved path in context of project's root folder (not the defined src folder)
    //     //  src can also be defined as: http* - Given http/https source
    //     // dest: 
    //     //  dest paths are resolved in context of defined dest folder
    //     // clean: true/false                    <-- delete all content of dest folder before copy, if set to true
    //     // onlyMin: true/false                  <-- exclude a js file for which a min.js exists
    //     // exclude: []                          <-- support standard wild-cards (https://www.npmjs.com/package/matcher)

    // One task can be: DelMinIfJS: which will delete .js file if corrosponding .min.js exists
    // or we can keep a flag in copy itself, to skip .js if .min.js exists


    // docs generation configuration
    docs: {
        // master switch for docs generation
        perform: true,

        // master switch to build search data
        search: {
            build: true
        },

        // fiddle example configuration
        fiddle: {
            // jsfiddleExample username
            // fiddle examples user contains the username in it
            // all examples will be reached via this username
            userName: '',

            // jsFiddle embedded fiddle url template
            urlTemplate: 'https://jsfiddle.net/<<userName>>/<<fiddleId>>/embedded/<<options>>/'
        },

        dest: {
            // where to copy runtime engine
            // this is the folder that is the root of the web server
            // service the documentation
            // engine is index.html itself
            root: './docs',

            // where to generate docs .json files under the root
            content: 'content',
        },

        // which theme to pick
        // custom themes can be installed in \themes folder
        // by keeping them inside src/docs/themes folder
        // each theme is expectd to have following files
        // mandatory:
        //  ./index.json { js: [], css: [] }
        //  ./html/index.html
        // optional:
        //   js files to load (defined in index.json)
        //   css files to load (defined in index.json)
        // templates (./html/*.html) - all optional:
        //   header, footer
        //   assembly
        //   globals, global
        //   components, component, annotation
        //   namespaces, namespace, types
        //   class, interface, struct, mixin, enum
        //   const, prop, event, func
        //   config, config-item
        //   settings, settings-item
        //   resources, resources-item
        //   routes, routes-item
        //   assets, assets-item
        //   locales, locales-item
        //   libs, libs-item
        //   examples, examples-item
        //   guides, guides-item
        //   tests, tests-item
        // any missing file in custom theme will be picked from default theme
        // default theme will always be overwritten with 
        // default theme
        //
        // NOTE: at each collection (package) level, following files can be placed in ./src/docs folder
        // and they will be processed over and above theme files
        //  ./index.json -- to load custom js and css at package level
        //  ./html/index.html -- to serve as package/collection specific home
        //  ./html/header.html -- to server as package/collection specific header
        //  ./html/footer.html -- to server as package/collection specific footer
        // with this way, without making a custom theme, still custom home can be provided for the package
        theme: '',

        // in a multi-project scenario, where docs need to be served from one place as collection
        // there must be one main repo which has this definition setup, and all
        // this also needs to write some post-build commands to download/copy docs
        // from other repos at right place
        // e.g., { name: 'flairjs', title: 'Flair.js' }
        packages: [],

        versions: {
            // all available versions to show on the ui
            // e.g., { name: 'v1', title: '1.x' }
            list: [],

            // current version details
            current: {
                // to be picked by default 
                name: 'v1',

                // version specific available locales
                locales: {
                    // all available locales for this version to show on the ui
                    //  e.g., { name: 'en', title: 'English' }
                    // NOTE: currently only english language is supported, as no translation or alternative
                    // approach is defined. However for UI sake, this process exists                    
                    list: [], 
                    
                    // default locale of current version
                    current: 'en'
                }
            }
        },

        // wildcards for assembly names for which documentation is not to be processed
        exclude: [],

        // any whitelisted custom symbols that can be used in documentation blocks
        // this way, typos can be avoided when it will throw for any unknown symbols
        // and for any custom reason, whitelisted symbols will be allowed as well
        customSymbols: ['component', 'para'] // TODO: remove these. keep it empty once files are fixed
    },

    // test configuration
    test: {
        // master switch for test execution
        perform: false,

        // test command to execute
        // TODO: 
        cmd: 'yarn test',

        // test config settings
        config: require('./test/options/test.json')
    },

    // package generation configuration
    pack: {
         // master switch for npm package creation
        perform: false,

        // command to run for package creation
        cmd: 'npm pack',

        // temp folder where package files are collected for package building
        temp: './temp/package',

        // where final created package is moved
        dest: './packages',

        // list of files and folders to be copied to temp folder
        // where package is created
        // all paths are to be mentioned in context of project root folder (./)
        files: []
    }
};
