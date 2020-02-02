// Written by and Copyright 2019 by Jeff Clemmer

/* 
right now, this code *does not* work in node.  node handles strings differently and strings can't be packed correctly.

so, to make it work, we need to detect if running in node or a browser
https://stackoverflow.com/questions/34550890/how-to-detect-if-script-is-running-in-browser-or-in-node-js
there are implications to the byte packer code in the way that node handles chars compared to a browser.
for some reason, node handles it differently, so we need to be able to detect and change behavior eventually...

// use in the following manner
var previous = {...}; // the original object
var latest = {...}; // contains any changes from the original object

// intermediary step - returns a json object of changes
var changes = changepack.encode(previous, latest);

// pack into one final buffer
var packedChanges = changepack.packChanges(changes);

// unpack a buffer into intermediary changes
var unpackedChanges = changepack.unpackChanges(packedChanges);

// get back final object with evolutions in place
var evolved = changepack.decode(previous, unpackedChanges);

// evolved should equal the same as latest
*/

var changepack = {};

let types = {
	0: "bool false",               // 0x00
	1: "bool true",                // 0x01
	2: "8 bit int",                // 0x02
	3: "16 bit int",               // 0x03
	4: "32 bit int",               // 0x04
	5: "64 bit int",               // 0x05
	6: "8 bit uint",               // 0x06
	7: "16 bit uint",              // 0x07
	8: "32 bit uint",              // 0x08
	9: "64 bit uint",              // 0x09
	10: "32 bit float",            // 0x0A
	11: "64 bit float",            // 0x0B
	12: "8 bit length string",     // 0x0C
	13: "16 bit length string",    // 0x0D
	14: "32 bit length string",    // 0x0E
	15: "64 bit length string",    // 0x0F
	16: "null",                    // 0x10
	17: "empty array",             // 0x11
	18: "empty object",            // 0x12
	
	240: "remove object",          // 0xF0
	
	255: "NOP",                    // 0xFF
}

/*
takes two javascript objects / arrays and finds the differences in them.

returns a packed array of strings for the representation of those differences
the new object is compared with the old.  only changes in the new object
from the old object will be represented
*/
changepack.encode = function(oldObj, newObj) {
  
	var startTime = new Date().getTime();
	
	// do some sanity checks
	if (typeof oldObj !== "object") {
		console.error("oldObj is not an object or array");
		return "";
	}
	
	if (typeof newObj !== "object") {
		console.error("newObj is not an object or array");
		return "";
	}
	
	// create a list of paths in the old and new objects
	var oldPaths = _paths(oldObj);
	var newPaths = _paths(newObj);
	
	// check for added paths and changed values
	var add = [];
	var text = "";
	for (var path in newPaths) {
		
		var change = "";
		var changed = false;
		
		if ( (path in oldPaths) == true) {
			// check to see if value has changed
			if (newPaths[path] != oldPaths[path]) {
				changed = true;
				text = "changing ";
			}
		} else {
			changed = true;
			text = "adding ";
		}
		
		if (changed == true) {
			var actionType = _getActionType(newPaths[path]);

			change += String.fromCharCode(actionType);
			change += _packString(path);
			change += _encodeValue(actionType, newPaths[path]);
			
			add.push({path: path, change: change, len: change.length, actionType: actionType, actionTypeTitle: types[actionType]});
		}
	}
	
	// check for removed paths
	var removeObj = {};
	var deepRemoval = {};
	for (var path in oldPaths) {
		
		var check = path.split(".");
		var cur = newObj;
		var path = "";
		
		for (var j = 0; j < check.length; j++) {
			path += path == "" ? check[j] : "." + check[j];
			
			if ( (check[j] in cur) == false) {
				// add to an object so we don't have duplicates.
				removeObj[path] = 0;
				break;
			} else {
				cur = cur[ check[j] ];
			}
		}
		
	}
	
	// go through the remove object and add anything to be removed
	var remove = [];
	for (var path in removeObj) {
		let change = String.fromCharCode(0xF0);
		change += _packString(path);
		
		remove.push({path: path, change: change, len: change.length, actionType: 0xF0, actionTypeTitle: types[0xF0]});
	}

	
	// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	
	return remove.concat(add);
}


// pack all changes into one buffer
changepack.packChanges = function(changes) {
	
	var startTime = new Date().getTime();
	
	// the final length of the packedChanges
	var len = 0;
	
	// add version to beginning of packed string
	var vbuffer = new ArrayBuffer(2);
	var vview = new DataView(vbuffer);
	vview.setUint16(0, 1); // version 1
	var vout = new Uint8Array(vbuffer);
	var packedChanges = String.fromCharCode.apply(null, vout);
	len += 2;
	
	var actionType = 0;
	
	for (var i in changes) {

		if (changes[i].len <= 0xFF) {
			// is 8 bit string?
			actionType = 0x0C;
		} else if (changes[i].len <= 0xFFFF) {
			// is 16 bit string?
			actionType = 0x0D;
		} else if (changes[i].len <= 0xFFFFFFFF) {
			// is 32 bit string?
			actionType = 0x0E;
		}
		
		// one byte for each actionType
		len += 1;
		
		// create right sized buffer
		var buffer = new ArrayBuffer( 1 << (actionType - 0x0C) );
		var view = new DataView(buffer);
		
		// pack the right amount of length bytes
		if (actionType == 0x0C) {
			view.setUint8(0, changes[i].len);
			len += 1;
		} else if (actionType == 0x0D) {
			view.setUint16(0, changes[i].len);
			len += 2;
		} else if (actionType == 0x0E) {
			view.setUint32(0, changes[i].len);
			len += 4;
		}
		
		// the size of the actual change
		len += changes[i].len;
		
		// create a packable view of the buffer
		var out = new Uint8Array(buffer);
		
		// pack the change into a string
		packedChanges += 
		String.fromCharCode(actionType) + // the actionType
		String.fromCharCode.apply(null, out) + // the change length
		changes[i].change; // the actual change
	}
	
	// console.log("changepack packChanges time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	
	return {packedChanges: packedChanges, len: len};
}


// take a buffer change pack from packChanges and decodes it into individual change packs
changepack.unpackChanges = function(packedChanges) {

  var startTime = new Date().getTime();
	
	var changes = [];
	
	var curPos = 0;
	var buffer = new ArrayBuffer(8);
	var copy = new Uint8Array(buffer);
	
	// get version
	for (var t = 0; t < 2; t++) {
		copy[t] = packedChanges.charCodeAt(t);
	}
	var view = new DataView(buffer);
	var version = view.getUint16(0);
	
	if (version == 1) {
		while (curPos < packedChanges.length) {
			
			// decode action
			var actionType = packedChanges.charCodeAt(curPos);
			curPos += 1;
			
			var change = "";
			var len = 0;
			
			// decode change
			if (actionType >= 0x0C && actionType <= 0x0F) {
				let bufLen = 1 << (actionType - 0x0C);
				for (var t = 0; t < bufLen; t++) {
					copy[t] = packedChanges.charCodeAt(curPos + t);
				}
				
				switch (actionType) {
					case 0x0C: // 8 bit string
						len = view.getUint8(0);
						break;
					case 0x0D: // 16 bit string
						len = view.getUint16(0);
						break;
					case 0x0E: // 32 bit string
						len = view.getUint32(0);
						break;
				}
				curPos += bufLen;
				
				change = packedChanges.slice(curPos, curPos + len);
				curPos += len;
				
				changes.push({change: change, len: len});
			}
		}
	}
	
	// console.log("changepack unpackChanges time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	
	return changes;
}



// takes a change set and applies it to an existing object / array
// returns an object representing the changes made to oldObj
changepack.decode = function(oldObj, changes) {

  var startTime = new Date().getTime();
	
	var buffer = new ArrayBuffer(8);
	var copy = new Uint8Array(buffer);
	
	for (var i in changes) {
		
		var curPos = 0;
		
		// decode action
		var actionType = changes[i].change.charCodeAt(curPos);
		curPos += 1;
		
		// decode path
		var pathLen = changes[i].change.charCodeAt(curPos);
		curPos += 1;
		
		var path = changes[i].change.slice(curPos, curPos + pathLen);
		curPos += pathLen;
		
		// decode value, if necessary
		var value;
		
		switch (actionType) {
			case 0x00:
				value = false;
				break;
			case 0x01:
				value = true;
				break;
			case 0x10:
				value = null;
				break;
			case 0x11:
				value = [];
				break;
			case 0x12:
				value = {};
				break;
			case 0xFF:
				// nop
		}
		
		
		if (actionType >= 0x02 && actionType <= 0x0F) {
			
			var bufLen = 0;
			if (actionType >= 0x02 && actionType <= 0x05) {
				bufLen = 1 << (actionType - 0x02);
			} else if (actionType >= 0x06 && actionType <= 0x09) {
				bufLen = 1 << (actionType - 0x06);
			} else if (actionType == 0x0A || actionType == 0x0B) {
				bufLen = 4 << (actionType - 0x0A);
			} else if (actionType >= 0x0C && actionType <= 0x0F) {
				bufLen = 1 << (actionType - 0x0C);
			}
			
			for (var t = 0; t < bufLen; t++) {
				copy[t] = changes[i].change.charCodeAt(curPos + t);
			}
			
			var view = new DataView(buffer);
			
			switch (actionType) {
				case 0x02: // int8
					value = view.getInt8(0);
					break;
				case 0x03: // int16
					value = view.getInt16(0);
					break;
				case 0x04: // int32
					value = view.getInt32(0);
					break;
				case 0x05: // int64
					// value = view.getUint64...(0);
					break;
				case 0x0C: // 8 bit string
				case 0x06: // uint8
					value = view.getUint8(0);
					break;
				case 0x0D: // 16 bit string
				case 0x07: // uint16
					value = view.getUint16(0);
					break;
				case 0x0E: // 32 bit string
				case 0x08: // uint32
					value = view.getUint32(0);
					break;
				case 0x0F: // 64 string
				case 0x09: // uint64
					// value = view.getUint64...(0);
					break;
				case 0x0A: // float32
					value = view.getFloat32(0);
					break;id.length
				case 0x0B: // float64
					value = view.getFloat64(0);
			}
			
			if (actionType >= 0x0C && actionType <= 0x0F) {
				var len = value;
				curPos += bufLen; // 1 << (actionType - 0x0C); - bufLen contains the same thing
				value = changes[i].change.slice(curPos, curPos + len);
			}
		}
		
		// replay changes on oldObj
		if (actionType == 0xF0) {
			// do field removals
			oldObj = _decodePathAndRemove(oldObj, path);
		} else {
			// do field additions and changes
			oldObj = _decodePathAndAssign(oldObj, path, value);
		}
		
	}
	
	// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	
	return oldObj;
}


// do a quick check to see if anything has changed
// useful to find out if something has changed, without going through the encoding process
changepack.quickCheck = function(oldObj, newObj) {

  var startTime = new Date().getTime();

	// create a list of paths in the old object
	var oldPaths = _paths(oldObj);
	var newPaths = _paths(newObj);
	
	// check for any additions or changes
	for (var path in newPaths) {
		if ( (path in oldPaths) == true) {
			if (
				newPaths[path] != oldPaths[path] && 
				(Object.keys(oldPaths[path]).length == 0 && Object.keys(newPaths[path]).length == 0) == false &&
				(newo.length == 0 && oldo.length == 0) == false
			) {
				return true;
			}
		} else {
			return true;
		}
	}
	
	// check for any deletions
	for (var path in oldPaths) {
		if ( (path in newPaths) == false) {
			// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
			return true;
		}
	}
	
	// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	return false;
}


// private methods


// decode the chain of a flat path and remove that key
function _decodePathAndRemove(obj, path) {
	var tpath = path.split(".");
	
	// sanity
	if (tpath.length == 0) return obj;
	
	// define references to top level object
	var object = obj;
	var cur = obj;
	var lastCur = cur;
	for (var t = 0; t < tpath.length-1; t++) {
		if ( (tpath[t] in cur) == true) {
			// go to next key
			lastCur = cur;
			cur = cur[ tpath[t] ];
		}
	}
	
	// delete the key
	if (cur != undefined) {
		delete cur[ tpath[ tpath.length-1 ] ];
		
		// check for empty object and go up one level and delete the higher up as well
		if (Object.keys( cur ).length === 0) {
			if ( (lastCur instanceof Array) == true ) {
				lastCur.splice(tpath[ tpath.length-2 ], 1);
			}
		}
	}
	
	return object;
}

// decode the chain of a flat path and assign the value to that path
function _decodePathAndAssign(obj, path, value) {

	// sanity
	if (obj == undefined) throw "object is not defined";
	
	var tpath = path.split(".");
	
	// sanity
	if (tpath.length == 0) return obj;

	// if the top level is an array, make the object an array
	// otherwise, leave it alone
	// if something already exists, leave it alone
	// obj = isNaN(tpath[0]) == false ? (obj instanceof Array) == false ? [] : obj : obj;
	
	
	
	// if (isNaN(tpath[0]) == false) {
	// 	if ( (obj instanceof Array) == false ) {
	// 		obj = [];
	// 	}
	// }
	
	
	// object to build upon
	var cur = obj;
	// reference to top level
	var object = obj;
	
	// do we need to create the key and write the value?
	for (var t = 0; t < tpath.length; t++) {
		
		// does the key exist?
		if ( (tpath[t] in cur) == false) {
			
			// check if cur[t+1] is an object or an array, otherwise write the value
			if ( t+1 < tpath.length && isNaN(tpath[t+1]) == false) {
				// looks like an array
				cur[ tpath[t] ] = [];
				
			} else if (t+1 < tpath.length && isNaN(tpath[t+1]) == true) {
				// looks like an object
				cur[ tpath[t] ] = {};
				
			} else {
				// write value into cur
				cur[ tpath[t] ] = value;
			}
			
		} else if ( (tpath[t] in cur) == true && t+1 == tpath.length ) {
			// if we get here, the path already exists and we just need to write the value
			cur[ tpath[t] ] = value;
		}

		// go to next path member
		cur = cur[ tpath[t] ];
		
	}
	
	return object;
}


// packs the value into a string
function _encodeValue(actionType, value) {
	if (actionType == 0x00) {
		
		// is bool false?
		// don't encode anything.  it's in the actionType
		
	} else if (actionType == 0x01) {
		
		// is bool true?
		// don't encode anything.  it's in the actionType
		
	} else if (actionType == 0x02) {
		
		// is 8 bit int?
		var buffer = new ArrayBuffer(1);
		var view = new DataView(buffer);
		view.setInt8(0, value);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x03) {
		
		// is 16 bit int?
		var buffer = new ArrayBuffer(2);
		var view = new DataView(buffer);
		view.setInt16(0, value);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x04) {
		
		// is 32 bit int?
		var buffer = new ArrayBuffer(4);
		var view = new DataView(buffer);
		view.setInt32(0, value);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x05) {
		// is 64 bit int?
		
	} else if (actionType == 0x06) {
		
		// is 8 bit uint?
		var buffer = new ArrayBuffer(1);
		var view = new DataView(buffer);
		view.setUint8(0, value);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x07) {
		
		// is 16 bit uint?
		var buffer = new ArrayBuffer(2);
		var view = new DataView(buffer);
		view.setUint16(0, value);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x08) {
		
		// is 32 bit uint?
		var buffer = new ArrayBuffer(4);
		var view = new DataView(buffer);
		view.setUint32(0, value);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x09) {
		// is 64 bit uint?
		
	} else if (actionType == 0x0A) {
		// is 32 bit float?
		
	} else if (actionType == 0x0B) {
		
		// is 64 bit float?
		var buffer = new ArrayBuffer(8);
		var view = new DataView(buffer);
		view.setFloat64(0, value);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x0C) {

		// is 8 bit length string?
		var buffer = new ArrayBuffer(1);
		var view = new DataView(buffer);
		view.setUint8(0, value.length);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out) + value;
		
	} else if (actionType == 0x0D) {

		// is 16 bit length string?
		var buffer = new ArrayBuffer(2);
		var view = new DataView(buffer);
		view.setUint16(0, value.length);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out) + value;
		
	} else if (actionType == 0x0E) {

		// is 32 bit length string?
		var buffer = new ArrayBuffer(4);
		var view = new DataView(buffer);
		view.setUint32(0, value.length);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out) + value;

	} else if (actionType == 0x0F) {
		// is 64 bit length string?
	} else if (actionType == 0x10) {
		// is null?
		// don't encode anything.  it's in the actionType
	} else if (actionType == 0x11) {
		// is empty array?
		// don't encode anything.  it's in the actionType
	} else if (actionType == 0x12) {
		// is empty object?
		// don't encode anything.  it's in the actionType
	}
	
	return "";
}


// packs a string into binary format
function _packString(value) {
	
	if (value.length <= 0xFF) {
		// is 8 bit string?
		var buffer = new ArrayBuffer(value.length + 1);
		var view = new Uint8Array(buffer);
		view[0] = value.length;
		for (var t = 0; t < value.length; t++) {
			view[t+1] = value.charCodeAt(t);
		}
		
		return String.fromCharCode.apply(null, view);
	} else {
		console.error("string to pack was too long.  must be less than 256 chars");
	}
	return "";
}


// checks the type and creates the actionType byte
function _getActionType(value) {
	
	// is number?
	if (typeof value == "number") {
		// what kind of number?  float or int
		if ( (value | 0) == value) {
			
			// int
			
			// what type of minor int is it?
			if (value >= 0x00 && value <= 0xFF) {
				// is 8 bit uint?
				return 0x06;
			} else if (value >= 0x00 && value <= 0xFFFF) {
				// is 16 bit uint?
				return 0x07;
			} else if (value >= 0x00 && value <= 0xFFFFFFFF) {
				// is 32 bit uint?
				return 0x08;
				
			} else if (value >= -128 && value < 0) {
				// is 8 bit int?
				return 0x02;
			} else if (value >= -32768 && value < 0) {
				// is 16 bit int?
				return 0x03;
			} else if (value >= -2147483648 && value < 0) {
				// is 32 bit int?
				return 0x04;
			}
			
		} else {
			
			// is a float?  return a 64 bit float for now
			return 0x0B;
		}
	}
	
	// is value a string?
	if (typeof value == "string") {
		if (value.length <= 0xFF) {
			// is 8 bit string?
			return 0x0C;
		} else if (value.length <= 0xFFFF) {
			// is 16 bit string?
			return 0x0D;
		} else if (value.length <= 0xFFFFFFFF) {
			// is 32 bit string?
			return 0x0E;
		}
	}
	
	// is value a bool?
	if (typeof value == "boolean") {
		return (value ? true : false);
	}
	
	// is value a null?
	if (value == null) {
		return 0x10;
	}

	// is value an empty object?
	if ( (value instanceof Array) == true) {
		return 0x11;
	}
	
	// is value an empty array?
	if ( (value instanceof Object) == true) {
		return 0x12;
	}
	
	// won't match anything and is reserved
	return 0xFF;
}

// this outputs an array of {path: "", value: ""} objects
// with inspiration from: https://stackoverflow.com/a/40053014
// this implements something similar to a directory descending algorithm.
// if it finds objects with sub elements, it pushes those onto a stack 
// and pulls them out later, as if they were sub directories, so to speak.  
// otherwise, this finalizes the element with a path
function _paths(obj) {
	
	var paths = {};
	var objects = [ {path: "", obj: obj} ];
	
	while (objects.length > 0) {
		
		var obj = objects.shift();
		
		if (obj == null) continue;
		
		var keys = Object.keys( obj.obj );
		
		// if we have an empty something, write it anyways, but not if it's
		// objects[0] aka the first objects item with a blank path
		if (keys.length == 0 && obj.path != "") {
			paths[ obj.path ] = obj.obj;
		}
		
		for (var key in keys) {
			if ( obj.obj[ keys[key] ] instanceof Object || obj.obj[ keys[key] ] instanceof Array ) {
				// if we have an object, that means that we have sub elements underneath.  push these on the stack and get them later
				objects.push({
					path: obj.path == "" ? keys[key] : obj.path + "." + keys[key], 
					obj: obj.obj[ keys[key] ],
				});
			} else {
				if ( Object.prototype.toString.call( obj.obj[ keys[key] ] ) != "[object Array]" ) {
					// this element is an actual value of something.  finalize it and put it in paths for returning to the caller
					paths[ obj.path == "" ? keys[key] : obj.path + "." + keys[key] ] = obj.obj[ keys[key] ];
				}
			}
		}
	}
	
	return paths;
}
