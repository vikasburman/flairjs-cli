const download = require('download-git-repo');
const { spawnSync } = require('child_process');

// do
const doTask = (argv, done) => {
    // get type
    let type = (argv._[1] || '').toLowerCase(),
        gitProject = '';

    switch(type) {
        case 'asm': gitProject = 'github:vikasburman/flairjs-template-asm'; break;
        case 'api': gitProject = 'github:vikasburman/flairjs-template-api'; break;
        case 'client': gitProject = 'github:vikasburman/flairjs-template-client-app'; break;
        case 'static': gitProject = 'github:vikasburman/flairjs-template-static-app'; break;
        case 'app': gitProject = 'github:vikasburman/flairjs-template-app'; break;
        case 'firebase': gitProject = 'github:vikasburman/flairjs-template-firebase-app'; break;
        default: console.log(`  Unknown type '${type}'`); break;
    }

    // download project
    if (gitProject) {
        console.log('   download: ');
        download(gitProject, process.cwd(), (err) => {
            if (err) {
                console.log(`       - error: ${err}`);
            } else {
                console.log(`       - done`);
                
                // install modules
                console.log('   modules: ');
                let child = spawnSync('yarn', ['install']);
                console.log(`       - done`);
            }
            
            // done
            done();
        });
    } else {
        // done
        done();
    }
};

exports.run = function(argv, cb) {
    console.log('flairCreate: (start)');
    doTask(argv, () => {
        console.log('flairCreate: (end)');
        cb();
    });
};