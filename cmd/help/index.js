// do
const doTask = (argv, done) => {
    let cmdName = (argv._[1] || '').toLowerCase();

    console.log('');
    console.log('FlairJS CLI - Help');
    console.log('');
    switch(cmdName) {
        case 'create':
            console.log('Usage: flair create --<type> [<name>]');
            console.log('');
            console.log('   create boilerplate project for specified type');
            console.log('');
            console.log('   type:');
            console.log('       asm      \t flairjs assembly project');
            console.log('       api      \t flairjs api project');
            console.log('       app      \t flairjs app project');
            console.log('       firebase \t flairjs firebase-app project');
            console.log('');
            console.log('   name: (optional)');
            console.log('       name of the project');
            console.log('');
            console.log('Example: flair create --app MyApp');
            break;
        case 'build':
            console.log('Usage: flair build --options <file> [flags]');
            console.log('');
            console.log('   assemble distribution files');
            console.log('');
            console.log('   --options <file>: build options file\'s location and name');
            console.log('       (refer online help to know the structure of build options file)');
            console.log('');
            console.log('   flags: (optional)');
            console.log('       --full | --quick  \t use full-set or quick-set options');
            console.log('       --flag <flagName> \t use given flag as default for distribution files');
            console.log('');
            console.log('Example: flair build --options ./config/build.json --full --flag prod');
            break;
        case 'flag':
            console.log('Usage: flair flag --options <file>');
            console.log('');
            console.log('   interactively set flag for distribution files');
            console.log('');
            console.log('   --options <file>: build options file\'s location and name');
            console.log('   (refer online help to know the structure of build options file)');
            console.log('');
            console.log('Example: flair flag --options ./config/build.json');
            break;            
        case 'pack':             
            console.log('Usage: flair pack --options <file>');
            console.log('');
            console.log('   create publish package(s)');
            console.log('');
            console.log('   --options <file>: package options file\'s location and name');
            console.log('   (refer online help to know the structure of package options file)');
            console.log('');
            console.log('Example: flair pack --options ./config/pack.json');
            break;            
        case 'test':
            console.log('Usage: flair test --options <file> [flags]');
            console.log('');
            console.log('   initiate tests execution');
            console.log('');
            console.log('   --options <file>: test options file\'s location and name');
            console.log('   (refer online help to know the structure of test options file)');
            console.log('');
            console.log('   flags: (optional)');
            console.log('       --server | --client \t initiate server-side or client-side tests execution');
            console.log('');
            console.log('Example: flair test --options ./config/test.json --client');
            break;            
        case 'help':
            console.log('Usage: flair help [cmd]');
            console.log('');
            console.log('   displays help information for a command');
            console.log('');
            console.log('   cmd: (optional)');
            console.log('       create');
            console.log('       build');
            console.log('       pack');
            console.log('       test');
            console.log('       flag');
            console.log('       help');
            break;
        default:
            console.log('Usage: flair command [options]');
            console.log('');
            console.log('   command:');
            console.log('       create --<type> [<name>]  \t create boilerplate project for specified type');
            console.log('       build --o <file> [flags]  \t assemble dist files');
            console.log('       test --o <file>           \t initiate tests execution');
            console.log('       pack --o <file>           \t create publish package(s)');
            console.log('       flag --o <file>           \t interactively set flag for dist files');
            console.log('       help [cmd]                \t displays help information for a command');
            break;
    };
    console.log('');

    // done
   done();
};

exports.run = function(argv, cb) {
    doTask(argv, cb);
};