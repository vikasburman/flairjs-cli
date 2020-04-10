// do
const doTask = (argv, done) => {
    let cmdName = (argv._[1] || '').toLowerCase();

    console.log('');
    console.log('FlairJS CLI - Help');
    console.log('');
    switch(cmdName) {
        case 'create':
            console.log('Usage: flair create <type>');
            console.log('');
            console.log('   create boilerplate project for specified type');
            console.log('');
            console.log('   type:');
            console.log('       asm      \t flairjs assembly project');
            console.log('       api      \t flairjs server-side only, restful api project');
            console.log('       client   \t flairjs client-side only, single page app project');
            console.log('       static   \t flairjs client-side only, static app project');
            console.log('       app      \t flairjs full stack, single page app project');
            console.log('       firebase \t flairjs full stack, firebase app project');
            console.log('');
            console.log('Example: flair create app');
            break;
        case 'build':
            console.log('Usage: flair build [args]');
            console.log('');
            console.log('   build project assemblies');
            console.log('');
            console.log('   args: (optional)');
            console.log('       --full | --quick    \t quick or full build mode');
            console.log('       --flag name         \t use given flag as default for distribution files');
            console.log('       --nolog             \t does not display logs');
            console.log('');
            console.log('Example: flair build --full --flag prod');
            break;
        case 'flag':
            console.log('Usage: flair flag');
            console.log('');
            console.log('   interactively set flag for distribution files');
            console.log('');
            console.log('Example: flair flag');
            break;
        case 'test':
            console.log('Usage: flair test [args]');
            console.log('');
            console.log('   execute tests');
            console.log('');
            console.log('   args: (optional)');
            console.log('       --client                                                    \t execute tests in client environment');
            console.log('       --browser name                                              \t execute client environment in specified (pre-configured) browser');
            console.log('       --full | --quick | --group name | --types name, name, ...   \t execute specified set of specs');
            console.log('       --nolog                                                     \t does not display logs (excluding console reporter logs)');
            console.log('');
            console.log('Example: flair test --client --browser safari --group smoke');
            break; 
        case 'serve':
            console.log('Usage: flair serve [args]');
            console.log('');
            console.log('   start debug server');
            console.log('');
            console.log('   args: (optional)');
            console.log('       --client                \t start one server for serving client files');
            console.log('       --server                \t start another server for serving server files');
            console.log('');
            console.log('Example: flair serve --client');
            break;                    
        case 'docs':
            console.log('Usage: flair docs [args]');
            console.log('');
            console.log('   display project docs');
            console.log('');
            console.log('   args: (optional)');
            console.log('       --browser name          \t show docs in specified (pre-configured) browser');
            console.log('');
            console.log('Example: flair docs --browser safari');
            break;                     
        case 'help':
            console.log('Usage: flair help [cmd]');
            console.log('');
            console.log('   displays help information for a command');
            console.log('');
            console.log('   cmd: (optional)');
            console.log('       create');
            console.log('       build');
            console.log('       flag');
            console.log('       docs');
            console.log('       test');
            console.log('       serve');
            console.log('       help');
            break;
        default:
            console.log('Usage: flair command [args]');
            console.log('');
            console.log('   command:');
            console.log('       create [args] \t create boilerplate project structure');
            console.log('       build  [args] \t build project assemblies');
            console.log('       flag   [args] \t set flag for dist files');
            console.log('       docs   [args] \t display project docs');
            console.log('       test   [args] \t execute tests');
            console.log('       serve  [args] \t start/kill debug server');
            console.log('       help   [cmd]  \t displays help');
            break;
    };
    console.log('');

    // done
   done();
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};