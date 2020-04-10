(async ()=> {
	'use strict';

	// support
	const index = JSON.parse('<<json>>');
	const addScript = (file) => {
		return new Promise((resolve, reject) => {
			var head = document.getElementsByTagName('head')[0];
			var script = document.createElement('script');
			script.type = 'text/javascript';
			script.onload = resolve;
			script.onerror = resolve; // still resolve
			script.src = file;
			head.appendChild(script);
		});
	};	
	const loadAndRun = async (files) => {
		for (let file of files) { 
			await addScript(file);
		}
	};
	const getSpecs = () => {
		let p = new URLSearchParams(window.location.search),
			q = p.get('q'), 
			n = p.get('n') || '',
			specs = [];

		if (!q) { q = 'types'; n = index.coverage; } // compiled default
		switch(q) {
			case 'full':
				specs.push(...index.specs.unit);
				specs.push(...index.specs.func);
				specs.push(...index.specs.integration);
				specs.push(...index.specs.nonfunc);
				specs.push(...index.specs.system);
				specs.push(...index.specs.e2e);
				break;
			case 'quick':
				specs.push(...index.specs.unit);
				specs.push(...index.specs.func);
				break;
			case 'group':
				if (n && index.groups[n]) {
					specs.push(...index.groups[n]);
				}
				break;
			case 'types':
				if (n) {
					let types = n.split(',');
					for(let type of types) {
						if (index.specs[type]) {
							specs.push(...index.specs[type]);
						}
					}
				}
				break;
			default: // inbuild default (here)
				specs.push(...index.specs.unit);
				break;
		}

		// return
		return specs;
	};

	// 1: environment (client)
	await loadAndRun(index.env.client);
	window.flairTest = {}; // to share items across tests

	// 2: bundled helpers
	await loadAndRun(index.helpers);

	// 3: specs
	await loadAndRun(getSpecs());
})();