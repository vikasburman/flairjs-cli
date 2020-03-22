const deepMerge = (objects, isMergeArray = true) => { // credit: https://stackoverflow.com/a/48218209
    const isObject = obj => obj && typeof obj === 'object';
    
    return objects.reduce((prev, obj) => {
        Object.keys(obj).forEach(key => {
            const pVal = prev[key];
            const oVal = obj[key];
        
            if (Array.isArray(pVal) && Array.isArray(oVal)) {
                if (isMergeArray) {
                    prev[key] = pVal.concat(...oVal); // merge array
                } else {
                    prev[key] = [].concat(...oVal); // overwrite as new array
                }
            } else if (isObject(pVal) && isObject(oVal)) {
                prev[key] = deepMerge([pVal, oVal], isMergeArray);
            } else {
                prev[key] = oVal;
            }
        });
        return prev;
    }, {});
};

module.exports = (source, target) => {
    return deepMerge([source, target], true); // merge arrays also - means arrays will be concatenated
};