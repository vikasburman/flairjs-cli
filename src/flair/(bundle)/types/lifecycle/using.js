/**
 * @name using
 * @description Ensures the dispose of the given object instance is called, even if there was an error 
 *              in executing processor function
 * @example
 *  using(obj, fn)
 * @params
 *  obj: object/string - object that needs to be processed by processor function or qualified name for which object will be created
 *                If a disposer is not defined for the object, it will not do anything
 *  fn: function - processor function
 * @returns any - returns anything that is returned by processor function, it may also be a promise
 */ 
const _using = (obj, fn) => {
    if (['instance', 'string'].indexOf(_typeOf(obj)) === -1) { throw new _Exception('InvalidArgument', 'Argument type is invalid. (obj)'); }
    if (_typeOf(fn) !== 'function') { throw new _Exception('InvalidArgument', 'Argument type is invalid. (fn)'); }

    // create instance, if need be
    if (typeof obj === 'string') { // qualifiedName
        let Type = _getType(obj);
        if (!Type) { throw new _Exception('InvalidArgument', 'Argument type is invalid. (obj)'); }
        obj = new Type(); // this does not support constructor args, for ease of use only.
    }

    let result = null,
        isDone = false,
        isPromiseReturned = false,
        doDispose = () => {
            if (!isDone && typeof obj._.dispose === 'function') {
                isDone = true; obj._.dispose();
            }
        };
    try {
        result = fn(obj);
        if (result && typeof result.finally === 'function') { // a promise is returned
            isPromiseReturned = true;
            result = result.finally((args) => {
                doDispose();
                return args;
            });
        }
    } finally {
        if (!isPromiseReturned) { doDispose(); }
    }

    // return
    return result;
};

// attach to flair
a2f('using', _using);